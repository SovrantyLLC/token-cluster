'use client';

import { useState, useCallback, useMemo } from 'react';
import { TokenInfo, ScanResult, HoldingsReport } from '@/lib/types';
import { DEFAULT_TARGET, TOKEN_PRESETS } from '@/lib/constants';
import Sidebar from '@/components/Sidebar';
import Graph from '@/components/Graph';
import AnalysisPanel from '@/components/AnalysisPanel';
import TokenModal from '@/components/TokenModal';
import HoldingsPanel from '@/components/HoldingsPanel';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

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
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [error, setError] = useState('');
  const [holdingsReport, setHoldingsReport] = useState<HoldingsReport | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const [showHoldings, setShowHoldings] = useState(false);

  /* ── scan (always deep) ── */
  const handleScan = useCallback(
    async (wallet: string, _depth: number, limit: number) => {
      if (!currentToken || !wallet) return;

      setTargetWallet(wallet);
      setIsScanning(true);
      setError('');
      setScanResult(null);
      setHoldingsReport(null);
      setShowHoldings(false);
      setVisibleLayers(new Set([0, 1, 2, 3, 4]));

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
        setShowAnalysis(false);
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

  /* ── filter nodes + links for sidebar list (not for graph — graph does its own filtering) ── */
  const { filteredNodes, filteredLinks } = useMemo(() => {
    if (!scanResult) return { filteredNodes: [], filteredLinks: [] };

    const nodes = scanResult.nodes.filter((n) => {
      if (!n.isTarget) {
        if (activeFilter === 'sent' && n.volOut <= 0) return false;
        if (activeFilter === 'received' && n.volIn <= 0) return false;
        if (activeFilter === 'heavy' && n.txCount < 5) return false;
        if (activeFilter === 'holders' && (n.balance === null || n.balance <= 0)) return false;
      }
      return true;
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const lnks = scanResult.links.filter(
      (l) => nodeIds.has(l.source) && nodeIds.has(l.target)
    );

    return { filteredNodes: nodes, filteredLinks: lnks };
  }, [scanResult, activeFilter]);

  /* ── all nodes/links for graph (graph handles layer filtering internally) ── */
  const allNodes = scanResult?.nodes ?? [];
  const allLinks = scanResult?.links ?? [];

  /* ── detectedContracts set ── */
  const detectedContracts = useMemo(
    () => new Set(scanResult?.detectedContracts ?? []),
    [scanResult?.detectedContracts]
  );

  /* ── topbar stats ── */
  const totalVolume = filteredLinks.reduce((s, l) => s + l.value, 0);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#06070b' }}>
      {/* ═══ TOPBAR ═══ */}
      <header
        className="flex items-center justify-between px-4 h-11 flex-shrink-0 border-b border-raised/40"
        style={{ background: '#0c0e16' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className="text-sm font-bold font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(201,162,39,0.15)', color: '#c9a227' }}
            >
              TC
            </span>
            <span className="text-sm font-semibold text-gray-200 tracking-tight">
              Token Cluster Map
            </span>
            <span className="text-[10px] text-gray-600 font-mono">v4</span>
          </div>

          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
            style={{ color: '#e84142', borderColor: 'rgba(232,65,66,0.3)', background: 'rgba(232,65,66,0.08)' }}
          >
            AVAX C-Chain
          </span>
        </div>

        <div className="flex items-center gap-4">
          {isScanning ? (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-[#c9a227]/30 border-t-[#c9a227] rounded-full animate-spin" />
              <span className="text-xs text-[#c9a227] font-mono">{scanPhase}</span>
            </div>
          ) : scanResult ? (
            <>
              <Stat label="Nodes" value={String(filteredNodes.length)} />
              <Stat label="Edges" value={String(filteredLinks.length)} />
              <Stat label="Volume" value={fmt(totalVolume)} accent />
              {holdingsReport && (
                <Stat
                  label="Est. Holdings"
                  value={fmt(holdingsReport.targetBalance + holdingsReport.totalHeldByCluster)}
                  accent
                />
              )}
            </>
          ) : (
            <span className="text-xs text-gray-600 font-mono">No scan data</span>
          )}
          {error && <span className="text-amber-400 text-[11px] font-mono ml-2">{error}</span>}
        </div>

        <div className="flex items-center gap-2">
          {scanResult && (
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className={`text-[11px] font-mono px-3 py-1 rounded-md border transition-colors ${
                showAnalysis
                  ? 'text-[#c9a227] border-[#c9a227]/40 bg-[#c9a227]/10'
                  : 'text-gray-500 border-raised hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              Analysis
            </button>
          )}
        </div>
      </header>

      {/* ═══ BODY ═══ */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          currentToken={currentToken}
          targetWallet={targetWallet}
          nodes={filteredNodes}
          isScanning={isScanning}
          activeFilter={activeFilter}
          onTokenChange={() => setShowTokenModal(true)}
          onWalletChange={setTargetWallet}
          onScan={handleScan}
          onFilterChange={setActiveFilter}
          onWalletClick={() => {}}
        />

        <main className="flex-1 flex flex-col min-w-0" style={{ background: '#06070b' }}>
          {/* Graph: takes remaining space (60% when holdings open, 100% when closed) */}
          <div
            className="p-2 min-h-0 transition-all duration-300"
            style={{ flex: holdingsReport && showHoldings ? '0 0 60%' : '1 1 100%' }}
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

          {/* Holdings drawer: collapsed tab at bottom, expands to 40% */}
          {holdingsReport && (
            <div
              className="flex flex-col border-t border-raised/50 transition-all duration-300 overflow-hidden"
              style={{
                flex: showHoldings ? '0 0 40%' : '0 0 auto',
                background: '#0c0e16',
              }}
            >
              {/* Toggle tab */}
              <button
                onClick={() => setShowHoldings(!showHoldings)}
                className="flex items-center justify-between px-4 py-2 hover:bg-raised/30 transition-colors cursor-pointer flex-shrink-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
                    style={{ background: 'rgba(80,200,120,0.15)', color: '#50c878' }}
                  >
                    HOLDINGS
                  </span>
                  <span className="text-xs font-mono text-[#c9a227]">
                    ~{fmt(holdingsReport.targetBalance + holdingsReport.totalHeldByCluster)} {currentToken.symbol}
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    across {holdingsReport.wallets.filter((w) => w.confidence === 'high').length + 1} wallets
                  </span>
                </div>
                <span
                  className="text-gray-500 text-xs transition-transform duration-300"
                  style={{ transform: showHoldings ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  ▲
                </span>
              </button>

              {/* Scrollable report content */}
              {showHoldings && (
                <div className="flex-1 overflow-y-auto min-h-0">
                  <HoldingsPanel
                    report={holdingsReport}
                    tokenSymbol={currentToken.symbol}
                    onWalletClick={(addr) => setTargetWallet(addr)}
                  />
                </div>
              )}
            </div>
          )}

          {showAnalysis && scanResult && (
            <AnalysisPanel
              isOpen={showAnalysis}
              nodes={scanResult.nodes}
              links={scanResult.links}
              transfers={scanResult.transfers}
              targetWallet={targetWallet}
              tokenSymbol={currentToken.symbol}
              detectedContracts={detectedContracts}
              onClose={() => setShowAnalysis(false)}
            />
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-600 font-mono uppercase">{label}</span>
      <span className={`text-xs font-mono font-bold ${accent ? 'text-[#c9a227]' : 'text-gray-300'}`}>
        {value}
      </span>
    </div>
  );
}
