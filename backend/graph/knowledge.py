"""
Persistent Knowledge Graph for the multi-agent trading system.

Design principles:
- Nodes: ASSET (tickers), ENTITY (companies/banks/govts),
  INDICATOR (VIX/DXY/yields), EVENT (compressed market facts),
  MARKET (regional market nodes: US, India, Crypto, MCX)
- Edges carry typed relationships with confidence scores

Ingest pipeline (per run) — two-stage, no timeout needed:
  Stage 1 — Compress  (many tiny parallel LLM calls, ~5s each):
    Split articles into batches of 15 → each batch → LLM extracts
    "TICKER | FACT | DIRECTION" lines. No JSON schema, just dense text.
    All batches run in parallel.

  Stage 2 — Graph extract (per-ticker parallel LLM calls):
    Group compressed facts by ticker → one LLM call per ticker →
    outputs KG nodes/edges JSON. Small focused input, fast output.
    All tickers run in parallel.

  Stage 3 — Auto-market links:
    Assets under India/Crypto/MCX/US market nodes are automatically
    linked to their market node and to any events mentioning their region.
"""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import or_
import core.models as models
from agents.llm import query_agent


# ── Constants ──────────────────────────────────────────────────────────────────

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

# Market → constituent tickers
MARKET_TICKERS: dict[str, list[str]] = {
    "US":     ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META", "AMD"],
    "India":  ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
               "ICICIBANK.NS", "WIPRO.NS", "SBIN.NS", "TATAMOTORS.NS"],
    "Crypto": ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD",
               "XRP-USD", "DOGE-USD", "ADA-USD"],
    "MCX":    ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F"],
}

MARKET_LABELS: dict[str, str] = {
    "US":     "US Equities",
    "India":  "India Equities (NSE)",
    "Crypto": "Cryptocurrency",
    "MCX":    "Commodities (MCX/NYMEX)",
}

# Keywords that signal a news item is relevant to each market
MARKET_KEYWORDS: dict[str, list[str]] = {
    "India":  ["india", "nifty", "sensex", "nse", "bse", "rupee", "rbi",
               "sebi", "mumbai", "dalal", "reliance", "tcs", "infosys",
               "hdfc", "icici", "wipro", "sbi", "tata"],
    "Crypto": ["bitcoin", "btc", "ethereum", "eth", "crypto", "solana",
               "binance", "coinbase", "defi", "blockchain", "web3",
               "altcoin", "nft", "stablecoin"],
    "MCX":    ["gold", "silver", "crude", "oil", "natural gas", "copper",
               "commodity", "commodities", "opec", "wti", "brent",
               "precious metals", "mcx"],
    "US":     ["fed", "federal reserve", "nasdaq", "s&p", "dow", "nyse",
               "treasury", "fomc", "wall street", "sec", "earnings",
               "gdp", "inflation", "rate hike"],
}


# ── LLM prompts ────────────────────────────────────────────────────────────────

# Stage 1: compress articles into dense fact lines — no JSON, just fast text
KG_COMPRESS_PROMPT = """You are a financial news analyst. Extract tradeable facts from these news articles.

For each relevant fact output ONE line in this exact format:
TICKER: <symbol or MACRO> | FACT: <one sentence with specific numbers/percentages> | DIR: bullish|bearish|neutral | CATALYST: earnings|macro|geopolitical|regulatory|technical|sentiment

Rules:
- Only output lines matching the format above, nothing else
- Skip vague facts with no numbers or price-moving information
- Use real ticker symbols (NVDA, HDFCBANK.NS, BTC-USD, GC=F) or MACRO for broad market facts
- Max 8 lines per batch — prioritise the most price-moving facts"""

# Stage 2: extract KG nodes/edges from compressed facts for a specific ticker
KG_EXTRACT_PROMPT = """You are a financial knowledge graph builder.

You receive compressed market facts about a specific ticker and an existing graph snapshot.
Extract net-new events and relationships NOT already in the graph.

For each distinct new fact output ONE JSON object per line (no preamble):

{"event_id":"<slug-YYYY-MM-DD>","event_label":"<10 words max>","event_summary":"<2-3 sentences with key numbers>","direction":"bullish|bearish|neutral","magnitude":"high|medium|low","expires_days":3,"catalyst_type":"earnings|macro|geopolitical|regulatory|technical|sentiment|sector","key_numbers":["Oil +5%","VIX 28"],"price_targets":["GS raises NVDA to $180"],"affected_assets":["NVDA","GC=F"],"affected_markets":["US","India","Crypto","MCX"],"related_entities":["entity:FederalReserve"],"source_region":"US|India|Global|Crypto|Europe|Asia","relations":[{"source":"asset:NVDA","target":"event:slug","relation":"affects","confidence":0.8,"reason":"direct earnings impact"}]}

Node IDs: asset:NVDA | entity:FederalReserve | indicator:VIX | market:US | event:slug-YYYY-MM-DD
Relations: affects | correlated_with | caused_by | related_to | sector_peer
Rules: skip vague facts, include specific numbers, expires_days: breaking=2 earnings=7 macro=14 structural=30, max 15 events per ticker."""


