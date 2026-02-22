import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { fetchTokenTransfers, detectContracts, getTokenBalanceBatch, fetchFundingSources } from '@/lib/avax';
import { GraphNode, GraphLink, TransferTx, ScanResult } from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { withOverallTimeout } from '@/lib/fetch-with-timeout';

interface ScanBody {
  wallet: string;
  tokenAddress: string;
  decimals?: number;
  depth?: number;
  limit?: number;
}

function buildGraph(
  transfers: TransferTx[],
  targetWallet: string,
  decimals: number,
  contractSet: Set<string>
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const linkMap = new Map<string, GraphLink>();
  const targetLower = targetWallet.toLowerCase();

  for (const tx of transfers) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    const value = parseFloat(ethers.formatUnits(tx.value, decimals));
    const ts = parseInt(tx.timeStamp, 10);

    // Upsert from-node
    if (!nodeMap.has(from)) {
      nodeMap.set(from, {
        id: from,
        address: tx.from,
        isTarget: from === targetLower,
        isContract: contractSet.has(from) || !!KNOWN_CONTRACTS[from],
        label: KNOWN_CONTRACTS[from] || null,
        txCount: 0,
        volIn: 0,
        volOut: 0,
        balance: null,
        netPosition: null,
        firstSeen: ts,
        lastSeen: ts,
        peakBalance: null,
        peakDate: null,
        isGhost: false,
        disposition: null,
      });
    }
    const fromNode = nodeMap.get(from)!;
    fromNode.txCount++;
    fromNode.volOut += value;
    fromNode.firstSeen = Math.min(fromNode.firstSeen, ts);
    fromNode.lastSeen = Math.max(fromNode.lastSeen, ts);

    // Upsert to-node
    if (!nodeMap.has(to)) {
      nodeMap.set(to, {
        id: to,
        address: tx.to,
        isTarget: to === targetLower,
        isContract: contractSet.has(to) || !!KNOWN_CONTRACTS[to],
        label: KNOWN_CONTRACTS[to] || null,
        txCount: 0,
        volIn: 0,
        volOut: 0,
        balance: null,
        netPosition: null,
        firstSeen: ts,
        lastSeen: ts,
        peakBalance: null,
        peakDate: null,
        isGhost: false,
        disposition: null,
      });
    }
    const toNode = nodeMap.get(to)!;
    toNode.txCount++;
    toNode.volIn += value;
    toNode.firstSeen = Math.min(toNode.firstSeen, ts);
    toNode.lastSeen = Math.max(toNode.lastSeen, ts);

    // Upsert link (directed: source -> target)
    const linkKey = `${from}->${to}`;
    if (!linkMap.has(linkKey)) {
      linkMap.set(linkKey, {
        source: from,
        target: to,
        value: 0,
        txCount: 0,
        direction: from === targetLower ? 'sent' : 'received',
      });
    }
    const link = linkMap.get(linkKey)!;
    link.value += value;
    link.txCount++;
  }

  const allNodes = Array.from(nodeMap.values());
  for (const node of allNodes) {
    node.netPosition = node.volIn - node.volOut;
  }

  return {
    nodes: allNodes,
    links: Array.from(linkMap.values()),
  };
}

async function runScan(body: ScanBody): Promise<ScanResult> {
  const { wallet, tokenAddress, depth = 1, limit = 1000 } = body;
  const decimals = body.decimals ?? 18;

  // Depth-1: fetch transfers for the target wallet
  let allTransfers = await fetchTokenTransfers(wallet, tokenAddress, limit);

  // Depth-2: expand top connected wallets
  if (depth >= 2 && allTransfers.length > 0) {
    const peerCounts = new Map<string, number>();
    const targetLower = wallet.toLowerCase();

    for (const tx of allTransfers) {
      const peer = tx.from.toLowerCase() === targetLower
        ? tx.to.toLowerCase()
        : tx.from.toLowerCase();
      if (peer !== targetLower) {
        peerCounts.set(peer, (peerCounts.get(peer) || 0) + 1);
      }
    }

    const topPeers = Array.from(peerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([addr]) => addr);

    const peerTransfers = await Promise.all(
      topPeers.map((peer) => fetchTokenTransfers(peer, tokenAddress, Math.floor(limit / 2)))
    );

    for (const transfers of peerTransfers) {
      allTransfers = allTransfers.concat(transfers);
    }

    // Deduplicate by tx hash + from + to
    const seen = new Set<string>();
    allTransfers = allTransfers.filter((tx) => {
      const key = `${tx.hash}-${tx.from}-${tx.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Collect all unique addresses for contract detection
  const allAddresses = new Set<string>();
  for (const tx of allTransfers) {
    allAddresses.add(tx.from.toLowerCase());
    allAddresses.add(tx.to.toLowerCase());
  }

  // Run contract detection
  const addressArray = Array.from(allAddresses);
  const detectedContracts = await detectContracts(addressArray);
  const contractSet = new Set(detectedContracts);

  // Add known contracts to the set
  for (const addr of Object.keys(KNOWN_CONTRACTS)) {
    contractSet.add(addr);
  }

  const { nodes, links } = buildGraph(allTransfers, wallet, decimals, contractSet);

  // Get balances for all non-contract wallets via multicall
  const nonContractWallets = nodes
    .filter((n) => !n.isContract)
    .map((n) => n.id);

  const balances = await getTokenBalanceBatch(nonContractWallets, tokenAddress, decimals);

  // Attach balances to nodes
  for (const node of nodes) {
    if (balances[node.id] !== undefined) {
      node.balance = balances[node.id];
    }
  }

  // Fetch funding sources for non-contract wallets
  const walletsToCheck = nonContractWallets.slice(0, 50);
  const fundingSources = await fetchFundingSources(walletsToCheck);

  return {
    nodes,
    links,
    transfers: allTransfers,
    detectedContracts,
    balances,
    fundingSources,
  };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'scan', 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 1 minute.' },
      { status: 429, headers: getRateLimitHeaders(rl.remaining, 30) }
    );
  }

  try {
    const body: ScanBody = await req.json();
    const { wallet, tokenAddress } = body;

    if (!wallet || !tokenAddress) {
      return NextResponse.json({ error: 'wallet and tokenAddress are required' }, { status: 400 });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
    }

    const result = await withOverallTimeout(runScan(body), 60_000, 'Scan');

    return NextResponse.json(result, {
      headers: getRateLimitHeaders(rl.remaining, 30),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
