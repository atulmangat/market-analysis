from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from pydantic import BaseModel
from typing import List
from datetime import datetime
import models
import yfinance as yf
from auth import require_auth, verify_password, create_token


# Public router — no auth required
router = APIRouter()

# Protected router — all routes require a valid JWT
protected = APIRouter(dependencies=[Depends(require_auth)])


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    password: str

@router.post("/auth/login", tags=["auth"])
def login(body: LoginRequest):
    if not verify_password(body.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    return {"token": create_token()}


def _strategy_to_dict(s) -> dict:
    return {
        "id":               s.id,
        "symbol":           s.symbol,
        "strategy_type":    s.strategy_type,
        "entry_price":      s.entry_price,
        "current_return":   s.current_return,
        "reasoning_summary": s.reasoning_summary,
        "status":           s.status,
        "timestamp":        s.timestamp.isoformat() if s.timestamp else None,
        "position_size":    s.position_size,
        "exit_price":       s.exit_price,
        "realized_pnl":     s.realized_pnl,
        "close_reason":     s.close_reason,
        "closed_at":        s.closed_at.isoformat() if s.closed_at else None,
        "notes":            s.notes,
    }


class MarketUpdate(BaseModel):
    market_name: str
    is_enabled: bool

class ApprovalAction(BaseModel):
    strategy_id: int
    action: str  # "approve" or "reject"

# --- Data Endpoints ---

@protected.get("/signals")
def get_signals(db: Session = Depends(get_db)):
    signals = db.query(models.MarketSignal).order_by(models.MarketSignal.timestamp.desc()).limit(10).all()
    return signals

@protected.get("/predictions")
def get_predictions(db: Session = Depends(get_db)):
    predictions = db.query(models.AgentPrediction).order_by(models.AgentPrediction.timestamp.desc()).limit(20).all()
    return predictions

@protected.get("/strategies")
def get_strategies(db: Session = Depends(get_db)):
    strategies = db.query(models.DeployedStrategy).order_by(models.DeployedStrategy.timestamp.desc()).limit(50).all()
    return [_strategy_to_dict(s) for s in strategies]

@protected.get("/debates")
def get_debates(db: Session = Depends(get_db)):
    debates = db.query(models.DebateRound).order_by(models.DebateRound.timestamp.desc()).limit(20).all()
    return debates

# --- Live Pipeline Endpoint ---

@protected.get("/pipeline/events")
def get_pipeline_events(db: Session = Depends(get_db)):
    """Returns pipeline events for the current run_id so the frontend can poll at 2s."""
    run_id_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
    run_id = run_id_conf.value if run_id_conf else None

    is_running_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    is_running = bool(is_running_conf and is_running_conf.value == "1")

    events = []
    if run_id:
        rows = (
            db.query(models.PipelineEvent)
            .filter(models.PipelineEvent.run_id == run_id)
            .order_by(models.PipelineEvent.created_at.asc())
            .all()
        )
        events = [
            {
                "id":         e.id,
                "step":       e.step,
                "agent_name": e.agent_name,
                "status":     e.status,
                "detail":     e.detail,
                "created_at": e.created_at.isoformat(),
            }
            for e in rows
        ]

    return {"run_id": run_id, "is_running": is_running, "events": events}


@protected.get("/pipeline/runs")
def get_pipeline_runs(db: Session = Depends(get_db)):
    """Returns a summary list of all past pipeline runs, newest first."""
    from sqlalchemy import func
    rows = (
        db.query(
            models.PipelineEvent.run_id,
            func.min(models.PipelineEvent.created_at).label("started_at"),
            func.max(models.PipelineEvent.created_at).label("ended_at"),
            func.count(models.PipelineEvent.id).label("event_count"),
        )
        .group_by(models.PipelineEvent.run_id)
        .order_by(func.min(models.PipelineEvent.created_at).desc())
        .limit(50)
        .all()
    )

    run_id_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
    current_run_id = run_id_conf.value if run_id_conf else None

    result = []
    for row in rows:
        # Determine status from last event in the run
        last_event = (
            db.query(models.PipelineEvent)
            .filter(models.PipelineEvent.run_id == row.run_id)
            .order_by(models.PipelineEvent.created_at.desc())
            .first()
        )
        has_error = db.query(models.PipelineEvent).filter(
            models.PipelineEvent.run_id == row.run_id,
            models.PipelineEvent.status == "ERROR",
        ).count() > 0

        if row.run_id == current_run_id:
            status = "running"
        elif has_error:
            status = "error"
        else:
            status = "done"

        # Extract deployed ticker from DEPLOY event if present
        deploy_event = (
            db.query(models.PipelineEvent)
            .filter(
                models.PipelineEvent.run_id == row.run_id,
                models.PipelineEvent.step == "DEPLOY",
                models.PipelineEvent.status == "DONE",
            )
            .first()
        )
        result.append({
            "run_id":      row.run_id,
            "started_at":  row.started_at.isoformat(),
            "ended_at":    row.ended_at.isoformat(),
            "event_count": row.event_count,
            "status":      status,
            "deploy_detail": deploy_event.detail if deploy_event else None,
        })
    return result


@protected.get("/pipeline/runs/{run_id}")
def get_pipeline_run_events(run_id: str, db: Session = Depends(get_db)):
    """Returns all events for a specific pipeline run."""
    rows = (
        db.query(models.PipelineEvent)
        .filter(models.PipelineEvent.run_id == run_id)
        .order_by(models.PipelineEvent.created_at.asc())
        .all()
    )
    events = [
        {
            "id":         e.id,
            "step":       e.step,
            "agent_name": e.agent_name,
            "status":     e.status,
            "detail":     e.detail,
            "created_at": e.created_at.isoformat(),
        }
        for e in rows
    ]
    return {"run_id": run_id, "events": events}


# --- Live Quotes Endpoint ---

MARKET_TICKERS = {
    "US":     ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META", "AMD"],
    "India":  ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "WIPRO.NS", "SBIN.NS", "TATAMOTORS.NS"],
    "Crypto": ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "DOGE-USD", "ADA-USD"],
    "MCX":    ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F"],
}

