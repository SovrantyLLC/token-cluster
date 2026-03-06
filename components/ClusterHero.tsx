'use client';

import { useState } from 'react';
import { HoldingsReport, HiddenHoldingWallet } from '@/lib/types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(ts: number): string {
  if (!ts) return '\u2014';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function abbr(addr: string) {
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/* ── Confidence badge ── */
function ConfBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    high:   { bg: 'rgba(16,185,129,0.12)', text: '#10b981', label: 'HIGH' },
    medium: { bg: 'rgba(251,191,36,0.12)', text: '#fbbf24', label: 'MED' },
    low:    { bg: 'rgba(107,114,128,0.12)', text: '#6b7280', label: 'LOW' },
  };
  const s = styles[confidence] ?? styles.low;
  return (
    <span
      className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

/* ── Wallet detail drawer ── */
function WalletDrawer({
  wallet,
  tokenSymbol,
  onClose,
}: {
  wallet: HiddenHoldingWallet;
  tokenSymbol: string;
  onClose: () => void;
}) {
  const scoreBreakdown = wallet.scoreBreakdown;

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-50 flex flex-col shadow-2xl border-l overflow-y-auto"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {wallet.address.slice(0, 10)}\u2026{wallet.address.slice(-6)}
          </div>
          <ConfBadge confidence={wallet.confidence} />
        </div>
        <button
          onClick={onClose}
          className="text-lg leading-none transition-opacity hover:opacity-60"
          style={{ color: 'var(--text-muted)' }}
        >
          \u2715
        </button>
      </div>

      {/* Holdings breakdown */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
          Holdings
        </div>
        <div className="space-y-1 text-[12px]">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Wallet balance</span>
            <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
              {fmt(wallet.balance)} {tokenSymbol}
            </span>
          </div>
          {wallet.lpBalance > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>In LP positions</span>
              <span className="font-mono" style={{ color: 'var(--accent-blue)' }}>
                +{fmt(wallet.lpBalance)} {tokenSymbol}
              </span>
            </div>
          )}
          {wallet.stakedBalance > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Staked</span>
              <span className="font-mono" style={{ color: 'var(--accent-purple)' }}>
                +{fmt(wallet.stakedBalance)} {tokenSymbol}
              </span>
            </div>
          )}
          {wallet.vlpStaking && wallet.vlpStaking.vlpStaked > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>
                VLP in Ninety1
                {wallet.vlpStaking.unstakingDetected && (
                  <span className="text-[9px] ml-1" style={{ color: 'var(--accent-red)' }}>{'\u26A0'} unstaking</span>
                )}
              </span>
              <span className="font-mono" style={{ color: 'var(--accent-purple)' }}>
                {fmt(wallet.vlpStaking.fldEquivalent)} {tokenSymbol}
              </span>
            </div>
          )}
          <div
            className="flex justify-between pt-1 border-t font-bold"
            style={{ borderColor: 'var(--border)' }}
          >
            <span style={{ color: 'var(--text-primary)' }}>Total</span>
            <span className="font-mono" style={{ color: 'var(--accent-green)' }}>
              {fmt(wallet.totalHoldings)} {tokenSymbol}
            </span>
          </div>
        </div>
      </div>

      {/* Activity */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
          Activity
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>First seen</span>
            <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(wallet.firstInteraction)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Last active</span>
            <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(wallet.lastInteraction)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Transfers with target</span>
            <span style={{ color: 'var(--text-secondary)' }}>{wallet.transfersWithTarget}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Net flow from target</span>
            <span style={{ color: wallet.netFlowFromTarget >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {wallet.netFlowFromTarget >= 0 ? '+' : ''}{fmt(wallet.netFlowFromTarget)} {tokenSymbol}
            </span>
          </div>
        </div>
      </div>

      {/* Evidence log */}
      <div className="px-4 py-3 flex-1">
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
          Why is this wallet linked?
        </div>
        <div className="space-y-2">
          {scoreBreakdown && scoreBreakdown.length > 0 ? (
            scoreBreakdown.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span
                  className="font-mono font-bold shrink-0 w-8 text-right"
                  style={{ color: item.points > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
                >
                  {item.points > 0 ? '+' : ''}{item.points}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>{item.signal}</span>
              </div>
            ))
          ) : (
            wallet.reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span style={{ color: 'var(--accent-green)' }} className="shrink-0">{'\u2713'}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{r}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CEX Deposit Match Evidence */}
      {wallet.cexDepositMatch && wallet.sharedDepositAddress && (
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div
            className="rounded p-2"
            style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid var(--accent-gold)' }}
          >
            <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--accent-gold)' }}>
              CEX DEPOSIT MATCH — HIGH CONFIDENCE
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              This wallet and {wallet.cexLinkedWallets.length} other wallet(s) have all sent funds
              to the same {wallet.cexLabel || 'CEX'} deposit address:
            </div>
            <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--accent-gold)' }}>
              {wallet.sharedDepositAddress}
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-dim)' }}>
              Linked wallets: {wallet.cexLinkedWallets.map(w => (
                <span key={w} className="font-mono">{w.slice(0,6)}...{w.slice(-4)} </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div
        className="flex gap-2 px-4 py-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <a
          href={`https://snowscan.xyz/address/${wallet.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-[11px] font-mono py-1.5 rounded border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-raised)' }}
        >
          View on Snowscan {'\u2197'}
        </a>
        <button
          onClick={() => navigator.clipboard.writeText(wallet.address)}
          className="text-[11px] font-mono px-3 py-1.5 rounded border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-raised)' }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

/* ── Wallet row ── */
function WalletRow({
  wallet,
  tokenSymbol,
  onSelect,
}: {
  wallet: HiddenHoldingWallet;
  tokenSymbol: string;
  onSelect: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 cursor-pointer border-b transition-colors hover:opacity-90"
      style={{
        borderColor: wallet.cexDepositMatch ? 'var(--accent-gold)' : 'var(--border)',
        borderWidth: wallet.cexDepositMatch ? '2px' : '1px',
        background: 'var(--bg-card)',
      }}
      onClick={onSelect}
    >
      <ConfBadge confidence={wallet.confidence} />

      <span
        className="font-mono text-[12px] flex-1 truncate flex items-center gap-1.5"
        style={{ color: 'var(--accent-blue)' }}
      >
        {abbr(wallet.address)}
        {wallet.cexDepositMatch && (
          <span
            className="text-[9px] font-bold px-1 rounded"
            style={{ background: 'var(--accent-gold)', color: '#000' }}
            title={`Shared CEX deposit: ${wallet.sharedDepositAddress}`}
          >
            CEX LINK
          </span>
        )}
      </span>

      <div className="text-right shrink-0">
        <div className="font-mono font-bold text-[12px]" style={{ color: 'var(--text-primary)' }}>
          {fmt(wallet.totalHoldings)} {tokenSymbol}
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-0.5">
          {wallet.lpBalance > 0 && (
            <span className="text-[9px] font-mono" style={{ color: 'var(--accent-blue)' }}>
              +{fmt(wallet.lpBalance)} LP
            </span>
          )}
          {wallet.stakedBalance > 0 && (
            <span className="text-[9px] font-mono" style={{ color: 'var(--accent-purple)' }}>
              +{fmt(wallet.stakedBalance)} staked
            </span>
          )}
          {wallet.vlpStaking?.unstakingDetected && (
            <span className="text-[9px] font-mono" style={{ color: 'var(--accent-red)' }}>
              {'\u26A0'} unstaking
            </span>
          )}
        </div>
      </div>

      <span className="text-[11px] shrink-0" style={{ color: 'var(--text-dim)' }}>{'\u203A'}</span>
    </div>
  );
}

/* ══════════════════════════════════════
   MAIN EXPORT — ClusterHero
   ══════════════════════════════════════ */
export default function ClusterHero({
  holdingsReport,
  tokenSymbol,
  targetWallet,
  isScanning,
  scanPhase,
  error,
  scanLimitHit,
}: {
  holdingsReport: HoldingsReport | null;
  tokenSymbol: string;
  targetWallet: string;
  isScanning: boolean;
  scanPhase: string;
  error: string;
  scanLimitHit: boolean;
}) {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  /* ── Loading state ── */
  if (isScanning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-base)' }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-gold)', borderTopColor: 'transparent' }} />
        <div className="font-mono text-sm" style={{ color: 'var(--accent-gold)' }}>{scanPhase || 'Scanning...'}</div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div
          className="px-4 py-3 rounded-lg border text-sm font-mono"
          style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)', background: 'rgba(248,113,113,0.08)' }}
        >
          {'\u26A0'} {error}
        </div>
      </div>
    );
  }

  /* ── Empty state ── */
  if (!holdingsReport) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="text-4xl">{'\uD83D\uDD0D'}</div>
        <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Paste a wallet address and hit Scan
        </div>
        <div className="text-sm max-w-xs" style={{ color: 'var(--text-muted)' }}>
          Token Cluster Map analyzes on-chain transfer patterns to find wallets likely
          controlled by the same entity.
        </div>
      </div>
    );
  }

  const { wallets, targetBalance, totalInLP, totalStaked, riskFlags } = holdingsReport;
  const highWallets = wallets.filter(w => w.confidence === 'high');
  const medWallets = wallets.filter(w => w.confidence === 'medium');
  const lowWallets = wallets.filter(w => w.confidence === 'low');

  const confirmedTotal = targetBalance +
    highWallets.reduce((s, w) => s + w.totalHoldings, 0) +
    medWallets.reduce((s, w) => s + w.totalHoldings, 0);

  const selectedWalletData = wallets.find(
    w => w.address.toLowerCase() === selectedWallet?.toLowerCase()
  );

  /* ── Share URL ── */
  const shareUrl = () => {
    const url = `${window.location.origin}?wallet=${targetWallet}`;
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">

      {/* ── ENTITY SUMMARY HEADER ── */}
      <div
        className="flex-shrink-0 px-5 py-4 border-b"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>
              Entity Summary
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold font-mono" style={{ color: 'var(--accent-gold)' }}>
                {fmt(confirmedTotal)} {tokenSymbol}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                total controlled
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] font-mono">
              <span style={{ color: 'var(--accent-green)' }}>
                {highWallets.length + medWallets.length + 1} wallets
              </span>
              {totalStaked > 0 && (
                <span style={{ color: 'var(--accent-purple)' }}>
                  {fmt(totalStaked)} staked
                </span>
              )}
              {totalInLP > 0 && (
                <span style={{ color: 'var(--accent-blue)' }}>
                  {fmt(totalInLP)} in LP
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {scanLimitHit && (
              <span
                className="text-[10px] font-mono px-2 py-1 rounded border"
                style={{ color: 'var(--accent-yellow)', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)' }}
              >
                {'\u26A0'} Limit hit
              </span>
            )}
            <button
              onClick={shareUrl}
              className="text-[11px] font-mono px-3 py-1.5 rounded border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-raised)' }}
              title="Copy shareable link to clipboard"
            >
              Share {'\u2197'}
            </button>
          </div>
        </div>

        {/* Risk flags — compact */}
        {riskFlags && riskFlags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {riskFlags.slice(0, 4).map((flag, i) => (
              <span
                key={i}
                className="text-[10px] font-mono px-2 py-0.5 rounded border truncate max-w-xs"
                style={{ borderColor: 'rgba(251,191,36,0.25)', color: 'var(--accent-yellow)', background: 'rgba(251,191,36,0.06)' }}
                title={flag}
              >
                {'\u26A0'} {flag.length > 55 ? flag.slice(0, 55) + '\u2026' : flag}
              </span>
            ))}
            {riskFlags.length > 4 && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                +{riskFlags.length - 4} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── CLUSTER LIST ── */}
      <div className="flex-1 overflow-y-auto">

        {/* HIGH CONFIDENCE */}
        {highWallets.length > 0 && (
          <div>
            <div
              className="px-4 py-2 text-[10px] uppercase tracking-wider font-bold sticky top-0 z-10"
              style={{ background: 'var(--bg-base)', color: 'var(--accent-green)', borderBottom: '1px solid var(--border)' }}
            >
              {'\u25CF'} Confirmed Cluster — {highWallets.length} wallet{highWallets.length !== 1 ? 's' : ''}
            </div>
            {highWallets.map(w => (
              <WalletRow
                key={w.address}
                wallet={w}
                tokenSymbol={tokenSymbol}
                onSelect={() => setSelectedWallet(w.address)}
              />
            ))}
          </div>
        )}

        {/* MEDIUM CONFIDENCE */}
        {medWallets.length > 0 && (
          <div>
            <div
              className="px-4 py-2 text-[10px] uppercase tracking-wider font-bold sticky top-0 z-10"
              style={{ background: 'var(--bg-base)', color: 'var(--accent-yellow)', borderBottom: '1px solid var(--border)' }}
            >
              {'\u25CF'} Suspects — {medWallets.length} wallet{medWallets.length !== 1 ? 's' : ''}
            </div>
            {medWallets.map(w => (
              <WalletRow
                key={w.address}
                wallet={w}
                tokenSymbol={tokenSymbol}
                onSelect={() => setSelectedWallet(w.address)}
              />
            ))}
          </div>
        )}

        {/* LOW CONFIDENCE — collapsed */}
        {lowWallets.length > 0 && (
          <div>
            <button
              className="w-full px-4 py-2 text-left text-[10px] uppercase tracking-wider font-mono transition-opacity hover:opacity-70"
              style={{ color: 'var(--text-dim)', background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}
              onClick={() => setShowLow(s => !s)}
            >
              {showLow ? '\u25BC' : '\u25B6'} Possible matches — {lowWallets.length} wallet{lowWallets.length !== 1 ? 's' : ''} (weak signals)
            </button>
            {showLow && lowWallets.map(w => (
              <WalletRow
                key={w.address}
                wallet={w}
                tokenSymbol={tokenSymbol}
                onSelect={() => setSelectedWallet(w.address)}
              />
            ))}
          </div>
        )}

        {/* Empty cluster state */}
        {highWallets.length === 0 && medWallets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-3">
            <div className="text-3xl">{'\uD83D\uDD0E'}</div>
            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              No cluster wallets found
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This wallet appears to be operating independently, or try increasing the scan limit.
            </div>
          </div>
        )}

        {/* Advanced report button */}
        {holdingsReport && (
          <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => setReportOpen(r => !r)}
              className="text-[11px] font-mono transition-opacity hover:opacity-70"
              style={{ color: 'var(--text-dim)' }}
            >
              {reportOpen ? '\u25BC' : '\u25B6'} Advanced Report
            </button>
            {reportOpen && (
              <div className="mt-3 text-[11px] leading-relaxed space-y-2" style={{ color: 'var(--text-secondary)' }}>
                <p>{holdingsReport.clusterSummary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── WALLET DETAIL DRAWER ── */}
      {selectedWallet && selectedWalletData && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSelectedWallet(null)}
          />
          <WalletDrawer
            wallet={selectedWalletData}
            tokenSymbol={tokenSymbol}
            onClose={() => setSelectedWallet(null)}
          />
        </>
      )}

    </div>
  );
}
