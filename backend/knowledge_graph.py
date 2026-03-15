"""
Persistent Knowledge Graph for the multi-agent trading system.

Design principles:
- Nodes represent: ASSET (tickers), ENTITY (companies/banks/govts),
  INDICATOR (VIX/DXY/yields), EVENT (compressed market facts)
- EVENT nodes store structured metadata: what happened, direction, magnitude, expiry
- Edges carry typed relationships with confidence scores
- Each pipeline run: extract compressed facts from retrieval context → upsert nodes/edges
- Semantic deduplication: embed edge descriptions, merge near-duplicate edges via LLM
- Agents receive a 2-hop subgraph per ticker — rich compressed context, not raw news
"""

import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import or_
import models
from agents import query_agent


# ── Ticker label lookup ────────────────────────────────────────────────────────

TICKER_LABELS: dict[str, str] = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA",
    "GOOGL": "Alphabet", "AMZN": "Amazon", "TSLA": "Tesla",
    "META": "Meta", "AMD": "AMD",
    "RELIANCE.NS": "Reliance Industries", "TCS.NS": "TCS",
    "INFY.NS": "Infosys", "HDFCBANK.NS": "HDFC Bank",
    "ICICIBANK.NS": "ICICI Bank", "WIPRO.NS": "Wipro",
    "SBIN.NS": "SBI", "TATAMOTORS.NS": "Tata Motors",
    "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana",
    "BNB-USD": "BNB", "XRP-USD": "XRP", "DOGE-USD": "Dogecoin", "ADA-USD": "Cardano",
    "GC=F": "Gold Futures", "SI=F": "Silver Futures",
    "CL=F": "Crude Oil WTI", "NG=F": "Natural Gas", "HG=F": "Copper Futures",
}


# ── LLM prompts ────────────────────────────────────────────────────────────────

KG_EXTRACT_SYSTEM_PROMPT = """You are a financial knowledge graph builder.

Given market research (news, fundamentals, price data), extract compressed, actionable facts.
For each distinct fact, output ONE JSON object per line:

{
  "event_id": "<slug-YYYY-MM-DD>",           // unique event slug e.g. "nvidia-earnings-beat-2026-03-15"
  "event_label": "<10 word max summary>",    // e.g. "NVIDIA Q1 earnings beat by 18%"
  "event_summary": "<2-3 sentence compressed fact with key numbers>",
  "direction": "bullish|bearish|neutral",
  "magnitude": "high|medium|low",            // market impact magnitude
  "expires_days": 3,                         // how many days before this fact is stale (1-30)
  "affected_assets": ["NVDA", "AMD", "asset:SOX"],  // tickers or node_ids directly affected
  "related_entities": ["entity:NVIDIA", "entity:FederalReserve"],
  "relations": [
    {"source": "<node_id>", "target": "<node_id>",
     "relation": "affects|correlated_with|caused_by|related_to|sector_peer",
     "confidence": 0.0-1.0, "reason": "<one phrase>"}
  ]
}

Node ID rules:
- ASSET tickers: "asset:NVDA", "asset:BTC-USD", "asset:GC=F"
- Entities: "entity:NVIDIA", "entity:FederalReserve", "entity:China"
- Indicators: "indicator:VIX", "indicator:DXY", "indicator:US10Y", "indicator:CPI"
- Events: "event:<slug-YYYY-MM-DD>"

Relations: affects | correlated_with | caused_by | related_to | sector_peer

Rules:
- Extract only facts with clear market implications — skip vague or purely informational items
- Compress each fact to its essential numbers and direction — no filler
- Set expires_days based on impact horizon: breaking catalyst=2, earnings=7, macro=14, structural=30
- Emit at most 15 event objects
- Output ONLY the JSON lines, no preamble"""


