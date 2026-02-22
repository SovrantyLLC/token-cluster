import {
  ScanResult,
  TransferTx,
  GraphNode,
  GraphLink,
  HiddenHoldingWallet,
  HoldingsReport,
  OutboundSummary,
  TokenOrigin,
  DispositionBreakdown,
  RecipientDisposition,
  WalletHistory,
} from './types';
import { KNOWN_CONTRACTS } from './constants';

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

/* ── DEX router detection ─────────────────────────────────────────────────── */

const DEX_ROUTER_ADDRS = new Set([
  '0x60ae616a2155ee3d9a68541ba4544862310933d4', // TraderJoe v2
  '0xb4315e873dbcf96ffd0acd8ea43f689d8c20fb30', // TraderJoe v2.1
  '0x18556ec73e7a7a2b4292c6b2148b570364631f28', // TraderJoe v2.2
  '0xe54ca86531e17ef3616d22ca28b0d458b6c89106', // Pangolin
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57', // ParaSwap
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', // KyberSwap
]);

const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000000000000000000000000',
]);

function isDexRouter(addr: string): boolean {
  return DEX_ROUTER_ADDRS.has(addr.toLowerCase());
}

function isBurnAddress(addr: string): boolean {
  return BURN_ADDRESSES.has(addr.toLowerCase());
}

