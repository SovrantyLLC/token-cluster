'use client';

import { HoldingsReport, HiddenHoldingWallet } from '@/lib/types';

interface HoldingsPanelProps {
  report: HoldingsReport;
  tokenSymbol: string;
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

export default function HoldingsPanel({
  report,
  tokenSymbol,
  onWalletClick,
}: HoldingsPanelProps) {
  const {
    targetBalance,
    totalHeldByCluster,
    totalPossibleHidden,
    wallets,
    clusterSummary,
    riskFlags,
  } = report;

  const highWallets = wallets.filter((w) => w.confidence === 'high');
  const confirmedHoldings = highWallets.reduce((s, w) => s + w.balance, 0);
  const totalEstimate = targetBalance + totalHeldByCluster;
  const totalWalletCount = wallets.filter((w) => w.confidence === 'high' || w.confidence === 'medium').length + 1;

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
                The target wallet has no tokens, but {fmt(totalHeldByCluster)} {tokenSymbol} was found across {highWallets.length} cluster wallet{highWallets.length !== 1 ? 's' : ''}.
                Tokens may have been dispersed to secondary wallets.
              </p>
            </div>
          )}

          {/* ── Stat Cards ── */}
          <div className="grid grid-cols-3 gap-3 px-4 pt-4 pb-3">
            <StatCard
              label="TARGET"
              value={fmt(targetBalance)}
              sub={tokenSymbol}
              accent={false}
              hint="Current token balance held directly in the target wallet"
            />
            <StatCard
              label="CONFIRMED"
              value={`+ ${fmt(confirmedHoldings)}`}
              sub={`${tokenSymbol} (${highWallets.length} wlt${highWallets.length !== 1 ? 's' : ''})`}
              accent={false}
              highlight
              hint="Additional tokens held in HIGH confidence wallets — likely owned by the same person based on shared funding, bidirectional transfers, timing patterns, etc."
            />
            <StatCard
              label="TOTAL ESTIMATED"
              value={fmt(totalEstimate)}
              sub={`${tokenSymbol} across ${totalWalletCount} wallet${totalWalletCount !== 1 ? 's' : ''}`}
              accent
              hint="Target balance + all HIGH and MEDIUM confidence wallet balances combined — this person's likely total position"
            />
          </div>

          {/* ── Cluster Wallets ── */}
          {wallets.length > 0 && (
            <div className="px-4 pb-3">
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2" title="Wallets scored by 6 heuristics: bidirectional transfers, shared gas funding source, rapid transfer timing, sequential sends, received-then-held pattern, and isolated activity">
                Cluster Wallets
              </div>
              <div
                className="rounded-md border border-raised/50 overflow-hidden"
                style={{ background: '#0a0c14' }}
              >
                {wallets.map((w) => (
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

                    {/* Reasons (truncated) */}
                    <span className="flex-1 min-w-0 text-[10px] text-gray-600 font-mono truncate" title={w.reasons.join('\n')}>
                      {w.reasons.slice(0, 2).join(', ')}
                    </span>

                    {/* Snowscan link */}
                    <SnowscanIcon address={w.address} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Risk Flags ── */}
          {riskFlags.length > 0 && (
            <div className="px-4 pb-3">
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2" title="Behavioral patterns detected across the wallet cluster — may indicate wash trading, wallet splitting, cold storage, or recent token dispersal">
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
  accent,
  highlight,
  hint,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  highlight?: boolean;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      className={`rounded-lg border px-3 py-3 ${
        accent
          ? 'border-[#c9a227]/40 bg-[#c9a227]/8'
          : highlight
          ? 'border-emerald-400/30 bg-emerald-400/5'
          : 'border-raised/50 bg-surface/50'
      }`}
    >
      <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`text-lg font-bold font-mono leading-tight ${
          accent ? 'text-[#c9a227]' : highlight ? 'text-emerald-400' : 'text-gray-200'
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] font-mono text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