TICKER_NAMES = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet",
    "AMZN": "Amazon", "TSLA": "Tesla", "META": "Meta", "AMD": "AMD",
    "RELIANCE.NS": "Reliance", "TCS.NS": "TCS", "INFY.NS": "Infosys",
    "HDFCBANK.NS": "HDFC Bank", "ICICIBANK.NS": "ICICI Bank", "WIPRO.NS": "Wipro",
    "SBIN.NS": "SBI", "TATAMOTORS.NS": "Tata Motors",
    "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana",
    "BNB-USD": "BNB", "XRP-USD": "XRP", "DOGE-USD": "Dogecoin", "ADA-USD": "Cardano",
    "GC=F": "Gold", "SI=F": "Silver", "CL=F": "Crude Oil", "NG=F": "Nat Gas", "HG=F": "Copper",
}


@protected.get("/quotes")
def get_live_quotes():
    """Fetch live quotes for all tickers across all markets (not filtered by debate config)."""
    tickers = []
    for market, syms in MARKET_TICKERS.items():
        for s in syms:
            tickers.append((market, s))

    all_symbols = [t[1] for t in tickers]
    results = []

    try:
        # Batch download — much faster than one-by-one
        data = yf.download(
            all_symbols,
            period="5d",
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        close = data.get("Close")
        volume = data.get("Volume")

        for market, symbol in tickers:
            try:
                if close is None:
                    raise ValueError("no close data")
                if len(all_symbols) == 1:
                    col = close
                    vol_col = volume
                else:
                    col = close[symbol]
                    vol_col = volume[symbol] if volume is not None else None

                col = col.dropna()
                if len(col) < 1:
                    raise ValueError("empty")

                price = float(col.iloc[-1])
                prev  = float(col.iloc[-2]) if len(col) >= 2 else price
                change_pct = ((price - prev) / prev * 100) if prev else 0.0
                import math as _math
                vol_raw = vol_col.iloc[-1] if vol_col is not None and not vol_col.dropna().empty else None
                vol = int(vol_raw) if vol_raw is not None and not _math.isnan(float(vol_raw)) else 0

                results.append({
                    "market":      market,
                    "symbol":      symbol,
                    "name":        TICKER_NAMES.get(symbol, symbol),
                    "price":       round(price, 4),
                    "prev_close":  round(prev, 4),
                    "change_pct":  round(change_pct, 2),
                    "volume":      vol,
                })
            except Exception as e:
                results.append({
                    "market": market, "symbol": symbol,
                    "name": TICKER_NAMES.get(symbol, symbol),
                    "price": None, "prev_close": None, "change_pct": None, "volume": None,
                    "error": str(e),
                })
    except Exception as e:
        print(f"[Quotes] Batch download failed: {e}")

    return results


@protected.get("/market/events")
def get_market_events():
    """Fetch upcoming earnings, dividends AND recent news for all markets."""
    from datetime import timezone
    import datetime as _dt

    events = []
    seen_news_titles: set[str] = set()

    for market, symbols in MARKET_TICKERS.items():
        for symbol in symbols:
            try:
                t = yf.Ticker(symbol)
                name = TICKER_NAMES.get(symbol, symbol)

                # ── Earnings & dividends (US & India only — reliable data) ──
                if market in ("US", "India"):
                    try:
                        cal = t.calendar
                        if cal is not None:
                            if hasattr(cal, "to_dict"):
                                cal = cal.to_dict()
                            # Earnings
                            ed = cal.get("Earnings Date")
                            if ed:
                                dates = ed if isinstance(ed, list) else [ed]
                                for d in dates[:1]:
                                    events.append({
                                        "market": market, "symbol": symbol, "name": name,
                                        "event_type": "Earnings",
                                        "date": str(d)[:10],
                                        "detail": None,
                                        "url": None,
                                    })
                            # Dividend
                            div_date = cal.get("Dividend Date") or cal.get("Ex-Dividend Date")
                            if div_date:
                                try:
                                    divs = t.dividends
                                    amt = f"${divs.iloc[-1]:.4f}" if divs is not None and len(divs) > 0 else None
                                except Exception:
                                    amt = None
                                events.append({
                                    "market": market, "symbol": symbol, "name": name,
                                    "event_type": "Dividend",
                                    "date": str(div_date)[:10],
                                    "detail": amt,
                                    "url": None,
                                })
                    except Exception:
                        pass

                # ── Recent news (all markets) ─────────────────────────────
                try:
                    news = t.news or []
                    for item in news[:4]:
                        content = item.get("content") or item
                        title = content.get("title") or ""
                        if not title or title in seen_news_titles:
                            continue
                        seen_news_titles.add(title)

                        pub = content.get("pubDate") or ""
                        # Parse date
                        try:
                            dt = _dt.datetime.fromisoformat(pub.replace("Z", "+00:00"))
                            date_str = dt.strftime("%Y-%m-%d")
                        except Exception:
                            date_str = pub[:10] if pub else ""

                        url = (content.get("canonicalUrl") or {}).get("url") or content.get("link") or item.get("link") or ""
                        provider = (content.get("provider") or {}).get("displayName") or ""

                        events.append({
                            "market": market, "symbol": symbol, "name": name,
                            "event_type": "News",
                            "date": date_str,
                            "detail": provider or None,
                            "url": url or None,
                            "title": title,
                        })
                except Exception:
                    pass

            except Exception:
                pass

    # Sort news by date desc, earnings/dividends by date asc — mix with news first
    news_events = sorted([e for e in events if e["event_type"] == "News"], key=lambda x: x["date"], reverse=True)
    cal_events  = sorted([e for e in events if e["event_type"] != "News"], key=lambda x: x["date"])
    return cal_events + news_events


# --- Darwin / Evolution Endpoints ---

@protected.get("/agents/fitness")
def get_agent_fitness(db: Session = Depends(get_db)):
    """Returns current fitness scores for all agents based on recent predictions."""
    from sqlalchemy import func
    from validator import _compute_fitness

    agents = db.query(models.AgentPrompt).all()
    result = []
    for a in agents:
        fitness = _compute_fitness(db, a.agent_name)
        # Current generation = total history entries + 1
        gen = db.query(models.AgentPromptHistory).filter(
            models.AgentPromptHistory.agent_name == a.agent_name
        ).count() + 1
        result.append({
            "agent_name":   a.agent_name,
            "generation":   gen,
            "fitness_score": fitness["fitness_score"],
            "win_rate":      fitness["win_rate"],
            "avg_return":    fitness["avg_return"],
            "total_scored":  fitness["total_scored"],
            "updated_at":    a.updated_at.isoformat() if a.updated_at else None,
        })
    return result


@protected.get("/agents/evolution/{agent_name}")
def get_agent_evolution(agent_name: str, db: Session = Depends(get_db)):
    """Returns full prompt evolution history for a single agent."""
    history = (
        db.query(models.AgentPromptHistory)
        .filter(models.AgentPromptHistory.agent_name == agent_name)
        .order_by(models.AgentPromptHistory.generation.desc())
        .all()
    )
    return [
        {
            "id":              h.id,
            "generation":      h.generation,
            "fitness_score":   h.fitness_score,
            "win_rate":        h.win_rate,
            "avg_return":      h.avg_return,
            "total_scored":    h.total_scored,
            "evolution_reason": h.evolution_reason,
            "system_prompt":   h.system_prompt,
            "replaced_at":     h.replaced_at.isoformat() if h.replaced_at else None,
            "created_at":      h.created_at.isoformat() if h.created_at else None,
        }
        for h in history
    ]

# --- Agent Prompts Endpoint ---

@protected.get("/agents")
def get_agents(db: Session = Depends(get_db)):
    """Get all agent prompts."""
    agents = db.query(models.AgentPrompt).all()
    return [
        {
            "id": a.id,
            "agent_name": a.agent_name,
            "system_prompt": a.system_prompt,
            "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        }
        for a in agents
    ]

@protected.put("/agents/{agent_name}/prompt")
def update_agent_prompt(agent_name: str, body: dict, db: Session = Depends(get_db)):
    """Update the system prompt for a specific agent."""
    new_prompt = body.get("system_prompt", "").strip()
    if not new_prompt:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="system_prompt cannot be empty")

    agent = db.query(models.AgentPrompt).filter(models.AgentPrompt.agent_name == agent_name).first()
    if not agent:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agent not found")

    # Archive current prompt before replacing
    from validator import _archive_prompt
    _archive_prompt(db, agent_name, "MANUAL", {
        "fitness_score": None, "win_rate": None, "avg_return": None, "total_scored": 0
    })

    agent.system_prompt = new_prompt
    agent.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "updated", "agent_name": agent_name}


