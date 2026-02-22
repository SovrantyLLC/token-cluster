'use client';

import { useState, useMemo } from 'react';
import { TokenInfo, GraphNode } from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';

/* ── colour helpers (match Graph.tsx) ─────── */
const COL = {
  target: '#c9a227',
  contract: '#a87cdb',
  holder: '#50c878',
  highFreq: '#47c9b2',
  wallet: '#4ea8de',
};

function dotColour(n: GraphNode): string {
  if (n.isTarget) return COL.target;
  if (n.isContract) return COL.contract;
  if (n.balance !== null && n.balance > 0) return COL.holder;
  if (n.txCount >= 5) return COL.highFreq;
  return COL.wallet;
}

function abbr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtBal(b: number | null): { text: string; cls: string } {
  if (b === null) return { text: '...', cls: 'text-gray-600' };
  if (b === 0) return { text: '0', cls: 'text-gray-500' };
  if (b >= 1_000_000) return { text: `${(b / 1_000_000).toFixed(1)}M`, cls: 'text-emerald-400' };
  if (b >= 1_000) return { text: `${(b / 1_000).toFixed(1)}K`, cls: 'text-emerald-400' };
  if (b >= 1) return { text: b.toFixed(2), cls: 'text-emerald-400' };
  return { text: b.toFixed(4), cls: 'text-emerald-400' };
}

/* ── snowtrace link icon (external link) ──── */
function SnowtraceLink({ address }: { address: string }) {
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

/* ── toggle sub-component ──────────────────── */
function Toggle({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none group">
      <div
        onClick={() => onToggle(!on)}
        className={`mt-0.5 w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 ${
          on ? 'bg-gold' : 'bg-raised'
        }`}
      >
        <div
          className={`absolute top-[3px] w-3 h-3 rounded-full transition-transform ${
            on ? 'translate-x-[14px] bg-void' : 'translate-x-[3px] bg-gray-500'
          }`}
        />
      </div>
      <div className="flex flex-col min-w-0">
        <span
          className={`text-xs leading-tight transition-colors ${
            on ? 'text-gray-200' : 'text-gray-400'
          }`}
        >
          {label}
        </span>
        <span className="text-[10px] text-gray-600 leading-tight">{hint}</span>
      </div>
    </label>
  );
}

/* ── skeleton row ──────────────────────────── */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 animate-pulse flex-shrink-0">
      <span className="w-2 h-2 rounded-full bg-raised flex-shrink-0" />
      <span className="h-3 bg-raised rounded flex-1" />
      <span className="h-3 w-10 bg-raised rounded flex-shrink-0" />
      <span className="h-3 w-6 bg-raised rounded flex-shrink-0" />
    </div>
  );
}

/* ── filter pills ──────────────────────────── */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'received', label: 'Received' },
  { key: 'heavy', label: 'Heavy' },
  { key: 'holders', label: 'Holders' },
];

/* ── props interface ───────────────────────── */
interface SidebarProps {
  currentToken: TokenInfo;
  targetWallet: string;
  nodes: GraphNode[];
  isScanning: boolean;
  activeFilter: string;
  w2wMode: boolean;
  hideLPs: boolean;
  onTokenChange: () => void;
  onWalletChange: (addr: string) => void;
  onScan: (wallet: string, depth: number, limit: number) => void;
  onDeepScan?: (wallet: string, depth: number, limit: number) => void;
  onFilterChange: (filter: string) => void;
  onW2WToggle: (on: boolean) => void;
  onLPToggle: (on: boolean) => void;
  onWalletClick: (addr: string) => void;
}

