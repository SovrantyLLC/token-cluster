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
  const [w2wMode, setW2wMode] = useState(false);
  const [hideLPs, setHideLPs] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [error, setError] = useState('');
  const [holdingsReport, setHoldingsReport] = useState<HoldingsReport | null>(null);
  const [isDeepScan, setIsDeepScan] = useState(false);

  /* ── regular scan ── */
  const handleScan = useCallback(
    async (wallet: string, depth: number, limit: number) => {
      if (!currentToken || !wallet) return;

      setTargetWallet(wallet);
      setIsScanning(true);
      setScanPhase('Fetching transfers...');
      setError('');
      setScanResult(null);
      setHoldingsReport(null);
      setIsDeepScan(false);

      try {
        const phaseTimer = setTimeout(() => setScanPhase('Detecting contracts...'), 3000);
        const phaseTimer2 = setTimeout(() => setScanPhase('Checking balances...'), 7000);
        const phaseTimer3 = setTimeout(() => setScanPhase('Building graph...'), 11000);

        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet,
            tokenAddress: currentToken.address,
            decimals: currentToken.decimals,
            depth,
            limit,
          }),
        });

        clearTimeout(phaseTimer);
        clearTimeout(phaseTimer2);
        clearTimeout(phaseTimer3);

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Scan failed');
        }

        const data: ScanResult = await res.json();
        setScanResult(data);
        setShowAnalysis(true);
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

  /* ── deep scan ── */
  const handleDeepScan = useCallback(
    async (wallet: string, _depth: number, limit: number) => {
      if (!currentToken || !wallet) return;

      setTargetWallet(wallet);
      setIsScanning(true);
      setIsDeepScan(true);
      setError('');
      setScanResult(null);
      setHoldingsReport(null);

      // Cycle through deep scan phases on timers
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
          throw new Error(data.error || 'Deep scan failed');
        }

        const data: { scanResult: ScanResult; holdingsReport: HoldingsReport } =
          await res.json();
        setScanResult(data.scanResult);
        setHoldingsReport(data.holdingsReport);
        setShowAnalysis(false);
        setScanPhase('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Deep scan failed');
        setScanPhase('');
      } finally {
        setIsScanning(false);
      }
    },
    [currentToken]
  );

  /* ── view mode ── */
  const viewMode: 'all' | 'w2w' | 'no-lp' = w2wMode ? 'w2w' : hideLPs ? 'no-lp' : 'all';

  /* ── filter nodes + links ── */
  const { filteredNodes, filteredLinks } = useMemo(() => {
    if (!scanResult) return { filteredNodes: [], filteredLinks: [] };

    const nodes = scanResult.nodes.filter((n) => {
      if (hideLPs && n.isContract && !n.isTarget) return false;
      if (w2wMode && n.isContract && !n.isTarget) return false;

      if (!n.isTarget) {
        if (activeFilter === 'sent' && n.volOut <= 0) return false;
        if (activeFilter === 'received' && n.volIn <= 0) return false;
        if (activeFilter === 'heavy' && n.txCount < 5) return false;
        if (activeFilter === 'holders' && (n.balance === null || n.balance <= 0)) return false;
      }
      return true;
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = scanResult.links.filter(
      (l) => nodeIds.has(l.source) && nodeIds.has(l.target)
    );

    return { filteredNodes: nodes, filteredLinks: links };
  }, [scanResult, activeFilter, w2wMode, hideLPs]);

  /* ── detectedContracts set ── */
  const detectedContracts = useMemo(
    () => new Set(scanResult?.detectedContracts ?? []),
    [scanResult?.detectedContracts]
  );

  /* ── topbar stats ── */
  const totalVolume = filteredLinks.reduce((s, l) => s + l.value, 0);

  /* ── holdings wallet set for graph coloring ── */
  const holdingsWalletMap = useMemo(() => {
    if (!holdingsReport) return null;
    const map = new Map<string, 'high' | 'medium' | 'low'>();
    for (const w of holdingsReport.wallets) {
      map.set(w.address.toLowerCase(), w.confidence);
    }
    return map;
  }, [holdingsReport]);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#06070b' }}>
      {/* ═══ TOPBAR ═══ */}
      <header
        className="flex items-center justify-between px-4 h-11 flex-shrink-0 border-b border-raised/40"
        style={{ background: '#0c0e16' }}
      >
        {/* left: logo + title */}
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
            <span className="text-[10px] text-gray-600 font-mono">v3</span>
          </div>

          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
            style={{ color: '#e84142', borderColor: 'rgba(232,65,66,0.3)', background: 'rgba(232,65,66,0.08)' }}
          >
            AVAX C-Chain
          </span>
        </div>

        {/* center: stats or scan progress */}
        <div className="flex items-center gap-4">
          {isScanning ? (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-[#c9a227]/30 border-t-[#c9a227] rounded-full animate-spin" />
              <span className="text-xs text-[#c9a227] font-mono">{scanPhase}</span>
              {isDeepScan && (
                <span className="text-[10px] text-[#c9a227]/60 font-mono">(Deep Scan)</span>
              )}
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

        {/* right: analysis toggle */}
        <div className="flex items-center gap-2">
          {scanResult && !holdingsReport && (
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
          {holdingsReport && (
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
          w2wMode={w2wMode}
          hideLPs={hideLPs}
          onTokenChange={() => setShowTokenModal(true)}
          onWalletChange={setTargetWallet}
          onScan={handleScan}
          onDeepScan={handleDeepScan}
          onFilterChange={setActiveFilter}
          onW2WToggle={setW2wMode}
          onLPToggle={setHideLPs}
          onWalletClick={() => {}}
        />

        <main
          className="flex-1 flex flex-col min-w-0"
          style={{ background: '#06070b' }}
        >
          <div className="flex-1 p-2 min-h-0">
            <Graph
              nodes={filteredNodes}
              links={filteredLinks}
              targetWallet={targetWallet}
              tokenSymbol={currentToken.symbol}
              viewMode={viewMode}
              holdingsMap={holdingsWalletMap}
              onNodeClick={() => {}}
            />
          </div>

          {/* Holdings Panel — shown when deep scan results exist */}
          {holdingsReport && (
            <HoldingsPanel
              report={holdingsReport}
              tokenSymbol={currentToken.symbol}
              onWalletClick={(addr) => {
                setTargetWallet(addr);
              }}
            />
          )}

          {/* Analysis Panel — shown for regular scan or when toggled */}
          {showAnalysis && !holdingsReport && (
            <AnalysisPanel
              isOpen={showAnalysis}
              nodes={scanResult?.nodes ?? []}
              links={scanResult?.links ?? []}
              transfers={scanResult?.transfers ?? []}
              targetWallet={targetWallet}
              tokenSymbol={currentToken.symbol}
              detectedContracts={detectedContracts}
              onClose={() => setShowAnalysis(false)}
            />
          )}

          {/* Analysis Panel toggled ON alongside holdings report */}
          {showAnalysis && holdingsReport && scanResult && (
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

      {/* ═══ TOKEN MODAL ═══ */}
      <TokenModal
        open={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        onSelect={(token) => setCurrentToken(token)}
      />
    </div>
  );
}

/* ── topbar stat chip ── */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-600 font-mono uppercase">{label}</span>
      <span
        className={`text-xs font-mono font-bold ${accent ? 'text-[#c9a227]' : 'text-gray-300'}`}
      >
        {value}
      </span>
    </div>
  );
}
