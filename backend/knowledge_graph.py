"""
Persistent Knowledge Graph for the multi-agent trading system.

The graph is stored in two PostgreSQL tables (kg_nodes, kg_edges).
Each pipeline run:
  1. Upserts asset nodes for all enabled tickers
  2. Ingests news items via an LLM extraction step → new edges/nodes
  3. Agents query a per-ticker subgraph (2-hop BFS) for richer context

The graph is append-only — nodes and edges are never deleted.
"""

import json
import re
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import or_
import models
from agents import query_agent


# ── Ticker label lookup ────────────────────────────────────────────────────────

TICKER_LABELS: dict[str, str] = {
    # US
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA",
    "GOOGL": "Alphabet", "AMZN": "Amazon", "TSLA": "Tesla",
    "META": "Meta", "AMD": "AMD",
    # India
    "RELIANCE.NS": "Reliance Industries", "TCS.NS": "TCS",
    "INFY.NS": "Infosys", "HDFCBANK.NS": "HDFC Bank",
    "ICICIBANK.NS": "ICICI Bank", "WIPRO.NS": "Wipro",
    "SBIN.NS": "SBI", "TATAMOTORS.NS": "Tata Motors",
    # Crypto
    "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana",
    "BNB-USD": "BNB", "XRP-USD": "XRP", "DOGE-USD": "Dogecoin", "ADA-USD": "Cardano",
    # MCX
    "GC=F": "Gold Futures", "SI=F": "Silver Futures",
    "CL=F": "Crude Oil WTI", "NG=F": "Natural Gas", "HG=F": "Copper Futures",
}


# ── LLM extraction prompt ──────────────────────────────────────────────────────

KG_INGEST_SYSTEM_PROMPT = """You are a financial knowledge graph extractor.

Given a list of news headlines and snippets, extract structured relationships between financial entities.

For each relationship, output a JSON object on its own line (no other text):
{"source": "<node_id>", "source_type": "ASSET|ENTITY|INDICATOR|EVENT", "source_label": "<label>",
 "relation": "affects|correlated_with|caused_by|related_to|sector_peer",
 "target": "<node_id>", "target_type": "ASSET|ENTITY|INDICATOR|EVENT", "target_label": "<label>",
 "confidence": 0.0-1.0}

Node ID naming rules:
- Assets (stocks/crypto/commodities): "asset:<TICKER>" e.g. asset:NVDA, asset:BTC-USD, asset:GC=F
- Named entities (companies, banks, govts): "entity:<SlugifiedName>" e.g. entity:FederalReserve, entity:Nvidia
- Macro indicators: "indicator:<NAME>" e.g. indicator:VIX, indicator:DXY, indicator:US10Y
- News events: "event:<slug-YYYY-MM>" e.g. event:fed-rate-hike-2026-03, event:nvidia-earnings-beat-2026-02

Relation types:
- affects: A directly impacts B's price or business
- correlated_with: A and B tend to move together
- caused_by: B's recent move was caused by A
- related_to: A and B are thematically connected
- sector_peer: A and B are direct competitors / same sector

Rules:
- Only emit relationships where confidence >= 0.4
- Emit at most 20 relationships per batch
- Output ONLY the JSON lines, no preamble, no explanation
- Focus on relationships that are useful for trading decisions"""


# ── Node helpers ───────────────────────────────────────────────────────────────

def _upsert_node(db: Session, node_id: str, node_type: str, label: str, symbol: str = None):
    existing = db.query(models.KGNode).filter(models.KGNode.node_id == node_id).first()
    if existing:
        existing.last_seen_at = datetime.utcnow()
    else:
        db.add(models.KGNode(
            node_id=node_id,
            node_type=node_type,
            label=label,
            symbol=symbol,
        ))


