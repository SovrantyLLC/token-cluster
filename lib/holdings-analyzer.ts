import {
  ScanResult,
  TransferTx,
  GraphNode,
  GraphLink,
  HiddenHoldingWallet,
  HoldingsReport,
  OutboundSummary,
  TokenOrigin,
} from './types';

interface WalletScore {
  address: string;
  score: number;
  reasons: string[];
  fundingSource: string | null;
  firstInteraction: number;
  lastInteraction: number;
  transfersWithTarget: number;
  netFlowFromTarget: number;
  balance: number;
  tokenOrigin: TokenOrigin;
  tokenOriginDetails: string;
}

function abbr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ── Token Origin Tracing ──────────────────────────────────────────────────── */

function traceTokenOrigin(
  walletAddr: string,
  target: string,
  transfers: TransferTx[],
  contractSet: Set<string>,
  decimals: number
): { origin: TokenOrigin; details: string } {
  const addr = walletAddr.toLowerCase();

  // Find all incoming transfers TO this wallet
  const incoming = transfers.filter((tx) => tx.to.toLowerCase() === addr);
  if (incoming.length === 0) return { origin: 'unknown', details: 'No incoming transfers found in scan data' };

  let fromTarget = 0;
  let fromDex = 0;
  let fromThirdParty = 0;
  let largestSource = '';
  let largestAmount = 0;
  let largestTs = 0;

  for (const tx of incoming) {
    const from = tx.from.toLowerCase();
    const value = parseFloat(tx.value) / Math.pow(10, decimals);

    if (from === target) {
      fromTarget += value;
    } else if (contractSet.has(from)) {
      fromDex += value;
    } else {
      fromThirdParty += value;
    }

    if (value > largestAmount) {
      largestAmount = value;
      largestSource = from;
      largestTs = parseInt(tx.timeStamp, 10);
    }
  }

  const total = fromTarget + fromDex + fromThirdParty;
  if (total === 0) return { origin: 'unknown', details: 'Zero-value transfers only' };

  const targetPct = fromTarget / total;
  const dexPct = fromDex / total;
  const thirdPct = fromThirdParty / total;

  let origin: TokenOrigin;
  let details: string;

  if (targetPct >= 0.7) {
    origin = 'from-target';
    details = `Received ${fmt(fromTarget)} directly from target`;
    if (largestTs > 0) details += ` (largest: ${fmt(largestAmount)} on ${fmtDate(largestTs)})`;
  } else if (dexPct >= 0.7) {
    origin = 'from-dex';
    details = `Acquired ${fmt(fromDex)} from DEX/contracts — likely independent buyer`;
  } else if (thirdPct >= 0.7) {
    origin = 'from-third-party';
    // Check if the third party is also connected to the target
    const thirdPartyConnected = transfers.some(
      (tx) =>
        (tx.from.toLowerCase() === largestSource && tx.to.toLowerCase() === target) ||
        (tx.to.toLowerCase() === largestSource && tx.from.toLowerCase() === target)
    );
    if (thirdPartyConnected) {
      details = `Received from ${abbr(largestSource)} (also connected to target) — intermediary pattern`;
    } else {
      details = `Received from third-party ${abbr(largestSource)}`;
    }
  } else {
    origin = 'mixed';
    const parts: string[] = [];
    if (fromTarget > 0) parts.push(`${fmt(fromTarget)} from target`);
    if (fromDex > 0) parts.push(`${fmt(fromDex)} from DEX`);
    if (fromThirdParty > 0) parts.push(`${fmt(fromThirdParty)} from other wallets`);
    details = `Mixed sources: ${parts.join(', ')}`;
  }

  return { origin, details };
}

/* ── Outbound Summary ──────────────────────────────────────────────────────── */