/* ── sidebar component ─────────────────────── */
export default function Sidebar({
  currentToken,
  targetWallet,
  nodes,
  isScanning,
  activeFilter,
  w2wMode,
  hideLPs,
  onTokenChange,
  onWalletChange,
  onScan,
  onDeepScan,
  onFilterChange,
  onW2WToggle,
  onLPToggle,
  onWalletClick,
}: SidebarProps) {
  const [localWallet, setLocalWallet] = useState(targetWallet);
  const [depth, setDepth] = useState(1);
  const [limit, setLimit] = useState(1000);

  /* ── sort + filter wallet list ── */
  const walletList = useMemo(() => {
    const nonTarget = nodes.filter((n) => !n.isTarget);

    let filtered = nonTarget;
    if (activeFilter === 'sent') {
      filtered = nonTarget.filter((n) => n.volOut > 0);
    } else if (activeFilter === 'received') {
      filtered = nonTarget.filter((n) => n.volIn > 0);
    } else if (activeFilter === 'heavy') {
      filtered = nonTarget.filter((n) => n.txCount >= 5);
    } else if (activeFilter === 'holders') {
      filtered = nonTarget.filter((n) => n.balance !== null && n.balance > 0);
    }

    return filtered.sort((a, b) => {
      const balA = a.balance ?? -1;
      const balB = b.balance ?? -1;
      if (balA > 0 && balB <= 0) return -1;
      if (balB > 0 && balA <= 0) return 1;
      if (balA > 0 && balB > 0) return balB - balA;
      return b.volIn + b.volOut - (a.volIn + a.volOut);
    });
  }, [nodes, activeFilter]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      onScan(localWallet, depth, limit);
    }
  }

  function handleScanClick() {
    onScan(localWallet, depth, limit);
  }

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r border-raised/50"
      style={{ width: 360, background: '#0c0e16', height: '100%' }}
    >
      {/* ═══ 1. TOKEN SELECTOR ═══ */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-raised/30">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
            Token
          </span>
          <button
            onClick={onTokenChange}
            className="text-[10px] text-gold/70 font-mono uppercase tracking-wider hover:text-gold transition-colors cursor-pointer"
          >
            Change
          </button>
        </div>
        <button
          onClick={onTokenChange}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-raised/40 transition-colors group cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <span className="text-gold text-xs font-bold font-mono">
              {currentToken.symbol.slice(0, 3)}
            </span>
          </div>
          <div className="flex flex-col items-start min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-200">
                {currentToken.symbol}
              </span>
              <span className="text-xs text-gray-500">{currentToken.name}</span>
            </div>
            <span className="text-[10px] text-gray-600 font-mono truncate w-full text-left">
              {currentToken.address}
            </span>
          </div>
        </button>
        <span className="text-[10px] text-gray-600 font-mono block mt-1 px-1">
          Presets are shortcuts — paste any ERC-20 contract
        </span>
      </div>

      {/* ═══ 2. TARGET WALLET ═══ */}
      <div className="flex-shrink-0 px-4 pt-3 pb-3 border-b border-raised/30">
        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1.5">
          Target Wallet
        </span>
        <div className="flex gap-2">
          <input
            type="text"
            value={localWallet}
            onChange={(e) => {
              setLocalWallet(e.target.value);
              onWalletChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Paste any AVAX C-Chain wallet..."
            className="flex-1 min-w-0 px-2.5 py-2 rounded-md border border-raised focus:border-gold/50 focus:outline-none text-xs font-mono text-gray-200 placeholder-gray-600 transition-colors"
            style={{ background: '#0a0c14' }}
          />
          <button
            onClick={handleScanClick}
            disabled={isScanning || !localWallet}
            className="px-3 py-2 rounded-md font-bold text-xs tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gold text-void hover:bg-[#a68520] active:scale-[0.97] flex-shrink-0 cursor-pointer"
          >
            {isScanning ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-void/30 border-t-void rounded-full animate-spin" />
                <span>...</span>
              </span>
            ) : (
              'SCAN'
            )}
          </button>
          {onDeepScan && (
            <button
              onClick={() => onDeepScan(localWallet, depth, limit)}
              disabled={isScanning || !localWallet}
              className="px-2.5 py-2 rounded-md font-bold text-[10px] tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-emerald-400/50 text-emerald-400 hover:bg-emerald-400/10 active:scale-[0.97] flex-shrink-0 cursor-pointer"
              title="Deep Scan: Analyzes funding sources, detects hidden wallets, and estimates total holdings"
            >
              DEEP
            </button>
          )}
        </div>
        <span className="text-[10px] text-gray-600 font-mono block mt-1.5 px-0.5">
          Default is pre-filled — type or paste any address
        </span>

        <div className="flex gap-2 mt-2.5">
          <div className="flex-1">
            <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">
              Depth
            </span>
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded-md border border-raised focus:border-gold/50 focus:outline-none text-xs text-gray-300 transition-colors cursor-pointer"
              style={{ background: '#0a0c14' }}
            >
              <option value={1}>1 hop</option>
              <option value={2}>2 hops</option>
            </select>
          </div>
          <div className="flex-1">
            <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">
              Limit
            </span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded-md border border-raised focus:border-gold/50 focus:outline-none text-xs text-gray-300 transition-colors cursor-pointer"
              style={{ background: '#0a0c14' }}
            >
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
            </select>
          </div>
        </div>
      </div>

      {/* ═══ 3. VIEW MODE ═══ */}
      <div className="flex-shrink-0 px-4 pt-3 pb-3 border-b border-raised/30 flex flex-col gap-2.5">
        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
          View Mode
        </span>
        <Toggle
          on={w2wMode}
          onToggle={onW2WToggle}
          label="Wallet-to-Wallet Only"
          hint="Hide DEX routers and contracts"
        />
        <Toggle
          on={hideLPs}
          onToggle={onLPToggle}
          label="Hide LP Pools"
          hint="Auto-detected via on-chain bytecode"
        />
      </div>

      {/* ═══ 4. FILTERS ═══ */}
      <div className="flex-shrink-0 px-4 pt-3 pb-3 border-b border-raised/30">
        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-2">
          Filter
        </span>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors border cursor-pointer ${
                activeFilter === f.key
                  ? 'bg-gold/15 border-gold/40 text-gold'
                  : 'bg-transparent border-raised text-gray-500 hover:border-gray-500 hover:text-gray-400'
              }`}
            >
              {f.label}
              {f.key === 'holders' && activeFilter === 'holders' && (
                <span className="ml-1 text-[9px]">{'\u2713'}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ 5. CONNECTED WALLETS LIST ═══ */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ flex: '1 1 0%', minHeight: 0 }}
      >
        <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
            Connected Wallets ({walletList.length})
          </span>
          {walletList.length > 0 && (
            <span className="text-[10px] text-gray-600 font-mono">
              {walletList.filter((n) => n.balance !== null && n.balance > 0).length} holders
            </span>
          )}
        </div>

        <div
          className="px-2 pb-2"
          style={{ flex: '1 1 0%', overflowY: 'auto', minHeight: 0 }}
        >
          {/* ── loading skeleton ── */}
          {isScanning && nodes.length === 0 && (
            <div className="flex flex-col gap-0.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          )}

          {/* ── empty: no scan yet ── */}
          {!isScanning && walletList.length === 0 && nodes.length === 0 && (
            <div className="flex items-center justify-center h-full px-4">
              <span className="text-xs text-gray-600 font-mono text-center leading-relaxed">
                Scan a wallet to see connected addresses
              </span>
            </div>
          )}

          {/* ── empty: filter has no matches ── */}
          {!isScanning && walletList.length === 0 && nodes.length > 0 && (
            <div className="flex items-center justify-center h-full px-4">
              <span className="text-xs text-gray-600 font-mono text-center leading-relaxed">
                No wallets match this filter
              </span>
            </div>
          )}

          {/* ── wallet rows ── */}
          {walletList.map((node) => {
            const bal = fmtBal(node.balance);
            const known = KNOWN_CONTRACTS[node.id];
            return (
              <button
                key={node.id}
                onClick={() => {
                  onWalletClick(node.address);
                  setLocalWallet(node.address);
                  onWalletChange(node.address);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-raised/40 transition-colors group text-left cursor-pointer flex-shrink-0"
              >
                {/* colour dot */}
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: dotColour(node) }}
                />

                {/* address / label */}
                <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-gray-400 group-hover:text-gray-200 transition-colors">
                  {known ?? abbr(node.address)}
                </span>

                {/* snowtrace link */}
                <SnowtraceLink address={node.address} />

                {/* balance badge */}
                <span
                  className={`text-[10px] font-mono flex-shrink-0 px-1.5 py-0.5 rounded ${bal.cls} ${
                    node.balance !== null && node.balance > 0
                      ? 'bg-emerald-400/10'
                      : 'bg-transparent'
                  }`}
                >
                  {bal.text}
                </span>

                {/* tx count */}
                <span className="text-[10px] font-mono text-gray-600 flex-shrink-0 w-8 text-right">
                  {node.txCount}tx
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