def upsert_asset_nodes(db: Session, tickers: list[str]) -> None:
    """Ensure all enabled tickers exist as ASSET nodes in the graph."""
    for ticker in tickers:
        node_id = f"asset:{ticker}"
        label = TICKER_LABELS.get(ticker, ticker)
        _upsert_node(db, node_id, "ASSET", label, symbol=ticker)
    db.commit()


# ── News ingestion via LLM ─────────────────────────────────────────────────────

def ingest_news_to_graph(db: Session, news_items: list[dict], run_id: str) -> int:
    """
    Parse news items via LLM and add extracted relationships to the graph.
    Processes up to 3 batches of 20 items each (60 items total).
    Returns the number of edges added.
    Non-fatal — errors are logged but not raised.
    """
    if not news_items:
        return 0

    edges_added = 0
    batches = [news_items[i:i + 20] for i in range(0, len(news_items), 20)]

    for batch in batches[:3]:
        prompt_body = "\n".join(
            f"{i + 1}. {r.get('title', '')} — {r.get('snippet', '')[:150]}"
            for i, r in enumerate(batch)
            if r.get('title')
        )
        if not prompt_body.strip():
            continue

        try:
            raw = query_agent(KG_INGEST_SYSTEM_PROMPT, prompt_body)
        except Exception as e:
            print(f"[KG] LLM call failed: {e}")
            continue

        for line in raw.strip().splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                rel = json.loads(line)
                src_id    = rel["source"]
                src_type  = rel["source_type"]
                src_label = rel["source_label"]
                tgt_id    = rel["target"]
                tgt_type  = rel["target_type"]
                tgt_label = rel["target_label"]
                relation  = rel["relation"]
                conf      = float(rel.get("confidence", 0.5))

                if conf < 0.4:
                    continue
                if relation not in ("affects", "correlated_with", "caused_by", "related_to", "sector_peer"):
                    continue

                # Upsert nodes
                src_sym = src_id.split(":", 1)[1] if src_type == "ASSET" else None
                tgt_sym = tgt_id.split(":", 1)[1] if tgt_type == "ASSET" else None
                _upsert_node(db, src_id, src_type, src_label, symbol=src_sym)
                _upsert_node(db, tgt_id, tgt_type, tgt_label, symbol=tgt_sym)

                # Insert edge
                db.add(models.KGEdge(
                    source_node_id=src_id,
                    target_node_id=tgt_id,
                    relation=relation,
                    confidence=conf,
                    source_run_id=run_id,
                ))
                edges_added += 1
            except Exception:
                continue

        db.commit()

    return edges_added


# ── Subgraph retrieval ─────────────────────────────────────────────────────────

def get_ticker_subgraph(db: Session, ticker: str, hops: int = 2) -> dict:
    """
    BFS over the knowledge graph starting from asset:<ticker>.
    Returns {nodes: [...], edges: [...], center: node_id}.
    """
    start_node_id = f"asset:{ticker}"
    visited_ids: set[str] = {start_node_id}
    frontier: set[str] = {start_node_id}
    all_edges: list = []

    for _ in range(min(hops, 3)):
        if not frontier:
            break
        edges = db.query(models.KGEdge).filter(
            or_(
                models.KGEdge.source_node_id.in_(list(frontier)),
                models.KGEdge.target_node_id.in_(list(frontier)),
            )
        ).all()
        all_edges.extend(edges)
        new_ids: set[str] = set()
        for e in edges:
            new_ids.add(e.source_node_id)
            new_ids.add(e.target_node_id)
        frontier = new_ids - visited_ids
        visited_ids.update(new_ids)

    nodes = db.query(models.KGNode).filter(
        models.KGNode.node_id.in_(list(visited_ids))
    ).all()

    # Deduplicate edges: keep highest confidence per (source, target, relation)
    seen_edges: dict[tuple, models.KGEdge] = {}
    for e in all_edges:
        key = (e.source_node_id, e.target_node_id, e.relation)
        if key not in seen_edges or e.confidence > seen_edges[key].confidence:
            seen_edges[key] = e

    return {
        "nodes": [_node_to_dict(n) for n in nodes],
        "edges": [_edge_to_dict(e) for e in seen_edges.values()],
        "center": start_node_id,
    }


