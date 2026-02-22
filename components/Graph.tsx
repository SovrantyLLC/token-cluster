'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphLink, HoldingsReport } from '@/lib/types';
import { KNOWN_CONTRACTS } from '@/lib/constants';

/* ── props ─────────────────────────────────── */
interface GraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  targetWallet: string;
  tokenSymbol: string;
  holdingsReport: HoldingsReport | null;
  detectedContracts: Set<string>;
  visibleLayers: Set<number>;
  onNodeClick?: (address: string) => void;
  onLayerToggle?: (layers: Set<number>) => void;
}

/* ── colour palette ─────────────────────────── */
const COL = {
  bg: '#06070b',
  grid: 'rgba(255,255,255,0.025)',
  target: '#c9a227',
  high: '#50c878',
  med: '#a3c44a',
  wallet: '#4ea8de',
  contract: '#a87cdb',
  goldRing: '#c9a227',
  edgeCluster: '#c9a227',
  edgeSuspect: '#e8c547',
  edgeWallet: '#4ea8de',
  edgeContract: '#a87cdb',
  edgeDefault: '#333847',
  lpPurple: '#9b59b6',
  stakedOrange: '#e67e22',
};

const RINGS = [
  { r: 150, label: 'Likely Same Owner', color: COL.high },
  { r: 260, label: 'Suspects', color: COL.med },
  { r: 420, label: 'Other Wallets', color: COL.wallet },
  { r: 620, label: 'Contracts & DEXes', color: COL.contract },
];

const LAYER_LABELS = [
  { layer: 0, label: 'Target', color: COL.target, hint: 'The wallet being analyzed' },
  { layer: 1, label: 'Cluster (HIGH)', color: COL.high, hint: 'Wallets scored 60+ — very likely owned by the same person (shared funding, bidirectional transfers, timing correlation)' },
  { layer: 2, label: 'Suspects (MED)', color: COL.med, hint: 'Wallets scored 35-59 — possibly same owner, fewer signals' },
  { layer: 3, label: 'Other Wallets', color: COL.wallet, hint: 'Regular wallets that transferred this token with the target' },
  { layer: 4, label: 'Contracts/DEX', color: COL.contract, hint: 'Smart contracts, DEX routers, and LP pools detected via on-chain bytecode' },
];

/* ── helpers ─────────────────────────────────── */
function abbr(addr: string) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
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

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ── layer assignment ────────────────────────── */
type LayeredNode = GraphNode & { layer: number };

function assignLayers(
  nodes: GraphNode[],
  targetWallet: string,
  holdingsReport: HoldingsReport | null,
  detectedContracts: Set<string>
): LayeredNode[] {
  const highWallets = holdingsReport?.wallets.filter((w) => w.confidence === 'high') ?? [];
  const medWallets = holdingsReport?.wallets.filter((w) => w.confidence === 'medium') ?? [];

  const highAddrs = new Set(highWallets.map((w) => w.address.toLowerCase()));
  const medAddrs = new Set(medWallets.map((w) => w.address.toLowerCase()));

  const contractAddrs = new Set(Array.from(detectedContracts));
  const knownKeys = Object.keys(KNOWN_CONTRACTS);
  for (let i = 0; i < knownKeys.length; i++) contractAddrs.add(knownKeys[i]);

  // Build set of existing node IDs
  const existingIds = new Set(nodes.map((n) => n.id));

  // Ensure holdings wallets exist as nodes even if missing from scan graph
  const extraNodes: GraphNode[] = [];
  const allHoldingsWallets = holdingsReport?.wallets ?? [];
  for (const w of allHoldingsWallets) {
    const addr = w.address.toLowerCase();
    if (!existingIds.has(addr)) {
      extraNodes.push({
        id: addr,
        address: w.address,
        isTarget: false,
        isContract: false,
        label: null,
        txCount: w.transfersWithTarget,
        volIn: Math.max(0, w.netFlowFromTarget),
        volOut: Math.max(0, -w.netFlowFromTarget),
        balance: w.balance,
        netPosition: w.netFlowFromTarget,
        firstSeen: w.firstInteraction,
        lastSeen: w.lastInteraction,
        peakBalance: null,
        peakDate: null,
        isGhost: false,
        disposition: null,
        lpBalance: w.lpBalance ?? 0,
        stakedBalance: w.stakedBalance ?? 0,
        totalHoldings: w.totalHoldings ?? w.balance,
        lpPositions: [],
        stakingPositions: [],
      });
      existingIds.add(addr);
    }
  }

  const allNodes = [...nodes, ...extraNodes];

  return allNodes.map((n) => {
    let layer = 3;
    if (n.id === targetWallet.toLowerCase()) layer = 0;
    else if (highAddrs.has(n.id)) layer = 1;
    else if (medAddrs.has(n.id)) layer = 2;
    else if (contractAddrs.has(n.id) || n.isContract) layer = 4;
    return { ...n, layer };
  });
}