export function buildOutboundSummary(
  transfers: TransferTx[],
  targetWallet: string,
  contractSet: Set<string>,
  decimals: number,
  balances: Record<string, number>
): OutboundSummary {
  const target = targetWallet.toLowerCase();

  let toDexAmount = 0;
  let toDexCount = 0;
  let toWalletAmount = 0;
  let toWalletCount = 0;
  const toContractAmount = 0;
  const toContractCount = 0;

  const recipientAmounts = new Map<string, number>();

  for (const tx of transfers) {
    if (tx.from.toLowerCase() !== target) continue;
    const to = tx.to.toLowerCase();
    const value = parseFloat(tx.value) / Math.pow(10, decimals);

    // Known DEX routers are contracts too
    if (contractSet.has(to)) {
      // Distinguish between known DEX routers and other contracts
      // For simplicity, all contracts are "dex/contract" but DEX routers are the main ones
      toDexAmount += value;
      toDexCount++;
    } else {
      toWalletAmount += value;
      toWalletCount++;
      recipientAmounts.set(to, (recipientAmounts.get(to) || 0) + value);
    }
  }

  // "Other contracts" category for non-DEX contracts (we lump them all as "DEX" for now)
  // Split: DEX is contracts, "other contracts" is reserved for future use
  const totalOut = toDexAmount + toWalletAmount + toContractAmount;

  const topRecipients = Array.from(recipientAmounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([addr, amount]) => ({
      address: addr,
      amount,
      stillHolding: balances[addr] ?? 0,
    }));

  return {
    toDex: {
      amount: toDexAmount,
      percentage: totalOut > 0 ? (toDexAmount / totalOut) * 100 : 0,
      txCount: toDexCount,
    },
    toWallets: {
      amount: toWalletAmount,
      percentage: totalOut > 0 ? (toWalletAmount / totalOut) * 100 : 0,
      txCount: toWalletCount,
    },
    toContracts: {
      amount: toContractAmount,
      percentage: totalOut > 0 ? (toContractAmount / totalOut) * 100 : 0,
      txCount: toContractCount,
    },
    topRecipients,
  };
}

/* ── Main Analysis ─────────────────────────────────────────────────────────── */