KG_MERGE_SYSTEM_PROMPT = """You are a knowledge graph deduplication expert.

You will receive two edge descriptions that may be near-duplicates.
Decide: MERGE or KEEP_BOTH.

If MERGE: output the merged edge as JSON:
{"action": "merge", "relation": "<best relation>", "confidence": <merged confidence 0-1>,
 "reason": "<merged one-phrase reason>"}

If KEEP_BOTH: output:
{"action": "keep_both"}

Rules:
- MERGE if they describe the same causal/directional relationship with >80% semantic overlap
- KEEP_BOTH if they describe different time periods, directions, or mechanisms
- When merging, take the higher confidence and the more specific relation"""


# ── Embedding via OpenRouter ───────────────────────────────────────────────────

def _embed_texts(texts: list[str]) -> list[list[float]] | None:
    """
    Compute embeddings via OpenRouter using Qwen3-Embedding-0.6B (free tier).
    Falls back to None if unavailable — deduplication is gracefully skipped.
    """
    if not texts:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.getenv("OPENROUTER_API_KEY", ""),
            base_url="https://openrouter.ai/api/v1",
        )
        resp = client.embeddings.create(
            model="Qwen/Qwen3-Embedding-0.6B",
            input=texts,
        )
        return [e.embedding for e in resp.data]
    except Exception as e:
        print(f"[KG] Embedding failed (dedup skipped): {e}")
        return None


def _cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a)) or 1.0
    nb  = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (na * nb)


def _edge_description(source_id: str, relation: str, target_id: str,
                       nodes_by_id: dict) -> str:
    src_label = nodes_by_id.get(source_id, {}).get("label", source_id)
    tgt_label = nodes_by_id.get(target_id, {}).get("label", target_id)
    return f"{src_label} {relation.replace('_', ' ')} {tgt_label}"


# ── Node helpers ───────────────────────────────────────────────────────────────

def _upsert_node(db: Session, node_id: str, node_type: str, label: str,
                 symbol: str = None, metadata: dict = None):
    existing = db.query(models.KGNode).filter(models.KGNode.node_id == node_id).first()
    if existing:
        existing.last_seen_at = datetime.utcnow()
        if metadata:
            # Merge metadata: update existing fields
            try:
                old_meta = json.loads(existing.metadata_json or "{}")
                old_meta.update(metadata)
                existing.metadata_json = json.dumps(old_meta)
            except Exception:
                pass
    else:
        db.add(models.KGNode(
            node_id=node_id,
            node_type=node_type,
            label=label,
            symbol=symbol,
            metadata_json=json.dumps(metadata or {}),
        ))


def upsert_asset_nodes(db: Session, tickers: list[str]) -> None:
    """Ensure all enabled tickers exist as ASSET nodes."""
    for ticker in tickers:
        node_id = f"asset:{ticker}"
        label = TICKER_LABELS.get(ticker, ticker)
        _upsert_node(db, node_id, "ASSET", label, symbol=ticker)
    db.commit()


# ── Semantic deduplication ─────────────────────────────────────────────────────