function layerRadius(layer: number): number {
  switch (layer) {
    case 0: return 0;
    case 1: return 150;
    case 2: return 260;
    case 3: return 420;
    case 4: return 620;
    default: return 400;
  }
}

function nodeRadius(n: LayeredNode): number {
  switch (n.layer) {
    case 0: return 28;
    case 1: {
      const bal = n.balance ?? 0;
      if (bal >= 100_000) return 20;
      if (bal >= 10_000) return 16;
      if (bal >= 1_000) return 14;
      return 12;
    }
    case 2: {
      const bal = n.balance ?? 0;
      if (bal >= 100_000) return 16;
      if (bal >= 10_000) return 12;
      if (bal >= 1_000) return 10;
      return 8;
    }
    case 3: {
      const vol = n.volIn + n.volOut;
      if (vol >= 100_000) return 12;
      if (vol >= 10_000) return 9;
      if (vol >= 1_000) return 7;
      return 5;
    }
    case 4: return Math.min(10, Math.max(5, n.txCount));
    default: return 6;
  }
}

function nodeColor(n: LayeredNode): string {
  switch (n.layer) {
    case 0: return COL.target;
    case 1: return COL.high;
    case 2: return COL.med;
    case 3: return COL.wallet;
    case 4: return COL.contract;
    default: return COL.wallet;
  }
}

function resolveId(ref: unknown): string {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && 'id' in ref) return (ref as { id: string }).id;
  return '';
}

function edgeColor(l: GraphLink, target: string, nodeLayerMap: Map<string, number>): { color: string; opacity: number; width: number } {
  const src = resolveId(l.source);
  const tgt = resolveId(l.target);
  const isTargetEdge = src === target || tgt === target;
  const peer = src === target ? tgt : tgt === target ? src : null;
  const peerLayer = peer ? (nodeLayerMap.get(peer) ?? 3) : 3;
  const txW = Math.max(0.8, Math.min(5, Math.log2(l.value + 1)));

  if (!isTargetEdge) return { color: COL.edgeDefault, opacity: 0.1, width: Math.max(0.5, txW * 0.4) };

  switch (peerLayer) {
    case 1: return { color: COL.edgeCluster, opacity: 0.6, width: Math.max(2, txW) };
    case 2: return { color: COL.edgeSuspect, opacity: 0.4, width: Math.max(1.5, txW * 0.8) };
    case 3: return { color: COL.edgeWallet, opacity: 0.25, width: Math.max(1, txW * 0.6) };
    case 4: return { color: COL.edgeContract, opacity: 0.15, width: Math.max(0.8, txW * 0.4) };
    default: return { color: COL.edgeDefault, opacity: 0.15, width: 1 };
  }
}

const layerConfidenceLabel: Record<number, string> = {
  0: 'Target Wallet',
  1: 'HIGH confidence same-owner',
  2: 'MEDIUM confidence suspect',
  3: 'Wallet',
  4: 'Contract / DEX',
};

