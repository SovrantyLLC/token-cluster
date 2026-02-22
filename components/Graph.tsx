'use client';

import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphLink } from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';

interface GraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  targetWallet: string;
  tokenSymbol: string;
  viewMode: 'all' | 'w2w' | 'no-lp';
  holdingsMap?: Map<string, 'high' | 'medium' | 'low'> | null;
  onNodeClick?: (address: string) => void;
}

/* ── colour palette ─────────────────────────── */
const COL = {
  target: '#c9a227',
  contract: '#a87cdb',
  holder: '#50c878',
  highFreq: '#47c9b2',
  wallet: '#4ea8de',
  sent: '#e89b3e',
  received: '#47c9b2',
  bg: '#06070b',
  grid: 'rgba(255,255,255,0.025)',
  muted: '#6b7280',
  highConf: '#50c878',
  medConf: '#b8d44a',
  lowConf: '#6b8a5e',
  goldRing: '#c9a227',
};

/* ── helpers ─────────────────────────────────── */
function abbr(addr: string) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function nodeColour(
  n: GraphNode,
  target: string,
  holdingsMap?: Map<string, 'high' | 'medium' | 'low'> | null
): string {
  if (n.id === target.toLowerCase()) return COL.target;

  // Holdings-based coloring takes priority when available
  if (holdingsMap) {
    const conf = holdingsMap.get(n.id);
    if (conf === 'high') return COL.highConf;
    if (conf === 'medium') return COL.medConf;
    if (conf === 'low') return COL.lowConf;
  }

  if (n.isContract) return COL.contract;
  if (n.balance !== null && n.balance > 0) return COL.holder;
  if (n.txCount >= 5) return COL.highFreq;
  return COL.wallet;
}

function nodeRadius(n: GraphNode, target: string, maxVol: number): number {
  if (n.id === target.toLowerCase()) return 22;
  const vol = n.volIn + n.volOut;
  if (maxVol === 0) return 6;
  const scale = Math.sqrt(vol / maxVol);
  return Math.max(5, Math.min(18, 5 + scale * 13));
}

function edgeWidth(v: number): number {
  if (v <= 0) return 0.8;
  return Math.max(0.8, Math.min(6, Math.log2(v + 1)));
}

function edgeColour(l: GraphLink, target: string): string {
  if (l.source === target.toLowerCase()) return COL.sent;
  if (l.target === target.toLowerCase()) return COL.received;
  return COL.muted;
}

function fmtBal(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}M`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)}K`;
  if (b >= 1) return b.toFixed(2);
  return b.toFixed(4);
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const viewModeLabel: Record<string, string> = {
  all: 'All Transfers',
  w2w: 'Wallet-to-Wallet Only',
  'no-lp': 'No LPs / Contracts',
};

const confidenceLabels: Record<string, string> = {
  high: 'HIGH confidence same-owner',
  medium: 'MEDIUM confidence same-owner',
  low: 'LOW confidence same-owner',
};