def _deduplicate_edges(db: Session, new_edges: list[dict],
                       existing_edges: list[models.KGEdge],
                       nodes_by_id: dict) -> list[dict]:
    """
    For each new edge, check if a semantically similar edge already exists.
    Similar = cosine(embedding) > 0.88 AND same (source, target) pair.
    When similar: LLM decides MERGE or KEEP_BOTH.
    Returns filtered list of new_edges that should be inserted.
    """
    if not new_edges or not existing_edges:
        return new_edges

    # Build descriptions for new edges
    new_descs = [
        _edge_description(e["source"], e["relation"], e["target"], nodes_by_id)
        for e in new_edges
    ]

    # Group existing edges by (source, target) for fast lookup
    existing_by_pair: dict[tuple, list[models.KGEdge]] = {}
    for e in existing_edges:
        key = (e.source_node_id, e.target_node_id)
        existing_by_pair.setdefault(key, []).append(e)

    # Find candidate pairs that share (source, target) — only embed those
    candidate_pairs: list[tuple[int, models.KGEdge]] = []  # (new_idx, existing_edge)
    for i, ne in enumerate(new_edges):
        key = (ne["source"], ne["target"])
        for ex in existing_by_pair.get(key, []):
            candidate_pairs.append((i, ex))

    if not candidate_pairs:
        return new_edges  # No structural overlap — no dedup needed

    # Embed all candidate descriptions in one call
    candidate_new_idxs  = list({i for i, _ in candidate_pairs})
    candidate_ex_edges  = list({id(ex): ex for _, ex in candidate_pairs}.values())

    new_texts = [new_descs[i] for i in candidate_new_idxs]
    ex_texts  = [
        _edge_description(ex.source_node_id, ex.relation, ex.target_node_id, nodes_by_id)
        for ex in candidate_ex_edges
    ]
    all_texts = new_texts + ex_texts
    embeddings = _embed_texts(all_texts)

    if embeddings is None:
        return new_edges  # Embedding failed — skip dedup

    new_embs = {candidate_new_idxs[i]: embeddings[i] for i in range(len(new_texts))}
    ex_embs  = {id(candidate_ex_edges[i]): embeddings[len(new_texts) + i]
                for i in range(len(ex_texts))}

    # Decide which new edges to suppress
    suppress: set[int] = set()
    for i, ex in candidate_pairs:
        if i in suppress:
            continue
        emb_new = new_embs.get(i)
        emb_ex  = ex_embs.get(id(ex))
        if emb_new is None or emb_ex is None:
            continue
        sim = _cosine_sim(emb_new, emb_ex)
        if sim < 0.88:
            continue

        # High similarity — ask LLM whether to merge
        ne = new_edges[i]
        try:
            merge_input = (
                f"Edge A (existing, confidence={ex.confidence:.2f}):\n"
                f"  {_edge_description(ex.source_node_id, ex.relation, ex.target_node_id, nodes_by_id)}\n\n"
                f"Edge B (new, confidence={ne['confidence']:.2f}):\n"
                f"  {_edge_description(ne['source'], ne['relation'], ne['target'], nodes_by_id)}\n\n"
                f"Similarity score: {sim:.3f}"
            )
            raw = query_agent(KG_MERGE_SYSTEM_PROMPT, merge_input)
            # Parse first JSON object in response
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                decision = json.loads(match.group())
                if decision.get("action") == "merge":
                    # Update existing edge in place
                    ex.confidence = float(decision.get("confidence", max(ex.confidence, ne["confidence"])))
                    suppress.add(i)
        except Exception:
            pass  # On parse failure: keep both (safe default)

    db.commit()
    return [ne for j, ne in enumerate(new_edges) if j not in suppress]


# ── Main ingestion ─────────────────────────────────────────────────────────────