# ── Node helpers ───────────────────────────────────────────────────────────────

def _upsert_node(db: Session, node_id: str, node_type: str, label: str,
                 symbol: str = None, metadata: dict = None) -> bool:
    """Returns True if a new node was created, False if an existing one was updated."""
    existing = db.query(models.KGNode).filter(models.KGNode.node_id == node_id).first()
    if existing:
        existing.last_seen_at = datetime.utcnow()
        if metadata:
            try:
                old_meta = json.loads(existing.metadata_json or "{}")
                old_meta.update(metadata)
                existing.metadata_json = json.dumps(old_meta)
            except Exception:
                pass
        return False
    else:
        node = models.KGNode(
            node_id=node_id,
            node_type=node_type,
            label=label,
            symbol=symbol,
            metadata_json=json.dumps(metadata or {}),
        )
        db.add(node)
        try:
            with db.begin_nested():
                db.flush()
            return True
        except Exception:
            # Duplicate or constraint violation — node already exists
            return False


def upsert_asset_nodes(db: Session, tickers: list[str]) -> None:
    """Ensure all enabled tickers and market nodes exist."""
    for ticker in tickers:
        node_id = f"asset:{ticker}"
        label = TICKER_LABELS.get(ticker, ticker)
        _upsert_node(db, node_id, "ASSET", label, symbol=ticker)

    # Ensure market nodes exist
    for market, label in MARKET_LABELS.items():
        _upsert_node(db, f"market:{market}", "MARKET", label)

    db.commit()

    # Link each asset to its market node (permanent structural edges, no expiry)
    for market, tickers_in_market in MARKET_TICKERS.items():
        market_node_id = f"market:{market}"
        for ticker in tickers_in_market:
            if ticker not in tickers:
                continue  # only link enabled tickers
            asset_node_id = f"asset:{ticker}"
            exists = db.query(models.KGEdge).filter(
                models.KGEdge.source_node_id == asset_node_id,
                models.KGEdge.target_node_id == market_node_id,
                models.KGEdge.relation == "sector_peer",
            ).first()
            if not exists:
                db.add(models.KGEdge(
                    source_node_id=asset_node_id,
                    target_node_id=market_node_id,
                    relation="sector_peer",
                    confidence=1.0,
                    source_run_id="__system__",
                    expires_at=None,  # permanent
                ))
    db.commit()


# ── Graph snapshot for LLM context ────────────────────────────────────────────