export function analyzeHoldings(
  scanResult: ScanResult,
  targetWallet: string,
  tokenSymbol: string,
  fundingSources: Record<string, string>
): HoldingsReport {
  const target = targetWallet.toLowerCase();
  const { nodes, links, transfers, balances, detectedContracts } = scanResult;

  // Build contract set
  const contractSet = new Set(detectedContracts);

  // Get decimals from first transfer if available
  const decimals = transfers.length > 0 ? parseInt(transfers[0].tokenDecimal, 10) || 18 : 18;

  // Get target balance
  const targetNode = nodes.find((n) => n.id === target);
  const targetBalance = targetNode?.balance ?? 0;

  // Get all non-contract, non-target wallet nodes
  const walletNodes = nodes.filter((n) => !n.isContract && !n.isTarget);

  // Build lookup maps
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Build per-wallet transfer lists from raw transfers
  const walletTransfers = new Map<string, TransferTx[]>();
  for (const tx of transfers) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    if (from === target || to === target) {
      const peer = from === target ? to : from;
      if (!walletTransfers.has(peer)) walletTransfers.set(peer, []);
      walletTransfers.get(peer)!.push(tx);
    }
  }

  // Build link lookup: target -> peer and peer -> target
  const sentToMap = new Map<string, GraphLink>();
  const recvFromMap = new Map<string, GraphLink>();
  for (const l of links) {
    const src = typeof l.source === 'string' ? l.source : l.source;
    const tgt = typeof l.target === 'string' ? l.target : l.target;
    if (src === target) sentToMap.set(tgt, l);
    if (tgt === target) recvFromMap.set(src, l);
  }

  // Get all peers the target interacted with (for sequential nonce detection)
  const targetSentTxs = transfers
    .filter((tx) => tx.from.toLowerCase() === target)
    .sort((a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10));

  // Detect sequential sends
  const sequentialGroups = detectSequentialSends(targetSentTxs, target);
  const sequentialWallets = new Set<string>();
  for (const group of sequentialGroups) {
    for (const addr of group) sequentialWallets.add(addr);
  }

  // Compute funding source clusters
  const fundingClusters = new Map<string, string[]>();
  for (const [wallet, funder] of Object.entries(fundingSources)) {
    const funderLower = funder.toLowerCase();
    if (!fundingClusters.has(funderLower)) fundingClusters.set(funderLower, []);
    fundingClusters.get(funderLower)!.push(wallet.toLowerCase());
  }

  const targetFundingSource = fundingSources[target] ?? null;

  // Score each wallet
  const scores: WalletScore[] = [];

  for (const node of walletNodes) {
    const addr = node.id;
    let score = 0;
    const reasons: string[] = [];

    const peerTxs = walletTransfers.get(addr) || [];
    const sentLink = sentToMap.get(addr);
    const recvLink = recvFromMap.get(addr);

    // Calculate interaction timestamps
    let firstInteraction = Infinity;
    let lastInteraction = 0;
    for (const tx of peerTxs) {
      const ts = parseInt(tx.timeStamp, 10);
      if (ts < firstInteraction) firstInteraction = ts;
      if (ts > lastInteraction) lastInteraction = ts;
    }
    if (firstInteraction === Infinity) firstInteraction = 0;

    const transfersWithTarget = peerTxs.length;
    const sentToTarget = recvLink?.value ?? 0;
    const recvFromTarget = sentLink?.value ?? 0;
    const netFlowFromTarget = recvFromTarget - sentToTarget;

    // ── Token Origin Tracing ──
    const { origin: tokenOrigin, details: tokenOriginDetails } = traceTokenOrigin(
      addr,
      target,
      transfers,
      contractSet,
      decimals
    );

    // ── HEURISTIC 1: Bidirectional Transfers (30 points) ──
    if (sentLink && recvLink) {
      score += 30;
      reasons.push('Bidirectional transfers with target');
    }

    // ── HEURISTIC 2: Shared Funding Source (25 points) ──
    const walletFundingSource = fundingSources[addr] ?? null;
    if (walletFundingSource && targetFundingSource) {
      if (walletFundingSource.toLowerCase() === targetFundingSource.toLowerCase()) {
        score += 25;
        reasons.push(`Shared funding source: ${abbr(walletFundingSource)}`);
      }
    }
    if (walletFundingSource) {
      const cluster = fundingClusters.get(walletFundingSource.toLowerCase());
      if (cluster && cluster.length >= 2) {
        if (!reasons.some((r) => r.includes('Shared funding'))) {
          score += 20;
          reasons.push(`Shared gas funder with ${cluster.length - 1} other wallet(s)`);
        }
      }
    }

    // ── HEURISTIC 3: Timing Correlation (15 points) ──
    const timingScore = checkTimingCorrelation(peerTxs, target);
    if (timingScore > 0) {
      score += timingScore;
      reasons.push('Rapid transfer timing (< 5 min windows)');
    }

    // ── HEURISTIC 4: Sequential Nonce Patterns (10 points) ──
    if (sequentialWallets.has(addr)) {
      score += 10;
      reasons.push('Sequential send pattern from target');
    }

    // ── HEURISTIC 5: Received-Then-Held (10 points) ──
    if (sentLink && node.balance !== null && node.balance > 0) {
      score += 10;
      reasons.push('Received tokens and still holding');
    }

    // ── HEURISTIC 6: No Other Activity (10 points) ──
    const hasOtherActivity = checkOtherActivity(addr, target, transfers);
    if (!hasOtherActivity && transfersWithTarget > 0) {
      score += 10;
      reasons.push('No token activity with anyone else');
    }

    // ── HEURISTIC 7: Token Origin Bonus/Penalty (up to +20 / -30) ──
    if (tokenOrigin === 'from-target' && node.balance !== null && node.balance > 0) {
      score += 20;
      reasons.push('Tokens received directly from target and held');
    } else if (tokenOrigin === 'from-dex') {
      score -= 30;
      reasons.push('Tokens acquired from DEX — likely independent buyer');
    } else if (tokenOrigin === 'from-third-party') {
      // Check if third party is also connected to target (intermediary pattern)
      const thirdPartyConnected = transfers.some(
        (tx) =>
          (tx.from.toLowerCase() === addr || tx.to.toLowerCase() === addr) &&
          transfers.some(
            (tx2) =>
              tx2.hash !== tx.hash &&
              (tx2.from.toLowerCase() === target || tx2.to.toLowerCase() === target)
          )
      );
      if (thirdPartyConnected) {
        score += 15;
        reasons.push('Received via intermediary connected to target');
      }
    }

    if (score >= 15) {
      scores.push({
        address: node.address,
        score,
        reasons,
        fundingSource: walletFundingSource,
        firstInteraction,
        lastInteraction,
        transfersWithTarget,
        netFlowFromTarget,
        balance: node.balance ?? 0,
        tokenOrigin,
        tokenOriginDetails,
      });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Convert to HiddenHoldingWallet
  const wallets: HiddenHoldingWallet[] = scores.map((s) => ({
    address: s.address,
    balance: s.balance,
    confidence: s.score >= 60 ? 'high' : s.score >= 35 ? 'medium' : 'low',
    reasons: s.reasons,
    fundingSource: s.fundingSource,
    firstInteraction: s.firstInteraction,
    lastInteraction: s.lastInteraction,
    transfersWithTarget: s.transfersWithTarget,
    netFlowFromTarget: s.netFlowFromTarget,
    tokenOrigin: s.tokenOrigin,
    tokenOriginDetails: s.tokenOriginDetails,
  }));

  // Calculate totals
  const highWallets = wallets.filter((w) => w.confidence === 'high');
  const medWallets = wallets.filter((w) => w.confidence === 'medium');
  const lowWallets = wallets.filter((w) => w.confidence === 'low');

  const confirmedHoldings = highWallets.reduce((s, w) => s + w.balance, 0);
  const suspectedHoldings = medWallets.reduce((s, w) => s + w.balance, 0);
  const possibleHoldings = lowWallets.reduce((s, w) => s + w.balance, 0);

  const totalHeldByCluster = confirmedHoldings + suspectedHoldings;
  const totalPossibleHidden = possibleHoldings;

  // Build outbound summary
  const outboundSummary = buildOutboundSummary(
    transfers,
    targetWallet,
    contractSet,
    decimals,
    balances ?? {}
  );

  // Generate risk flags
  const riskFlags = generateRiskFlags(
    wallets,
    targetSentTxs,
    sequentialGroups,
    fundingClusters,
    target,
    tokenSymbol
  );

  // Generate cluster summary
  const clusterSummary = generateSummary(
    targetBalance,
    highWallets,
    medWallets,
    lowWallets,
    confirmedHoldings,
    suspectedHoldings,
    tokenSymbol,
    outboundSummary
  );

  return {
    targetWallet,
    targetBalance,
    totalHeldByCluster,
    totalPossibleHidden,
    wallets,
    clusterSummary,
    riskFlags,
    outboundSummary,
  };
}

/* ── Helper Functions ──────────────────────────────────────────────────────── */

function detectSequentialSends(
  sortedTargetSentTxs: TransferTx[],
  target: string
): string[][] {
  const groups: string[][] = [];
  let currentGroup: string[] = [];
  let lastTs = 0;

  for (const tx of sortedTargetSentTxs) {
    const to = tx.to.toLowerCase();
    const ts = parseInt(tx.timeStamp, 10);

    if (to === target) continue;

    if (lastTs > 0 && ts - lastTs < 120) {
      if (!currentGroup.includes(to)) currentGroup.push(to);
    } else {
      if (currentGroup.length >= 2) groups.push([...currentGroup]);
      currentGroup = [to];
    }
    lastTs = ts;
  }
  if (currentGroup.length >= 2) groups.push([...currentGroup]);

  return groups;
}

function checkTimingCorrelation(peerTxs: TransferTx[], target: string): number {
  if (peerTxs.length < 2) return 0;

  const sorted = [...peerTxs].sort(
    (a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10)
  );

  let rapidPairs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = parseInt(sorted[i].timeStamp, 10) - parseInt(sorted[i - 1].timeStamp, 10);
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevDir = prev.from.toLowerCase() === target ? 'sent' : 'received';
    const currDir = curr.from.toLowerCase() === target ? 'sent' : 'received';

    if (diff < 300 && prevDir !== currDir) {
      rapidPairs++;
    }
  }

  if (rapidPairs >= 3) return 15;
  if (rapidPairs >= 2) return 10;
  if (rapidPairs >= 1) return 5;
  return 0;
}