def ingest_retrieval_to_graph(db: Session, research_items: list[dict],
                               run_id: str, now: datetime = None) -> int:
    """
    Extract compressed facts from retrieval context and update the knowledge graph.

    - research_items: list of {title, snippet, source_url, published} dicts
    - Each batch of 20 items → 1 LLM call → structured EVENT nodes + edges
    - New edges are semantically deduplicated against existing edges
    - EVENT node metadata stores: summary, direction, magnitude, expires_at

    Returns number of net new edges added.
    """
    if not research_items:
        return 0

    if now is None:
        now = datetime.utcnow()

    # Filter to items that have meaningful content
    items = [r for r in research_items if r.get("title") and len(r.get("title", "")) > 10]
    if not items:
        return 0

    # Load existing edges once for dedup (recent runs only, cap at 500)
    existing_edges = (
        db.query(models.KGEdge)
        .order_by(models.KGEdge.created_at.desc())
        .limit(500)
        .all()
    )
    # Build nodes lookup for description generation
    all_node_ids = list({e.source_node_id for e in existing_edges} |
                        {e.target_node_id for e in existing_edges})
    existing_nodes = db.query(models.KGNode).filter(
        models.KGNode.node_id.in_(all_node_ids)
    ).all() if all_node_ids else []
    nodes_by_id: dict[str, dict] = {
        n.node_id: {"label": n.label, "type": n.node_type}
        for n in existing_nodes
    }

    total_edges_added = 0
    batches = [items[i:i + 20] for i in range(0, len(items), 20)]

    for batch in batches[:3]:  # cap at 3 LLM calls
        prompt_body = "\n\n".join(
            f"[{i + 1}] TITLE: {r['title']}\n"
            f"      SNIPPET: {r.get('snippet', '')[:200]}\n"
            f"      SOURCE: {r.get('source_url', 'N/A')}\n"
            f"      PUBLISHED: {r.get('published', 'N/A')}"
            for i, r in enumerate(batch)
        )

        try:
            raw = query_agent(KG_EXTRACT_SYSTEM_PROMPT, prompt_body)
        except Exception as e:
            print(f"[KG] LLM extraction failed: {e}")
            continue

        batch_new_edges: list[dict] = []

        for line in raw.strip().splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                fact = json.loads(line)
                event_id    = fact.get("event_id", "")
                event_label = fact.get("event_label", "")
                event_summary = fact.get("event_summary", "")
                direction   = fact.get("direction", "neutral")
                magnitude   = fact.get("magnitude", "medium")
                expires_days = int(fact.get("expires_days", 7))
                affected    = fact.get("affected_assets", [])
                entities    = fact.get("related_entities", [])
                relations   = fact.get("relations", [])

                if not event_id or not event_label:
                    continue

                # Normalise event node id
                event_node_id = f"event:{event_id[:60]}"
                expires_at = now + timedelta(days=expires_days)

                # Upsert EVENT node with rich metadata
                event_meta = {
                    "summary":   event_summary[:500],
                    "direction": direction,
                    "magnitude": magnitude,
                    "expires_days": expires_days,
                    "run_id":    run_id,
                    "extracted_at": now.isoformat(),
                }
                _upsert_node(db, event_node_id, "EVENT", event_label[:80],
                             metadata=event_meta)
                nodes_by_id[event_node_id] = {"label": event_label, "type": "EVENT"}

                # Upsert affected asset nodes (ensure they exist)
                for asset_ref in affected:
                    if asset_ref.startswith("asset:"):
                        a_node_id = asset_ref
                        a_sym = asset_ref.replace("asset:", "")
                    else:
                        a_node_id = f"asset:{asset_ref}"
                        a_sym = asset_ref
                    a_label = TICKER_LABELS.get(a_sym, a_sym)
                    _upsert_node(db, a_node_id, "ASSET", a_label, symbol=a_sym)
                    nodes_by_id[a_node_id] = {"label": a_label, "type": "ASSET"}

                    # Auto-link event → asset
                    direction_rel = "affects"
                    batch_new_edges.append({
                        "source": event_node_id,
                        "target": a_node_id,
                        "relation": direction_rel,
                        "confidence": 0.75,
                        "expires_at": expires_at,
                    })

                # Upsert related entity nodes
                for ent_ref in entities:
                    if ent_ref.startswith("entity:") or ent_ref.startswith("indicator:"):
                        ent_node_id = ent_ref
                        ent_label = ent_ref.split(":", 1)[1].replace("-", " ").replace("_", " ")
                        ent_type = "ENTITY" if ent_ref.startswith("entity:") else "INDICATOR"
                    else:
                        ent_node_id = f"entity:{ent_ref}"
                        ent_label = ent_ref
                        ent_type = "ENTITY"
                    _upsert_node(db, ent_node_id, ent_type, ent_label)
                    nodes_by_id[ent_node_id] = {"label": ent_label, "type": ent_type}

                    # Link entity → event
                    batch_new_edges.append({
                        "source": ent_node_id,
                        "target": event_node_id,
                        "relation": "caused_by",
                        "confidence": 0.65,
                        "expires_at": expires_at,
                    })

                # Explicit typed relations from LLM
                for rel in relations:
                    src_id  = rel.get("source", "")
                    tgt_id  = rel.get("target", "")
                    rtype   = rel.get("relation", "related_to")
                    conf    = float(rel.get("confidence", 0.5))
                    if not src_id or not tgt_id or conf < 0.4:
                        continue
                    if rtype not in ("affects", "correlated_with", "caused_by",
                                     "related_to", "sector_peer"):
                        continue

                    # Ensure nodes exist
                    for nid in [src_id, tgt_id]:
                        if nid not in nodes_by_id:
                            ntype = ("ASSET" if nid.startswith("asset:") else
                                     "INDICATOR" if nid.startswith("indicator:") else
                                     "EVENT" if nid.startswith("event:") else "ENTITY")
                            nlabel = nid.split(":", 1)[1].replace("-", " ") if ":" in nid else nid
                            nsym = nid.replace("asset:", "") if nid.startswith("asset:") else None
                            _upsert_node(db, nid, ntype, nlabel, symbol=nsym)
                            nodes_by_id[nid] = {"label": nlabel, "type": ntype}

                    batch_new_edges.append({
                        "source":     src_id,
                        "target":     tgt_id,
                        "relation":   rtype,
                        "confidence": conf,
                        "expires_at": expires_at,
                    })

            except Exception:
                continue

        # Semantic dedup against existing edges
        filtered_edges = _deduplicate_edges(db, batch_new_edges, existing_edges, nodes_by_id)

        # Insert net-new edges
        for ne in filtered_edges:
            db.add(models.KGEdge(
                source_node_id=ne["source"],
                target_node_id=ne["target"],
                relation=ne["relation"],
                confidence=ne["confidence"],
                source_run_id=run_id,
                expires_at=ne.get("expires_at"),
            ))
            total_edges_added += 1

        db.commit()

        # Extend existing_edges for subsequent batch dedup
        existing_edges = (
            db.query(models.KGEdge)
            .order_by(models.KGEdge.created_at.desc())
            .limit(500)
            .all()
        )

    return total_edges_added