def _build_graph_snapshot(db: Session, max_nodes: int = 80) -> str:
    """
    Serialize the current graph as a compact text snapshot for the LLM.
    Shows recent EVENT nodes with summaries + key edges.
    """
    now = datetime.utcnow()

    # Recent non-expired event nodes
    event_nodes = (
        db.query(models.KGNode)
        .filter(models.KGNode.node_type == "EVENT")
        .order_by(models.KGNode.last_seen_at.desc())
        .limit(max_nodes)
        .all()
    )

    # All asset/market/entity nodes
    structural_nodes = (
        db.query(models.KGNode)
        .filter(models.KGNode.node_type.in_(["ASSET", "MARKET", "ENTITY", "INDICATOR"]))
        .order_by(models.KGNode.last_seen_at.desc())
        .limit(60)
        .all()
    )

    all_node_ids = [n.node_id for n in event_nodes + structural_nodes]

    # Active edges
    edges = db.query(models.KGEdge).filter(
        models.KGEdge.source_node_id.in_(all_node_ids),
        models.KGEdge.target_node_id.in_(all_node_ids),
        or_(models.KGEdge.expires_at.is_(None), models.KGEdge.expires_at > now),
    ).order_by(models.KGEdge.confidence.desc()).limit(200).all()

    nodes_by_id = {n.node_id: n for n in event_nodes + structural_nodes}

    lines = ["=== EXISTING GRAPH SNAPSHOT ===\n"]

    if event_nodes:
        lines.append("## Recent Events (already in graph — do not re-emit these):")
        for n in event_nodes[:30]:
            meta = json.loads(n.metadata_json or "{}")
            direction = meta.get("direction", "")
            summary = meta.get("summary", "")[:120]
            dir_icon = "▲" if direction == "bullish" else "▼" if direction == "bearish" else "●"
            lines.append(f"  {dir_icon} [{n.node_id}] {n.label}")
            if summary:
                lines.append(f"      {summary}")
        lines.append("")

    if edges:
        lines.append("## Key Relationships (already in graph):")
        for e in edges[:60]:
            src = nodes_by_id.get(e.source_node_id)
            tgt = nodes_by_id.get(e.target_node_id)
            src_label = src.label if src else e.source_node_id
            tgt_label = tgt.label if tgt else e.target_node_id
            lines.append(f"  {src_label} --[{e.relation}]--> {tgt_label} ({int(e.confidence*100)}%)")
        lines.append("")

    if not event_nodes and not edges:
        lines.append("(Graph is empty — extract all facts from the news)")

    return "\n".join(lines)


# ── Stage 1: compress a batch of articles → fact lines ────────────────────────

def _compress_batch(batch: list[dict], run_id: str | None = None) -> list[str]:
    """
    Fast LLM call: 15 article titles+snippets → dense TICKER|FACT|DIR lines.
    No JSON, no schema — just plain text. Completes in ~5s on free tier.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    articles = []
    for i, r in enumerate(batch):
        if not r.get("title"):
            continue
        snippet = r.get("snippet", "").strip()[:150]
        articles.append(f"[{i+1}] {r['title']}" + (f" — {snippet}" if snippet else ""))
    if not articles:
        return []
    news_block = "\n".join(articles)
    prompt_body = f"TODAY: {today}\n\n=== NEWS BATCH ===\n{news_block}"

    raw = query_agent(KG_COMPRESS_PROMPT, prompt_body,
                      caller="kg_compress", run_id=run_id,
                      timeout=30, retries=1)
    if not raw:
        return []
    lines = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if line.startswith("TICKER:") and "| FACT:" in line and "| DIR:" in line:
            lines.append(line)
    return lines


# ── Stage 2: extract KG facts for one ticker from compressed lines ─────────────

def _extract_ticker_facts(ticker: str, fact_lines: list[str],
                           graph_snapshot: str, run_id: str | None = None) -> list[dict]:
    """
    One LLM call per ticker: compressed fact lines + graph snapshot → KG JSON events.
    Input is tiny (just facts relevant to this ticker) → fast and focused.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    facts_block = "\n".join(fact_lines)
    prompt_body = (
        f"TODAY: {today}\n"
        f"FOCUS TICKER: {ticker}\n\n"
        f"{graph_snapshot}\n\n"
        f"=== COMPRESSED FACTS ===\n{facts_block}"
    )
    raw = query_agent(KG_EXTRACT_PROMPT, prompt_body,
                      caller="kg_extract", run_id=run_id,
                      timeout=30, retries=1)
    if not raw:
        return []
    facts = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            fact = json.loads(line)
            if fact.get("event_id") and fact.get("event_label"):
                facts.append(fact)
        except Exception:
            continue
    return facts


# ── Auto-market linking ────────────────────────────────────────────────────────

def _detect_markets_for_event(event_label: str, event_summary: str,
                               affected_assets: list[str]) -> list[str]:
    """
    Detect which market nodes an event should be linked to.
    Uses keyword matching on label+summary AND asset membership.
    """
    text = (event_label + " " + event_summary).lower()
    detected = set()

    # Keyword-based detection
    for market, keywords in MARKET_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            detected.add(market)

    # Asset-based detection
    for asset_ref in affected_assets:
        sym = asset_ref.replace("asset:", "").upper()
        for market, tickers in MARKET_TICKERS.items():
            if sym in tickers or sym + ".NS" in tickers or sym + "-USD" in tickers:
                detected.add(market)

    return list(detected)


# ── Main ingestion ─────────────────────────────────────────────────────────────

