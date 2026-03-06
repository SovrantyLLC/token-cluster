import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  fetchTokenTransfers,
  detectContracts,
  getTokenBalanceBatch,
  fetchFundingSources,
  fetchCrossAssetLinks,
  discoverCrossAssetPeers,
} from '@/lib/avax';
import {
  GraphNode,
  GraphLink,
  TransferTx,
  ScanResult,
  WalletHistory,
  LPPosition,
  VLPStakingPosition,
} from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';
import { analyzeHoldings } from '@/lib/holdings-analyzer';
import { findLPPairs, getLPPositions, getStakedVLPPositions } from '@/lib/lp-detection';
import { getStakingPositions, StakingPosition } from '@/lib/staking';
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
        netPosition: null,
        firstSeen: ts,
        lastSeen: ts,
        peakBalance: null,
        peakDate: null,
        isGhost: false,
        disposition: null,
        lpBalance: 0,
        stakedBalance: 0,
        totalHoldings: 0,
        lpPositions: [],
        stakingPositions: [],
        vlpStaking: null,
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
        netPosition: null,
        firstSeen: ts,
        lastSeen: ts,
        peakBalance: null,
        peakDate: null,
        isGhost: false,
        disposition: null,
        lpBalance: 0,
        stakedBalance: 0,
        totalHoldings: 0,
        lpPositions: [],
        stakingPositions: [],
        vlpStaking: null,
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

  // Calculate net position for each node
  const allNodes = Array.from(nodeMap.values());
  for (const node of allNodes) {
    node.netPosition = node.volIn - node.volOut;
  }

  return {
    nodes: allNodes,
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

function attachLPToNodes(
  nodes: GraphNode[],
  lpPositions: Record<string, LPPosition[]>
) {
  for (const node of nodes) {
    const positions = lpPositions[node.id];
    if (positions && positions.length > 0) {
      node.lpPositions = positions;
      node.lpBalance = positions.reduce((s, p) => s + p.userFldShare, 0);
    }
    node.totalHoldings = (node.balance ?? 0) + node.lpBalance + node.stakedBalance;
  }
}

function attachStakingToNodes(
  nodes: GraphNode[],
  stakingPositions: Record<string, StakingPosition[]>
) {
  for (const node of nodes) {
    const positions = stakingPositions[node.id];
    if (positions && positions.length > 0) {
      node.stakingPositions = positions.map((p) => ({
        contractAddress: p.contractAddress,
        contractLabel: p.contractLabel,
        stakedAsset: p.stakedAsset,
        stakedAmount: p.stakedAmount,
        underlyingFLD: p.underlyingFLD,
        lpPairAddress: p.lpPairAddress,
        lpShareOfFLD: p.lpShareOfFLD,
        sharePercentage: p.sharePercentage,
      }));
      node.stakedBalance = positions.reduce((s, p) => s + p.underlyingFLD, 0);
    }
    node.totalHoldings = (node.balance ?? 0) + node.lpBalance + node.stakedBalance;
  }
}

function buildLPReserves(
  lpPositions: Record<string, LPPosition[]>
): Record<string, { fldReserve: number; totalSupply: number }> {
  const reserves: Record<string, { fldReserve: number; totalSupply: number }> = {};
  for (const positions of Object.values(lpPositions)) {
    for (const p of positions) {
      if (!reserves[p.pairAddress]) {
        reserves[p.pairAddress] = { fldReserve: p.fldReserve, totalSupply: p.totalSupply };
      }
    }
  }
  return reserves;
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

  // ── PHASE 2.5: Discover LP pairs ──
  const lpPairs = await findLPPairs(tokenAddress);

  // ── PHASE 3: Build initial graph + balances ──
  let { nodes, links } = buildGraph(allTransfers, wallet, decimals, contractSet);

  const nonContractWallets = nodes
    .filter((n) => !n.isContract)
    .map((n) => n.id);

  const balances = await getTokenBalanceBatch(nonContractWallets, tokenAddress, decimals);
  for (const node of nodes) {
    if (balances[node.id] !== undefined) {
      node.balance = balances[node.id];
    }
  }

  // ── PHASE 3.5: Check LP positions for all non-contract wallets ──
  let lpPositions: Record<string, LPPosition[]> = {};
  if (lpPairs.length > 0) {
    lpPositions = await getLPPositions(nonContractWallets, tokenAddress, decimals, lpPairs);
    attachLPToNodes(nodes, lpPositions);
  }

  // ── PHASE 3.7: Check staking positions (token-specific) ──
  const lpReserves = buildLPReserves(lpPositions);
  const stakingPositions = await getStakingPositions(nonContractWallets, tokenAddress, decimals, lpReserves);
  if (Object.keys(stakingPositions).length > 0) {
    attachStakingToNodes(nodes, stakingPositions);
  }

  // ── PHASE 4: Fetch funding sources ──
  const walletsToCheck = nonContractWallets.slice(0, 50);
  const fundingSources = await fetchFundingSources(walletsToCheck);

  // ── PHASE 4.5: Fetch transfers for ghost wallet detection ──
  const fetchedWallets = new Set<string>([wallet.toLowerCase()]);

  const ghostCandidates = nodes
    .filter((n) => {
      if (n.isContract || n.isTarget) return false;
      return n.volIn > 0;
    })
    .sort((a, b) => {
      const aZero = balances[a.id] === 0 ? 0 : 1;
      const bZero = balances[b.id] === 0 ? 0 : 1;
      if (aZero !== bZero) return aZero - bZero;
      return b.volIn - a.volIn;
    })
    .map((n) => n.id)
    .filter((addr) => !fetchedWallets.has(addr))
    .slice(0, 10);

  if (ghostCandidates.length > 0) {
    for (let i = 0; i < ghostCandidates.length; i += 3) {
      const batch = ghostCandidates.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map((addr) =>
          fetchTokenTransfers(addr, tokenAddress, Math.floor(limit / 2))
        )
      );
      for (const txs of batchResults) {
        allTransfers = allTransfers.concat(txs);
      }
      for (const addr of batch) fetchedWallets.add(addr);
      if (i + 3 < ghostCandidates.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    allTransfers = deduplicateTransfers(allTransfers);

    const ghostExpandedAddrs = new Set<string>();
    for (const tx of allTransfers) {
      ghostExpandedAddrs.add(tx.from.toLowerCase());
      ghostExpandedAddrs.add(tx.to.toLowerCase());
    }
    const ghostNewAddrs = Array.from(ghostExpandedAddrs).filter(
      (a) => !allAddresses.has(a)
    );
    if (ghostNewAddrs.length > 0) {
      const ghostNewContracts = await detectContracts(ghostNewAddrs);
      for (const c of ghostNewContracts) contractSet.add(c);
      for (const a of ghostNewAddrs) allAddresses.add(a);
    }

    const rebuilt = buildGraph(allTransfers, wallet, decimals, contractSet);
    nodes = rebuilt.nodes;
    links = rebuilt.links;

    const ghostNewWalletIds = nodes
      .filter((n) => !n.isContract && balances[n.id] === undefined)
      .map((n) => n.id);
    if (ghostNewWalletIds.length > 0) {
      const ghostNewBals = await getTokenBalanceBatch(
        ghostNewWalletIds,
        tokenAddress,
        decimals
      );
      Object.assign(balances, ghostNewBals);
    }
    for (const node of nodes) {
      if (balances[node.id] !== undefined) {
        node.balance = balances[node.id];
      }
    }

    // Re-attach LP positions to rebuilt nodes
    if (lpPairs.length > 0) {
      const newLPWallets = ghostNewWalletIds.filter((w) => !lpPositions[w]);
      if (newLPWallets.length > 0) {
        const newLP = await getLPPositions(newLPWallets, tokenAddress, decimals, lpPairs);
        Object.assign(lpPositions, newLP);
      }
      attachLPToNodes(nodes, lpPositions);
    }

    // Re-check staking for new wallets
    const ghostNewStakingWallets = ghostNewWalletIds.filter((w) => !stakingPositions[w]);
    if (ghostNewStakingWallets.length > 0) {
      const updatedReserves = buildLPReserves(lpPositions);
      const newStaking = await getStakingPositions(ghostNewStakingWallets, tokenAddress, decimals, updatedReserves);
      Object.assign(stakingPositions, newStaking);
    }
    if (Object.keys(stakingPositions).length > 0) {
      attachStakingToNodes(nodes, stakingPositions);
    }
  }

  // ── PHASE 4.7: Cross-asset correlation (AVAX/USDC/USDT between cluster wallets) ──
  // Only check target + direct peers (wallets with token transfers to/from target)
  // to keep API calls manageable. This is the set most likely to reveal same-owner.
  const targetLowerCA = wallet.toLowerCase();
  const directPeers = new Set<string>();
  directPeers.add(targetLowerCA);
  for (const tx of allTransfers) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    if (from === targetLowerCA && !contractSet.has(to)) directPeers.add(to);
    if (to === targetLowerCA && !contractSet.has(from)) directPeers.add(from);
  }
  const crossAssetWallets = Array.from(directPeers).slice(0, 30);
  const crossAssetLinks = crossAssetWallets.length >= 2
    ? await fetchCrossAssetLinks(crossAssetWallets)
    : [];

  // ── PHASE 4.8: Discover hidden wallets via cross-asset transfers ──
  // Find wallets the target sent/received AVAX/USDC/USDT to/from that are NOT
  // in the graph yet. If they hold the target token, they're "hidden" wallets
  // with no token transfer link but a clear funding relationship.
  const knownAddrs = new Set<string>();
  for (const n of nodes) knownAddrs.add(n.id);
  const crossAssetDiscovered = await discoverCrossAssetPeers(wallet, knownAddrs);

  if (crossAssetDiscovered.length > 0) {
    // Check which of these hold the target token
    const discoveredBalances = await getTokenBalanceBatch(
      crossAssetDiscovered.slice(0, 50), tokenAddress, decimals
    );
    const holders = Object.entries(discoveredBalances)
      .filter(([, bal]) => bal > 0)
      .map(([addr]) => addr);

    if (holders.length > 0) {
      // Add them as nodes in the graph (no token transfer links, but they hold the token)
      Object.assign(balances, discoveredBalances);
      for (const addr of holders) {
        const isContract = contractSet.has(addr);
        if (!isContract) {
          nodes.push({
            id: addr,
            address: addr,
            isTarget: false,
            isContract: false,
            label: null,
            txCount: 0,
            volIn: 0,
            volOut: 0,
            balance: discoveredBalances[addr] ?? 0,
            netPosition: 0,
            firstSeen: 0,
            lastSeen: 0,
            peakBalance: null,
            peakDate: null,
            isGhost: false,
            disposition: null,
            lpBalance: 0,
            stakedBalance: 0,
            totalHoldings: discoveredBalances[addr] ?? 0,
            lpPositions: [],
            stakingPositions: [],
            vlpStaking: null,
          });
        }
      }

      // Re-run cross-asset to include the newly discovered wallets
      const updatedPeers = new Set(directPeers);
      for (const addr of holders) updatedPeers.add(addr);
      const updatedCrossAssetWallets = Array.from(updatedPeers).slice(0, 40);
      const updatedCrossAssetLinks = await fetchCrossAssetLinks(updatedCrossAssetWallets);
      crossAssetLinks.push(...updatedCrossAssetLinks.filter(
        (l) => !crossAssetLinks.some(
          (e) => e.from === l.from && e.to === l.to && e.asset === l.asset
        )
      ));

      // Check LP and staking for discovered holders
      if (lpPairs.length > 0) {
        const discoveredLP = await getLPPositions(holders, tokenAddress, decimals, lpPairs);
        Object.assign(lpPositions, discoveredLP);
        attachLPToNodes(nodes, lpPositions);
      }
      const discoveredReserves = buildLPReserves(lpPositions);
      const discoveredStaking = await getStakingPositions(holders, tokenAddress, decimals, discoveredReserves);
      if (Object.keys(discoveredStaking).length > 0) {
        Object.assign(stakingPositions, discoveredStaking);
        attachStakingToNodes(nodes, stakingPositions);
      }
    }
  }

  // ── PHASE 4.9a: VLP staking via Ninety1 transfer events ──
  const NINETY1_STAKING = '0x17427aF0F2E0ed27856C3288Bb902115467e2540';
  const FATE_FLD_VLP = '0xcf55499e13bf758ddb9d40883c1e123ce18c2888';
  const vlpStakingPositions: Record<string, VLPStakingPosition> = {};
  const allWalletAddrs = nodes.filter(n => !n.isContract).map(n => n.id);
  if (allWalletAddrs.length > 0) {
    try {
      const vlpResults = await getStakedVLPPositions(
        allWalletAddrs, NINETY1_STAKING, FATE_FLD_VLP, decimals
      );
      Object.assign(vlpStakingPositions, vlpResults);
    } catch {
      // non-fatal
    }
  }
  for (const node of nodes) {
    const pos = vlpStakingPositions[node.id];
    if (pos) {
      node.vlpStaking = pos;
      node.stakedBalance = (node.stakedBalance || 0) + pos.fldEquivalent;
      node.totalHoldings = (node.balance ?? 0) + node.lpBalance + node.stakedBalance;
    }
  }

  // ── PHASE 4.9b: Cap graph size ──
  const MAX_NODES = 150;
  if (nodes.length > MAX_NODES) {
    nodes.sort((a, b) => {
      if (a.isTarget) return -1;
      if (b.isTarget) return 1;
      return (b.balance ?? 0) + b.volIn + b.volOut - ((a.balance ?? 0) + a.volIn + a.volOut);
    });
    const kept = new Set(nodes.slice(0, MAX_NODES).map((n) => n.id));
    nodes = nodes.filter((n) => kept.has(n.id));
    links = links.filter((l) => kept.has(l.source) && kept.has(l.target));
  }

  // ── PHASE 5: Run holdings analysis ──
  const scanResult: ScanResult = {
    nodes,
    links,
    transfers: allTransfers,
    detectedContracts,
    balances,
    fundingSources,
    lpPairs,
    lpPositions,
    stakingPositions,
    vlpStakingPositions,
    crossAssetLinks,
  };

  const holdingsReport = analyzeHoldings(scanResult, wallet, 'TOKEN', fundingSources);

  // ── PHASE 6: Recursive scan for HIGH confidence wallets (2-hop) ──
  const highWallets = holdingsReport.wallets.filter((w) => w.confidence === 'high');
  const recursiveTargets = highWallets
    .slice(0, 5)
    .map((w) => w.address.toLowerCase())
    .filter((addr) => !fetchedWallets.has(addr));

  if (recursiveTargets.length > 0) {

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

    // LP positions for expanded nodes
    if (lpPairs.length > 0) {
      const expandedLPWallets = expanded.nodes
        .filter((n) => !n.isContract && !lpPositions[n.id])
        .map((n) => n.id);
      if (expandedLPWallets.length > 0) {
        const expandedLP = await getLPPositions(expandedLPWallets, tokenAddress, decimals, lpPairs);
        Object.assign(lpPositions, expandedLP);
      }
      attachLPToNodes(expanded.nodes, lpPositions);
    }

    // Staking positions for expanded nodes
    const expandedStakingWallets = expanded.nodes
      .filter((n) => !n.isContract && !stakingPositions[n.id])
      .map((n) => n.id);
    if (expandedStakingWallets.length > 0) {
      const expandedReserves = buildLPReserves(lpPositions);
      const expandedStaking = await getStakingPositions(expandedStakingWallets, tokenAddress, decimals, expandedReserves);
      Object.assign(stakingPositions, expandedStaking);
    }
    if (Object.keys(stakingPositions).length > 0) {
      attachStakingToNodes(expanded.nodes, stakingPositions);
    }

    const newWalletsForFunding = newWallets.slice(0, 30);
    if (newWalletsForFunding.length > 0) {
      const newFunding = await fetchFundingSources(newWalletsForFunding);
      Object.assign(fundingSources, newFunding);
    }

    // Re-run cross-asset correlation with expanded wallet set (target + direct peers)
    const expandedDirectPeers = new Set<string>();
    expandedDirectPeers.add(targetLowerCA);
    for (const tx of allTransfers) {
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      if (from === targetLowerCA && !contractSet.has(to)) expandedDirectPeers.add(to);
      if (to === targetLowerCA && !contractSet.has(from)) expandedDirectPeers.add(from);
    }
    // Also include HIGH confidence wallets from first pass as peers
    for (const hw of highWallets) {
      expandedDirectPeers.add(hw.address.toLowerCase());
    }
    const expandedCrossAssetWallets = Array.from(expandedDirectPeers).slice(0, 40);
    const expandedCrossAssetLinks = expandedCrossAssetWallets.length >= 2
      ? await fetchCrossAssetLinks(expandedCrossAssetWallets)
      : [];

    // Cap expanded graph
    let expandedNodes = expanded.nodes;
    let expandedLinks = expanded.links;
    if (expandedNodes.length > MAX_NODES) {
      expandedNodes.sort((a, b) => {
        if (a.isTarget) return -1;
        if (b.isTarget) return 1;
        return (b.balance ?? 0) + b.volIn + b.volOut - ((a.balance ?? 0) + a.volIn + a.volOut);
      });
      const kept = new Set(expandedNodes.slice(0, MAX_NODES).map((n) => n.id));
      expandedNodes = expandedNodes.filter((n) => kept.has(n.id));
      expandedLinks = expandedLinks.filter((l) => kept.has(l.source) && kept.has(l.target));
    }

    const expandedScanResult: ScanResult = {
      nodes: expandedNodes,
      links: expandedLinks,
      transfers: allTransfers,
      detectedContracts: Array.from(contractSet),
      balances,
      fundingSources,
      lpPairs,
      lpPositions,
      stakingPositions,
      vlpStakingPositions,
      crossAssetLinks: expandedCrossAssetLinks,
    };

    const finalReport = analyzeHoldings(expandedScanResult, wallet, 'TOKEN', fundingSources);

    // Attach wallet history data to nodes
    attachHistoryToNodes(expandedNodes, finalReport.walletHistories);

    return { scanResult: expandedScanResult, holdingsReport: finalReport };
  }

  // Attach wallet history data to nodes
  attachHistoryToNodes(scanResult.nodes, holdingsReport.walletHistories);

  return { scanResult, holdingsReport };
}

function attachHistoryToNodes(nodes: GraphNode[], histories: WalletHistory[]) {
  const historyMap = new Map<string, WalletHistory>();
  for (const h of histories) historyMap.set(h.address.toLowerCase(), h);

  for (const node of nodes) {
    const history = historyMap.get(node.id);
    if (history) {
      node.peakBalance = history.peakBalance;
      node.peakDate = history.peakDate;
      node.isGhost = history.isGhost;
      node.disposition = history.disposition;
    }
  }
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

    const result = await withOverallTimeout(runDeepScan(body), 180_000, 'Deep scan');

    return NextResponse.json(result, {
      headers: getRateLimitHeaders(rl.remaining, 30),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
