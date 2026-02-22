import { ScanResult, TransferTx, GraphNode, GraphLink, HiddenHoldingWallet, HoldingsReport } from './types';

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
}

function abbr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function analyzeHoldings(
  scanResult: ScanResult,
  targetWallet: string,
  tokenSymbol: string,
  fundingSources: Record<string, string>
): HoldingsReport {
  const target = targetWallet.toLowerCase();
  const { nodes, links, transfers } = scanResult;

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
  const sentToMap = new Map<string, GraphLink>(); // target sent to peer
  const recvFromMap = new Map<string, GraphLink>(); // target received from peer
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

  // Detect sequential sends (consecutive txs from target to different wallets)
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

  // Find the target's funding source
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
    // Also check if this wallet shares funding with OTHER wallets in the cluster
    if (walletFundingSource) {
      const cluster = fundingClusters.get(walletFundingSource.toLowerCase());
      if (cluster && cluster.length >= 2) {
        // Multiple wallets funded by same source (even if not the target's funder)
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
    tokenSymbol
  );

  return {
    targetWallet,
    targetBalance,
    totalHeldByCluster,
    totalPossibleHidden,
    wallets,
    clusterSummary,
    riskFlags,
  };
}

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
      // Within 2 minutes — likely same batch
      if (currentGroup.length === 0 && lastTs > 0) {
        // Add the previous wallet too
      }
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
    // Check if the pair is a send-then-receive or receive-then-send within 5 min
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

  // Sequential send detection
  for (const group of sequentialGroups) {
    if (group.length >= 2) {
      flags.push(
        `Wallet splitting detected: ${group.length} wallets received tokens in sequential transactions`
      );
      break;
    }
  }

  // Wash trading (bidirectional)
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

  // Cold storage
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

  // Shared funding
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

  // Recent dispersal (last 7 days)
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
  tokenSymbol: string
): string {
  const totalWallets = highWallets.length + medWallets.length;
  const totalEstimate = targetBalance + confirmedHoldings + suspectedHoldings;

  let summary = `Target wallet holds ${fmt(targetBalance)} ${tokenSymbol} directly.`;

  if (highWallets.length > 0) {
    const sharedFundingWallets = highWallets.filter((w) =>
      w.reasons.some((r) => r.includes('funding'))
    );
    const bidirWallets = highWallets.filter((w) =>
      w.reasons.some((r) => r.includes('Bidirectional'))
    );

    summary += ` Analysis identified ${highWallets.length} additional wallet(s) likely belonging to the same person, holding a combined ${fmt(confirmedHoldings)} ${tokenSymbol}.`;

    const signals: string[] = [];
    if (sharedFundingWallets.length > 0) {
      const funder = sharedFundingWallets[0].fundingSource;
      signals.push(`shared funding source from ${funder ? abbr(funder) : 'unknown'}`);
    }
    if (bidirWallets.length > 0) {
      signals.push('bidirectional transfers');
    }
    if (signals.length > 0) {
      summary += ` ${highWallets.length} wallet(s) are HIGH confidence (${signals.join(', ')}).`;
    }

    summary += ` Total estimated holdings: ${fmt(totalEstimate)} ${tokenSymbol} across ${totalWallets + 1} wallets.`;
  }

  if (medWallets.length > 0) {
    summary += ` ${medWallets.length} additional wallet(s) (MEDIUM confidence) hold ${fmt(suspectedHoldings)} ${tokenSymbol} and may also belong to this person.`;
  }

  if (lowWallets.length > 0) {
    const lowTotal = lowWallets.reduce((s, w) => s + w.balance, 0);
    summary += ` ${lowWallets.length} wallet(s) (LOW confidence) hold ${fmt(lowTotal)} ${tokenSymbol} with weaker signals.`;
  }

  if (highWallets.length === 0 && medWallets.length === 0) {
    summary += ' No strong same-owner signals were detected among connected wallets.';
  }

  return summary;
}