def ingest_retrieval_to_graph(db: Session, research_items: list[dict],
                               run_id: str, now: datetime = None) -> int:
    """
    Two-stage parallel KG ingest — no timeout needed:

    Stage 1 — Compress (parallel, ~5s per batch):
      Split articles into batches of 15 → each batch → fast LLM call →
      TICKER|FACT|DIR lines. No JSON schema. All batches in parallel.

    Stage 2 — Graph extract (parallel, one call per ticker, ~5s each):
      Group compressed facts by ticker → one focused LLM call per ticker →
      KG nodes/edges JSON. All tickers run in parallel.

    Returns number of new edges added.
    """
    if not research_items:
        return 0

    if now is None:
        now = datetime.utcnow()

    items = [r for r in research_items if r.get("title") and len(r.get("title", "")) > 10]
    if not items:
        return 0

    # ── Stage 1: compress articles → fact lines ───────────────────────────────
    # Hard cap: process at most 60 articles (4 batches) to stay within Vercel's
    # 5-minute function limit. Articles are already sorted by recency so we
    # take the freshest ones.
    STAGE1_ARTICLE_CAP = 60
    STAGE1_TIMEOUT_S   = 60   # wall-clock budget for all Stage 1 batches

    capped_items = items[:STAGE1_ARTICLE_CAP]
    t0 = time.time()
    batches = [capped_items[i:i+15] for i in range(0, len(capped_items), 15)]
    print(f"[KG] Stage 1: compressing {len(capped_items)} articles in {len(batches)} parallel batches…")

    all_fact_lines: list[str] = []
    with ThreadPoolExecutor(max_workers=min(len(batches), 4)) as pool:
        futures = [pool.submit(_compress_batch, batch, run_id) for batch in batches]
        try:
            for f in as_completed(futures, timeout=STAGE1_TIMEOUT_S):
                try:
                    all_fact_lines.extend(f.result())
                except Exception as e:
                    print(f"[KG] Compress batch failed: {e}")
        except FuturesTimeoutError:
            print("[KG] Stage 1 wall-clock budget exceeded — using facts collected so far")
    print(f"[KG] Stage 1 done in {time.time()-t0:.1f}s — {len(all_fact_lines)} fact lines extracted")

    if not all_fact_lines:
        return 0

    # ── Stage 2: group facts by ticker, extract KG per ticker ─────────────────
    STAGE2_TICKER_CAP  = 15   # max tickers to run Stage 2 for
    STAGE2_TIMEOUT_S   = 90   # wall-clock budget for all Stage 2 calls

    # Build graph snapshot once (pure DB, fast)
    graph_snapshot = _build_graph_snapshot(db)

    # Group fact lines by ticker symbol
    ticker_facts: dict[str, list[str]] = {}
    macro_facts: list[str] = []
    for line in all_fact_lines:
        # Parse: "TICKER: NVDA | FACT: ... | DIR: ..."
        try:
            ticker_part = line.split("|")[0].replace("TICKER:", "").strip()
        except Exception:
            continue
        if not ticker_part or ticker_part == "MACRO":
            macro_facts.append(line)
        else:
            ticker_facts.setdefault(ticker_part, []).append(line)

    # Each ticker also gets the macro facts for broader context
    # Build per-ticker fact lists (own facts + macro, capped at 20 lines)
    # Prioritise tickers with the most facts, cap total tickers at STAGE2_TICKER_CAP
    extract_targets: dict[str, list[str]] = {}
    sorted_tickers = sorted(ticker_facts.items(), key=lambda x: -len(x[1]))
    for ticker, lines in sorted_tickers[:STAGE2_TICKER_CAP]:
        extract_targets[ticker] = (lines + macro_facts)[:20]

    # If there are only macro facts with no specific tickers, use a MACRO bucket
    if not extract_targets and macro_facts:
        extract_targets["MACRO"] = macro_facts[:20]

    t1 = time.time()
    print(f"[KG] Stage 2: extracting KG for {len(extract_targets)} ticker(s) in parallel…")

    all_facts: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(extract_targets), 4)) as pool:
        futures = {
            pool.submit(_extract_ticker_facts, ticker, lines, graph_snapshot, run_id): ticker
            for ticker, lines in extract_targets.items()
        }
        try:
            for f in as_completed(futures, timeout=STAGE2_TIMEOUT_S):
                ticker = futures[f]
                try:
                    facts = f.result()
                    all_facts.extend(facts)
                    print(f"[KG]   {ticker}: {len(facts)} events")
                except Exception as e:
                    print(f"[KG]   {ticker} extract failed: {e}")
        except FuturesTimeoutError:
            print("[KG] Stage 2 wall-clock budget exceeded — using facts collected so far")
    print(f"[KG] Stage 2 done in {time.time()-t1:.1f}s — {len(all_facts)} total facts")

    facts = all_facts

    if not facts:
        return 0

    # ── Write facts to DB ──────────────────────────────────────────────────────
    nodes_by_id: dict[str, dict] = {}
    total_edges_added = 0
    total_nodes_added = 0

    for fact in facts:
        event_id      = fact["event_id"]
        event_label   = fact.get("event_label", "")
        event_summary = fact.get("event_summary", "")
        direction     = fact.get("direction", "neutral")
        magnitude     = fact.get("magnitude", "medium")
        expires_days  = int(fact.get("expires_days", 7))
        catalyst_type = fact.get("catalyst_type", "")
        key_numbers   = fact.get("key_numbers", [])
        price_targets = fact.get("price_targets", [])
        source_region = fact.get("source_region", "")
        affected      = fact.get("affected_assets", [])
        markets       = fact.get("affected_markets", [])
        entities      = fact.get("related_entities", [])
        relations     = fact.get("relations", [])

        event_node_id = f"event:{event_id[:60]}"
        expires_at = now + timedelta(days=expires_days)

        is_new = _upsert_node(db, event_node_id, "EVENT", event_label[:80], metadata={
            "summary":       event_summary[:600],
            "direction":     direction,
            "magnitude":     magnitude,
            "expires_days":  expires_days,
            "catalyst_type": catalyst_type,
            "key_numbers":   key_numbers[:8],
            "price_targets": price_targets[:5],
            "source_region": source_region,
            "run_id":        run_id,
            "extracted_at":  now.isoformat() + "Z",
        })
        if is_new:
            total_nodes_added += 1
        nodes_by_id[event_node_id] = {"label": event_label, "type": "EVENT"}

        # Affected assets → event edges
        for asset_ref in affected:
            a_node_id = asset_ref if asset_ref.startswith("asset:") else f"asset:{asset_ref}"
            a_sym = a_node_id.replace("asset:", "")
            a_label = TICKER_LABELS.get(a_sym, a_sym)
            if _upsert_node(db, a_node_id, "ASSET", a_label, symbol=a_sym):
                total_nodes_added += 1
            nodes_by_id[a_node_id] = {"label": a_label, "type": "ASSET"}
            db.add(models.KGEdge(
                source_node_id=event_node_id, target_node_id=a_node_id,
                relation="affects", confidence=0.75,
                source_run_id=run_id, expires_at=expires_at,
            ))
            total_edges_added += 1

        # Entity nodes → event edges
        for ent_ref in entities:
            if ent_ref.startswith("entity:") or ent_ref.startswith("indicator:"):
                ent_node_id = ent_ref
                ent_label = ent_ref.split(":", 1)[1].replace("-", " ").replace("_", " ")
                ent_type = "ENTITY" if ent_ref.startswith("entity:") else "INDICATOR"
            else:
                ent_node_id = f"entity:{ent_ref}"
                ent_label = ent_ref
                ent_type = "ENTITY"
            if _upsert_node(db, ent_node_id, ent_type, ent_label):
                total_nodes_added += 1
            nodes_by_id[ent_node_id] = {"label": ent_label, "type": ent_type}
            db.add(models.KGEdge(
                source_node_id=ent_node_id, target_node_id=event_node_id,
                relation="caused_by", confidence=0.65,
                source_run_id=run_id, expires_at=expires_at,
            ))
            total_edges_added += 1

        # Explicit relations from LLM
        for rel in relations:
            src_id = rel.get("source", "")
            tgt_id = rel.get("target", "")
            rtype  = rel.get("relation", "related_to")
            conf   = float(rel.get("confidence", 0.5))
            if not src_id or not tgt_id or conf < 0.4:
                continue
            if rtype not in ("affects", "correlated_with", "caused_by",
                             "related_to", "sector_peer"):
                continue
            for nid in [src_id, tgt_id]:
                if nid not in nodes_by_id:
                    ntype = ("ASSET" if nid.startswith("asset:") else
                             "INDICATOR" if nid.startswith("indicator:") else
                             "MARKET" if nid.startswith("market:") else
                             "EVENT" if nid.startswith("event:") else "ENTITY")
                    nlabel = nid.split(":", 1)[1].replace("-", " ") if ":" in nid else nid
                    nsym = nid.replace("asset:", "") if nid.startswith("asset:") else None
                    _upsert_node(db, nid, ntype, nlabel, symbol=nsym)
                    nodes_by_id[nid] = {"label": nlabel, "type": ntype}
            db.add(models.KGEdge(
                source_node_id=src_id, target_node_id=tgt_id,
                relation=rtype, confidence=conf,
                source_run_id=run_id, expires_at=expires_at,
            ))
            total_edges_added += 1

        # ── Auto-market linking ────────────────────────────────────────────────
        # Detect which markets this event relates to (keyword + asset membership)
        auto_markets = _detect_markets_for_event(event_label, event_summary, affected)
        # Merge with explicitly declared markets from LLM
        all_markets = set(auto_markets) | set(m for m in markets if m in MARKET_LABELS)

        for market in all_markets:
            market_node_id = f"market:{market}"
            # Ensure market node exists
            _upsert_node(db, market_node_id, "MARKET", MARKET_LABELS.get(market, market))
            nodes_by_id[market_node_id] = {"label": MARKET_LABELS.get(market, market), "type": "MARKET"}

            # Link event → market
            db.add(models.KGEdge(
                source_node_id=event_node_id, target_node_id=market_node_id,
                relation="affects", confidence=0.80,
                source_run_id=run_id, expires_at=expires_at,
            ))
            total_edges_added += 1

            # Link all affected assets that belong to this market → market node
            for asset_ref in affected:
                a_sym = asset_ref.replace("asset:", "").upper()
                market_tickers_upper = [t.upper() for t in MARKET_TICKERS.get(market, [])]
                if a_sym in market_tickers_upper:
                    a_node_id = f"asset:{asset_ref.replace('asset:', '')}"
                    # event → asset already added; add asset → market if not already structural
                    exists = db.query(models.KGEdge).filter(
                        models.KGEdge.source_node_id == a_node_id,
                        models.KGEdge.target_node_id == market_node_id,
                        models.KGEdge.relation == "sector_peer",
                    ).first()
                    if not exists:
                        db.add(models.KGEdge(
                            source_node_id=a_node_id,
                            target_node_id=market_node_id,
                            relation="sector_peer", confidence=1.0,
                            source_run_id="__system__", expires_at=None,
                        ))
                        total_edges_added += 1

    try:
        db.commit()
    except Exception as e:
        print(f"[KG] DB commit failed: {e}")
        db.rollback()

    return total_edges_added, total_nodes_added


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
    nodes = subgraph.get("nodes", [])
    edges = subgraph.get("edges", [])
    if len(nodes) <= 1:
        return ""

    nodes_by_id = {n["id"]: n for n in nodes}
    center = subgraph.get("center", "")
    center_label = nodes_by_id.get(center, {}).get("label", center)

    lines = [f"## Knowledge Graph: {center_label} ({len(edges)} active relationships)\n"]

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
    try:
        subgraph = get_ticker_subgraph(db, ticker, hops=2)
        return format_subgraph_for_agent(subgraph)
    except Exception as e:
        print(f"[KG] Subgraph failed for {ticker}: {e}")
        return ""