/* ── component ───────────────────────────────── */
export default function Graph({
  nodes,
  links,
  targetWallet,
  tokenSymbol,
  viewMode,
  holdingsMap,
  onNodeClick,
}: GraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<d3.SimulationNodeDatum, undefined> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── teardown helper ── */
  const cleanup = useCallback(() => {
    if (simRef.current) {
      simRef.current.stop();
      simRef.current = null;
    }
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
  }, []);

  /* ── main render effect ── */
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;
    cleanup();

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    let width = container.clientWidth;
    let height = container.clientHeight;

    /* ---- defs: filters, markers ---- */
    const defs = svg.append('defs');

    // glow filter for target node
    const glow = defs.append('filter').attr('id', 'glow');
    glow
      .append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'blur');
    glow
      .append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .join('feMergeNode')
      .attr('in', (d) => d);

    // gold ring glow for high-confidence nodes
    const goldGlow = defs.append('filter').attr('id', 'gold-glow');
    goldGlow
      .append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'blur');
    goldGlow
      .append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .join('feMergeNode')
      .attr('in', (d) => d);

    // arrow markers for each colour
    const arrowColours = [
      { id: 'arrow-sent', col: COL.sent },
      { id: 'arrow-received', col: COL.received },
      { id: 'arrow-muted', col: COL.muted },
    ];
    for (const { id, col } of arrowColours) {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 12)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', col);
    }

    // grid pattern
    const pat = defs
      .append('pattern')
      .attr('id', 'grid')
      .attr('width', 40)
      .attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');
    pat
      .append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none')
      .attr('stroke', COL.grid)
      .attr('stroke-width', 0.5);

    /* ---- root group (zoom target) ---- */
    const g = svg.append('g');

    // grid bg
    g.append('rect')
      .attr('x', -5000)
      .attr('y', -5000)
      .attr('width', 10000)
      .attr('height', 10000)
      .attr('fill', `url(#grid)`);

    /* ---- zoom ---- */
    const zoomBehaviour = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 6])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoomBehaviour);

    /* ---- prepare data copies for D3 mutation ---- */
    const target = targetWallet.toLowerCase();
    const maxVol = Math.max(...nodes.map((n) => n.volIn + n.volOut), 1);

    type SimNode = GraphNode & d3.SimulationNodeDatum;
    type SimLink = GraphLink & {
      source: string | SimNode;
      target: string | SimNode;
    };

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const simLinks: SimLink[] = links.map((l) => ({ ...l }));

    /* ---- force simulation ---- */
    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => {
            const count = (l as SimLink).txCount || 1;
            return Math.max(40, 180 - count * 8);
          })
      )
      .force(
        'charge',
        d3.forceManyBody<SimNode>().strength((d) =>
          d.id === target ? -600 : -200
        )
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide<SimNode>().radius((d) => nodeRadius(d, target, maxVol) + 4)
      )
      .alphaDecay(0.02);

    simRef.current = sim as unknown as d3.Simulation<d3.SimulationNodeDatum, undefined>;

    /* ---- links ---- */
    const linkG = g.append('g').attr('class', 'links');
    const linkEls = linkG
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => edgeColour(d as GraphLink, target))
      .attr('stroke-width', (d) => edgeWidth(d.value))
      .attr('stroke-opacity', 0.35)
      .attr('marker-end', (d) => {
        const col = edgeColour(d as GraphLink, target);
        if (col === COL.sent) return 'url(#arrow-sent)';
        if (col === COL.received) return 'url(#arrow-received)';
        return 'url(#arrow-muted)';
      });

    /* ---- nodes ---- */
    const nodeG = g.append('g').attr('class', 'nodes');
    const nodeEls = nodeG
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'pointer');

    // drag
    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeEls.call(drag);

    // Gold ring for HIGH confidence nodes (rendered behind the main circle)
    if (holdingsMap) {
      nodeEls
        .filter((d) => holdingsMap.get(d.id) === 'high')
        .append('circle')
        .attr('r', (d) => nodeRadius(d, target, maxVol) + 4)
        .attr('fill', 'none')
        .attr('stroke', COL.goldRing)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.7)
        .attr('filter', 'url(#gold-glow)');
    }

    // main circle
    nodeEls
      .append('circle')
      .attr('r', (d) => nodeRadius(d, target, maxVol))
      .attr('fill', (d) => nodeColour(d, target, holdingsMap))
      .attr('stroke', (d) => (d.id === target ? '#ffffff' : 'none'))
      .attr('stroke-width', (d) => (d.id === target ? 2.5 : 0))
      .attr('filter', (d) => (d.id === target ? 'url(#glow)' : ''));

    // balance label on ALL holder nodes (when holdingsMap present) or just holders otherwise
    const showBalanceFor = holdingsMap
      ? (d: SimNode) => d.balance !== null && d.balance > 0
      : (d: SimNode) => d.balance !== null && d.balance > 0 && d.id !== target;

    nodeEls
      .filter((d) => showBalanceFor(d))
      .append('text')
      .attr('dy', (d) => -nodeRadius(d, target, maxVol) - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => {
        if (holdingsMap) {
          const conf = holdingsMap.get(d.id);
          if (conf === 'high') return COL.highConf;
          if (conf === 'medium') return COL.medConf;
          if (conf === 'low') return COL.lowConf;
        }
        return COL.holder;
      })
      .attr('font-size', (d) => {
        if (holdingsMap && holdingsMap.has(d.id)) return '9px';
        return '8px';
      })
      .attr('font-weight', (d) => {
        if (holdingsMap && holdingsMap.get(d.id) === 'high') return 'bold';
        return 'normal';
      })
      .attr('font-family', 'var(--font-dm-mono), monospace')
      .attr('pointer-events', 'none')
      .text((d) => fmtBal(d.balance!));

    // label: "TARGET" above target node
    nodeEls
      .filter((d) => d.id === target)
      .append('text')
      .attr('dy', -30)
      .attr('text-anchor', 'middle')
      .attr('fill', COL.target)
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'var(--font-dm-mono), monospace')
      .attr('pointer-events', 'none')
      .text('TARGET');

    // label: address / known name
    nodeEls
      .append('text')
      .attr('dy', (d) => nodeRadius(d, target, maxVol) + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .attr('font-size', '7.5px')
      .attr('font-family', 'var(--font-dm-mono), monospace')
      .attr('pointer-events', 'none')
      .text((d) => {
        const known = KNOWN_CONTRACTS[d.id];
        if (known) return known;
        return abbr(d.address);
      });

    /* ---- tooltip ---- */
    const tooltip = d3
      .select(container)
      .append('div')
      .attr(
        'style',
        'position:absolute;pointer-events:none;opacity:0;background:#131620;border:1px solid #1a1e2e;border-radius:6px;padding:8px 10px;font-size:11px;font-family:var(--font-dm-mono),monospace;color:#d1d5db;z-index:50;max-width:320px;line-height:1.5;transition:opacity 0.15s;'
      );

    nodeEls
      .on('mouseenter', (event, d) => {
        const known = KNOWN_CONTRACTS[d.id];
        const conf = holdingsMap?.get(d.id);
        const nodeType = d.id === target
          ? 'Target Wallet'
          : conf
          ? confidenceLabels[conf]
          : d.isContract
          ? `Contract${known ? ` (${known})` : ''}`
          : d.txCount >= 5
          ? 'High-Frequency Wallet'
          : 'Wallet';

        let html = `<div style="color:${nodeColour(d, target, holdingsMap)};font-weight:bold;margin-bottom:2px">${nodeType}</div>`;
        html += `<div style="color:#6b7280">${d.address}</div>`;
        html += `<div style="margin-top:4px">Txs: <span style="color:#fff">${d.txCount}</span>`;
        html += ` &nbsp; In: <span style="color:${COL.received}">${d.volIn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>`;
        html += ` &nbsp; Out: <span style="color:${COL.sent}">${d.volOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>`;
        if (d.balance !== null) {
          html += `<div>Balance: <span style="color:${COL.holder}">${d.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>`;
        }
        if (conf) {
          html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #1a1e2e">`;
          html += `<span style="color:${nodeColour(d, target, holdingsMap)};font-weight:bold">${conf.toUpperCase()}</span>`;
          html += ` confidence same-owner</div>`;
        }
        html += `<div style="color:#6b7280;margin-top:2px">${fmtDate(d.firstSeen)} → ${fmtDate(d.lastSeen)}</div>`;

        tooltip.html(html).style('opacity', '1');
      })
      .on('mousemove', (event) => {
        const rect = container.getBoundingClientRect();
        tooltip
          .style('left', `${event.clientX - rect.left + 14}px`)
          .style('top', `${event.clientY - rect.top + 14}px`);
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', '0');
      });

    /* ---- click: highlight node + connections ---- */
    nodeEls.on('click', (event, d) => {
      event.stopPropagation();
      onNodeClick?.(d.address);

      const connectedIds = new Set<string>();
      connectedIds.add(d.id);
      for (const l of simLinks) {
        const src = typeof l.source === 'string' ? l.source : (l.source as SimNode).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as SimNode).id;
        if (src === d.id) connectedIds.add(tgt);
        if (tgt === d.id) connectedIds.add(src);
      }

      nodeEls.select('circle').attr('opacity', (n) =>
        connectedIds.has(n.id) ? 1 : 0.15
      );
      nodeEls.selectAll('text').attr('opacity', (n: unknown) =>
        connectedIds.has((n as SimNode).id) ? 1 : 0.15
      );
      linkEls.attr('stroke-opacity', (l) => {
        const src = typeof l.source === 'string' ? l.source : (l.source as SimNode).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as SimNode).id;
        return src === d.id || tgt === d.id ? 0.7 : 0.05;
      });

      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        nodeEls.select('circle').attr('opacity', 1);
        nodeEls.selectAll('text').attr('opacity', 1);
        linkEls.attr('stroke-opacity', 0.35);
      }, 3500);
    });

    // click canvas to deselect
    svg.on('click', () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      nodeEls.select('circle').attr('opacity', 1);
      nodeEls.selectAll('text').attr('opacity', 1);
      linkEls.attr('stroke-opacity', 0.35);
    });

    /* ---- tick ---- */
    sim.on('tick', () => {
      linkEls
        .attr('x1', (d) => ((d.source as SimNode).x ?? 0))
        .attr('y1', (d) => ((d.source as SimNode).y ?? 0))
        .attr('x2', (d) => ((d.target as SimNode).x ?? 0))
        .attr('y2', (d) => ((d.target as SimNode).y ?? 0));

      nodeEls.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    /* ---- resize observer ---- */
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
        sim.force('center', d3.forceCenter(width / 2, height / 2));
        sim.alpha(0.1).restart();
      }
    });
    ro.observe(container);

    /* ---- cleanup ---- */
    return () => {
      ro.disconnect();
      tooltip.remove();
      cleanup();
    };
  }, [nodes, links, targetWallet, tokenSymbol, viewMode, holdingsMap, onNodeClick, cleanup]);

  /* ── zoom control handlers ── */
  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 6]);
    svg.transition().duration(300).call(zoom.scaleBy, factor);
  }, []);

  const resetView = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 6]);
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  }, []);

  /* ── derived stats ── */
  const walletCount = nodes.filter((n) => !n.isContract).length;
  const txCount = links.reduce((s, l) => s + l.txCount, 0);
  const now = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Build legend items dynamically based on whether holdingsMap is present
  const legendItems = holdingsMap
    ? [
        { col: COL.target, label: 'Target' },
        { col: COL.highConf, label: 'HIGH conf' },
        { col: COL.medConf, label: 'MED conf' },
        { col: COL.lowConf, label: 'LOW conf' },
        { col: COL.wallet, label: 'Wallet' },
        { col: COL.contract, label: 'Contract' },
      ]
    : [
        { col: COL.target, label: 'Target' },
        { col: COL.wallet, label: 'Wallet' },
        { col: COL.highFreq, label: 'High freq' },
        { col: COL.holder, label: 'Holder' },
        { col: COL.contract, label: 'Contract' },
      ];

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-void rounded-lg border border-raised/50 overflow-hidden"
    >
      {nodes.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
          Run a scan to visualize token clusters
        </div>
      ) : (
        <>
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ minHeight: '400px', background: COL.bg }}
          />

          {/* ── floating zoom controls (top-right) ── */}
          <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
            {[
              { label: '+', action: () => zoomBy(1.4) },
              { label: '\u2013', action: () => zoomBy(1 / 1.4) },
              { label: '\u21ba', action: resetView },
            ].map((btn) => (
              <button
                key={btn.label}
                onClick={btn.action}
                className="w-7 h-7 flex items-center justify-center rounded bg-surface/90 border border-raised/60 text-gray-400 hover:text-gold hover:border-gold/40 text-sm font-mono transition-colors"
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* ── view mode badge (top-left) ── */}
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-surface/90 border border-raised/60 text-[10px] font-mono text-gray-500 z-10">
            {holdingsMap ? 'Deep Scan — Ownership Analysis' : viewModeLabel[viewMode] ?? 'All Transfers'}
          </div>

          {/* ── legend (bottom-right) ── */}
          <div className="absolute bottom-3 right-3 bg-surface/90 border border-raised/60 rounded px-3 py-2 text-[10px] font-mono z-10 flex flex-col gap-1">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: item.col }}
                />
                <span className="text-gray-400">{item.label}</span>
              </div>
            ))}
            {holdingsMap && (
              <div className="flex items-center gap-2 border-t border-raised/50 mt-1 pt-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full border-2"
                  style={{ borderColor: COL.goldRing, background: 'transparent' }}
                />
                <span className="text-gray-400">Gold ring = HIGH</span>
              </div>
            )}
            <div className="border-t border-raised/50 mt-1 pt-1 flex flex-col gap-1">
              {[
                { col: COL.sent, label: 'Sent' },
                { col: COL.received, label: 'Received' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className="inline-block w-4 h-0.5"
                    style={{ background: item.col }}
                  />
                  <span className="text-gray-400">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── status bar (bottom-left) ── */}
          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-surface/90 border border-raised/60 text-[10px] font-mono text-gray-500 z-10">
            {txCount} transfers · {walletCount} wallets · {tokenSymbol} on AVAX · {now}
          </div>
        </>
      )}
    </div>
  );
}