# ── Subgraph retrieval ─────────────────────────────────────────────────────────

def get_ticker_subgraph(db: Session, ticker: str, hops: int = 2) -> dict:
    """BFS from asset:<ticker>, deduplicating edges by max confidence."""
    start_node_id = f"asset:{ticker}"
    visited_ids: set[str] = {start_node_id}
    frontier: set[str] = {start_node_id}
    all_edges: list = []
    now = datetime.utcnow()

    for _ in range(min(hops, 3)):
        if not frontier:
            break
        edges = db.query(models.KGEdge).filter(
            or_(
                models.KGEdge.source_node_id.in_(list(frontier)),
                models.KGEdge.target_node_id.in_(list(frontier)),
            )
        ).all()
        # Skip expired edges
        active = [e for e in edges if e.expires_at is None or e.expires_at > now]
        all_edges.extend(active)
        new_ids: set[str] = set()
        for e in active:
            new_ids.add(e.source_node_id)
            new_ids.add(e.target_node_id)
        frontier = new_ids - visited_ids
        visited_ids.update(new_ids)

    nodes = db.query(models.KGNode).filter(
        models.KGNode.node_id.in_(list(visited_ids))
    ).all()

    seen_edges: dict[tuple, models.KGEdge] = {}
    for e in all_edges:
        key = (e.source_node_id, e.target_node_id, e.relation)
        if key not in seen_edges or e.confidence > seen_edges[key].confidence:
            seen_edges[key] = e

    return {
        "nodes":  [_node_to_dict(n) for n in nodes],
        "edges":  [_edge_to_dict(e) for e in seen_edges.values()],
        "center": start_node_id,
    }