# ── LLM-driven graph traversal ─────────────────────────────────────────────────

_KG_TRAVERSE_SEED_PROMPT = """You are a financial knowledge graph navigator.

You will receive a list of ASSET nodes and their direct edges. Each edge shows a connected node ID.
Your job: decide which connected nodes are worth expanding to find the most actionable market intelligence.

Prioritise:
- Nodes connected to multiple assets (high cross-asset impact)
- Event nodes that suggest price catalysts (earnings, macro shocks, regulatory)
- Anything with HIGH magnitude

Respond with ONLY a JSON object in this exact format — no preamble:
{"expand": ["node_id_1", "node_id_2", ...], "reason": "one sentence"}

Rules:
- List at most 12 node IDs to expand
- Only pick IDs that appear in the edges shown
- If the current graph already has sufficient context, return {"expand": [], "reason": "sufficient"}"""

_KG_TRAVERSE_FINAL_PROMPT = """You are a financial knowledge graph analyst.

You have traversed a knowledge graph and collected nodes and relationships. Now produce a ranked analysis.

For each asset that has meaningful events/relationships, output ONE JSON object per line:
{"ticker":"NVDA","direction":"bullish|bearish|neutral","conviction":"high|medium|low","key_events":["slug1","slug2"],"reasoning":"2-3 sentences citing specific graph facts and numbers"}

Rules:
- Only include assets with at least one supporting event in the graph
- Order by conviction then recency of supporting events
- Max 8 tickers
- Output only JSON lines, no preamble"""


