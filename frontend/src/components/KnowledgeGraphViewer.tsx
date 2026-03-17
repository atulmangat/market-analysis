import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { KGNode, KnowledgeGraph } from '../types';
import { KG_COLORS } from '../constants';
import { apiFetch } from '../utils';

export function KnowledgeGraphViewer({ refreshTrigger }: { refreshTrigger?: number }) {
  const [graph, setGraph]           = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading]       = useState(false);
  const [filter, setFilter]         = useState<'ALL' | 'ASSET' | 'ENTITY' | 'EVENT' | 'INDICATOR' | 'MARKET'>('ALL');
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);
  const [tickerSearch, setTickerSearch] = useState('');
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 520 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  // Measure container width so the canvas fills it responsively
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      setDims({ w, h: Math.max(480, Math.min(w * 0.65, 680)) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const loadGraph = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/knowledge-graph');
      if (res.ok) { const data = await res.json(); setGraph(data); }
    } finally { setLoading(false); }
  };

  const loadSubgraph = async (symbol: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/knowledge-graph/ticker/${encodeURIComponent(symbol)}?hops=2`);
      if (res.ok) { const data = await res.json(); setGraph(data); setFilter('ALL'); }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadGraph(); }, []);
  // Reload whenever the pipeline KG_INGEST step completes
  useEffect(() => { if (refreshTrigger) loadGraph(); }, [refreshTrigger]);

  // Zoom to fit after graph data loads
  useEffect(() => {
    if (graph && fgRef.current) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 40), 600);
    }
  }, [graph]);

  // Compute degree (connection count) per node for size scaling
  const degreeMap = useMemo(() => {
    const m: Record<string, number> = {};
    (graph?.edges ?? []).forEach(e => {
      m[e.source] = (m[e.source] ?? 0) + 1;
      m[e.target] = (m[e.target] ?? 0) + 1;
    });
    return m;
  }, [graph]);

  const displayNodes = useMemo(() => (graph?.nodes ?? []).filter(
    n => filter === 'ALL' || n.type === filter
  ), [graph, filter]);

  const displayNodeIds = useMemo(() => new Set(displayNodes.map(n => n.id)), [displayNodes]);

  const displayEdges = useMemo(() => (graph?.edges ?? []).filter(
    e => displayNodeIds.has(e.source) && displayNodeIds.has(e.target)
  ), [graph, displayNodeIds]);

  // Build the data object that ForceGraph2D accepts
  const fgData = useMemo(() => ({
    nodes: displayNodes.map(n => ({ ...n, id: n.id })),
    links: displayEdges.map(e => ({ source: e.source, target: e.target, relation: e.relation, confidence: e.confidence })),
  }), [displayNodes, displayEdges]);

  const nodeColor = useCallback((n: KGNode) => KG_COLORS[n.type] ?? '#6b7280', []);

  const nodeRadius = useCallback((n: KGNode) => {
    const deg = degreeMap[n.id] ?? 0;
    const base = n.type === 'ASSET' ? 7 : n.type === 'INDICATOR' ? 6 : 5;
    return base + Math.min(deg * 1.2, 10);
  }, [degreeMap]);

  const handleNodeClick = useCallback((n: KGNode) => {
    setSelectedNode(prev => prev?.id === n.id ? null : n);
    // Highlight the node and its neighbours
    const neighbours = new Set<string>([n.id]);
    (graph?.edges ?? []).forEach(e => {
      if (e.source === n.id) neighbours.add(e.target);
      if (e.target === n.id) neighbours.add(e.source);
    });
    setHighlightIds(neighbours);
  }, [graph]);

  const handleBgClick = useCallback(() => {
    setSelectedNode(null);
    setHighlightIds(new Set());
  }, []);

  const nodeCanvasObject = useCallback((node: KGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const r = nodeRadius(node);
    const color = nodeColor(node);
    const isHighlighted = highlightIds.size === 0 || highlightIds.has(node.id);
    const isSelected = selectedNode?.id === node.id;

    ctx.globalAlpha = isHighlighted ? 1 : 0.2;

    // Glow for selected
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color + '40';
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label — show when zoomed in enough or highlighted
    const fontSize = Math.max(3, Math.min(5 / globalScale * 2, 11));
    if (globalScale > 0.6 || isHighlighted) {
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = isHighlighted ? '#e2e8f0' : '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label;
      ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + 2);
    }

    ctx.globalAlpha = 1;
  }, [nodeRadius, nodeColor, highlightIds, selectedNode]);

  const linkColor = useCallback((link: { confidence?: number }) =>
    `rgba(71,85,105,${0.2 + (link.confidence ?? 0.5) * 0.5})`, []);

  const linkWidth = useCallback((link: { confidence?: number }) =>
    (link.confidence ?? 0.5) * 2, []);

  const relLabel = (r: string) => r.replace(/_/g, ' ');

  const nodesById = useMemo(() =>
    Object.fromEntries((graph?.nodes ?? []).map(n => [n.id, n])), [graph]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-textMain">Knowledge Graph</h2>
          <p className="text-[11px] text-textDim mt-0.5">
            {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges — drag to explore, scroll to zoom, click node for details` : 'Persistent event & entity network — updated each pipeline run'}
          </p>
        </div>
        <button onClick={loadGraph} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-borderMid bg-surface2 text-textMuted hover:text-textMain hover:border-brand-500/40 transition-colors disabled:opacity-50">
          {loading ? '…' : '↺ Refresh'}
        </button>
      </div>

      {/* Search + ticker subgraph */}
      <div className="flex gap-2">
        <input
          value={tickerSearch}
          onChange={e => setTickerSearch(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && tickerSearch && loadSubgraph(tickerSearch)}
          placeholder="Focus on ticker (e.g. NVDA)"
          className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-borderMid bg-surface2 text-textMain placeholder:text-textDim focus:outline-none focus:border-brand-500/60"
        />
        <button onClick={() => tickerSearch ? loadSubgraph(tickerSearch) : loadGraph()}
          className="text-xs px-3 py-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 transition-colors">
          {tickerSearch ? `Subgraph: ${tickerSearch}` : 'Full graph'}
        </button>
        {graph && (
          <button onClick={() => fgRef.current?.zoomToFit(400, 40)}
            className="text-xs px-3 py-1.5 rounded-lg border border-borderMid bg-surface2 text-textMuted hover:text-textMain transition-colors">
            ⊡ Fit
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {(['ALL', 'ASSET', 'ENTITY', 'EVENT', 'INDICATOR', 'MARKET'] as const).map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
              filter === t
                ? 'border-brand-500 bg-brand-500/20 text-brand-300'
                : 'border-borderLight bg-surface2 text-textMuted hover:border-brand-400'
            }`}>
            {t === 'ALL' ? 'All types' : t}
            {graph && (
              <span className="ml-1 opacity-60">
                ({t === 'ALL' ? graph.nodes.length : graph.nodes.filter(n => n.type === t).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap items-center">
        {Object.entries(KG_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-[10px] text-textDim">{type}</span>
          </div>
        ))}
        <span className="text-[10px] text-textDim ml-2 opacity-60">· node size = connection count</span>
      </div>

      {/* Force Graph canvas + inline detail panel */}
      <div ref={containerRef} className="rounded-xl border border-borderLight overflow-hidden bg-surface2 relative">
        {loading ? (
          <div className="flex items-center justify-center text-textDim text-sm" style={{ height: dims.h }}>Loading graph…</div>
        ) : !graph || graph.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-2 px-6" style={{ height: dims.h }}>
            <span className="text-3xl opacity-30">◎</span>
            <p className="text-sm text-textDim">No graph data yet</p>
            <p className="text-[11px] text-textDim">Run a pipeline to populate the knowledge graph.</p>
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            graphData={fgData}
            width={selectedNode ? dims.w * 0.58 : dims.w}
            height={dims.h}
            backgroundColor="#0f172a"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeCanvasObject={nodeCanvasObject as any}
            nodeCanvasObjectMode={() => 'replace'}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodePointerAreaPaint={(node: any, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node as KGNode) + 4, 0, 2 * Math.PI);
              ctx.fill();
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            linkColor={linkColor as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            linkWidth={linkWidth as any}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={() => '#475569'}
            linkCurvature={0.1}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onNodeClick={handleNodeClick as any}
            onBackgroundClick={handleBgClick}
            cooldownTicks={120}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        )}

        {/* Inline detail panel — overlays on the right side of the canvas */}
        {selectedNode && graph && (
          <div
            className="absolute top-0 right-0 bottom-0 bg-surface/95 border-l border-borderLight overflow-y-auto"
            style={{ width: '42%' }}
          >
            <div className="p-4 space-y-3">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: KG_COLORS[selectedNode.type] }} />
                  <span className="text-sm font-semibold text-textMain truncate">{selectedNode.label}</span>
                </div>
                <button onClick={() => { setSelectedNode(null); setHighlightIds(new Set()); }}
                  className="text-textDim hover:text-textMain text-lg leading-none shrink-0">×</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded font-semibold"
                  style={{ background: KG_COLORS[selectedNode.type] + '22', color: KG_COLORS[selectedNode.type] }}>
                  {selectedNode.type}
                </span>
                <span className="text-[10px] text-textDim">{degreeMap[selectedNode.id] ?? 0} connections</span>
                <span className="text-[10px] text-textDim font-mono opacity-60 truncate">{selectedNode.id}</span>
              </div>

              {/* Relationships */}
              {(() => {
                const nodeEdges = graph.edges.filter(
                  e => e.source === selectedNode.id || e.target === selectedNode.id
                );
                if (!nodeEdges.length) return <p className="text-[11px] text-textDim">No relationships found.</p>;
                return (
                  <div className="space-y-1">
                    <p className="text-[10px] text-textDim uppercase tracking-wider font-semibold">Relationships ({nodeEdges.length})</p>
                    {nodeEdges.slice(0, 12).map((e, i) => {
                      const isOutbound = e.source === selectedNode.id;
                      const otherId = isOutbound ? e.target : e.source;
                      const other = nodesById[otherId];
                      return (
                        <div key={i} className="flex items-center gap-2 text-[11px] text-textMuted">
                          <span className="font-mono text-textDim w-4 text-center shrink-0">{isOutbound ? '→' : '←'}</span>
                          <button onClick={() => other && handleNodeClick(other)}
                            className="text-brand-400 hover:underline truncate">
                            {other?.label ?? otherId}
                          </button>
                          <span className="text-textDim text-[10px] shrink-0">{relLabel(e.relation)}</span>
                          <span className="ml-auto text-textDim text-[10px] shrink-0">{(e.confidence * 100).toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* EVENT metadata */}
              {selectedNode.type === 'EVENT' && (() => {
                const m = selectedNode.metadata as Record<string, unknown>;
                const dir = String(m.direction ?? '');
                const mag = String(m.magnitude ?? '');
                const exp = m.expires_days ? String(m.expires_days) : '';
                const sum = String(m.summary ?? '');
                const catalyst = String(m.catalyst_type ?? '');
                const region = String(m.source_region ?? '');
                const keyNums = Array.isArray(m.key_numbers) ? m.key_numbers as string[] : [];
                const targets = Array.isArray(m.price_targets) ? m.price_targets as string[] : [];
                const extractedAt = m.extracted_at ? new Date(String(m.extracted_at)).toLocaleDateString() : '';
                if (!dir && !sum) return null;
                return (
                  <div className="space-y-2.5 border-t border-borderLight pt-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {dir && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          dir.includes('bullish') ? 'bg-up/10 text-up' :
                          dir.includes('bearish') ? 'bg-down/10 text-down' :
                          'bg-surface3 text-textDim'
                        }`}>{dir.toUpperCase()}</span>
                      )}
                      {mag && <span className="text-[10px] bg-surface3 text-textDim px-2 py-0.5 rounded">{mag.toUpperCase()}</span>}
                      {catalyst && <span className="text-[10px] bg-brand-500/10 text-brand-400 px-2 py-0.5 rounded">{catalyst}</span>}
                      {region && <span className="text-[10px] text-textDim px-2 py-0.5 rounded border border-borderLight">{region}</span>}
                      {exp && <span className="text-[10px] text-textDim">expires {exp}d</span>}
                    </div>
                    {sum && <p className="text-[11px] text-textMuted leading-relaxed">{sum}</p>}
                    {keyNums.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-textDim uppercase tracking-wider font-semibold">Key Numbers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {keyNums.map((n, i) => (
                            <span key={i} className="text-[10px] font-mono bg-surface3 text-textMain px-2 py-0.5 rounded">{n}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {targets.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-textDim uppercase tracking-wider font-semibold">Analyst Calls</p>
                        <div className="space-y-0.5">
                          {targets.map((t, i) => (
                            <p key={i} className="text-[10px] text-textMuted font-mono">· {t}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {extractedAt && <p className="text-[9px] text-textDim">extracted {extractedAt}</p>}
                  </div>
                );
              })()}

              {/* Subgraph drill-down for assets */}
              {selectedNode.type === 'ASSET' && selectedNode.symbol && (
                <button onClick={() => { loadSubgraph(selectedNode.symbol!); setSelectedNode(null); setHighlightIds(new Set()); }}
                  className="text-[11px] text-brand-400 hover:text-brand-300 hover:underline">
                  Focus 2-hop subgraph on {selectedNode.symbol} →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