def get_full_graph(db: Session, limit_nodes: int = 500) -> dict:
    """Return all nodes and deduplicated edges, capped for performance."""
    nodes = db.query(models.KGNode).order_by(
        models.KGNode.last_seen_at.desc()
    ).limit(limit_nodes).all()
    node_ids = [n.node_id for n in nodes]

    edges = db.query(models.KGEdge).filter(
        models.KGEdge.source_node_id.in_(node_ids),
        models.KGEdge.target_node_id.in_(node_ids),
    ).order_by(models.KGEdge.confidence.desc()).limit(2000).all()

    seen_edges: dict[tuple, models.KGEdge] = {}
    for e in edges:
        key = (e.source_node_id, e.target_node_id, e.relation)
        if key not in seen_edges or e.confidence > seen_edges[key].confidence:
            seen_edges[key] = e

    return {
        "nodes": [_node_to_dict(n) for n in nodes],
        "edges": [_edge_to_dict(e) for e in seen_edges.values()],
    }


# ── Agent context formatting ───────────────────────────────────────────────────

def format_subgraph_for_agent(subgraph: dict) -> str:
    """
    Format a ticker subgraph as structured markdown for injection into agent context.
    Returns empty string if the graph has only the root asset node (not yet populated).
    """
    nodes = subgraph.get("nodes", [])
    edges = subgraph.get("edges", [])

    if len(nodes) <= 1:
        return ""  # Graph not yet populated for this ticker

    nodes_by_id = {n["id"]: n for n in nodes}
    center = subgraph.get("center", "")
    center_label = nodes_by_id.get(center, {}).get("label", center)

    lines = [
        f"## Knowledge Graph: {center_label} ({len(nodes)} connected nodes, {len(edges)} relationships)\n"
    ]

    # Group edges by relation type, sorted by confidence
    by_relation: dict[str, list] = {}
    for e in edges:
        by_relation.setdefault(e["relation"], []).append(e)

    for relation, rel_edges in sorted(by_relation.items()):
        rel_edges_sorted = sorted(rel_edges, key=lambda x: -x["confidence"])
        label = relation.replace("_", " ").title()
        lines.append(f"**{label}:**")
        for e in rel_edges_sorted[:6]:
            src_label = nodes_by_id.get(e["source"], {}).get("label", e["source"])
            tgt_label = nodes_by_id.get(e["target"], {}).get("label", e["target"])
            conf_pct = int(e["confidence"] * 100)
            lines.append(f"- {src_label} → {tgt_label} ({conf_pct}% confidence)")
        lines.append("")

    return "\n".join(lines)


def build_kg_context_for_ticker(db: Session, ticker: str) -> str:
    """Convenience wrapper: fetch subgraph and format it for an agent."""
    try:
        subgraph = get_ticker_subgraph(db, ticker, hops=2)
        return format_subgraph_for_agent(subgraph)
    except Exception as e:
        print(f"[KG] Failed to build subgraph for {ticker}: {e}")
        return ""


# ── Serialization helpers ──────────────────────────────────────────────────────

def _node_to_dict(n: models.KGNode) -> dict:
    return {
        "id":          n.node_id,
        "type":        n.node_type,
        "label":       n.label,
        "symbol":      n.symbol,
        "metadata":    json.loads(n.metadata_json or "{}"),
        "last_seen_at": n.last_seen_at.isoformat() if n.last_seen_at else None,
        "created_at":  n.created_at.isoformat() if n.created_at else None,
    }


def _edge_to_dict(e: models.KGEdge) -> dict:
    return {
        "source":     e.source_node_id,
        "target":     e.target_node_id,
        "relation":   e.relation,
        "confidence": round(e.confidence, 3),
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
