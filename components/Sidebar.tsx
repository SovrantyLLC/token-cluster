'use client';

import { useState } from 'react';
import { TokenInfo } from '@/lib/types';

/* ── props interface ───────────────────────── */
interface SidebarProps {
  currentToken: TokenInfo;
  targetWallet: string;
  isScanning: boolean;
  onTokenChange: () => void;
  onWalletChange: (addr: string) => void;
  onScan: (wallet: string, depth: number, limit: number) => void;
}

/* ── sidebar component ─────────────────────── */
export default function Sidebar({
  currentToken,
  targetWallet,
  isScanning,
  onTokenChange,
  onWalletChange,
  onScan,
}: SidebarProps) {
  const [localWallet, setLocalWallet] = useState(targetWallet);
  const [depth, setDepth] = useState(1);
  const [limit, setLimit] = useState(1000);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      onScan(localWallet, depth, limit);
    }
  }

  function handleScanClick() {
    onScan(localWallet, depth, limit);
  }

  return (
    <div className="flex flex-col h-full">
      {/* ═══ 1. TOKEN SELECTOR ═══ */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Token
          </span>
          <button
            onClick={onTokenChange}
            className="text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer hover:opacity-70"
            style={{ color: 'var(--accent-gold)' }}
          >
            Change
          </button>
        </div>
        <button
          onClick={onTokenChange}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors group cursor-pointer hover:opacity-80"
          style={{ background: 'var(--bg-raised)' }}
        >
          <div
            className="w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0"
            style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.1)' }}
          >
            <span className="text-xs font-bold font-mono" style={{ color: 'var(--accent-gold)' }}>
              {currentToken.symbol.slice(0, 3)}
            </span>
          </div>
          <div className="flex flex-col items-start min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {currentToken.symbol}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{currentToken.name}</span>
            </div>
            <span className="text-[10px] font-mono truncate w-full text-left" style={{ color: 'var(--text-dim)' }}>
              {currentToken.address}
            </span>
          </div>
        </button>
        <span className="text-[10px] font-mono block mt-1 px-1" style={{ color: 'var(--text-dim)' }}>
          Presets are shortcuts — paste any ERC-20 contract
        </span>
      </div>

      {/* ═══ 2. TARGET WALLET ═══ */}
      <div className="flex-shrink-0 px-4 pt-3 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px] font-mono uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>
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
            className="flex-1 min-w-0 px-2.5 py-2 rounded-md border focus:outline-none text-xs font-mono transition-colors"
            style={{
              background: 'var(--bg-base)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={handleScanClick}
            disabled={isScanning || !localWallet}
            className="px-3 py-2 rounded-md font-bold text-xs tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97] flex-shrink-0 cursor-pointer"
            style={{ background: 'var(--accent-gold)', color: 'var(--bg-base)' }}
            title="Scan this wallet's token transfers"
          >
            {isScanning ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--bg-base)', borderTopColor: 'transparent' }} />
                <span>...</span>
              </span>
            ) : (
              'SCAN'
            )}
          </button>
        </div>
        <span className="text-[10px] font-mono block mt-1.5 px-0.5" style={{ color: 'var(--text-dim)' }}>
          Default is pre-filled — type or paste any address
        </span>

        <div className="flex gap-2 mt-2.5">
          <div className="flex-1" title="How many hops from the target wallet to scan.">
            <span className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: 'var(--text-dim)' }}>
              Depth
            </span>
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded-md border focus:outline-none text-xs transition-colors cursor-pointer"
              style={{ background: 'var(--bg-base)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <option value={1}>1 hop</option>
              <option value={2}>2 hops</option>
            </select>
          </div>
          <div className="flex-1" title="Maximum number of token transfer transactions to fetch.">
            <span className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: 'var(--text-dim)' }}>
              Limit
            </span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded-md border focus:outline-none text-xs transition-colors cursor-pointer"
              style={{ background: 'var(--bg-base)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
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

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  );
}
