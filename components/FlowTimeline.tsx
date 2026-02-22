'use client';

import { useMemo } from 'react';
import { TransferTx } from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';

interface FlowTimelineProps {
  transfers: TransferTx[];
  targetWallet: string;
  tokenSymbol: string;
  decimals: number;
}

function abbr(addr: string) {
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtShortDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

interface TimelineEntry {
  ts: number;
  direction: 'sent' | 'received';
  amount: number;
  counterparty: string;
  counterpartyLabel: string | null;
  runningBalance: number;
  hash: string;
}

export default function FlowTimeline({
  transfers,
  targetWallet,
  tokenSymbol,
  decimals,
}: FlowTimelineProps) {
  const target = targetWallet.toLowerCase();

  const { entries, balancePoints, maxBalance } = useMemo(() => {
    // Sort transfers chronologically
    const sorted = [...transfers]
      .filter(
        (tx) =>
          tx.from.toLowerCase() === target || tx.to.toLowerCase() === target
      )
      .sort((a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10));

    let balance = 0;
    let peak = 0;
    const entries: TimelineEntry[] = [];
    const balancePoints: { ts: number; balance: number }[] = [];

    for (const tx of sorted) {
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      const value = parseFloat(tx.value) / Math.pow(10, decimals);
      const ts = parseInt(tx.timeStamp, 10);

      const direction: 'sent' | 'received' =
        from === target ? 'sent' : 'received';
      const counterparty = from === target ? to : from;

      if (direction === 'received') {
        balance += value;
      } else {
        balance -= value;
      }
      if (balance < 0) balance = 0; // clamp (can happen with partial scan data)
      if (balance > peak) peak = balance;

      entries.push({
        ts,
        direction,
        amount: value,
        counterparty,
        counterpartyLabel: KNOWN_CONTRACTS[counterparty] || null,
        runningBalance: balance,
        hash: tx.hash,
      });

      balancePoints.push({ ts, balance });
    }

    return { entries, balancePoints, maxBalance: peak };
  }, [transfers, target, decimals]);

  // Sparkline dimensions
  const sparkW = 600;
  const sparkH = 80;
  const padding = 4;

  const sparkPath = useMemo(() => {
    if (balancePoints.length < 2) return '';
    const minTs = balancePoints[0].ts;
    const maxTs = balancePoints[balancePoints.length - 1].ts;
    const tsRange = maxTs - minTs || 1;
    const balRange = maxBalance || 1;

    const points = balancePoints.map((p) => {
      const x =
        padding + ((p.ts - minTs) / tsRange) * (sparkW - padding * 2);
      const y =
        sparkH -
        padding -
        ((p.balance / balRange) * (sparkH - padding * 2));
      return `${x},${y}`;
    });

    // Area fill path
    const firstX = padding + ((balancePoints[0].ts - minTs) / tsRange) * (sparkW - padding * 2);
    const lastX = padding + ((balancePoints[balancePoints.length - 1].ts - minTs) / tsRange) * (sparkW - padding * 2);
    const bottom = sparkH - padding;

    return {
      line: `M${points.join(' L')}`,
      area: `M${firstX},${bottom} L${points.join(' L')} L${lastX},${bottom} Z`,
    };
  }, [balancePoints, maxBalance, sparkW, sparkH]);

  // Group entries by month for display
  const grouped = useMemo(() => {
    const groups: { label: string; entries: TimelineEntry[] }[] = [];
    let currentLabel = '';

    for (const entry of entries) {
      const d = new Date(entry.ts * 1000);
      const label = d.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
      if (label !== currentLabel) {
        groups.push({ label, entries: [] });
        currentLabel = label;
      }
      groups[groups.length - 1].entries.push(entry);
    }

    return groups;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full text-gray-600 font-mono text-xs"
        style={{ background: '#0c0e16' }}
      >
        No transfers found for the target wallet
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" style={{ background: '#0c0e16' }}>
      {/* Sparkline: Balance Over Time */}
      <div
        className="rounded-lg border border-raised/50 p-3"
        style={{ background: '#0a0c14' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
            Target Balance Over Time
          </span>
          <span className="text-[10px] font-mono text-gray-500">
            Peak: {fmt(maxBalance)} {tokenSymbol}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${sparkW} ${sparkH}`}
          className="w-full"
          style={{ height: 80 }}
          preserveAspectRatio="none"
        >
          {/* Area fill */}
          {typeof sparkPath === 'object' && sparkPath.area && (
            <path
              d={sparkPath.area}
              fill="rgba(201,162,39,0.1)"
              stroke="none"
            />
          )}
          {/* Line */}
          {typeof sparkPath === 'object' && sparkPath.line && (
            <path
              d={sparkPath.line}
              fill="none"
              stroke="#c9a227"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          )}
          {/* Zero line */}
          <line
            x1={padding}
            y1={sparkH - padding}
            x2={sparkW - padding}
            y2={sparkH - padding}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />
        </svg>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] font-mono text-gray-600">
            {fmtShortDate(entries[0].ts)}
          </span>
          <span className="text-[9px] font-mono text-gray-600">
            {fmtShortDate(entries[entries.length - 1].ts)}
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="flex gap-3">
        <div className="flex-1 rounded-md border border-raised/40 px-3 py-2" style={{ background: '#0a0c14' }}>
          <div className="text-[9px] font-mono text-gray-500 uppercase">Transfers</div>
          <div className="text-sm font-bold font-mono text-gray-200">{entries.length}</div>
        </div>
        <div className="flex-1 rounded-md border border-raised/40 px-3 py-2" style={{ background: '#0a0c14' }}>
          <div className="text-[9px] font-mono text-gray-500 uppercase">First Activity</div>
          <div className="text-sm font-bold font-mono text-gray-200">{fmtDate(entries[0].ts)}</div>
        </div>
        <div className="flex-1 rounded-md border border-raised/40 px-3 py-2" style={{ background: '#0a0c14' }}>
          <div className="text-[9px] font-mono text-gray-500 uppercase">Last Activity</div>
          <div className="text-sm font-bold font-mono text-gray-200">{fmtDate(entries[entries.length - 1].ts)}</div>
        </div>
        <div className="flex-1 rounded-md border border-raised/40 px-3 py-2" style={{ background: '#0a0c14' }}>
          <div className="text-[9px] font-mono text-gray-500 uppercase">Current</div>
          <div className={`text-sm font-bold font-mono ${entries[entries.length - 1].runningBalance === 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {fmt(entries[entries.length - 1].runningBalance)} {tokenSymbol}
          </div>
        </div>
      </div>

      {/* Timeline */}
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="sticky top-0 z-10 py-1" style={{ background: '#0c0e16' }}>
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
              {group.label}
            </span>
          </div>
          <div className="space-y-0.5 ml-2 border-l border-raised/30 pl-3">
            {group.entries.map((entry, i) => (
              <div
                key={`${entry.hash}-${i}`}
                className="flex items-center gap-2 py-1 text-[11px] font-mono"
              >
                {/* Date */}
                <span className="text-gray-600 w-16 flex-shrink-0">
                  {fmtShortDate(entry.ts)}
                </span>

                {/* Direction arrow */}
                <span
                  className={`w-4 text-center flex-shrink-0 font-bold ${
                    entry.direction === 'received'
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}
                >
                  {entry.direction === 'received' ? '\u2190' : '\u2192'}
                </span>

                {/* Amount */}
                <span
                  className={`w-20 text-right flex-shrink-0 ${
                    entry.direction === 'received'
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}
                >
                  {entry.direction === 'received' ? '+' : '-'}
                  {fmt(entry.amount)}
                </span>

                {/* Symbol */}
                <span className="text-gray-500 flex-shrink-0 w-10">
                  {tokenSymbol}
                </span>

                {/* Direction label + counterparty */}
                <span className="text-gray-500 flex-shrink-0">
                  {entry.direction === 'received' ? 'from' : 'to'}
                </span>
                <span className="text-[#4ea8de] flex-shrink-0">
                  {entry.counterpartyLabel || abbr(entry.counterparty)}
                </span>

                {/* Running balance */}
                <span className="ml-auto text-gray-600 flex-shrink-0">
                  bal: {fmt(entry.runningBalance)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* End state */}
      <div className="ml-2 pl-3 py-2 text-[11px] font-mono">
        <span className="text-gray-500">Now: Target holds </span>
        <span
          className={
            entries[entries.length - 1].runningBalance === 0
              ? 'text-amber-400 font-bold'
              : 'text-emerald-400 font-bold'
          }
        >
          {fmt(entries[entries.length - 1].runningBalance)} {tokenSymbol}
        </span>
      </div>
    </div>
  );
}