def _serialize_assets_with_edges(db: Session, allowed_tickers: list[str]) -> tuple[str, dict, list]:
    """
    Fetch all ASSET nodes for allowed_tickers + their direct 1-hop edges.
    Returns (text_block, nodes_by_id dict).
    """
    now = datetime.utcnow()
    asset_ids = [f"asset:{t}" for t in allowed_tickers]
    nodes = db.query(models.KGNode).filter(models.KGNode.node_id.in_(asset_ids)).all()
    nodes_by_id: dict[str, dict] = {n.node_id: _node_to_dict(n) for n in nodes}

    edges = db.query(models.KGEdge).filter(
        or_(
            models.KGEdge.source_node_id.in_(asset_ids),
            models.KGEdge.target_node_id.in_(asset_ids),
        ),
        or_(models.KGEdge.expires_at.is_(None), models.KGEdge.expires_at > now),
    ).order_by(models.KGEdge.confidence.desc()).limit(300).all()

    lines = ["## Asset Nodes and Direct Edges\n"]
    for node in nodes:
        lines.append(f"NODE {node.node_id} | {node.label} | updated:{node.last_seen_at.strftime('%Y-%m-%dT%H:%M') if node.last_seen_at else '?'}")
    lines.append("")
    for e in edges:
        age = ""
        if e.created_at:
            h = (now - e.created_at).total_seconds() / 3600
            age = f"{int(h)}h ago" if h < 48 else f"{int(h/24)}d ago"
        lines.append(f"EDGE {e.source_node_id} --[{e.relation} {int(e.confidence*100)}%]--> {e.target_node_id} ({age})")

    return "\n".join(lines), nodes_by_id, edges