# --- Agent Memory Endpoints ---

@protected.get("/memory")
def get_all_memory(db: Session = Depends(get_db)):
    """Get recent memory notes for all agents."""
    memories = (
        db.query(models.AgentMemory)
        .order_by(models.AgentMemory.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": m.id,
            "agent_name": m.agent_name,
            "note_type": m.note_type,
            "content": m.content,
            "source_debate_id": m.source_debate_id,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in memories
    ]

@protected.get("/memory/{agent_name}")
def get_agent_memory(agent_name: str, db: Session = Depends(get_db)):
    """Get memory notes for a specific agent."""
    memories = (
        db.query(models.AgentMemory)
        .filter(models.AgentMemory.agent_name == agent_name)
        .order_by(models.AgentMemory.created_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": m.id,
            "agent_name": m.agent_name,
            "note_type": m.note_type,
            "content": m.content,
            "source_debate_id": m.source_debate_id,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in memories
    ]

# --- Ticker Search Endpoint ---

@protected.get("/search/tickers")
def search_tickers(q: str = ""):
    """Search tickers by name or symbol using Yahoo Finance."""
    if not q or len(q.strip()) < 1:
        return []
    try:
        import yfinance as yf
        results = yf.Search(q.strip(), max_results=10).quotes
        out = []
        for r in results:
            symbol = r.get("symbol", "")
            name = r.get("longname") or r.get("shortname") or symbol
            sector = r.get("sectorDisp") or r.get("sector") or r.get("quoteType", "").capitalize() or ""
            exchange = r.get("exchDisp") or r.get("exchange") or ""
            quote_type = r.get("quoteType", "").lower()
            if symbol:
                out.append({
                    "symbol": symbol,
                    "name": name,
                    "sector": sector,
                    "exchange": exchange,
                    "type": quote_type,
                })
        return out
    except Exception as e:
        print(f"[Search] Error: {e}")
        return []


# --- Web Research Endpoints ---

@protected.get("/research")
def get_research(db: Session = Depends(get_db)):
    """Get the latest cached web research results."""
    research = (
        db.query(models.WebResearch)
        .order_by(models.WebResearch.fetched_at.desc())
        .limit(30)
        .all()
    )
    return [
        {
            "id": r.id,
            "query": r.query,
            "title": r.title,
            "snippet": r.snippet,
            "source_url": r.source_url,
            "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
        }
        for r in research
    ]

# --- Market Config ---

@protected.get("/config/markets")
def get_market_config(db: Session = Depends(get_db)):
    defaults = ["Crypto", "India", "US", "MCX"]
    configs = db.query(models.MarketConfig).all()
    if not configs:
        for market in defaults:
            db.add(models.MarketConfig(market_name=market, is_enabled=1))
        db.commit()
        configs = db.query(models.MarketConfig).all()
    return [{"id": c.id, "market_name": c.market_name, "is_enabled": c.is_enabled} for c in configs]

@protected.post("/config/markets")
def update_market_config(updates: List[MarketUpdate], db: Session = Depends(get_db)):
    for update in updates:
        conf = db.query(models.MarketConfig).filter(models.MarketConfig.market_name == update.market_name).first()
        if conf:
            conf.is_enabled = 1 if update.is_enabled else 0
    db.commit()
    return {"status": "success"}

# --- Approval Mode Config ---

def _get_approval_mode(db: Session) -> str:
    """Helper: returns 'auto' or 'manual'. Defaults to 'auto'."""
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "approval_mode").first()
    if not conf:
        conf = models.AppConfig(key="approval_mode", value="auto")
        db.add(conf)
        db.commit()
    return conf.value

@protected.get("/config/approval_mode")
def get_approval_mode(db: Session = Depends(get_db)):
    return {"approval_mode": _get_approval_mode(db)}

@protected.post("/config/approval_mode")
def set_approval_mode(mode: dict, db: Session = Depends(get_db)):
    new_mode = mode.get("approval_mode", "auto")
    if new_mode not in ("auto", "manual"):
        return {"error": "Invalid mode. Use 'auto' or 'manual'."}
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "approval_mode").first()
    if conf:
        conf.value = new_mode
    else:
        db.add(models.AppConfig(key="approval_mode", value=new_mode))
    db.commit()
    return {"approval_mode": new_mode}