function checkOtherActivity(
  walletAddr: string,
  target: string,
  transfers: TransferTx[]
): boolean {
  const addr = walletAddr.toLowerCase();
  for (const tx of transfers) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    if (from === addr && to !== target) return true;
    if (to === addr && from !== target) return true;
  }
  return false;
}

function generateRiskFlags(
  wallets: HiddenHoldingWallet[],
  targetSentTxs: TransferTx[],
  sequentialGroups: string[][],
  fundingClusters: Map<string, string[]>,
  target: string,
  tokenSymbol: string
): string[] {
  const flags: string[] = [];

  for (const group of sequentialGroups) {
    if (group.length >= 2) {
      flags.push(
        `Wallet splitting detected: ${group.length} wallets received tokens in sequential transactions`
      );
      break;
    }
  }

  const bidirWallets = wallets.filter((w) =>
    w.reasons.some((r) => r.includes('Bidirectional'))
  );
  if (bidirWallets.length > 0) {
    const totalBidirVol = bidirWallets.reduce(
      (s, w) => s + Math.abs(w.netFlowFromTarget),
      0
    );
    flags.push(
      `Possible wash trading: bidirectional transfers totaling ${fmt(totalBidirVol)} ${tokenSymbol}`
    );
  }

  const coldWallets = wallets.filter(
    (w) =>
      w.balance > 0 &&
      w.reasons.some((r) => r.includes('still holding'))
  );
  if (coldWallets.length > 0) {
    flags.push(
      `Cold storage pattern: ${coldWallets.length} wallet(s) received tokens and never moved them`
    );
  }

  const fcEntries = Array.from(fundingClusters.entries());
  for (let fi = 0; fi < fcEntries.length; fi++) {
    const funder = fcEntries[fi][0];
    const cluster = fcEntries[fi][1];
    if (cluster.length >= 2) {
      flags.push(
        `Shared funding source: ${cluster.length} wallets funded by ${abbr(funder)}`
      );
      break;
    }
  }

  // DEX buyers flag
  const dexBuyers = wallets.filter((w) => w.tokenOrigin === 'from-dex');
  if (dexBuyers.length > 0) {
    const dexTotal = dexBuyers.reduce((s, w) => s + w.balance, 0);
    flags.push(
      `${dexBuyers.length} wallet(s) acquired ${fmt(dexTotal)} ${tokenSymbol} from DEX — likely independent buyers`
    );
  }

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  let recentAmount = 0;
  let recentCount = 0;
  for (const tx of targetSentTxs) {
    const ts = parseInt(tx.timeStamp, 10);
    if (ts > sevenDaysAgo) {
      recentAmount += parseFloat(tx.value) / 1e18;
      recentCount++;
    }
  }
  if (recentCount >= 2 && recentAmount > 0) {
    flags.push(
      `Recent dispersal: ${fmt(recentAmount)} ${tokenSymbol} distributed to ${recentCount} wallets in last 7 days`
    );
  }

  return flags;
}

