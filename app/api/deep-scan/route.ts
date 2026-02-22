import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  fetchTokenTransfers,
  detectContracts,
  getTokenBalanceBatch,
  fetchFundingSources,
} from '@/lib/avax';
import {
  GraphNode,
  GraphLink,
  TransferTx,
  ScanResult,
} from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';
import { analyzeHoldings } from '@/lib/holdings-analyzer';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { withOverallTimeout } from '@/lib/fetch-with-timeout';

interface DeepScanBody {
  wallet: string;
  tokenAddress: string;
  decimals?: number;
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
        firstSeen: ts,
        lastSeen: ts,
      });
    }
    const fromNode = nodeMap.get(from)!;
    fromNode.txCount++;
    fromNode.volOut += value;
    fromNode.firstSeen = Math.min(fromNode.firstSeen, ts);
    fromNode.lastSeen = Math.max(fromNode.lastSeen, ts);

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
        firstSeen: ts,
        lastSeen: ts,
      });
    }
    const toNode = nodeMap.get(to)!;
    toNode.txCount++;
    toNode.volIn += value;
    toNode.firstSeen = Math.min(toNode.firstSeen, ts);
    toNode.lastSeen = Math.max(toNode.lastSeen, ts);

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

  return {
    nodes: Array.from(nodeMap.values()),
    links: Array.from(linkMap.values()),
  };
}

function deduplicateTransfers(transfers: TransferTx[]): TransferTx[] {
  const seen = new Set<string>();
  return transfers.filter((tx) => {
    const key = `${tx.hash}-${tx.from}-${tx.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runDeepScan(body: DeepScanBody) {
  const { wallet, tokenAddress, limit = 1000 } = body;
  const decimals = body.decimals ?? 18;

  // ── PHASE 1: Fetch target's transfers ──
  let allTransfers = await fetchTokenTransfers(wallet, tokenAddress, limit);

  // ── PHASE 2: Detect contracts ──
  const allAddresses = new Set<string>();
  for (const tx of allTransfers) {
    allAddresses.add(tx.from.toLowerCase());
    allAddresses.add(tx.to.toLowerCase());
  }
  const detectedContracts = await detectContracts(Array.from(allAddresses));
  const contractSet = new Set(detectedContracts);
  for (const addr of Object.keys(KNOWN_CONTRACTS)) {
    contractSet.add(addr);
  }

  // ── PHASE 3: Build initial graph + balances ──
  const { nodes, links } = buildGraph(allTransfers, wallet, decimals, contractSet);

  const nonContractWallets = nodes
    .filter((n) => !n.isContract)
    .map((n) => n.id);

  const balances = await getTokenBalanceBatch(nonContractWallets, tokenAddress, decimals);
  for (const node of nodes) {
    if (balances[node.id] !== undefined) {
      node.balance = balances[node.id];
    }
  }

  // ── PHASE 4: Fetch funding sources ──
  const walletsToCheck = nonContractWallets.slice(0, 50);
  const fundingSources = await fetchFundingSources(walletsToCheck);

  // ── PHASE 5: Run holdings analysis ──
  const scanResult: ScanResult = {
    nodes,
    links,
    transfers: allTransfers,
    detectedContracts,
    balances,
    fundingSources,
  };

  const holdingsReport = analyzeHoldings(scanResult, wallet, 'TOKEN', fundingSources);

  // ── PHASE 6: Recursive scan for HIGH confidence wallets (2-hop) ──
  const highWallets = holdingsReport.wallets.filter((w) => w.confidence === 'high');

  if (highWallets.length > 0) {
    const recursiveTargets = highWallets
      .slice(0, 5)
      .map((w) => w.address.toLowerCase());

    const secondaryTransfers = await Promise.all(
      recursiveTargets.map((addr) =>
        fetchTokenTransfers(addr, tokenAddress, Math.floor(limit / 2))
      )
    );

    for (const txs of secondaryTransfers) {
      allTransfers = allTransfers.concat(txs);
    }
    allTransfers = deduplicateTransfers(allTransfers);

    const expandedAddresses = new Set<string>();
    for (const tx of allTransfers) {
      expandedAddresses.add(tx.from.toLowerCase());
      expandedAddresses.add(tx.to.toLowerCase());
    }

    const newAddresses = Array.from(expandedAddresses).filter(
      (a) => !allAddresses.has(a)
    );
    if (newAddresses.length > 0) {
      const newContracts = await detectContracts(newAddresses);
      for (const c of newContracts) contractSet.add(c);
    }

    const expanded = buildGraph(allTransfers, wallet, decimals, contractSet);

    const newWallets = expanded.nodes
      .filter((n) => !n.isContract && balances[n.id] === undefined)
      .map((n) => n.id);

    if (newWallets.length > 0) {
      const newBalances = await getTokenBalanceBatch(newWallets, tokenAddress, decimals);
      Object.assign(balances, newBalances);
    }

    for (const node of expanded.nodes) {
      if (balances[node.id] !== undefined) {
        node.balance = balances[node.id];
      }
    }

    const newWalletsForFunding = newWallets.slice(0, 30);
    if (newWalletsForFunding.length > 0) {
      const newFunding = await fetchFundingSources(newWalletsForFunding);
      Object.assign(fundingSources, newFunding);
    }

    const expandedScanResult: ScanResult = {
      nodes: expanded.nodes,
      links: expanded.links,
      transfers: allTransfers,
      detectedContracts: Array.from(contractSet),
      balances,
      fundingSources,
    };

    const finalReport = analyzeHoldings(expandedScanResult, wallet, 'TOKEN', fundingSources);

    return { scanResult: expandedScanResult, holdingsReport: finalReport };
  }

  return { scanResult, holdingsReport };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'deep-scan', 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 1 minute.' },
      { status: 429, headers: getRateLimitHeaders(rl.remaining, 30) }
    );
  }

  try {
    const body: DeepScanBody = await req.json();
    const { wallet, tokenAddress } = body;

    if (!wallet || !tokenAddress) {
      return NextResponse.json(
        { error: 'wallet and tokenAddress are required' },
        { status: 400 }
      );
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
    }

    const result = await withOverallTimeout(runDeepScan(body), 120_000, 'Deep scan');

    return NextResponse.json(result, {
      headers: getRateLimitHeaders(rl.remaining, 30),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
