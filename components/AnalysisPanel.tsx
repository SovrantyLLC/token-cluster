'use client';

import { useState, useMemo } from 'react';
import { GraphNode, GraphLink, TransferTx } from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';

/* ── props ────────────────────────────────── */
interface AnalysisPanelProps {
  isOpen: boolean;
  nodes: GraphNode[];
  links: GraphLink[];
  transfers: TransferTx[];
  targetWallet: string;
  tokenSymbol: string;
  detectedContracts: Set<string>;
  onClose: () => void;
}

/* ── helpers ──────────────────────────────── */
function abbr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmt(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/* ── highlight spans ─────────────────────── */
const HL = {
  green: (t: string) => <span className="text-emerald-400">{t}</span>,
  accent: (t: string) => <span className="text-[#c9a227]">{t}</span>,
  blue: (t: string) => <span className="text-[#4ea8de] font-mono">{t}</span>,
  purple: (t: string) => <span className="text-[#a87cdb]">{t}</span>,
  dim: (t: string) => <span className="text-gray-500">{t}</span>,
};

/* ── sort key for balance table ──────────── */
type SortCol = 'balance' | 'transfers';

/* ── component ───────────────────────────── */
export default function AnalysisPanel({
  isOpen,
  nodes,
  links,
  transfers,
  targetWallet,
  tokenSymbol,
  detectedContracts,
  onClose,
}: AnalysisPanelProps) {
  const [tab, setTab] = useState<'report' | 'balances'>('report');
  const [sortCol, setSortCol] = useState<SortCol>('balance');
  const [sortAsc, setSortAsc] = useState(false);

  const target = targetWallet.toLowerCase();

  /* ── derived analytics ── */
  const analysis = useMemo(() => {
    const transferCount = transfers.length;
    const walletNodes = nodes.filter((n) => !n.isContract);
    const contractNodes = nodes.filter((n) => n.isContract);
    const targetNode = nodes.find((n) => n.id === target);

    // date range
    let minTs = Infinity;
    let maxTs = 0;
    for (const n of nodes) {
      if (n.firstSeen < minTs) minTs = n.firstSeen;
      if (n.lastSeen > maxTs) maxTs = n.lastSeen;
    }

    // target flow
    let sentVol = 0;
    let recvVol = 0;
    let sentTo = 0;
    let recvFrom = 0;
    const sentToSet = new Set<string>();
    const recvFromSet = new Set<string>();

    for (const l of links) {
      if (l.source === target) {
        sentVol += l.value;
        sentToSet.add(l.target);
      }
      if (l.target === target) {
        recvVol += l.value;
        recvFromSet.add(l.source);
      }
    }
    sentTo = sentToSet.size;
    recvFrom = recvFromSet.size;
    const netFlow = recvVol - sentVol;
    const totalVolume = links.reduce((s, l) => s + l.value, 0);

    // volume breakdown: DEX vs W2W
    let dexVolume = 0;
    let w2wVolume = 0;
    for (const l of links) {
      const srcIsContract = nodes.find((n) => n.id === l.source)?.isContract ?? false;
      const tgtIsContract = nodes.find((n) => n.id === l.target)?.isContract ?? false;
      if (srcIsContract || tgtIsContract) {
        dexVolume += l.value;
      } else {
        w2wVolume += l.value;
      }
    }

    const knownRouterCount = contractNodes.filter((n) => !!KNOWN_CONTRACTS[n.id.toLowerCase()]).length;
    const autoDetectedCount = contractNodes.length - knownRouterCount;

    // holdings
    const holdersChecked = walletNodes.filter((n) => n.balance !== null);
    const holders = walletNodes.filter((n) => n.balance !== null && n.balance > 0);
    const holdersEmpty = walletNodes.filter((n) => n.balance !== null && n.balance === 0);
    const combinedBalance = holders.reduce((s, n) => s + (n.balance ?? 0), 0);
    const targetBalance = targetNode?.balance ?? 0;
    const topHolders = [...holders].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0)).slice(0, 8);

    // cluster signals
    const bidirectional: GraphNode[] = [];
    const sentPeers = new Set<string>();
    const recvPeers = new Set<string>();
    for (const l of links) {
      if (l.source === target) sentPeers.add(l.target);
      if (l.target === target) recvPeers.add(l.source);
    }
    const bidirSeen = new Set<string>();
    Array.from(sentPeers).forEach((addr) => {
      if (recvPeers.has(addr) && !bidirSeen.has(addr)) {
        bidirSeen.add(addr);
        const node = nodes.find((n) => n.id === addr && !n.isContract);
        if (node) bidirectional.push(node);
      }
    });

    const heavyInteractorsSeen = new Set<string>();
    const heavyInteractors = walletNodes.filter((n) => {
      if (n.txCount < 5 || n.isTarget) return false;
      if (heavyInteractorsSeen.has(n.id)) return false;
      heavyInteractorsSeen.add(n.id);
      return true;
    });

    return {
      transferCount,
      walletNodes,
      contractNodes,
      targetNode,
      minTs,
      maxTs,
      sentVol,
      recvVol,
      sentTo,
      recvFrom,
      netFlow,
      totalVolume,
      dexVolume,
      w2wVolume,
      knownRouterCount,
      autoDetectedCount,
      holdersChecked,
      holders,
      holdersEmpty,
      combinedBalance,
      targetBalance,
      topHolders,
      bidirectional,
      heavyInteractors,
    };
  }, [nodes, links, transfers, detectedContracts, target]);

  /* ── sorted balance table ── */
  const sortedBalanceRows = useMemo(() => {
    const rows = nodes.filter((n) => !n.isContract);
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'balance') {
        const ba = a.balance ?? -1;
        const bb = b.balance ?? -1;
        // holders first always
        if (ba > 0 && bb <= 0) return -1;
        if (bb > 0 && ba <= 0) return 1;
        cmp = ba - bb;
      } else {
        cmp = a.txCount - b.txCount;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [nodes, sortCol, sortAsc]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  }

  const sortArrow = (col: SortCol) => {
    if (sortCol !== col) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div
      className="flex-shrink-0 overflow-hidden transition-[height] duration-300 ease-in-out border-t border-raised/50"
      style={{ height: isOpen ? 320 : 0, background: '#0c0e16' }}
    >
      <div className="h-[320px] flex flex-col" style={{ background: '#0c0e16' }}>
        {/* ── header / tabs ── */}
        <div
          className="flex items-center flex-shrink-0 border-b border-raised/40"
          style={{ background: '#0c0e16' }}
        >
          <button
            onClick={() => setTab('report')}
            className={`px-4 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors ${
              tab === 'report'
                ? 'text-[#c9a227] border-b-2 border-[#c9a227]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Report
          </button>
          <button
            onClick={() => setTab('balances')}
            className={`px-4 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors ${
              tab === 'balances'
                ? 'text-[#c9a227] border-b-2 border-[#c9a227]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Balance Sheet
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm font-mono transition-colors"
          >
            {'\u2715'}
          </button>
        </div>

        {/* ── body ── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: '#0c0e16' }}
        >
          {nodes.length === 0 ? (
            <div
              className="flex items-center justify-center h-full text-gray-600 font-mono text-xs"
              style={{ background: '#0c0e16' }}
            >
              Run a scan to generate analysis
            </div>
          ) : tab === 'report' ? (
            <ReportTab a={analysis} target={target} sym={tokenSymbol} />
          ) : (
            <BalanceTable
              rows={sortedBalanceRows}
              target={target}
              sym={tokenSymbol}
              sortArrow={sortArrow}
              onSort={toggleSort}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   REPORT TAB
   ═══════════════════════════════════════════ */
interface Analysis {
  transferCount: number;
  walletNodes: GraphNode[];
  contractNodes: GraphNode[];
  targetNode: GraphNode | undefined;
  minTs: number;
  maxTs: number;
  sentVol: number;
  recvVol: number;
  sentTo: number;
  recvFrom: number;
  netFlow: number;
  totalVolume: number;
  dexVolume: number;
  w2wVolume: number;
  knownRouterCount: number;
  autoDetectedCount: number;
  holdersChecked: GraphNode[];
  holders: GraphNode[];
  holdersEmpty: GraphNode[];
  combinedBalance: number;
  targetBalance: number;
  topHolders: GraphNode[];
  bidirectional: GraphNode[];
  heavyInteractors: GraphNode[];
}

function ReportTab({
  a,
  target,
  sym,
}: {
  a: Analysis;
  target: string;
  sym: string;
}) {
  const {
    transferCount, walletNodes, contractNodes, minTs, maxTs,
    sentVol, recvVol, sentTo, recvFrom, netFlow, totalVolume,
    dexVolume, w2wVolume, knownRouterCount, autoDetectedCount,
    holdersChecked, holders, holdersEmpty, combinedBalance,
    targetBalance, topHolders, bidirectional, heavyInteractors,
  } = a;

  return (
    <div className="p-4 space-y-4 text-[12px] leading-relaxed" style={{ background: '#0c0e16' }}>
      {/* Zero Balance Alert */}
      {targetBalance === 0 && combinedBalance > 0 && (
        <div
          className="px-3 py-2.5 rounded-md border border-amber-500/40 text-[11px] font-mono"
          style={{ background: 'rgba(245,158,11,0.08)' }}
        >
          <span className="text-amber-400 font-bold">! TARGET HOLDS 0 {sym}</span>
          <span className="text-amber-300/80 ml-2">
            but {fmt(combinedBalance)} {sym} is held across other wallets in this cluster.
          </span>
        </div>
      )}

      {/* A. Summary */}
      <section style={{ background: '#0c0e16' }}>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
          Summary
        </h3>
        <p className="text-gray-300">
          Scanned {HL.accent(String(transferCount))} {sym} transfers
          for wallet {HL.blue(abbr(target))}.
          Found {HL.accent(String(walletNodes.length))} wallets (EOA)
          and {HL.purple(String(contractNodes.length))} contracts/routers
          ({HL.purple(String(knownRouterCount))} known DEX routers + {HL.purple(String(autoDetectedCount))} auto-detected)
          across activity from {HL.dim(minTs === Infinity ? '—' : fmtDate(minTs))} to {HL.dim(maxTs === 0 ? '—' : fmtDate(maxTs))}.
        </p>
      </section>

      {/* B. Token Flow */}
      <section style={{ background: '#0c0e16' }}>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
          Token Flow
        </h3>
        <p className="text-gray-300">
          Target sent {HL.accent(fmt(sentVol))} {sym} to {HL.accent(String(sentTo))} wallets
          and received {HL.green(fmt(recvVol))} {sym} from {HL.accent(String(recvFrom))} wallets.
          Net flow: {netFlow >= 0 ? HL.green(`+${fmt(netFlow)}`) : HL.accent(fmt(netFlow))} {sym}{' '}
          ({netFlow >= 0 ? 'net accumulator' : 'net distributor'}).
          Total volume: {HL.accent(fmt(totalVolume))} {sym}.
        </p>
      </section>

      {/* C. Volume Breakdown */}
      <section style={{ background: '#0c0e16' }}>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
          Volume Breakdown
        </h3>
        <p className="text-gray-300">
          DEX/Contract volume: {HL.purple(fmt(dexVolume))} {sym} ({pct(dexVolume, totalVolume)} of total)
          — includes router swaps, LP interactions, and contract calls.
        </p>
        <p className="text-gray-300 mt-1">
          Wallet-to-wallet volume: {HL.accent(fmt(w2wVolume))} {sym} ({pct(w2wVolume, totalVolume)} of total)
          — direct transfers between EOA wallets only.
        </p>
        <p className="text-gray-300 mt-1">
          Contracts identified: {HL.purple(String(knownRouterCount))} known routers + {HL.purple(String(autoDetectedCount))} auto-detected {HL.dim('(via bytecode check)')}.
        </p>
      </section>

      {/* D. Current Holdings */}
      <section style={{ background: '#0c0e16' }}>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
          Current Holdings — Who Still Has {sym}?
        </h3>
        <p className="text-gray-300">
          Checked {HL.accent(String(holdersChecked.length))} wallets for live {sym} balances.{' '}
          {HL.green(String(holders.length))} wallets still hold {sym} with a combined {HL.green(fmt(combinedBalance, 4))} {sym}.{' '}
          {HL.dim(String(holdersEmpty.length))} wallets have zero balance.
          Target wallet holds {HL.accent(fmt(targetBalance, 4))} {sym}.
        </p>
        {topHolders.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {topHolders.map((h, i) => (
              <div key={h.id} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-gray-600 w-4 text-right">{i + 1}.</span>
                <span className="text-[#4ea8de]">{abbr(h.address)}</span>
                <span className="text-emerald-400">{fmt(h.balance ?? 0, 4)} {sym}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* E. Cluster Signals */}
      <section style={{ background: '#0c0e16' }}>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1">
          Cluster Signals
        </h3>

        {bidirectional.length > 0 ? (
          <div className="mb-2">
            <p className="text-gray-300 mb-1">
              {HL.accent(String(bidirectional.length))} bidirectional transfer{bidirectional.length !== 1 ? 's' : ''} {HL.dim('(sent AND received — strongest same-owner indicator)')}:
            </p>
            <div className="space-y-0.5">
              {bidirectional.map((n) => (
                <div key={n.id} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-[#4ea8de]">{abbr(n.address)}</span>
                  {n.balance !== null && n.balance > 0 && (
                    <span className="text-emerald-400">{fmt(n.balance, 4)} {sym}</span>
                  )}
                  <span className="text-gray-600">{n.txCount}tx</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-gray-500 mb-2">No bidirectional transfers detected.</p>
        )}

        {heavyInteractors.length > 0 ? (
          <div>
            <p className="text-gray-300 mb-1">
              {HL.accent(String(heavyInteractors.length))} heavy interactor{heavyInteractors.length !== 1 ? 's' : ''} {HL.dim('(5+ transfers)')}:
            </p>
            <div className="space-y-0.5">
              {heavyInteractors.slice(0, 8).map((n) => (
                <div key={n.id} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-[#47c9b2]">{abbr(n.address)}</span>
                  {n.balance !== null && n.balance > 0 && (
                    <span className="text-emerald-400">{fmt(n.balance, 4)} {sym}</span>
                  )}
                  <span className="text-gray-600">{n.txCount}tx</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-gray-500">No heavy interactors found.</p>
        )}
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BALANCE SHEET TAB
   ═══════════════════════════════════════════ */
function BalanceTable({
  rows,
  target,
  sym,
  sortArrow,
  onSort,
}: {
  rows: GraphNode[];
  target: string;
  sym: string;
  sortArrow: (col: SortCol) => string;
  onSort: (col: SortCol) => void;
}) {
  return (
    <div className="px-4 py-2" style={{ background: '#0c0e16' }}>
      <table className="w-full text-[11px] font-mono" style={{ background: '#0c0e16' }}>
        <thead>
          <tr className="text-gray-500 uppercase border-b border-raised/40" style={{ background: '#0c0e16' }}>
            <th className="text-left py-2 pr-3 w-20">Status</th>
            <th className="text-left py-2 pr-3">Wallet</th>
            <th
              className="text-right py-2 pr-3 cursor-pointer hover:text-gray-300 transition-colors select-none"
              onClick={() => onSort('transfers')}
            >
              Transfers{sortArrow('transfers')}
            </th>
            <th
              className="text-right py-2 cursor-pointer hover:text-gray-300 transition-colors select-none"
              onClick={() => onSort('balance')}
            >
              Balance ({sym}){sortArrow('balance')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => {
            const isHolder = node.balance !== null && node.balance > 0;
            const isTarget = node.id === target;
            return (
              <tr
                key={node.id}
                className="border-b border-raised/20 hover:bg-[#131620] transition-colors"
                style={{ background: '#0c0e16' }}
              >
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: isHolder ? '#50c878' : '#374151' }}
                    />
                    <span className={isHolder ? 'text-emerald-400' : 'text-gray-600'}>
                      {isHolder ? 'Holder' : 'Empty'}
                    </span>
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-gray-400">
                  {isTarget && <span className="mr-1" title="Target wallet">{'\uD83C\uDFAF'}</span>}
                  {abbr(node.address)}
                  {node.label && (
                    <span className="ml-2 text-gray-600">{node.label}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-400">
                  {node.txCount}
                </td>
                <td className={`py-1.5 text-right ${isHolder ? 'text-emerald-400' : 'text-gray-600'}`}>
                  {node.balance !== null
                    ? node.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="text-center text-gray-600 font-mono text-xs py-8" style={{ background: '#0c0e16' }}>
          No wallet data available
        </div>
      )}
    </div>
  );
}