def _fetch_and_serialize_nodes(db: Session, node_ids: list[str],
                                already_loaded: dict, now: datetime) -> str:
    """
    Fetch the requested node IDs (skipping already loaded ones), return compact text.
    Includes each node's metadata summary + their outgoing edges.
    """
    new_ids = [nid for nid in node_ids if nid not in already_loaded]
    if not new_ids:
        return ""

    nodes = db.query(models.KGNode).filter(models.KGNode.node_id.in_(new_ids)).all()
    for n in nodes:
        already_loaded[n.node_id] = _node_to_dict(n)

    edges = db.query(models.KGEdge).filter(
        or_(
            models.KGEdge.source_node_id.in_(new_ids),
            models.KGEdge.target_node_id.in_(new_ids),
        ),
        or_(models.KGEdge.expires_at.is_(None), models.KGEdge.expires_at > now),
    ).order_by(models.KGEdge.confidence.desc()).limit(200).all()

    lines = ["\n## Expanded Nodes\n"]
    for n in nodes:
        meta = json.loads(n.metadata_json or "{}")
        direction = meta.get("direction", "")
        summary = meta.get("summary", "")[:200]
        magnitude = meta.get("magnitude", "")
        key_nums = ", ".join(meta.get("key_numbers", [])[:4])
        age = ""
        if n.last_seen_at:
            h = (now - n.last_seen_at).total_seconds() / 3600
            age = f"{int(h)}h ago" if h < 48 else f"{int(h/24)}d ago"
        dir_icon = "▲" if direction == "bullish" else "▼" if direction == "bearish" else "●"
        lines.append(f"\nNODE {n.node_id} | {n.label} | {dir_icon} {direction} [{magnitude}] | {age}")
        if summary:
            lines.append(f"  Summary: {summary}")
        if key_nums:
            lines.append(f"  Numbers: {key_nums}")
    lines.append("")
    for e in edges:
        age = ""
        if e.created_at:
            h = (now - e.created_at).total_seconds() / 3600
            age = f"{int(h)}h ago" if h < 48 else f"{int(h/24)}d ago"
        lines.append(f"EDGE {e.source_node_id} --[{e.relation} {int(e.confidence*100)}%]--> {e.target_node_id} ({age})")

    return "\n".join(lines)