# --- Strategy Approval / Rejection ---

@protected.post("/strategies/approve")
def approve_strategy(action: ApprovalAction, db: Session = Depends(get_db)):
    strategy = db.query(models.DeployedStrategy).filter(models.DeployedStrategy.id == action.strategy_id).first()
    if not strategy:
        return {"error": "Strategy not found"}
    if strategy.status != "PENDING":
        return {"error": f"Strategy is already {strategy.status}"}
    if action.action == "approve":
        strategy.status = "ACTIVE"
    elif action.action == "reject":
        strategy.status = "REJECTED"
    else:
        return {"error": "Invalid action. Use 'approve' or 'reject'."}
    db.commit()
    return {"status": strategy.status, "id": strategy.id}

# --- Manual Trigger & Scheduling ---

from fastapi import BackgroundTasks
from orchestrator import run_debate
import threading

class TriggerRequest(BaseModel):
    tickers: List[str] | None = None

@protected.post("/trigger")
def manual_trigger(body: TriggerRequest = TriggerRequest(), db: Session = Depends(get_db)):
    """Manually triggers a new debate round. Optionally pass {"tickers": ["AAPL", "NVDA"]} to focus the run."""
    is_running = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if is_running and is_running.value == "1":
        return {"status": "error", "message": "A data extraction is already running. Please wait."}

    focus = [t.strip().upper() for t in body.tickers if t.strip()] if body.tickers else None
    t = threading.Thread(target=run_debate, args=(focus,), daemon=True)
    t.start()
    msg = f"Focused run on: {', '.join(focus)}" if focus else "Full pipeline started."
    return {"status": "success", "message": msg}

