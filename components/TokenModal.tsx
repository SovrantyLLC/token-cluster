'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TokenInfo } from '@/lib/types';
import { TOKEN_PRESETS } from '@/lib/constants';

interface TokenModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (token: TokenInfo) => void;
}

/* ── preset icon colours ─────────────────── */
const ICON_COLOURS: Record<string, string> = {
  FLD: '#c9a227',
  WAVAX: '#e84142',
  USDC: '#2775ca',
  JOE: '#f2716a',
};

export default function TokenModal({ open, onClose, onSelect }: TokenModalProps) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<TokenInfo | null>(null);
  const [error, setError] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch('');
      setLookupResult(null);
      setError('');
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(search.trim());

  // Auto-lookup when a valid address is pasted
  const doLookup = useCallback(async (address: string) => {
    setLoading(true);
    setError('');
    setLookupResult(null);

    try {
      const res = await fetch('/api/token-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) {
        setError('Token not found on AVAX C-Chain');
        return;
      }
      const token: TokenInfo = await res.json();
      setLookupResult(token);
    } catch {
      setError('Lookup failed — check the address');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-trigger lookup on valid address paste/type
  useEffect(() => {
    if (isAddress && !loading) {
      const match = TOKEN_PRESETS.find(
        (t) => t.address.toLowerCase() === search.trim().toLowerCase()
      );
      if (match) {
        // It's a preset, show it directly
        setLookupResult(match);
      } else {
        doLookup(search.trim());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function handleSelect(token: TokenInfo) {
    onSelect(token);
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  const filteredPresets = TOKEN_PRESETS.filter(
    (t) =>
      !isAddress &&
      (search === '' ||
        t.symbol.toLowerCase().includes(search.toLowerCase()) ||
        t.name.toLowerCase().includes(search.toLowerCase()))
  );

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="flex flex-col rounded-lg border border-raised/60 shadow-2xl"
        style={{ width: 440, maxHeight: 520, background: '#0c0e16' }}
      >
        {/* ── header ── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-raised/40 flex-shrink-0"
          style={{ background: '#0c0e16' }}
        >
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-[#c9a227]">
            Select Token
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-base leading-none transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-raised/40"
          >
            {'\u2715'}
          </button>
        </div>

        {/* ── search ── */}
        <div className="px-5 pt-4 pb-2 flex-shrink-0" style={{ background: '#0c0e16' }}>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Paste any ERC-20 contract address (0x...)"
            className="w-full px-3 py-2.5 rounded-md border border-raised focus:border-[#c9a227]/50 focus:outline-none text-sm font-mono text-gray-200 placeholder-gray-600 transition-colors"
            style={{ background: '#0a0c14' }}
          />
          <p className="text-[10px] text-gray-600 font-mono mt-1.5 px-0.5">
            Search by name or paste any AVAX C-Chain token contract
          </p>
          {error && (
            <p className="text-amber-400 text-xs mt-2 font-mono">{error}</p>
          )}
        </div>

        {/* ── results ── */}
        <div
          className="flex-1 overflow-y-auto px-4 pb-4"
          style={{ background: '#0c0e16', minHeight: 0 }}
        >
          {/* loading state */}
          {loading && (
            <div
              className="flex items-center gap-2 px-3 py-3 rounded-md mb-2"
              style={{ background: '#131620' }}
            >
              <span className="w-4 h-4 border-2 border-[#c9a227]/30 border-t-[#c9a227] rounded-full animate-spin" />
              <span className="text-xs text-gray-400 font-mono">Looking up token...</span>
            </div>
          )}

          {/* lookup result */}
          {lookupResult && !loading && (
            <button
              onClick={() => handleSelect(lookupResult)}
              className="w-full text-left px-3 py-3 rounded-md mb-3 border border-[#c9a227]/30 hover:border-[#c9a227]/60 transition-colors"
              style={{ background: 'rgba(201,162,39,0.08)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border"
                  style={{
                    background: 'rgba(201,162,39,0.15)',
                    borderColor: 'rgba(201,162,39,0.3)',
                  }}
                >
                  <span className="text-[#c9a227] text-xs font-bold font-mono">
                    {lookupResult.symbol.slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-200">{lookupResult.symbol}</span>
                    <span className="text-xs text-gray-500">{lookupResult.name}</span>
                    <span className="text-[10px] text-gray-600 font-mono">({lookupResult.decimals}d)</span>
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono truncate">{lookupResult.address}</div>
                </div>
              </div>
            </button>
          )}

          {/* divider before presets */}
          {filteredPresets.length > 0 && (
            <div className="flex items-center gap-2 mb-2 mt-1">
              <span className="text-[10px] text-gray-600 font-mono uppercase tracking-wider">
                Presets
              </span>
              <div className="flex-1 h-px bg-raised/40" />
            </div>
          )}

          {/* preset tokens */}
          {filteredPresets.map((t) => {
            const iconCol = ICON_COLOURS[t.symbol] ?? '#4ea8de';
            return (
              <button
                key={t.address}
                onClick={() => handleSelect(t)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-raised/40 transition-colors mb-0.5 text-left"
                style={{ background: '#0c0e16' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border"
                  style={{
                    background: `${iconCol}15`,
                    borderColor: `${iconCol}40`,
                  }}
                >
                  <span
                    className="text-xs font-bold font-mono"
                    style={{ color: iconCol }}
                  >
                    {t.symbol.slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-200">{t.symbol}</span>
                    <span className="text-xs text-gray-500">{t.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono truncate">{t.address}</div>
                </div>
              </button>
            );
          })}

          {/* empty state */}
          {filteredPresets.length === 0 && !lookupResult && !loading && !isAddress && search !== '' && (
            <p className="text-gray-600 text-xs font-mono text-center py-6">
              No matches. Paste a full contract address to look up any token.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