def llm_traverse_graph(db: Session, allowed_tickers: list[str],
                       run_id: str | None = None) -> tuple[list[str], str]:
    """
    LLM-driven iterative graph traversal.

    Round 0: show LLM all ASSET nodes + their direct edges
    Round 1: LLM picks which neighbor nodes to expand → fetch + show
    Round 2: (optional) LLM picks further expansions
    Final:   LLM analyses full collected subgraph → ranked tickers + reasoning

    Returns (ranked_ticker_list, kg_context_string_for_agents).
    """
    if not allowed_tickers:
        return [], ""

    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d %H:%M UTC")

    # ── Round 0: seed — assets + direct edges ─────────────────────────────────
    seed_text, nodes_by_id, _ = _serialize_assets_with_edges(db, allowed_tickers)
    collected_text = seed_text

    # ── Rounds 1-2: LLM-controlled expansion ──────────────────────────────────
    MAX_ROUNDS = 4
    for round_num in range(1, MAX_ROUNDS + 1):
        prompt_body = f"TODAY: {today}\n\n{collected_text}"
        raw = query_agent(_KG_TRAVERSE_SEED_PROMPT, prompt_body,
                          caller="kg_traverse", run_id=run_id,
                          timeout=20, retries=1)
        if not raw:
            break
        try:
            decision = json.loads(raw.strip())
        except Exception:
            # Try to find JSON in the response
            m = re.search(r'\{.*\}', raw, re.DOTALL)
            if not m:
                break
            try:
                decision = json.loads(m.group(0))
            except Exception:
                break

        expand_ids = decision.get("expand", [])
        reason = decision.get("reason", "")
        print(f"[KG traverse] Round {round_num}: expanding {len(expand_ids)} nodes — {reason}")

        if not expand_ids:
            break

        expanded = _fetch_and_serialize_nodes(db, expand_ids, nodes_by_id, now)
        if expanded:
            collected_text += expanded

    # ── Final: LLM analyses full collected subgraph → ranked output ───────────
    final_body = f"TODAY: {today}\n\n{collected_text}"
    raw_final = query_agent(_KG_TRAVERSE_FINAL_PROMPT, final_body,
                            caller="kg_traverse_final", run_id=run_id,
                            timeout=30, retries=1)

    ranked_tickers: list[str] = []
    agent_lines: list[str] = ["## Knowledge Graph Analysis (LLM-traversed)\n"]

    if raw_final:
        for line in raw_final.strip().splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                item = json.loads(line)
                ticker = item.get("ticker", "")
                direction = item.get("direction", "neutral")
                conviction = item.get("conviction", "medium")
                key_events = item.get("key_events", [])
                reasoning = item.get("reasoning", "")

                if ticker:
                    ranked_tickers.append(ticker)
                    dir_icon = "▲" if direction == "bullish" else "▼" if direction == "bearish" else "●"
                    agent_lines.append(
                        f"{dir_icon} **{ticker}** [{conviction.upper()} conviction] — {direction}"
                    )
                    if reasoning:
                        agent_lines.append(f"  {reasoning}")
                    if key_events:
                        agent_lines.append(f"  Key events: {', '.join(key_events[:3])}")
                    agent_lines.append("")
            except Exception:
                continue

    if not ranked_tickers:
        print("[KG traverse] Final LLM returned no ranked tickers — falling back to allowed_tickers")
        ranked_tickers = allowed_tickers[:8]

    kg_context = "\n".join(agent_lines)
    print(f"[KG traverse] Done — {len(ranked_tickers)} ranked tickers: {ranked_tickers}")
    return ranked_tickers, kg_context


# ── Serialization helpers ──────────────────────────────────────────────────────

def _node_to_dict(n: models.KGNode) -> dict:
    return {
        "id":           n.node_id,
        "type":         n.node_type,
        "label":        n.label,
        "symbol":       n.symbol,
        "metadata":     json.loads(n.metadata_json or "{}"),
        "last_seen_at": n.last_seen_at.isoformat() + "Z" if n.last_seen_at else None,
        "created_at":   n.created_at.isoformat() + "Z" if n.created_at else None,
    }


def _edge_to_dict(e: models.KGEdge) -> dict:
    return {
        "source":     e.source_node_id,
        "target":     e.target_node_id,
        "relation":   e.relation,
        "confidence": round(e.confidence, 3),
        "expires_at": e.expires_at.isoformat() + "Z" if e.expires_at else None,
        "created_at": e.created_at.isoformat() + "Z" if e.created_at else None,
    }