@protected.get("/system/status")
def get_system_status(db: Session = Depends(get_db)):
    """Check if the system is currently running a data extraction."""
    is_running = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    return {"is_running": is_running and is_running.value == "1"}

@protected.post("/system/stop")
def stop_pipeline(db: Session = Depends(get_db)):
    """Force-stop the running pipeline by releasing the lock. The in-flight thread will finish its current LLM call but no new steps will deploy."""
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if conf:
        conf.value = "0"
        db.commit()
    return {"status": "stopped"}

def _get_schedule_interval(db: Session) -> int:
    """Helper: returns schedule interval in minutes. Defaults to 60."""
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "schedule_interval_minutes").first()
    if not conf:
        conf = models.AppConfig(key="schedule_interval_minutes", value="60")
        db.add(conf)
        db.commit()
    return int(conf.value)

@protected.get("/config/schedule")
def get_schedule(db: Session = Depends(get_db)):
    return {"interval_minutes": _get_schedule_interval(db)}

class ScheduleUpdate(BaseModel):
    interval_minutes: int

@protected.post("/config/schedule")
def set_schedule(update: ScheduleUpdate, db: Session = Depends(get_db)):
    if update.interval_minutes < 1:
        return {"error": "Interval must be at least 1 minute."}
        
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "schedule_interval_minutes").first()
    if conf:
        conf.value = str(update.interval_minutes)
    else:
        db.add(models.AppConfig(key="schedule_interval_minutes", value=str(update.interval_minutes)))
    db.commit()
    
    # Notice: we don't have access to the scheduler here directly.
    # The frontend will hit this endpoint, but we need main.py to actually reload it.
    # For now, we provide the updated value. main.py will provide a mechanism to sync it.
    
    return {"status": "success", "interval_minutes": update.interval_minutes}