def get_full_graph(db: Session, limit_nodes: int = 500) -> dict:
    """Return all non-expired nodes/edges, capped for performance."""
    now = datetime.utcnow()
    nodes = db.query(models.KGNode).order_by(
        models.KGNode.last_seen_at.desc()
    ).limit(limit_nodes).all()
    node_ids = [n.node_id for n in nodes]

    edges = db.query(models.KGEdge).filter(
        models.KGEdge.source_node_id.in_(node_ids),
        models.KGEdge.target_node_id.in_(node_ids),
    ).filter(
        or_(models.KGEdge.expires_at.is_(None), models.KGEdge.expires_at > now)
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
    Format the ticker subgraph as structured markdown.
    EVENT nodes include their compressed summary and direction.
    Returns empty string if graph is empty for this ticker.
    """
    nodes = subgraph.get("nodes", [])
    edges = subgraph.get("edges", [])
    if len(nodes) <= 1:
        return ""

    nodes_by_id = {n["id"]: n for n in nodes}
    center = subgraph.get("center", "")
    center_label = nodes_by_id.get(center, {}).get("label", center)

    lines = [f"## Knowledge Graph: {center_label} ({len(edges)} active relationships)\n"]

    # Show EVENT nodes first — they carry compressed market intelligence
    event_nodes = [n for n in nodes if n["type"] == "EVENT"]
    if event_nodes:
        lines.append("**Recent Market Events (compressed):**")
        for n in sorted(event_nodes, key=lambda x: x.get("last_seen_at") or "", reverse=True)[:8]:
            meta = n.get("metadata", {})
            direction  = meta.get("direction", "")
            magnitude  = meta.get("magnitude", "")
            summary    = meta.get("summary", "")
            dir_icon   = "▲" if direction == "bullish" else "▼" if direction == "bearish" else "●"
            mag_tag    = f"[{magnitude.upper()}]" if magnitude else ""
            lines.append(f"  {dir_icon} **{n['label']}** {mag_tag}")
            if summary:
                lines.append(f"    {summary[:250]}")
        lines.append("")

    # Typed relationships grouped by relation
    by_relation: dict[str, list] = {}
    for e in edges:
        by_relation.setdefault(e["relation"], []).append(e)

    for relation, rel_edges in sorted(by_relation.items()):
        label = relation.replace("_", " ").title()
        lines.append(f"**{label}:**")
        for e in sorted(rel_edges, key=lambda x: -x["confidence"])[:5]:
            src_label = nodes_by_id.get(e["source"], {}).get("label", e["source"])
            tgt_label = nodes_by_id.get(e["target"], {}).get("label", e["target"])
            lines.append(f"  - {src_label} → {tgt_label} ({int(e['confidence'] * 100)}%)")
        lines.append("")

    return "\n".join(lines)


def build_kg_context_for_ticker(db: Session, ticker: str) -> str:
    """Convenience wrapper: fetch subgraph and format for agent injection."""
    try:
        subgraph = get_ticker_subgraph(db, ticker, hops=2)
        return format_subgraph_for_agent(subgraph)
    except Exception as e:
        print(f"[KG] Subgraph failed for {ticker}: {e}")
        return ""


# ── Serialization helpers ──────────────────────────────────────────────────────

def _node_to_dict(n: models.KGNode) -> dict:
    return {
        "id":           n.node_id,
        "type":         n.node_type,
        "label":        n.label,
        "symbol":       n.symbol,
        "metadata":     json.loads(n.metadata_json or "{}"),
        "last_seen_at": n.last_seen_at.isoformat() if n.last_seen_at else None,
        "created_at":   n.created_at.isoformat() if n.created_at else None,
    }


def _edge_to_dict(e: models.KGEdge) -> dict:
    return {
        "source":     e.source_node_id,
        "target":     e.target_node_id,
        "relation":   e.relation,
        "confidence": round(e.confidence, 3),
        "expires_at": e.expires_at.isoformat() if e.expires_at else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