function getDexName(addr: string): string {
  return KNOWN_CONTRACTS[addr.toLowerCase()] || 'Unknown DEX';
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

/* ── Wallet History Reconstruction (Step 1) ───────────────────────────────── */

export function reconstructWalletHistory(
  wallet: string,
  transfers: TransferTx[],
  tokenDecimals: number,
  contractSet: Set<string>,
  balances: Record<string, number>
): WalletHistory {
  const addr = wallet.toLowerCase();
  const currentBalance = balances[addr] ?? 0;

  // Filter and sort transfers involving this wallet
  const walletTxs = transfers
    .filter((tx) => tx.from.toLowerCase() === addr || tx.to.toLowerCase() === addr)
    .sort((a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10));

  let runningBalance = 0;
  let peakBalance = 0;
  let peakDate = 0;
  let totalReceived = 0;
  let totalSent = 0;

  // Disposition tracking
  let soldOnDexAmount = 0;
  let soldOnDexCount = 0;
  const dexNames = new Set<string>();
  let sentToWalletsAmount = 0;
  const recipientMap = new Map<string, number>();
  const sentToContractsAmount = 0;
  let burnedAmount = 0;

  for (const tx of walletTxs) {
    const to = tx.to.toLowerCase();
    const value = parseFloat(tx.value) / Math.pow(10, tokenDecimals);
    const ts = parseInt(tx.timeStamp, 10);

    if (to === addr) {
      // Incoming
      runningBalance += value;
      totalReceived += value;
    } else {
      // Outgoing
      runningBalance -= value;
      totalSent += value;

      // Classify destination
      if (isBurnAddress(to)) {
        burnedAmount += value;
      } else if (isDexRouter(to) || contractSet.has(to)) {
        // DEX routers, LP pairs, and other contracts — all count as DEX/contract sells
        soldOnDexAmount += value;
        soldOnDexCount++;
        if (isDexRouter(to)) {
          dexNames.add(getDexName(to));
        } else {
          dexNames.add(KNOWN_CONTRACTS[to] || 'DEX/Contract');
        }
      } else {
        // Regular wallet
        sentToWalletsAmount += value;
        recipientMap.set(to, (recipientMap.get(to) || 0) + value);
      }
    }

    if (runningBalance < 0) runningBalance = 0;
    if (runningBalance > peakBalance) {
      peakBalance = runningBalance;
      peakDate = ts;
    }
  }

  const totalOut = soldOnDexAmount + sentToWalletsAmount + sentToContractsAmount + burnedAmount;

  // Build recipient dispositions (second-hop tracking)
  const recipients: RecipientDisposition[] = Array.from(recipientMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([recipAddr, amount]) => {
      const recipBalance = balances[recipAddr] ?? 0;

      // Check what the recipient did with the tokens (second-hop)
      const recipOutbound = transfers.filter(
        (tx) => tx.from.toLowerCase() === recipAddr
      );
      let recipSoldOnDex = 0;
      let recipPassedAlong = 0;
      for (const tx of recipOutbound) {
        const dest = tx.to.toLowerCase();
        const val = parseFloat(tx.value) / Math.pow(10, tokenDecimals);
        if (isDexRouter(dest) || (contractSet.has(dest) && !isBurnAddress(dest))) {
          recipSoldOnDex += val;
        } else if (!isBurnAddress(dest)) {
          recipPassedAlong += val;
        }
      }

      let status: RecipientDisposition['status'] = 'holding';
      if (recipBalance > amount * 0.5) {
        status = 'holding';
      } else if (recipSoldOnDex > amount * 0.5) {
        status = 'sold';
      } else if (recipPassedAlong > amount * 0.5) {
        status = 'passed-along';
      } else if (recipSoldOnDex > 0 || recipPassedAlong > 0) {
        status = 'mixed';
      }

      return {
        address: recipAddr,
        amountReceived: amount,
        currentBalance: recipBalance,
        soldFromHere: recipSoldOnDex,
        passedAlong: recipPassedAlong,
        stillHolding: recipBalance,
        status,
      };
    });

  const disposition: DispositionBreakdown = {
    soldOnDex: {
      amount: soldOnDexAmount,
      percentage: totalOut > 0 ? (soldOnDexAmount / totalOut) * 100 : 0,
      txCount: soldOnDexCount,
      dexes: Array.from(dexNames),
    },
    sentToWallets: {
      amount: sentToWalletsAmount,
      percentage: totalOut > 0 ? (sentToWalletsAmount / totalOut) * 100 : 0,
      recipients,
    },
    sentToContracts: {
      amount: sentToContractsAmount,
      percentage: totalOut > 0 ? (sentToContractsAmount / totalOut) * 100 : 0,
    },
    burnedOrLost: {
      amount: burnedAmount,
      percentage: totalOut > 0 ? (burnedAmount / totalOut) * 100 : 0,
    },
    addedToLP: {
      amount: 0,
      pairs: [],
      stillActive: false,
    },
  };

  return {
    address: wallet,
    currentBalance,
    peakBalance,
    peakDate,
    totalReceived,
    totalSent,
    netDisposed: peakBalance - currentBalance,
    disposition,
    isGhost: peakBalance > 0 && currentBalance <= peakBalance * 0.01,
  };
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

    if (contractSet.has(to)) {
      toDexAmount += value;
      toDexCount++;
    } else {
      toWalletAmount += value;
      toWalletCount++;
      recipientAmounts.set(to, (recipientAmounts.get(to) || 0) + value);
    }
  }

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

  const contractSet = new Set(detectedContracts);
  const decimals = transfers.length > 0 ? parseInt(transfers[0].tokenDecimal, 10) || 18 : 18;

  const targetNode = nodes.find((n) => n.id === target);
  const targetBalance = targetNode?.balance ?? 0;

  const walletNodes = nodes.filter((n) => !n.isContract && !n.isTarget);

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

  // Build link lookup
  const sentToMap = new Map<string, GraphLink>();
  const recvFromMap = new Map<string, GraphLink>();
  for (const l of links) {
    const src = typeof l.source === 'string' ? l.source : l.source;
    const tgt = typeof l.target === 'string' ? l.target : l.target;
    if (src === target) sentToMap.set(tgt, l);
    if (tgt === target) recvFromMap.set(src, l);
  }

  const targetSentTxs = transfers
    .filter((tx) => tx.from.toLowerCase() === target)
    .sort((a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10));

  const sequentialGroups = detectSequentialSends(targetSentTxs, target);
  const sequentialWallets = new Set<string>();
  for (const group of sequentialGroups) {
    for (const addr of group) sequentialWallets.add(addr);
  }

  const fundingClusters = new Map<string, string[]>();
  for (const [wallet, funder] of Object.entries(fundingSources)) {
    const funderLower = funder.toLowerCase();
    if (!fundingClusters.has(funderLower)) fundingClusters.set(funderLower, []);
    fundingClusters.get(funderLower)!.push(wallet.toLowerCase());
  }

  const targetFundingSource = fundingSources[target] ?? null;

  // ── Reconstruct wallet histories for all non-contract wallets ──
  const walletHistories: WalletHistory[] = [];
  const walletHistoryMap = new Map<string, WalletHistory>();

  for (const node of walletNodes) {
    const history = reconstructWalletHistory(
      node.id,
      transfers,
      decimals,
      contractSet,
      balances ?? {}
    );
    walletHistories.push(history);
    walletHistoryMap.set(node.id, history);
  }

  // Also reconstruct target history
  const targetHistory = reconstructWalletHistory(
    target,
    transfers,
    decimals,
    contractSet,
    balances ?? {}
  );

  const ghostWallets = walletHistories.filter((h) => h.isGhost);

  // ── Detect pass-through patterns ──
  // Ghost wallet received from target → sent everything to one wallet → that wallet still holds
  const passThroughWallets = new Set<string>();
  const passThroughTargets = new Map<string, string>(); // ghost -> final holder

  for (const ghost of ghostWallets) {
    const addr = ghost.address.toLowerCase();
    const recips = ghost.disposition.sentToWallets.recipients;
    // Check if most tokens went to a single wallet that still holds
    if (recips.length > 0) {
      const topRecip = recips[0];
      const totalSentToWallets = ghost.disposition.sentToWallets.amount;
      if (totalSentToWallets > 0 && topRecip.amountReceived / totalSentToWallets > 0.7) {
        if (topRecip.currentBalance > topRecip.amountReceived * 0.3) {
          passThroughWallets.add(addr);
          passThroughTargets.set(addr, topRecip.address);
        }
      }
    }
  }

  // Score each wallet
  const scores: WalletScore[] = [];

  for (const node of walletNodes) {
    const addr = node.id;
    let score = 0;
    const reasons: string[] = [];

    const peerTxs = walletTransfers.get(addr) || [];
    const sentLink = sentToMap.get(addr);
    const recvLink = recvFromMap.get(addr);
    const history = walletHistoryMap.get(addr);

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

    const { origin: tokenOrigin, details: tokenOriginDetails } = traceTokenOrigin(
      addr, target, transfers, contractSet, decimals
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

    // ── HEURISTIC 8: Pass-Through Pattern (+20 points) ──
    if (passThroughWallets.has(addr)) {
      const finalHolder = passThroughTargets.get(addr);
      score += 20;
      reasons.push(`Pass-through: moved all tokens to ${finalHolder ? abbr(finalHolder) : 'holder'} (still holding)`);
    }

    // ── HEURISTIC 9: Sell-Off Pattern (-15 points) ──
    if (history && history.totalSent > 0) {
      const sellPct = history.disposition.soldOnDex.amount / history.totalSent;
      if (sellPct >= 0.9) {
        // Check exception: same funding source could mean wash sale
        const hasSameFunder = walletFundingSource && targetFundingSource &&
          walletFundingSource.toLowerCase() === targetFundingSource.toLowerCase();
        if (!hasSameFunder) {
          score -= 15;
          reasons.push(`Sold 90%+ on DEX — likely not same owner`);
        } else {
          reasons.push(`Sold 90%+ on DEX but shares funding source — possible wash sale`);
        }
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

  scores.sort((a, b) => b.score - a.score);

  // Convert to HiddenHoldingWallet
  const wallets: HiddenHoldingWallet[] = scores.map((s) => {
    const addr = s.address.toLowerCase();
    const nodeForAddr = nodes.find((n) => n.id === addr);
    const lpBal = nodeForAddr?.lpBalance ?? 0;
    const stakedBal = nodeForAddr?.stakedBalance ?? 0;
    const totalHoldings = s.balance + lpBal + stakedBal;
    return {
      address: s.address,
      balance: s.balance,
      confidence: s.score >= 60 ? 'high' : s.score >= 35 ? 'medium' : ('low' as const),
      reasons: s.reasons,
      fundingSource: s.fundingSource,
      firstInteraction: s.firstInteraction,
      lastInteraction: s.lastInteraction,
      transfersWithTarget: s.transfersWithTarget,
      netFlowFromTarget: s.netFlowFromTarget,
      tokenOrigin: s.tokenOrigin,
      tokenOriginDetails: s.tokenOriginDetails,
      lpBalance: lpBal,
      stakedBalance: stakedBal,
      totalHoldings,
    };
  });

  // Pass-through ghosts inherit confidence of their final recipient
  for (const w of wallets) {
    const addr = w.address.toLowerCase();
    if (passThroughWallets.has(addr)) {
      const finalAddr = passThroughTargets.get(addr);
      if (finalAddr) {
        const finalWallet = wallets.find((fw) => fw.address.toLowerCase() === finalAddr);
        if (finalWallet && (finalWallet.confidence === 'high' || finalWallet.confidence === 'medium')) {
          w.confidence = finalWallet.confidence;
        }
      }
    }
  }

  // Calculate totals
  const highWallets = wallets.filter((w) => w.confidence === 'high');
  const medWallets = wallets.filter((w) => w.confidence === 'medium');
  const lowWallets = wallets.filter((w) => w.confidence === 'low');

  const confirmedHoldings = highWallets.reduce((s, w) => s + w.balance, 0);
  const suspectedHoldings = medWallets.reduce((s, w) => s + w.balance, 0);
  const possibleHoldings = lowWallets.reduce((s, w) => s + w.balance, 0);

  const totalHeldByCluster = confirmedHoldings + suspectedHoldings;
  const totalPossibleHidden = possibleHoldings;

  // LP + staking totals
  const targetNodeLP = targetNode?.lpBalance ?? 0;
  const targetNodeStaked = targetNode?.stakedBalance ?? 0;
  const clusterLP = [...highWallets, ...medWallets].reduce((s, w) => s + w.lpBalance, 0);
  const clusterStaked = [...highWallets, ...medWallets].reduce((s, w) => s + w.stakedBalance, 0);
  const totalInLP = targetNodeLP + clusterLP;
  const totalStaked = targetNodeStaked + clusterStaked;
  const totalWalletBalances = targetBalance + confirmedHoldings + suspectedHoldings;
  const totalTrueHoldings = totalWalletBalances + totalInLP + totalStaked;

  // Build outbound summary
  const outboundSummary = buildOutboundSummary(
    transfers, targetWallet, contractSet, decimals, balances ?? {}
  );

  // Generate risk flags
  const riskFlags = generateRiskFlags(
    wallets, targetSentTxs, sequentialGroups, fundingClusters,
    target, tokenSymbol, ghostWallets, passThroughWallets
  );

  // Generate cluster summary
  const clusterSummary = generateSummary(
    targetBalance, targetHistory, highWallets, medWallets, lowWallets,
    confirmedHoldings, suspectedHoldings, tokenSymbol,
    outboundSummary, ghostWallets, passThroughWallets, passThroughTargets, balances ?? {}
  );

  return {
    targetWallet,
    targetBalance,
    totalHeldByCluster,
    totalPossibleHidden,
    totalWalletBalances,
    totalInLP,
    totalStaked,
    totalTrueHoldings,
    wallets,
    clusterSummary,
    riskFlags,
    outboundSummary,
    walletHistories,
    ghostWallets,
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
  tokenSymbol: string,
  ghostWallets: WalletHistory[],
  passThroughWallets: Set<string>
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
      (s, w) => s + Math.abs(w.netFlowFromTarget), 0
    );
    flags.push(
      `Possible wash trading: bidirectional transfers totaling ${fmt(totalBidirVol)} ${tokenSymbol}`
    );
  }

  const coldWallets = wallets.filter(
    (w) => w.balance > 0 && w.reasons.some((r) => r.includes('still holding'))
  );
  if (coldWallets.length > 0) {
    flags.push(
      `Cold storage pattern: ${coldWallets.length} wallet(s) received tokens and never moved them`
    );
  }

  const fcEntries = Array.from(fundingClusters.entries());
  for (const [funder, cluster] of fcEntries) {
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

  // Ghost wallets flag
  if (ghostWallets.length > 0) {
    const combinedPeak = ghostWallets.reduce((s, g) => s + g.peakBalance, 0);
    flags.push(
      `${ghostWallets.length} ghost wallet(s) previously held ${fmt(combinedPeak)} ${tokenSymbol} — now empty`
    );
  }

  // Pass-through flag
  if (passThroughWallets.size > 0) {
    flags.push(
      `${passThroughWallets.size} pass-through wallet(s) detected — tokens moved through intermediary to final holders`
    );
  }

  // LP holdings flag
  const lpHolders = wallets.filter((w) => w.lpBalance > 0);
  if (lpHolders.length > 0) {
    const totalLP = lpHolders.reduce((s, w) => s + w.lpBalance, 0);
    flags.push(
      `${lpHolders.length} cluster wallet(s) hold ${fmt(totalLP)} ${tokenSymbol} in LP positions — hidden from simple balance checks`
    );
  }

  // Staking flag
  const stakedHolders = wallets.filter((w) => w.stakedBalance > 0);
  if (stakedHolders.length > 0) {
    const totalStaked = stakedHolders.reduce((s, w) => s + w.stakedBalance, 0);
    flags.push(
      `${stakedHolders.length} cluster wallet(s) have ${fmt(totalStaked)} ${tokenSymbol} staked in farm contracts`
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
  targetHistory: WalletHistory,
  highWallets: HiddenHoldingWallet[],
  medWallets: HiddenHoldingWallet[],
  lowWallets: HiddenHoldingWallet[],
  confirmedHoldings: number,
  suspectedHoldings: number,
  tokenSymbol: string,
  outbound: OutboundSummary,
  ghostWallets: WalletHistory[],
  passThroughWallets: Set<string>,
  passThroughTargets: Map<string, string>,
  balances: Record<string, number>
): string {
  const parts: string[] = [];

  // Full token accounting header
  parts.push(`COMPLETE TOKEN ACCOUNTING:`);

  // Inbound/Outbound
  parts.push(
    `INBOUND: Received ${fmt(targetHistory.totalReceived)} ${tokenSymbol} total.`
  );
  parts.push(
    `OUTBOUND: Sent ${fmt(targetHistory.totalSent)} ${tokenSymbol} total (${
      targetHistory.totalReceived >= targetHistory.totalSent ? 'net accumulator' : 'net distributor'
    }: ${targetHistory.totalReceived >= targetHistory.totalSent ? '+' : ''}${fmt(targetHistory.totalReceived - targetHistory.totalSent)} ${tokenSymbol}).`
  );

  // Disposition of outbound
  const totalOut = outbound.toDex.amount + outbound.toWallets.amount + outbound.toContracts.amount;
  if (totalOut > 0) {
    parts.push(`DISPOSITION OF OUTBOUND ${fmt(totalOut)} ${tokenSymbol}:`);
    parts.push(`Sold on DEX: ${fmt(outbound.toDex.amount)} ${tokenSymbol} (${outbound.toDex.percentage.toFixed(1)}%).`);
    parts.push(`Sent to wallets: ${fmt(outbound.toWallets.amount)} ${tokenSymbol} (${outbound.toWallets.percentage.toFixed(1)}%).`);

    // Break down wallet sends
    const stillHeldByRecipients = outbound.topRecipients.reduce((s, r) => s + r.stillHolding, 0);
    if (stillHeldByRecipients > 0) {
      parts.push(`Still held by recipients: ${fmt(stillHeldByRecipients)} ${tokenSymbol}.`);
    }
  }

  // Ghost wallets
  if (ghostWallets.length > 0) {
    const combinedPeak = ghostWallets.reduce((s, g) => s + g.peakBalance, 0);
    const ghostSold = ghostWallets.reduce((s, g) => s + g.disposition.soldOnDex.amount, 0);
    const ghostPassed = ghostWallets.reduce((s, g) => s + g.disposition.sentToWallets.amount, 0);
    parts.push(
      `GHOST WALLETS: ${ghostWallets.length} wallet(s), combined peak ${fmt(combinedPeak)} ${tokenSymbol} → sold ${fmt(ghostSold)}, passed ${fmt(ghostPassed)} to holders.`
    );
  }

  // Pass-through insights
  if (passThroughWallets.size > 0) {
    const ptList: string[] = [];
    for (const [ghost, holder] of Array.from(passThroughTargets.entries())) {
      const holderBal = balances[holder] ?? 0;
      if (holderBal > 0) {
        ptList.push(`${abbr(ghost)} → ${abbr(holder)} (holds ${fmt(holderBal)})`);
      }
    }
    if (ptList.length > 0) {
      parts.push(`Pass-through chains: ${ptList.slice(0, 3).join('; ')}.`);
    }
  }

  // Confidence buckets
  if (highWallets.length > 0) {
    parts.push(
      `HIGH confidence: ${highWallets.length} wallet(s) holding ${fmt(confirmedHoldings)} ${tokenSymbol}.`
    );
  }
  if (medWallets.length > 0) {
    parts.push(
      `MEDIUM confidence: ${medWallets.length} wallet(s) holding ${fmt(suspectedHoldings)} ${tokenSymbol}.`
    );
  }
  if (lowWallets.length > 0) {
    const lowTotal = lowWallets.reduce((s, w) => s + w.balance, 0);
    parts.push(
      `LOW confidence: ${lowWallets.length} wallet(s) holding ${fmt(lowTotal)} ${tokenSymbol}.`
    );
  }

  // Final estimate
  const totalWallets = highWallets.length + medWallets.length;
  if (totalWallets > 0) {
    const totalEstimate = targetBalance + confirmedHoldings + suspectedHoldings;
    const lpTotal = [...highWallets, ...medWallets].reduce((s, w) => s + (w.lpBalance ?? 0), 0);
    const stakedTotal = [...highWallets, ...medWallets].reduce((s, w) => s + (w.stakedBalance ?? 0), 0);
    const defiParts: string[] = [];
    if (lpTotal > 0) defiParts.push(`${fmt(lpTotal)} in LP`);
    if (stakedTotal > 0) defiParts.push(`${fmt(stakedTotal)} staked`);
    if (defiParts.length > 0) {
      parts.push(`DEFI POSITIONS: ${defiParts.join(', ')} ${tokenSymbol} across cluster wallets.`);
    }
    const trueTotal = totalEstimate + lpTotal + stakedTotal;
    const suffix = defiParts.length > 0 ? ' (including DeFi positions)' : '';
    parts.push(
      `CURRENT ESTIMATED SAME-OWNER HOLDINGS: ${fmt(trueTotal)} ${tokenSymbol} across ${totalWallets + 1} wallets${suffix}.`
    );
  } else {
    parts.push('No strong same-owner signals were detected among connected wallets.');
  }

  return parts.join(' ');
}