# --- Strategy Management (undeploy, edit) ---

class StrategyUpdateBody(BaseModel):
    position_size: float | None = None
    notes: str | None = None
    reasoning_summary: str | None = None


@protected.post("/strategies/{strategy_id}/undeploy")
def undeploy_strategy(strategy_id: int, db: Session = Depends(get_db)):
    """Manually close (undeploy) an ACTIVE or PENDING strategy at current market price."""
    from data_ingestion import fetch_market_data
    from datetime import datetime as dt
    s = db.query(models.DeployedStrategy).filter(models.DeployedStrategy.id == strategy_id).first()
    if not s:
        return {"error": "Strategy not found"}
    if s.status not in ("ACTIVE", "PENDING"):
        return {"error": f"Strategy is already {s.status}"}

    # Fetch current price for realized P&L
    sig = fetch_market_data(s.symbol)
    exit_px = sig.price if sig else s.entry_price
    if s.strategy_type == "LONG":
        pct = ((exit_px - s.entry_price) / s.entry_price) * 100
    else:
        pct = ((s.entry_price - exit_px) / s.entry_price) * 100

    position = s.position_size or 0.0
    realized = (position * pct / 100) if position else None

    s.status = "CLOSED"
    s.exit_price = exit_px
    s.realized_pnl = realized
    s.current_return = pct
    s.close_reason = "MANUAL"
    s.closed_at = dt.utcnow()
    db.commit()
    return _strategy_to_dict(s)


@protected.put("/strategies/{strategy_id}")
def update_strategy(strategy_id: int, body: StrategyUpdateBody, db: Session = Depends(get_db)):
    """Update editable fields on a strategy (position size, notes, summary)."""
    s = db.query(models.DeployedStrategy).filter(models.DeployedStrategy.id == strategy_id).first()
    if not s:
        return {"error": "Strategy not found"}
    if body.position_size is not None:
        s.position_size = body.position_size
    if body.notes is not None:
        s.notes = body.notes
    if body.reasoning_summary is not None:
        s.reasoning_summary = body.reasoning_summary
    db.commit()
    return _strategy_to_dict(s)


# --- Investment Focus Config ---

@protected.get("/config/investment_focus")
def get_investment_focus(db: Session = Depends(get_db)):
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "investment_focus").first()
    return {"investment_focus": conf.value if conf else ""}


