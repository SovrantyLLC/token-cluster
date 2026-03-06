'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { TokenInfo, ScanResult, HoldingsReport } from '@/lib/types';
import { DEFAULT_TARGET, TOKEN_PRESETS } from '@/lib/constants';
import Sidebar from '@/components/Sidebar';
import Graph from '@/components/Graph';
import ClusterHero from '@/components/ClusterHero';
import TokenModal from '@/components/TokenModal';

const DEEP_SCAN_PHASES = [
  'Fetching transfers...',
  'Detecting contracts...',
  'Checking balances...',
  'Analyzing funding sources...',
  'Scoring wallet ownership...',
  'Running recursive scan...',
];

export default function Dashboard() {
  /* ── state ── */
  const [currentToken, setCurrentToken] = useState<TokenInfo>(TOKEN_PRESETS[0]);
  const [targetWallet, setTargetWallet] = useState(DEFAULT_TARGET);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState('');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [error, setError] = useState('');
  const [holdingsReport, setHoldingsReport] = useState<HoldingsReport | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Set<number>>(new Set([1, 2]));
  const [scanLimitHit, setScanLimitHit] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  /* ── theme ── */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* ── scan (always deep) ── */
  const handleScan = useCallback(
    async (wallet: string, _depth: number, limit: number) => {
      if (!currentToken || !wallet) return;

      setTargetWallet(wallet);
      setIsScanning(true);
      setError('');
      setScanResult(null);
      setHoldingsReport(null);
      setVisibleLayers(new Set([1, 2]));
      setScanLimitHit(false);
      setShowGraph(false);

      const timers: ReturnType<typeof setTimeout>[] = [];
      DEEP_SCAN_PHASES.forEach((phase, i) => {
        timers.push(setTimeout(() => setScanPhase(phase), i * 4000));
      });

      try {
        const res = await fetch('/api/deep-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet,
            tokenAddress: currentToken.address,
            decimals: currentToken.decimals,
            limit,
          }),
        });

        for (const t of timers) clearTimeout(t);

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Scan failed');
        }

        const data: { scanResult: ScanResult; holdingsReport: HoldingsReport } =
          await res.json();
        setScanResult(data.scanResult);
        setHoldingsReport(data.holdingsReport);
        setScanLimitHit(data.scanResult.transfers.length >= limit);
        setScanPhase('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scan failed');
        setScanPhase('');
      } finally {
        setIsScanning(false);
      }
    },
    [currentToken]
  );

  /* ── all nodes/links for graph ── */
  const allNodes = scanResult?.nodes ?? [];
  const allLinks = scanResult?.links ?? [];

  /* ── detectedContracts set ── */
  const detectedContracts = useMemo(
    () => new Set(scanResult?.detectedContracts ?? []),
    [scanResult?.detectedContracts]
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* ═══ TOPBAR ═══ */}
      <header
        className="flex items-center justify-between px-4 h-11 flex-shrink-0 border-b"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className="text-sm font-bold font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--accent-gold)' }}
            >
              TC
            </span>
            <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Token Cluster Map
            </span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>v5</span>
          </div>

          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
            style={{ color: 'var(--accent-avax)', borderColor: 'rgba(232,65,66,0.3)', background: 'rgba(232,65,66,0.08)' }}
          >
            AVAX C-Chain
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="text-[11px] font-mono px-2 py-1 rounded border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
            title="Toggle dark/light mode"
          >
            {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
          </button>
        </div>
      </header>

      {/* ═══ BODY ═══ */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── LEFT PANEL ── */}
        <aside
          className="flex-shrink-0 flex flex-col border-r overflow-hidden"
          style={{ width: 300, background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <Sidebar
            currentToken={currentToken}
            targetWallet={targetWallet}
            isScanning={isScanning}
            onTokenChange={() => setShowTokenModal(true)}
            onWalletChange={setTargetWallet}
            onScan={handleScan}
          />
        </aside>

        {/* ── RIGHT PANEL ── */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: 'var(--bg-base)' }}>

          {/* CLUSTER HERO — takes all space when graph is hidden */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <ClusterHero
              holdingsReport={holdingsReport}
              tokenSymbol={currentToken.symbol}
              targetWallet={targetWallet}
              isScanning={isScanning}
              scanPhase={scanPhase}
              error={error}
              scanLimitHit={scanLimitHit}
            />
          </div>

          {/* GRAPH — collapsed by default, expands when showGraph is true */}
          <div
            className="flex-shrink-0 border-t transition-all duration-300 overflow-hidden"
            style={{
              borderColor: 'var(--border)',
              height: showGraph ? 380 : 0,
            }}
          >
            <Graph
              nodes={allNodes}
              links={allLinks}
              targetWallet={targetWallet}
              tokenSymbol={currentToken.symbol}
              holdingsReport={holdingsReport}
              detectedContracts={detectedContracts}
              visibleLayers={visibleLayers}
              onNodeClick={() => {}}
              onLayerToggle={setVisibleLayers}
            />
          </div>

          {/* GRAPH TOGGLE BAR */}
          {scanResult && (
            <div
              className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
              onClick={() => setShowGraph(g => !g)}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {showGraph ? '\u25BC Hide Graph' : '\u25B6 Show Graph'}
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                  {allNodes.length} nodes {'\u00B7'} {allLinks.length} edges
                </span>
              </div>
              <div className="flex items-center gap-3">
                {showGraph && (
                  <LayerToggles visibleLayers={visibleLayers} onLayerToggle={setVisibleLayers} />
                )}
              </div>
            </div>
          )}

        </main>
      </div>

      <TokenModal
        open={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        onSelect={(token) => setCurrentToken(token)}
      />
    </div>
  );
}

/* ── Layer toggle pills ── */
function LayerToggles({
  visibleLayers,
  onLayerToggle,
}: {
  visibleLayers: Set<number>;
  onLayerToggle: (layers: Set<number>) => void;
}) {
  const layers = [
    { id: 1, label: 'Cluster', color: '#10b981' },
    { id: 2, label: 'Suspects', color: '#fbbf24' },
    { id: 3, label: 'Other', color: '#60a5fa' },
    { id: 4, label: 'Contracts', color: '#a78bfa' },
  ];
  return (
    <div className="flex items-center gap-2">
      {layers.map(layer => {
        const on = visibleLayers.has(layer.id);
        return (
          <button
            key={layer.id}
            onClick={(e) => {
              e.stopPropagation();
              const next = new Set(visibleLayers);
              if (on) next.delete(layer.id); else next.add(layer.id);
              onLayerToggle(next);
            }}
            className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all"
            style={{
              borderColor: on ? layer.color : 'var(--border)',
              color: on ? layer.color : 'var(--text-dim)',
              background: on ? `${layer.color}18` : 'transparent',
              opacity: on ? 1 : 0.5,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? layer.color : 'var(--text-dim)' }} />
            {layer.label}
          </button>
        );
      })}
    </div>
  );
}