/* ── component ───────────────────────────────── */
export default function Graph({
  nodes,
  links,
  targetWallet,
  tokenSymbol,
  holdingsReport,
  detectedContracts,
  visibleLayers,
  onNodeClick,
  onLayerToggle,
}: GraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<d3.SimulationNodeDatum, undefined> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clusterOnly, setClusterOnly] = useState(false);

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

  /* ── cluster only toggle ── */
  const handleClusterOnly = useCallback(() => {
    const next = !clusterOnly;
    setClusterOnly(next);
    if (onLayerToggle) {
      if (next) {
        onLayerToggle(new Set([0, 1]));
      } else {
        onLayerToggle(new Set([0, 1, 2, 3, 4]));
      }
    }
  }, [clusterOnly, onLayerToggle]);

  const handleLayerToggle = useCallback(
    (layer: number) => {
      if (!onLayerToggle) return;
      const next = new Set(visibleLayers);
      if (next.has(layer)) {
        if (layer === 0) return; // never hide target
        next.delete(layer);
      } else {
        next.add(layer);
      }
      setClusterOnly(next.size === 2 && next.has(0) && next.has(1));
      onLayerToggle(next);
    },
    [visibleLayers, onLayerToggle]
  );

  const handleAllLayers = useCallback(() => {
    setClusterOnly(false);
    if (onLayerToggle) onLayerToggle(new Set([0, 1, 2, 3, 4]));
  }, [onLayerToggle]);

  /* ── main render effect ── */
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;
    cleanup();

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    let width = container.clientWidth;
    let height = container.clientHeight;
    const cx = width / 2;
    const cy = height / 2;

    const target = targetWallet.toLowerCase();

    /* ── assign layers ── */
    const layeredNodes = assignLayers(nodes, targetWallet, holdingsReport, detectedContracts);
    const nodeLayerMap = new Map<string, number>();
    for (const n of layeredNodes) nodeLayerMap.set(n.id, n.layer);

    // Debug: log layer counts
    const layerCounts = [0, 0, 0, 0, 0];
    for (const n of layeredNodes) layerCounts[n.layer]++;
    console.log('[Graph] Layer assignment:', { total: layeredNodes.length, target: layerCounts[0], high: layerCounts[1], med: layerCounts[2], wallets: layerCounts[3], contracts: layerCounts[4] });
    if (holdingsReport) {
      const hrHigh = holdingsReport.wallets.filter((w) => w.confidence === 'high');
      const hrMed = holdingsReport.wallets.filter((w) => w.confidence === 'medium');
      console.log('[Graph] HoldingsReport wallets:', { high: hrHigh.length, med: hrMed.length, highAddrs: hrHigh.map((w) => w.address.toLowerCase()), sample_node_ids: layeredNodes.slice(0, 5).map((n) => n.id) });
    }

    /* ── filter by visible layers ── */
    const visNodes = layeredNodes.filter((n) => visibleLayers.has(n.layer));
    const visIds = new Set(visNodes.map((n) => n.id));
    const visLinks = links.filter((l) => visIds.has(l.source) && visIds.has(l.target));
    console.log('[Graph] Visible:', { layers: Array.from(visibleLayers), nodes: visNodes.length, links: visLinks.length });

    /* ── defs ── */
    const defs = svg.append('defs');

    // glow filter for target
    const glow = defs.append('filter').attr('id', 'glow');
    glow.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
    glow.append('feMerge').selectAll('feMergeNode').data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', (d) => d);

    // gold glow for high confidence
    const goldGlow = defs.append('filter').attr('id', 'gold-glow');
    goldGlow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
    goldGlow.append('feMerge').selectAll('feMergeNode').data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', (d) => d);

    // pulse animation for layer 1
    const pulse = defs.append('filter').attr('id', 'pulse-glow');
    pulse.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
    pulse.append('feMerge').selectAll('feMergeNode').data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', (d) => d);

    // grid
    const pat = defs.append('pattern').attr('id', 'grid').attr('width', 40).attr('height', 40).attr('patternUnits', 'userSpaceOnUse');
    pat.append('path').attr('d', 'M 40 0 L 0 0 0 40').attr('fill', 'none').attr('stroke', COL.grid).attr('stroke-width', 0.5);

    /* ── root group ── */
    const g = svg.append('g');

    // grid bg
    g.append('rect').attr('x', -5000).attr('y', -5000).attr('width', 10000).attr('height', 10000).attr('fill', 'url(#grid)');

    /* ── zoom ── */
    const zoomBehaviour = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 6]).on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoomBehaviour);

    /* ── ring guides ── */
    const ringG = g.append('g').attr('class', 'rings');
    for (let i = 0; i < RINGS.length; i++) {
      const ring = RINGS[i];
      const layerIdx = i + 1;
      const isVisible = visibleLayers.has(layerIdx);

      ringG
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', ring.r)
        .attr('fill', 'none')
        .attr('stroke', ring.color)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 8')
        .attr('opacity', isVisible ? 0.12 : 0)
        .attr('class', `ring-${layerIdx}`);

      ringG
        .append('text')
        .attr('x', cx)
        .attr('y', cy - ring.r - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', ring.color)
        .attr('font-size', '9px')
        .attr('font-family', 'var(--font-dm-mono), monospace')
        .attr('opacity', isVisible ? 0.25 : 0)
        .attr('class', `ring-label-${layerIdx}`)
        .text(ring.label);
    }

    /* ── simulation data ── */
    type SimNode = LayeredNode & d3.SimulationNodeDatum;
    type SimLink = GraphLink & { source: string | SimNode; target: string | SimNode };

    const simNodes: SimNode[] = visNodes.map((n) => ({ ...n }));
    const simLinks: SimLink[] = visLinks.map((l) => ({ ...l }));

    /* ── force simulation with radial layout ── */
    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'radial',
        d3
          .forceRadial<SimNode>((d) => layerRadius(d.layer), cx, cy)
          .strength((d) => (d.layer === 0 ? 1.0 : 0.7))
      )
      .force(
        'charge',
        d3.forceManyBody<SimNode>().strength((d) => {
          if (d.layer === 0) return -400;
          if (d.layer === 1) return -150;
          return -80;
        })
      )
      .force(
        'collision',
        d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 8)
      )
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .strength(0.1)
          .distance(80)
      )
      .alphaDecay(0.02);

    simRef.current = sim as unknown as d3.Simulation<d3.SimulationNodeDatum, undefined>;

    /* ── edges ── */
    const linkG = g.append('g').attr('class', 'links');
    const linkEls = linkG
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .each(function (d) {
        const style = edgeColor(d as GraphLink, target, nodeLayerMap);
        d3.select(this)
          .attr('stroke', style.color)
          .attr('stroke-width', style.width)
          .attr('stroke-opacity', style.opacity);
      });

    /* ── nodes ── */
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

    // Gold ring for HIGH confidence (behind main circle)
    nodeEls
      .filter((d) => d.layer === 1)
      .append('circle')
      .attr('r', (d) => nodeRadius(d) + 4)
      .attr('fill', 'none')
      .attr('stroke', COL.goldRing)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.7)
      .attr('filter', 'url(#gold-glow)');

    // Dashed ring for MED confidence
    nodeEls
      .filter((d) => d.layer === 2)
      .append('circle')
      .attr('r', (d) => nodeRadius(d) + 3)
      .attr('fill', 'none')
      .attr('stroke', COL.med)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-opacity', 0.5);

    // Purple ring for LP holders
    nodeEls
      .filter((d) => d.lpBalance > 0 && d.layer !== 0)
      .append('circle')
      .attr('r', (d) => nodeRadius(d) + (d.layer === 1 ? 8 : d.layer === 2 ? 6 : 4))
      .attr('fill', 'none')
      .attr('stroke', COL.lpPurple)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '2 2')
      .attr('stroke-opacity', 0.6);

    // Orange ring for staked positions (outside LP ring for bullseye effect)
    nodeEls
      .filter((d) => d.stakedBalance > 0 && d.layer !== 0)
      .append('circle')
      .attr('r', (d) => {
        const lpOffset = d.lpBalance > 0 ? 4 : 0; // extra offset if LP ring exists
        return nodeRadius(d) + (d.layer === 1 ? 8 : d.layer === 2 ? 6 : 4) + lpOffset;
      })
      .attr('fill', 'none')
      .attr('stroke', COL.stakedOrange)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // main circle
    nodeEls
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => {
        // Hollow target node when balance is 0
        if (d.layer === 0 && (d.balance === null || d.balance === 0)) return 'transparent';
        // Ghost nodes are hollow
        if (d.isGhost) return 'transparent';
        return nodeColor(d);
      })
      .attr('opacity', (d) => (d.layer === 4 ? 0.4 : 1))
      .attr('stroke', (d) => {
        if (d.layer === 0) return d.balance === null || d.balance === 0 ? '#e8813a' : '#ffffff';
        // Ghost nodes: red if sold on DEX, gold if pass-through to holder
        if (d.isGhost) {
          const disp = d.disposition;
          if (disp && disp.soldOnDex.percentage > 50) return 'rgba(232,65,66,0.5)';
          if (disp && disp.sentToWallets.percentage > 50) return 'rgba(201,162,39,0.5)';
          return 'rgba(156,163,175,0.4)';
        }
        return 'none';
      })
      .attr('stroke-width', (d) => {
        if (d.layer === 0) return 2.5;
        if (d.isGhost) return 2;
        return 0;
      })
      .attr('stroke-dasharray', (d) => (d.isGhost ? '4 3' : ''))
      .attr('filter', (d) => {
        if (d.layer === 0) return 'url(#glow)';
        if (d.layer === 1) return 'url(#pulse-glow)';
        return '';
      });

    // balance labels for layers 0, 1, 2
    nodeEls
      .filter((d) => d.balance !== null && d.balance > 0 && d.layer <= 2)
      .append('text')
      .attr('dy', (d) => -nodeRadius(d) - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => nodeColor(d))
      .attr('font-size', (d) => (d.layer <= 1 ? '9px' : '8px'))
      .attr('font-weight', (d) => (d.layer <= 1 ? 'bold' : 'normal'))
      .attr('font-family', 'var(--font-dm-mono), monospace')
      .attr('pointer-events', 'none')
      .text((d) => fmtBal(d.balance!));

    // "TARGET" label
    nodeEls
      .filter((d) => d.layer === 0)
      .append('text')
      .attr('dy', -36)
      .attr('text-anchor', 'middle')
      .attr('fill', COL.target)
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'var(--font-dm-mono), monospace')
      .attr('pointer-events', 'none')
      .text('TARGET');

    // address / known name labels
    nodeEls
      .append('text')
      .attr('dy', (d) => nodeRadius(d) + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => (d.layer === 4 ? '#6b7280' : '#9ca3af'))
      .attr('font-size', '7.5px')
      .attr('font-family', 'var(--font-dm-mono), monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', (d) => (d.layer === 4 ? 0.5 : 1))
      .text((d) => {
        const known = KNOWN_CONTRACTS[d.id];
        if (known) return known;
        return abbr(d.address);
      });

    /* ── tooltip ── */
    const tooltip = d3
      .select(container)
      .append('div')
      .attr(
        'style',
        'position:absolute;pointer-events:none;opacity:0;background:#131620;border:1px solid #1a1e2e;border-radius:6px;padding:8px 10px;font-size:11px;font-family:var(--font-dm-mono),monospace;color:#d1d5db;z-index:50;max-width:340px;line-height:1.5;transition:opacity 0.15s;'
      );

    nodeEls
      .on('mouseenter', (event, d) => {
        const known = KNOWN_CONTRACTS[d.id];
        const nodeType = layerConfidenceLabel[d.layer] || 'Wallet';

        let html = `<div style="color:${nodeColor(d)};font-weight:bold;margin-bottom:2px">${nodeType}</div>`;
        if (known) html += `<div style="color:#a87cdb">${known}</div>`;
        html += `<div style="color:#6b7280">${d.address}</div>`;
        html += `<div style="margin-top:4px">Txs: <span style="color:#fff">${d.txCount}</span>`;
        html += ` &nbsp; In: <span style="color:#47c9b2">${d.volIn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>`;
        html += ` &nbsp; Out: <span style="color:#e89b3e">${d.volOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>`;
        if (d.balance !== null) {
          html += `<div>Balance: <span style="color:${COL.high}">${d.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenSymbol}</span></div>`;
        }
        if (d.lpBalance > 0) {
          html += `<div>In LP: <span style="color:${COL.lpPurple}">${d.lpBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenSymbol}</span></div>`;
          if (d.lpPositions && d.lpPositions.length > 0) {
            for (const lp of d.lpPositions) {
              html += `<div style="color:#9ca3af;font-size:10px">&nbsp;&nbsp;${lp.pairLabel}: ${lp.sharePercentage.toFixed(2)}% of pool</div>`;
            }
          }
        }
        if (d.stakedBalance > 0) {
          html += `<div>Staked: <span style="color:${COL.stakedOrange}">${d.stakedBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenSymbol}</span></div>`;
          if (d.stakingPositions && d.stakingPositions.length > 0) {
            for (const sp of d.stakingPositions) {
              html += `<div style="color:#9ca3af;font-size:10px">&nbsp;&nbsp;${sp.contractLabel}: ${sp.underlyingFLD.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}</div>`;
            }
          }
        }
        if (d.lpBalance > 0 || d.stakedBalance > 0) {
          html += `<div style="border-top:1px solid #1a1e2e;margin-top:2px;padding-top:2px">Total: <span style="color:#fff;font-weight:bold">${d.totalHoldings.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenSymbol}</span></div>`;
        }

        // Show confidence reasons from holdingsReport
        if (holdingsReport && (d.layer === 1 || d.layer === 2)) {
          const wallet = holdingsReport.wallets.find((w) => w.address.toLowerCase() === d.id);
          if (wallet) {
            html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #1a1e2e">`;
            html += `<span style="color:${nodeColor(d)};font-weight:bold">${wallet.confidence.toUpperCase()}</span> confidence`;
            if (wallet.reasons.length > 0) {
              html += `<div style="margin-top:2px;color:#9ca3af">`;
              for (let ri = 0; ri < Math.min(wallet.reasons.length, 3); ri++) {
                html += `<div>- ${wallet.reasons[ri]}</div>`;
              }
              html += `</div>`;
            }
            html += `</div>`;
          }
        }

        // Ghost wallet info
        if (d.isGhost && d.peakBalance !== null && d.peakBalance > 0) {
          html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #1a1e2e">`;
          html += `<div style="color:#e84142;font-weight:bold">GHOST WALLET</div>`;
          html += `<div>Peak: <span style="color:#fff">${fmtBal(d.peakBalance)} ${tokenSymbol}</span>`;
          if (d.peakDate) html += ` <span style="color:#6b7280">(${fmtDate(d.peakDate)})</span>`;
          html += `</div>`;
          if (d.disposition) {
            const disp = d.disposition;
            if (disp.soldOnDex.amount > 0) {
              html += `<div>Sold on DEX: <span style="color:#e84142">${fmtBal(disp.soldOnDex.amount)}</span> (${disp.soldOnDex.percentage.toFixed(0)}%)`;
              if (disp.soldOnDex.dexes.length > 0) html += ` via ${disp.soldOnDex.dexes[0]}`;
              html += `</div>`;
            }
            if (disp.sentToWallets.amount > 0) {
              html += `<div>Sent to wallets: <span style="color:#c9a227">${fmtBal(disp.sentToWallets.amount)}</span> (${disp.sentToWallets.percentage.toFixed(0)}%)</div>`;
            }
          }
          html += `</div>`;
        }

        html += `<div style="color:#6b7280;margin-top:2px">${fmtDate(d.firstSeen)} \u2192 ${fmtDate(d.lastSeen)}</div>`;
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

    /* ── click: highlight ── */
    nodeEls.on('click', (event, d) => {
      event.stopPropagation();
      onNodeClick?.(d.address);

      const connectedIds = new Set<string>();
      connectedIds.add(d.id);
      for (const l of simLinks) {
        const src = resolveId(l.source);
        const tgt = resolveId(l.target);
        if (src === d.id) connectedIds.add(tgt);
        if (tgt === d.id) connectedIds.add(src);
      }

      nodeEls.select('circle').attr('opacity', (n) => (connectedIds.has(n.id) ? (n.layer === 4 ? 0.4 : 1) : 0.08));
      nodeEls.selectAll('text').attr('opacity', (n: unknown) => (connectedIds.has((n as SimNode).id) ? 1 : 0.08));
      linkEls.attr('stroke-opacity', (l) => {
        const src = typeof l.source === 'string' ? l.source : (l.source as SimNode).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as SimNode).id;
        return src === d.id || tgt === d.id ? 0.7 : 0.02;
      });

      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        nodeEls.select('circle').attr('opacity', (n) => (n.layer === 4 ? 0.4 : 1));
        nodeEls.selectAll('text').attr('opacity', 1);
        linkEls.each(function (ld) {
          const style = edgeColor(ld as GraphLink, target, nodeLayerMap);
          d3.select(this).attr('stroke-opacity', style.opacity);
        });
      }, 3500);
    });

    svg.on('click', () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      nodeEls.select('circle').attr('opacity', (n) => (n.layer === 4 ? 0.4 : 1));
      nodeEls.selectAll('text').attr('opacity', 1);
      linkEls.each(function (ld) {
        const style = edgeColor(ld as GraphLink, target, nodeLayerMap);
        d3.select(this).attr('stroke-opacity', style.opacity);
      });
    });

    /* ── tick ── */
    sim.on('tick', () => {
      linkEls
        .attr('x1', (d) => ((d.source as SimNode).x ?? 0))
        .attr('y1', (d) => ((d.source as SimNode).y ?? 0))
        .attr('x2', (d) => ((d.target as SimNode).x ?? 0))
        .attr('y2', (d) => ((d.target as SimNode).y ?? 0));
      nodeEls.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    /* ── resize ── */
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
        // update radial center
        const newCx = width / 2;
        const newCy = height / 2;
        sim.force('radial', d3.forceRadial<SimNode>((d) => layerRadius(d.layer), newCx, newCy).strength((d) => (d.layer === 0 ? 1.0 : 0.7)));
        sim.alpha(0.1).restart();
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      tooltip.remove();
      cleanup();
    };
  }, [nodes, links, targetWallet, tokenSymbol, holdingsReport, detectedContracts, visibleLayers, onNodeClick, cleanup]);

  /* ── zoom controls ── */
  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current) return;
    const svgEl = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 6]);
    svgEl.transition().duration(300).call(zoom.scaleBy, factor);
  }, []);

  const resetView = useCallback(() => {
    if (!svgRef.current) return;
    const svgEl = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 6]);
    svgEl.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  }, []);

  /* ── cluster holdings card data ── */
  const clusterData = holdingsReport
    ? (() => {
        const highWallets = holdingsReport.wallets.filter((w) => w.confidence === 'high');
        const total = holdingsReport.targetBalance + highWallets.reduce((s, w) => s + w.balance, 0);
        const count = highWallets.length + 1;
        return { total, count, targetBalance: holdingsReport.targetBalance, highWallets };
      })()
    : null;

  const isClusterOnlyView = visibleLayers.size === 2 && visibleLayers.has(0) && visibleLayers.has(1);

  /* ── derived stats ── */
  const walletCount = nodes.filter((n) => !n.isContract).length;
  const txCount = links.reduce((s, l) => s + l.txCount, 0);
  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-lg border border-raised/50 overflow-hidden"
      style={{ background: COL.bg }}
    >
      {nodes.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
          Run a scan to visualize token clusters
        </div>
      ) : (
        <>
          <svg ref={svgRef} className="w-full h-full" style={{ minHeight: '400px', background: COL.bg }} />

          {/* ── Layer Controls (top-left) ── */}
          <div className="absolute top-3 left-3 z-10">
            <div
              className="rounded-lg border border-raised/60 px-2.5 py-2 flex flex-col gap-1 text-[10px] font-mono"
              style={{ background: 'rgba(12,14,22,0.95)' }}
            >
              <div className="text-gray-500 uppercase tracking-wider mb-0.5 text-[9px]">Layers</div>

              {/* All Layers */}
              <button
                onClick={handleAllLayers}
                className={`flex items-center gap-2 px-1.5 py-0.5 rounded transition-colors text-left cursor-pointer ${
                  visibleLayers.size === 5 ? 'text-gray-200' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: visibleLayers.size === 5 ? '#c9a227' : '#374151' }}
                />
                All Layers
              </button>

              <div className="border-t border-raised/40 my-0.5" />

              {/* Individual layers 1-4 */}
              {LAYER_LABELS.filter((l) => l.layer >= 1).map((item) => (
                <button
                  key={item.layer}
                  onClick={() => handleLayerToggle(item.layer)}
                  title={item.hint}
                  className={`flex items-center gap-2 px-1.5 py-0.5 rounded transition-colors text-left cursor-pointer ${
                    visibleLayers.has(item.layer) ? 'text-gray-200' : 'text-gray-600 hover:text-gray-400'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: visibleLayers.has(item.layer) ? item.color : '#374151' }}
                  />
                  {item.label}
                </button>
              ))}

              <div className="border-t border-raised/40 my-0.5" />

              {/* Cluster Only shortcut */}
              <button
                onClick={handleClusterOnly}
                className={`flex items-center gap-2 px-1.5 py-0.5 rounded transition-colors text-left cursor-pointer ${
                  clusterOnly ? 'text-[#c9a227]' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ background: clusterOnly ? '#c9a227' : '#374151' }}
                />
                Cluster Only
              </button>
            </div>
          </div>

          {/* ── Zoom Controls (top-right) ── */}
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

          {/* ── Cluster Holdings Card (bottom-left) ── */}
          {clusterData && (
            <div
              className="absolute z-10 font-mono transition-all duration-350"
              style={{
                bottom: 44,
                left: 12,
                maxWidth: isClusterOnlyView ? 300 : 260,
              }}
            >
              {isClusterOnlyView ? (
                /* Full card in cluster-only mode */
                <div
                  className="rounded-lg border-l-[3px] border border-raised/50 px-3 py-3"
                  style={{ background: 'rgba(12,14,22,0.95)', borderLeftColor: '#c9a227' }}
                >
                  <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">
                    Cluster Holdings
                  </div>
                  <div className="text-2xl font-bold text-[#c9a227] leading-tight">
                    {fmt(clusterData.total)} {tokenSymbol}
                  </div>
                  <div className="text-[10px] text-gray-500 mb-2">
                    across {clusterData.count} wallet{clusterData.count !== 1 ? 's' : ''}
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COL.target }} />
                      <span className="text-gray-400">Target</span>
                      <span className="text-[#c9a227] ml-auto">{fmt(clusterData.targetBalance)} {tokenSymbol}</span>
                    </div>
                    {clusterData.highWallets.slice(0, 5).map((w) => (
                      <div key={w.address} className="flex items-center gap-2 text-[10px]">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COL.high }} />
                        <span className="text-gray-400">{abbr(w.address)}</span>
                        <span className="text-emerald-400 ml-auto">{fmt(w.balance)} {tokenSymbol}</span>
                      </div>
                    ))}
                  </div>

                  {clusterData.highWallets.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-raised/30 text-[10px] text-gray-500">
                      Confidence: <span className="text-emerald-400">HIGH</span>
                    </div>
                  )}
                </div>
              ) : (
                /* Condensed single line */
                <div
                  className="rounded-md border border-raised/50 px-2.5 py-1.5 text-[10px]"
                  style={{ background: 'rgba(12,14,22,0.95)' }}
                >
                  <span className="text-gray-500">Cluster: </span>
                  <span className="text-[#c9a227] font-bold">~{fmt(clusterData.total)} {tokenSymbol}</span>
                  <span className="text-gray-600"> ({clusterData.count} wallets)</span>
                </div>
              )}
            </div>
          )}

          {/* ── Status Bar (bottom-left, below card) ── */}
          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-surface/90 border border-raised/60 text-[10px] font-mono text-gray-500 z-10">
            {txCount} transfers · {walletCount} wallets · {tokenSymbol} on AVAX · {now}
          </div>

          {/* ── Legend (bottom-right) ── */}
          <div className="absolute bottom-3 right-3 bg-surface/90 border border-raised/60 rounded px-3 py-2 text-[10px] font-mono z-10 flex flex-col gap-1">
            {LAYER_LABELS.map((item) => (
              <div key={item.layer} className="flex items-center gap-2" title={item.hint}>
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                <span className="text-gray-400">{item.label}</span>
              </div>
            ))}
            <div className="border-t border-raised/50 mt-1 pt-1 flex items-center gap-2" title="Gold glowing ring around a node means HIGH confidence same-owner wallet">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: COL.goldRing, background: 'transparent' }} />
              <span className="text-gray-400">Gold ring = HIGH</span>
            </div>
            <div className="flex items-center gap-2" title="Hollow dashed circle = Ghost wallet (once held tokens, now empty)">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-dashed" style={{ borderColor: 'rgba(232,65,66,0.5)', background: 'transparent' }} />
              <span className="text-gray-400">Ghost (emptied)</span>
            </div>
            <div className="flex items-center gap-2" title="Purple dashed ring = wallet holds tokens in a liquidity pool">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-dashed" style={{ borderColor: COL.lpPurple, background: 'transparent' }} />
              <span className="text-gray-400">LP Position</span>
            </div>
            <div className="flex items-center gap-2" title="Orange ring = wallet has tokens staked in a farm contract">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: COL.stakedOrange, background: 'transparent' }} />
              <span className="text-gray-400">Staked</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