@protected.post("/config/investment_focus")
def set_investment_focus(body: dict, db: Session = Depends(get_db)):
    text = (body.get("investment_focus") or "").strip()
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "investment_focus").first()
    if conf:
        conf.value = text
    else:
        db.add(models.AppConfig(key="investment_focus", value=text))
    db.commit()
    return {"investment_focus": text}


# --- Budget Config ---

@protected.get("/config/budget")
def get_budget(db: Session = Depends(get_db)):
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
    budget = float(conf.value) if conf else 10000.0
    return {"trading_budget": budget}


class BudgetUpdate(BaseModel):
    trading_budget: float


@protected.post("/config/budget")
def set_budget(body: BudgetUpdate, db: Session = Depends(get_db)):
    if body.trading_budget < 0:
        return {"error": "Budget must be non-negative"}
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
    if conf:
        conf.value = str(body.trading_budget)
    else:
        db.add(models.AppConfig(key="trading_budget", value=str(body.trading_budget)))
    db.commit()
    return {"trading_budget": body.trading_budget}


# --- Portfolio P&L ---

@protected.get("/portfolio/pnl")
def get_portfolio_pnl(db: Session = Depends(get_db)):
    """Compute portfolio P&L with live prices fetched from yfinance for ACTIVE positions."""
    import math as _math

    budget_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
    total_budget = float(budget_conf.value) if budget_conf else 10000.0

    all_strats = db.query(models.DeployedStrategy).order_by(models.DeployedStrategy.timestamp.desc()).all()

    # Batch-fetch live prices for all ACTIVE symbols in one yfinance call
    active_strats = [s for s in all_strats if s.status == "ACTIVE"]
    live_prices: dict[str, float] = {}
    if active_strats:
        symbols = list({s.symbol for s in active_strats})
        try:
            tickers_str = " ".join(symbols)
            raw = yf.download(tickers_str, period="2d", interval="1d", auto_adjust=True, progress=False)
            close = raw["Close"] if "Close" in raw.columns else None
            if close is not None:
                if len(symbols) == 1:
                    col = close
                    vals = col.dropna()
                    if not vals.empty:
                        live_prices[symbols[0]] = float(vals.iloc[-1])
                else:
                    for sym in symbols:
                        if sym in close.columns:
                            col = close[sym].dropna()
                            if not col.empty:
                                live_prices[sym] = float(col.iloc[-1])
        except Exception as e:
            print(f"[portfolio/pnl] live price fetch error: {e}")

    realized_pnl = 0.0
    unrealized_pnl = 0.0
    allocated = 0.0
    positions = []

    for s in all_strats:
        pos_size = s.position_size or 0.0

        if s.status == "CLOSED":
            rpnl = s.realized_pnl or 0.0
            realized_pnl += rpnl
            positions.append({
                **_strategy_to_dict(s),
                "pnl_usd": rpnl,
                "pnl_pct": s.current_return,
                "current_price": s.exit_price,
                "is_open": False,
            })
        elif s.status == "ACTIVE":
            allocated += pos_size
            live_price = live_prices.get(s.symbol)
            if live_price and s.entry_price:
                if s.strategy_type == "LONG":
                    pct = ((live_price - s.entry_price) / s.entry_price) * 100
                else:
                    pct = ((s.entry_price - live_price) / s.entry_price) * 100
                # Persist updated return to DB so validator has fresh value too
                s.current_return = round(pct, 4)
                upnl = (pos_size * pct / 100) if pos_size else None
            else:
                pct = s.current_return or 0.0
                upnl = (pos_size * pct / 100) if pos_size else None

            if upnl is not None:
                unrealized_pnl += upnl
            positions.append({
                **_strategy_to_dict(s),
                "pnl_usd": upnl,
                "pnl_pct": pct,
                "current_price": live_price,
                "is_open": True,
            })

    db.commit()  # persist updated current_return values

    available = total_budget - allocated
    total_pnl = realized_pnl + unrealized_pnl

    return {
        "total_budget":    total_budget,
        "allocated":       allocated,
        "available":       available,
        "realized_pnl":    round(realized_pnl, 2),
        "unrealized_pnl":  round(unrealized_pnl, 2),
        "total_pnl":       round(total_pnl, 2),
        "total_pnl_pct":   round((total_pnl / total_budget * 100) if total_budget else 0, 2),
        "positions":       positions,
    }