function generateSummary(
  targetBalance: number,
  highWallets: HiddenHoldingWallet[],
  medWallets: HiddenHoldingWallet[],
  lowWallets: HiddenHoldingWallet[],
  confirmedHoldings: number,
  suspectedHoldings: number,
  tokenSymbol: string,
  outbound: OutboundSummary
): string {
  const parts: string[] = [];

  // Target status
  if (targetBalance === 0) {
    parts.push(`Target wallet: EMPTIED (0 ${tokenSymbol}).`);
  } else {
    parts.push(`Target wallet holds ${fmt(targetBalance)} ${tokenSymbol} directly.`);
  }

  // Outbound analysis
  const totalOut = outbound.toDex.amount + outbound.toWallets.amount + outbound.toContracts.amount;
  if (totalOut > 0) {
    const dexPct = outbound.toDex.percentage.toFixed(1);
    const walletPct = outbound.toWallets.percentage.toFixed(1);
    parts.push(
      `Sent ${fmt(totalOut)} ${tokenSymbol} total: ${fmt(outbound.toDex.amount)} (${dexPct}%) to DEX/contracts, ${fmt(outbound.toWallets.amount)} (${walletPct}%) to wallets.`
    );
  }

  // HIGH confidence
  if (highWallets.length > 0) {
    const fromTarget = highWallets.filter((w) => w.tokenOrigin === 'from-target');
    parts.push(
      `HIGH confidence: ${highWallets.length} wallet(s) holding ${fmt(confirmedHoldings)} ${tokenSymbol}.`
    );
    if (fromTarget.length > 0) {
      parts.push(
        `${fromTarget.length} received tokens directly from target.`
      );
    }
  }

  // MEDIUM confidence
  if (medWallets.length > 0) {
    parts.push(
      `MEDIUM confidence: ${medWallets.length} wallet(s) holding ${fmt(suspectedHoldings)} ${tokenSymbol}.`
    );
  }

  // LOW
  if (lowWallets.length > 0) {
    const lowTotal = lowWallets.reduce((s, w) => s + w.balance, 0);
    parts.push(
      `LOW confidence: ${lowWallets.length} wallet(s) holding ${fmt(lowTotal)} ${tokenSymbol}.`
    );
  }

  // Total estimate
  const totalWallets = highWallets.length + medWallets.length;
  if (totalWallets > 0) {
    const totalEstimate = targetBalance + confirmedHoldings + suspectedHoldings;
    parts.push(
      `Estimated same-owner holdings: ${fmt(totalEstimate)} ${tokenSymbol} across ${totalWallets + 1} wallets.`
    );
  } else {
    parts.push('No strong same-owner signals were detected among connected wallets.');
  }

  return parts.join(' ');
}
