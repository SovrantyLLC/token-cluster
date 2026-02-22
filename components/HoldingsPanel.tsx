'use client';

import { useCallback } from 'react';
import { HoldingsReport, HiddenHoldingWallet, ScanResult } from '@/lib/types';

interface HoldingsPanelProps {
  report: HoldingsReport;
  tokenSymbol: string;
  scanResult: ScanResult | null;
  onWalletClick: (address: string) => void;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function abbr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function confidenceColor(c: HiddenHoldingWallet['confidence']): string {
  if (c === 'high') return '#50c878';
  if (c === 'medium') return '#c9a227';
  return '#6b7280';
}

function confidenceLabel(c: HiddenHoldingWallet['confidence']): string {
  if (c === 'high') return 'HIGH';
  if (c === 'medium') return 'MED';
  return 'LOW';
}

function confidenceBorder(c: HiddenHoldingWallet['confidence']): string {
  if (c === 'high') return 'border-l-[#50c878]';
  if (c === 'medium') return 'border-l-[#c9a227]';
  return 'border-l-gray-600';
}

function originBadge(origin: HiddenHoldingWallet['tokenOrigin']): { text: string; cls: string } {
  switch (origin) {
    case 'from-target': return { text: 'FROM TARGET', cls: 'text-emerald-400 bg-emerald-400/10' };
    case 'from-dex': return { text: 'DEX BUYER', cls: 'text-purple-400 bg-purple-400/10' };
    case 'from-third-party': return { text: '3RD PARTY', cls: 'text-blue-400 bg-blue-400/10' };
    case 'mixed': return { text: 'MIXED', cls: 'text-gray-400 bg-gray-400/10' };
    default: return { text: '', cls: '' };
  }
}

function SnowscanIcon({ address }: { address: string }) {
  return (
    <a
      href={`https://snowscan.xyz/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex-shrink-0 text-gray-600 hover:text-[#4ea8de] transition-colors p-0.5"
      title="View on Snowscan"
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4.5 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V9.5C1.5 10.05 1.95 10.5 2.5 10.5H9.5C10.05 10.5 10.5 10.05 10.5 9.5V7.5M7 1.5H10.5M10.5 1.5V5M10.5 1.5L5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </a>
  );
}

/* ── Export Report ── */
function generateMarkdownReport(
  report: HoldingsReport,
  tokenSymbol: string,
  scanResult: ScanResult | null
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# Token Cluster Analysis Report`);
  lines.push(`**Date:** ${now}`);
  lines.push(`**Target:** \`${report.targetWallet}\``);
  lines.push(`**Token:** ${tokenSymbol}`);
  lines.push(`**Chain:** AVAX C-Chain`);
  lines.push('');

  // Holdings summary
  lines.push(`## Holdings Summary`);
  lines.push(`- Target balance: **${fmt(report.targetBalance)} ${tokenSymbol}**`);
  const highW = report.wallets.filter((w) => w.confidence === 'high');
  const medW = report.wallets.filter((w) => w.confidence === 'medium');
  const confirmedH = highW.reduce((s, w) => s + w.balance, 0);
  lines.push(`- HIGH confidence wallets: **${highW.length}** holding **${fmt(confirmedH)} ${tokenSymbol}**`);
  lines.push(`- MEDIUM confidence wallets: **${medW.length}** holding **${fmt(report.totalHeldByCluster - confirmedH)} ${tokenSymbol}**`);
  lines.push(`- Total estimated same-owner: **${fmt(report.targetBalance + report.totalHeldByCluster)} ${tokenSymbol}**`);
  lines.push('');

  // Outbound analysis
  const out = report.outboundSummary;
  if (out.toDex.amount > 0 || out.toWallets.amount > 0) {
    lines.push(`## Outbound Analysis`);
    lines.push(`- Sold on DEX: **${fmt(out.toDex.amount)} ${tokenSymbol}** (${out.toDex.percentage.toFixed(1)}%)`);
    lines.push(`- Sent to wallets: **${fmt(out.toWallets.amount)} ${tokenSymbol}** (${out.toWallets.percentage.toFixed(1)}%)`);
    if (out.topRecipients.length > 0) {
      lines.push('');
      lines.push('### Top Recipients');
      for (const r of out.topRecipients.slice(0, 10)) {
        lines.push(`- \`${r.address}\` — received ${fmt(r.amount)} ${tokenSymbol}, holds ${fmt(r.stillHolding)} ${tokenSymbol}`);
      }
    }
    lines.push('');
  }

  // Cluster wallets
  lines.push(`## Cluster Wallets`);
  for (const w of report.wallets) {
    const conf = w.confidence.toUpperCase();
    const origin = w.tokenOrigin !== 'unknown' ? ` [${w.tokenOrigin}]` : '';
    lines.push(`- **${conf}** \`${w.address}\` — ${fmt(w.balance)} ${tokenSymbol}${origin}`);
    lines.push(`  - ${w.reasons.join(', ')}`);
    if (w.tokenOriginDetails) lines.push(`  - Origin: ${w.tokenOriginDetails}`);
  }
  lines.push('');

  // Risk flags
  if (report.riskFlags.length > 0) {
    lines.push(`## Risk Flags`);
    for (const f of report.riskFlags) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  // Timeline (top 20 transfers by volume)
  if (scanResult && scanResult.transfers.length > 0) {
    const decimals = parseInt(scanResult.transfers[0].tokenDecimal, 10) || 18;
    const target = report.targetWallet.toLowerCase();
    const targetTxs = scanResult.transfers
      .filter((tx) => tx.from.toLowerCase() === target || tx.to.toLowerCase() === target)
      .sort((a, b) => {
        const va = parseFloat(a.value) / Math.pow(10, decimals);
        const vb = parseFloat(b.value) / Math.pow(10, decimals);
        return vb - va;
      })
      .slice(0, 20);

    if (targetTxs.length > 0) {
      lines.push(`## Top Transfers (by volume)`);
      for (const tx of targetTxs) {
        const value = parseFloat(tx.value) / Math.pow(10, decimals);
        const ts = parseInt(tx.timeStamp, 10);
        const dir = tx.from.toLowerCase() === target ? 'SENT' : 'RECV';
        const peer = tx.from.toLowerCase() === target ? tx.to : tx.from;
        lines.push(`- ${fmtDate(ts)}: ${dir} ${fmt(value)} ${tokenSymbol} ${dir === 'SENT' ? 'to' : 'from'} \`${peer}\``);
      }
      lines.push('');
    }
  }

  lines.push(`---`);
  lines.push(`*Generated by TCV — Token Cluster Visualizer*`);

  return lines.join('\n');
}

export default function HoldingsPanel({
  report,
  tokenSymbol,
  scanResult,
  onWalletClick,
}: HoldingsPanelProps) {
  const {
    targetBalance,
    totalHeldByCluster,
    totalPossibleHidden,
    wallets,
    clusterSummary,
    riskFlags,
    outboundSummary,
  } = report;

  const highWallets = wallets.filter((w) => w.confidence === 'high');
  const medWallets = wallets.filter((w) => w.confidence === 'medium');
  const confirmedHoldings = highWallets.reduce((s, w) => s + w.balance, 0);
  const suspectedHoldings = medWallets.reduce((s, w) => s + w.balance, 0);
  const totalEstimate = targetBalance + totalHeldByCluster;
  const totalWalletCount = wallets.filter((w) => w.confidence === 'high' || w.confidence === 'medium').length + 1;

  const handleExport = useCallback(() => {
    const md = generateMarkdownReport(report, tokenSymbol, scanResult);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcv-report-${report.targetWallet.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [report, tokenSymbol, scanResult]);

  return (
    <div>
      {/* ── Zero Balance Alert ── */}
      {targetBalance === 0 && totalHeldByCluster > 0 && (
        <div
          className="mx-4 mt-4 mb-2 px-3 py-2.5 rounded-md border border-amber-500/40 text-[11px] font-mono"
          style={{ background: 'rgba(245,158,11,0.08)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-400 font-bold text-xs">! TARGET HOLDS 0 {tokenSymbol}</span>
          </div>
          <p className="text-amber-300/80 leading-relaxed">
            The target wallet has no tokens, but {fmt(totalHeldByCluster)} {tokenSymbol} was found across {highWallets.length + medWallets.length} cluster wallet{highWallets.length + medWallets.length !== 1 ? 's' : ''}.
            Tokens may have been dispersed to secondary wallets.
          </p>
        </div>
      )}

      {/* ── Stat Cards (4 columns) ── */}
      <div className="grid grid-cols-4 gap-2 px-4 pt-4 pb-3">
        <StatCard
          label="TARGET"
          value={fmt(targetBalance)}
          sub={targetBalance === 0 ? 'EMPTIED' : tokenSymbol}
          variant={targetBalance === 0 ? 'warning' : 'default'}
          hint="Current token balance held directly in the target wallet"
        />
        <StatCard
          label="SOLD ON DEX"
          value={fmt(outboundSummary.toDex.amount)}
          sub={`${outboundSummary.toDex.percentage.toFixed(1)}% of outbound`}
          variant="purple"
          hint="Tokens sent to DEX contracts / routers — likely sold/liquidated"
        />
        <StatCard
          label="CONFIRMED HELD"
          value={fmt(confirmedHoldings + suspectedHoldings)}
          sub={`${highWallets.length} HIGH + ${medWallets.length} MED`}
          variant="green"
          hint="Tokens held in HIGH and MEDIUM confidence wallets — likely same owner"
        />
        <StatCard
          label="TOTAL ESTIMATED"
          value={fmt(totalEstimate)}
          sub={`across ${totalWalletCount} wallet${totalWalletCount !== 1 ? 's' : ''}`}
          variant="accent"
          hint="Target balance + all cluster wallet balances combined — this person's likely total position"
        />
      </div>

      {/* ── Export Button ── */}
      <div className="px-4 pb-3 flex justify-end">
        <button
          onClick={handleExport}
          className="text-[10px] font-mono px-3 py-1 rounded-md border border-raised hover:border-gray-500 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          title="Export a markdown report of all findings"
        >
          Export Report
        </button>
      </div>

      {/* ── Cluster Wallets ── */}
      {wallets.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2" title="Wallets scored by 7 heuristics including token origin analysis">
            Cluster Wallets
          </div>
          <div
            className="rounded-md border border-raised/50 overflow-hidden"
            style={{ background: '#0a0c14' }}
          >
            {wallets.map((w) => {
              const ob = originBadge(w.tokenOrigin);
              return (
                <button
                  key={w.address}
                  onClick={() => onWalletClick(w.address)}
                  className={`w-full flex items-center gap-2 px-3 py-2 border-l-[3px] ${confidenceBorder(
                    w.confidence
                  )} hover:bg-raised/40 transition-colors text-left cursor-pointer border-b border-raised/20 last:border-b-0`}
                >
                  {/* Confidence badge */}
                  <span
                    className="text-[9px] font-mono font-bold w-8 flex-shrink-0"
                    style={{ color: confidenceColor(w.confidence) }}
                    title={w.confidence === 'high' ? 'Score 60+: Very likely same owner' : w.confidence === 'medium' ? 'Score 35-59: Possibly same owner' : 'Score 15-34: Weak signals'}
                  >
                    {confidenceLabel(w.confidence)}
                  </span>

                  {/* Address */}
                  <span className="text-[11px] font-mono text-gray-400 flex-shrink-0">
                    {abbr(w.address)}
                  </span>

                  {/* Balance */}
                  <span
                    className={`text-[11px] font-mono flex-shrink-0 px-1.5 py-0.5 rounded ${
                      w.balance > 0
                        ? 'text-emerald-400 bg-emerald-400/10'
                        : 'text-gray-600'
                    }`}
                  >
                    {fmt(w.balance)} {tokenSymbol}
                  </span>

                  {/* Token origin badge */}
                  {ob.text && (
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${ob.cls}`}>
                      {ob.text}
                    </span>
                  )}

                  {/* Reasons (truncated) */}
                  <span className="flex-1 min-w-0 text-[10px] text-gray-600 font-mono truncate" title={`${w.reasons.join('\n')}\n\nOrigin: ${w.tokenOriginDetails}`}>
                    {w.reasons.slice(0, 2).join(', ')}
                  </span>

                  {/* Snowscan link */}
                  <SnowscanIcon address={w.address} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Risk Flags ── */}
      {riskFlags.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2" title="Behavioral patterns detected across the wallet cluster">
            Flags
          </div>
          <div className="space-y-1">
            {riskFlags.map((flag, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-[11px] font-mono"
              >
                <span className="text-amber-400 flex-shrink-0 mt-0.5">*</span>
                <span className="text-gray-400">{flag}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Summary ── */}
      <div className="px-4 pb-4">
        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">
          Summary
        </div>
        <p className="text-[11px] font-mono text-gray-400 leading-relaxed">
          {clusterSummary}
        </p>
        {totalPossibleHidden > 0 && (
          <p className="text-[11px] font-mono text-gray-500 mt-2 leading-relaxed">
            Additional LOW confidence wallets hold {fmt(totalPossibleHidden)}{' '}
            {tokenSymbol} with weaker signals.
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  variant = 'default',
  hint,
}: {
  label: string;
  value: string;
  sub: string;
  variant?: 'default' | 'accent' | 'green' | 'purple' | 'warning';
  hint?: string;
}) {
  const styles: Record<string, { border: string; bg: string; text: string }> = {
    default: { border: 'border-raised/50', bg: 'bg-surface/50', text: 'text-gray-200' },
    accent: { border: 'border-[#c9a227]/40', bg: 'bg-[#c9a227]/8', text: 'text-[#c9a227]' },
    green: { border: 'border-emerald-400/30', bg: 'bg-emerald-400/5', text: 'text-emerald-400' },
    purple: { border: 'border-[#a87cdb]/30', bg: 'bg-[#a87cdb]/5', text: 'text-[#a87cdb]' },
    warning: { border: 'border-amber-500/40', bg: 'bg-amber-500/5', text: 'text-amber-400' },
  };
  const s = styles[variant];

  return (
    <div
      title={hint}
      className={`rounded-lg border px-2.5 py-2.5 ${s.border} ${s.bg}`}
    >
      <div className="text-[8px] font-mono text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-base font-bold font-mono leading-tight ${s.text}`}>
        {value}
      </div>
      <div className="text-[9px] font-mono text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
