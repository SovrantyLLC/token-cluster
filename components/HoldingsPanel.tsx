'use client';

import { useCallback } from 'react';
import { HoldingsReport, HiddenHoldingWallet, ScanResult, WalletHistory } from '@/lib/types';

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

/* ── Disposition Bar ── */
function DispositionBar({ ghost }: { ghost: WalletHistory }) {
  const d = ghost.disposition;
  const total = d.soldOnDex.amount + d.sentToWallets.amount + d.sentToContracts.amount + d.burnedOrLost.amount;
  if (total === 0) return null;

  const segments = [
    { pct: d.soldOnDex.percentage, color: '#e84142', label: 'DEX' },
    { pct: d.sentToWallets.percentage, color: '#4ea8de', label: 'Wallets' },
    { pct: d.sentToContracts.percentage, color: '#a87cdb', label: 'Contracts' },
    { pct: d.burnedOrLost.percentage, color: '#6b7280', label: 'Burned' },
  ].filter((s) => s.pct > 0);

  return (
    <div className="flex items-center gap-1 w-full">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden flex" style={{ background: '#1a1e2e' }}>
        {segments.map((s, i) => (
          <div
            key={i}
            style={{ width: `${s.pct}%`, background: s.color }}
            title={`${s.label}: ${s.pct.toFixed(1)}%`}
          />
        ))}
      </div>
    </div>
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
  if (report.totalInLP > 0) {
    lines.push(`- In LP positions: **${fmt(report.totalInLP)} ${tokenSymbol}**`);
    lines.push(`- True total (wallet + LP): **${fmt(report.totalTrueHoldings)} ${tokenSymbol}**`);
  } else {
    lines.push(`- Total estimated same-owner: **${fmt(report.targetBalance + report.totalHeldByCluster)} ${tokenSymbol}**`);
  }
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

  // Ghost wallets
  if (report.ghostWallets.length > 0) {
    lines.push(`## Ghost Wallets (Previously Held)`);
    lines.push(`*${report.ghostWallets.length} wallet(s) that once held tokens but are now empty.*`);
    lines.push('');
    for (const g of report.ghostWallets) {
      const d = g.disposition;
      lines.push(`### \`${g.address}\``);
      lines.push(`- Peak: **${fmt(g.peakBalance)} ${tokenSymbol}** (${fmtDate(g.peakDate)})`);
      lines.push(`- Total received: ${fmt(g.totalReceived)}, Total sent: ${fmt(g.totalSent)}`);
      if (d.soldOnDex.amount > 0) {
        lines.push(`- Sold on DEX: **${fmt(d.soldOnDex.amount)}** (${d.soldOnDex.percentage.toFixed(1)}%) via ${d.soldOnDex.dexes.join(', ') || 'DEX'}`);
      }
      if (d.sentToWallets.amount > 0) {
        lines.push(`- Sent to wallets: **${fmt(d.sentToWallets.amount)}** (${d.sentToWallets.percentage.toFixed(1)}%)`);
        for (const r of d.sentToWallets.recipients.slice(0, 5)) {
          const statusLabel = r.status === 'holding' ? 'HOLDING' : r.status === 'sold' ? 'SOLD' : r.status === 'passed-along' ? 'PASSED' : 'MIXED';
          lines.push(`  - \`${r.address}\` received ${fmt(r.amountReceived)}, holds ${fmt(r.stillHolding)} [${statusLabel}]`);
        }
      }
      lines.push('');
    }
  }

  // Cluster wallets
  lines.push(`## Cluster Wallets`);
  for (const w of report.wallets) {
    const conf = w.confidence.toUpperCase();
    const origin = w.tokenOrigin !== 'unknown' ? ` [${w.tokenOrigin}]` : '';
    const lpNote = w.lpBalance > 0 ? ` (+${fmt(w.lpBalance)} in LP)` : '';
    lines.push(`- **${conf}** \`${w.address}\` — ${fmt(w.balance)} ${tokenSymbol}${lpNote}${origin}`);
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

  // Top transfers
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
    totalInLP,
    totalTrueHoldings,
    wallets,
    clusterSummary,
    riskFlags,
    outboundSummary,
    ghostWallets,
  } = report;

  const highWallets = wallets.filter((w) => w.confidence === 'high');
  const medWallets = wallets.filter((w) => w.confidence === 'medium');
  const confirmedHoldings = highWallets.reduce((s, w) => s + w.balance, 0);
  const suspectedHoldings = medWallets.reduce((s, w) => s + w.balance, 0);
  const totalEstimate = targetBalance + totalHeldByCluster;
  const totalWalletCount = wallets.filter((w) => w.confidence === 'high' || w.confidence === 'medium').length + 1;
  const combinedGhostPeak = ghostWallets.reduce((s, g) => s + g.peakBalance, 0);

  // Detect pass-through ghosts
  const passThroughGhosts = ghostWallets.filter((g) => {
    const recips = g.disposition.sentToWallets.recipients;
    if (recips.length === 0) return false;
    const top = recips[0];
    return top.amountReceived / (g.disposition.sentToWallets.amount || 1) > 0.7 && top.currentBalance > 0;
  });

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

      {/* ── Stat Cards ── */}
      <div className={`grid gap-2 px-4 pt-4 pb-3 ${totalInLP > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
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
        {totalInLP > 0 && (
          <StatCard
            label="IN LP"
            value={fmt(totalInLP)}
            sub="in liquidity pools"
            variant="lp"
            hint="Tokens held inside DEX liquidity pools — hidden from simple balance checks"
          />
        )}
        <StatCard
          label={totalInLP > 0 ? 'TRUE TOTAL' : 'TOTAL ESTIMATED'}
          value={fmt(totalInLP > 0 ? totalTrueHoldings : totalEstimate)}
          sub={`across ${totalWalletCount} wallet${totalWalletCount !== 1 ? 's' : ''}${totalInLP > 0 ? ' + LP' : ''}`}
          variant="accent"
          hint={totalInLP > 0 ? 'Target + cluster wallets + LP positions — true total holdings' : 'Target balance + all cluster wallet balances combined'}
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
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2" title="Wallets scored by 9 heuristics including token origin, pass-through, and sell-off analysis">
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
                  <span
                    className="text-[9px] font-mono font-bold w-8 flex-shrink-0"
                    style={{ color: confidenceColor(w.confidence) }}
                    title={w.confidence === 'high' ? 'Score 60+: Very likely same owner' : w.confidence === 'medium' ? 'Score 35-59: Possibly same owner' : 'Score 15-34: Weak signals'}
                  >
                    {confidenceLabel(w.confidence)}
                  </span>
                  <span className="text-[11px] font-mono text-gray-400 flex-shrink-0">
                    {abbr(w.address)}
                  </span>
                  <span
                    className={`text-[11px] font-mono flex-shrink-0 px-1.5 py-0.5 rounded ${
                      w.balance > 0
                        ? 'text-emerald-400 bg-emerald-400/10'
                        : 'text-gray-600'
                    }`}
                  >
                    {fmt(w.balance)} {tokenSymbol}
                  </span>
                  {w.lpBalance > 0 && (
                    <span className="text-[10px] font-mono flex-shrink-0 px-1.5 py-0.5 rounded text-[#9b59b6] bg-[#9b59b6]/10">
                      +{fmt(w.lpBalance)} LP
                    </span>
                  )}
                  {ob.text && (
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${ob.cls}`}>
                      {ob.text}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 text-[10px] text-gray-600 font-mono truncate" title={`${w.reasons.join('\n')}\n\nOrigin: ${w.tokenOriginDetails}`}>
                    {w.reasons.slice(0, 2).join(', ')}
                  </span>
                  <SnowscanIcon address={w.address} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ghost Wallets ── */}
      {ghostWallets.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider" title="Wallets that once held tokens but are now empty — shows where tokens went">
              Ghost Wallets — Previously Held
            </div>
            <span className="text-[9px] font-mono text-gray-600">
              Peak: {fmt(combinedGhostPeak)} {tokenSymbol}
            </span>
          </div>

          <div
            className="rounded-md border border-raised/50 overflow-hidden"
            style={{ background: '#0a0c14' }}
          >
            {ghostWallets
              .sort((a, b) => b.peakBalance - a.peakBalance)
              .slice(0, 15)
              .map((ghost) => {
                const d = ghost.disposition;
                const isPassThrough = passThroughGhosts.includes(ghost);
                const topRecip = d.sentToWallets.recipients[0];

                return (
                  <div
                    key={ghost.address}
                    className={`px-3 py-2.5 border-b border-raised/20 last:border-b-0 ${
                      isPassThrough ? 'border-l-[3px] border-l-[#c9a227]' : 'border-l-[3px] border-l-red-500/40'
                    }`}
                  >
                    {/* Row 1: Address + Peak */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-mono font-bold text-red-400/70 w-10 flex-shrink-0">
                        GHOST
                      </span>
                      <span className="text-[11px] font-mono text-gray-400 flex-shrink-0">
                        {abbr(ghost.address)}
                      </span>
                      <span className="text-[11px] font-mono text-gray-200 font-bold flex-shrink-0">
                        {fmt(ghost.peakBalance)} {tokenSymbol}
                      </span>
                      <span className="text-[9px] font-mono text-gray-600 flex-shrink-0">
                        peak {fmtDate(ghost.peakDate)}
                      </span>
                      {isPassThrough && (
                        <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded text-[#c9a227] bg-[#c9a227]/10 flex-shrink-0">
                          PASS-THROUGH
                        </span>
                      )}
                      <span className="ml-auto flex-shrink-0">
                        <SnowscanIcon address={ghost.address} />
                      </span>
                    </div>

                    {/* Row 2: Disposition bar */}
                    <DispositionBar ghost={ghost} />

                    {/* Row 3: Where it went */}
                    <div className="flex items-center gap-3 mt-1 text-[10px] font-mono">
                      {d.soldOnDex.amount > 0 && (
                        <span className="text-red-400/80">
                          {d.soldOnDex.percentage.toFixed(0)}% sold{d.soldOnDex.dexes.length > 0 ? ` on ${d.soldOnDex.dexes[0]}` : ''}
                        </span>
                      )}
                      {d.sentToWallets.amount > 0 && (
                        <span className="text-[#4ea8de]/80">
                          {d.sentToWallets.percentage.toFixed(0)}% to wallets
                        </span>
                      )}
                      {d.sentToContracts.amount > 0 && (
                        <span className="text-[#a87cdb]/80">
                          {d.sentToContracts.percentage.toFixed(0)}% to contracts
                        </span>
                      )}
                    </div>

                    {/* Row 4: Top recipient if pass-through */}
                    {isPassThrough && topRecip && (
                      <div className="mt-1 text-[10px] font-mono text-[#c9a227]/80 flex items-center gap-1">
                        <span className="text-gray-600">{'\u2192'}</span>
                        Moved to {abbr(topRecip.address)} which still holds{' '}
                        <span className="text-emerald-400">{fmt(topRecip.stillHolding)} {tokenSymbol}</span>
                      </div>
                    )}

                    {/* Row 4b: Recipients who sold */}
                    {!isPassThrough && d.sentToWallets.recipients.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {d.sentToWallets.recipients.slice(0, 3).map((r) => (
                          <div key={r.address} className="text-[10px] font-mono flex items-center gap-1">
                            <span className="text-gray-600">{'\u2192'}</span>
                            <span className="text-gray-500">{abbr(r.address)}</span>
                            <span className="text-gray-500">recv {fmt(r.amountReceived)}</span>
                            {r.status === 'holding' && (
                              <span className="text-emerald-400">holds {fmt(r.stillHolding)}</span>
                            )}
                            {r.status === 'sold' && (
                              <span className="text-red-400/70">sold {fmt(r.soldFromHere)}</span>
                            )}
                            {r.status === 'passed-along' && (
                              <span className="text-[#4ea8de]/70">passed {fmt(r.passedAlong)}</span>
                            )}
                            {r.status === 'mixed' && (
                              <span className="text-gray-500">mixed</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
  variant?: 'default' | 'accent' | 'green' | 'purple' | 'warning' | 'lp';
  hint?: string;
}) {
  const styles: Record<string, { border: string; bg: string; text: string }> = {
    default: { border: 'border-raised/50', bg: 'bg-surface/50', text: 'text-gray-200' },
    accent: { border: 'border-[#c9a227]/40', bg: 'bg-[#c9a227]/8', text: 'text-[#c9a227]' },
    green: { border: 'border-emerald-400/30', bg: 'bg-emerald-400/5', text: 'text-emerald-400' },
    purple: { border: 'border-[#a87cdb]/30', bg: 'bg-[#a87cdb]/5', text: 'text-[#a87cdb]' },
    warning: { border: 'border-amber-500/40', bg: 'bg-amber-500/5', text: 'text-amber-400' },
    lp: { border: 'border-[#9b59b6]/30', bg: 'bg-[#9b59b6]/5', text: 'text-[#9b59b6]' },
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
