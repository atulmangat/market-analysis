from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from core.database import get_db, SessionLocal
from pydantic import BaseModel
from typing import List
from datetime import datetime
import json
import math
import core.models as models
import yfinance as yf
from core.auth import require_auth, verify_password, create_token, check_rate_limit, record_failed_attempt, record_success
from core.cache import cache_get, cache_set, cache_invalidate, cache_invalidate_prefix, cache_stats

# TTL constants (seconds)
_TTL_RUN_EVENTS  = 86400   # 1 day  — completed run events never change
_TTL_RUNS_LIST   = 60      # 1 min  — new runs appear; short so list stays fresh
_TTL_DEBATES     = 600     # 10 min — historical debate rounds
_TTL_RESEARCH    = 600     # 10 min — web research cache
_TTL_GRAPH       = 600     # 10 min — knowledge graph updated each pipeline run
_TTL_FITNESS     = 600     # 10 min — agent fitness scores
_TTL_EVOLUTION   = 3600    # 1 hr   — prompt evolution history
_TTL_MARKET_EVT  = 1800    # 30 min — earnings/news calendar
_TTL_MEMORY      = 300     # 5 min  — agent memories written after each run


def _is_pipeline_running(db) -> bool:
    """Return True if a pipeline run is currently active. Used to skip caches during live runs."""
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    return conf is not None and conf.value == "1"


# Public router — no auth required
router = APIRouter()

# Protected router — all routes require a valid JWT
protected = APIRouter(dependencies=[Depends(require_auth)])


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    password: str

@router.post("/auth/login", tags=["auth"])
def login(body: LoginRequest, request: Request):
    check_rate_limit(request)
    if not verify_password(body.password):
        record_failed_attempt(request)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    record_success(request)
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
        "debate_round_id":  s.debate_round_id,
    }


def _build_chart(symbol: str, entry_price: float, entry_dt) -> dict:
    """Return 1-month daily OHLCV candles + entry price marker for charting."""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1mo", interval="1d", auto_adjust=True)
        candles = []
        for ts, row in hist.iterrows():
            v = int(row["Volume"]) if not math.isnan(float(row["Volume"] or 0)) else 0
            candles.append({
                "date":   ts.strftime("%Y-%m-%d"),
                "open":   round(float(row["Open"]),  4),
                "high":   round(float(row["High"]),  4),
                "low":    round(float(row["Low"]),   4),
                "close":  round(float(row["Close"]), 4),
                "volume": v,
            })
        return {
            "symbol":      symbol,
            "period":      "1mo",
            "candles":     candles,
            "entry_price": entry_price,
            "entry_date":  entry_dt.strftime("%Y-%m-%d") if entry_dt else None,
        }
    except Exception as e:
        return {"symbol": symbol, "period": "1mo", "candles": [], "error": str(e)}


def _build_fundamentals(symbol: str) -> dict:
    """Return rich fundamental fields from yfinance for the report template."""
    def _safe(d, *keys):
        for k in keys:
            v = d.get(k)
            if v is not None and not (isinstance(v, float) and math.isnan(v)):
                return v
        return None

    try:
        ticker = yf.Ticker(symbol)
        try:
            info = ticker.info
        except Exception:
            info = {}
        fi = ticker.fast_info

        # Price history for technical signals
        hist = ticker.history(period="1mo", interval="1d", auto_adjust=True)
        closes = hist["Close"].dropna() if not hist.empty else None
        vols   = hist["Volume"].dropna() if not hist.empty else None

        # RSI(14)
        rsi = None
        if closes is not None and len(closes) >= 14:
            deltas = closes.diff().dropna()
            avg_gain = deltas.clip(lower=0).rolling(14).mean().iloc[-1]
            avg_loss = (-deltas).clip(lower=0).rolling(14).mean().iloc[-1]
            if avg_loss > 0:
                rsi = round(float(100 - (100 / (1 + avg_gain / avg_loss))), 1)

        # Volume ratio (last day vs 20-day avg)
        vol_ratio = None
        if vols is not None and len(vols) >= 2:
            avg_vol = float(vols.iloc[:-1].mean())
            if avg_vol > 0:
                vol_ratio = round(float(vols.iloc[-1]) / avg_vol, 2)

        # Price momentum
        chg_5d = chg_20d = None
        if closes is not None and len(closes) >= 2:
            n5 = min(5, len(closes))
            chg_5d  = round((float(closes.iloc[-1]) - float(closes.iloc[-n5])) / float(closes.iloc[-n5]) * 100, 2)
            chg_20d = round((float(closes.iloc[-1]) - float(closes.iloc[0])) / float(closes.iloc[0]) * 100, 2)

        # Recent closes (last 5 days)
        recent_closes = []
        if closes is not None:
            for ts, c in zip(closes.index[-5:], closes.values[-5:]):
                recent_closes.append({"date": ts.strftime("%m-%d"), "close": round(float(c), 4)})

        # Next earnings
        next_earnings = None
        try:
            cal = ticker.calendar
            if cal is not None and not (hasattr(cal, 'empty') and cal.empty):
                ed = cal.get("Earnings Date", [None])[0] if hasattr(cal, 'get') else None
                if ed:
                    next_earnings = str(ed)
        except Exception:
            pass

        # Analyst target
        target = _safe(info, "targetMeanPrice")
        target_low = _safe(info, "targetLowPrice")
        target_high = _safe(info, "targetHighPrice")
        lp = None
        try:
            lp = fi.last_price
        except Exception:
            pass
        lp = lp or _safe(info, "currentPrice", "regularMarketPrice")
        analyst_upside = round((target - lp) / lp * 100, 1) if target and lp and lp > 0 else None

        return {
            # Identity
            "name":           info.get("longName") or info.get("shortName"),
            "sector":         info.get("sector"),
            "industry":       info.get("industry"),
            "exchange":       info.get("exchange"),
            "currency":       info.get("currency", "USD"),
            "quote_type":     info.get("quoteType"),
            "description":    (info.get("longBusinessSummary") or "")[:500] or None,
            # Size
            "market_cap":     _safe(info, "marketCap"),
            "enterprise_value": _safe(info, "enterpriseValue"),
            # Valuation
            "pe_ratio":       _safe(info, "trailingPE"),
            "forward_pe":     _safe(info, "forwardPE"),
            "pb_ratio":       _safe(info, "priceToBook"),
            "ps_ratio":       _safe(info, "priceToSalesTrailing12Months"),
            "ev_ebitda":      _safe(info, "enterpriseToEbitda"),
            # Growth & profitability
            "revenue_growth": _safe(info, "revenueGrowth"),
            "earnings_growth": _safe(info, "earningsGrowth"),
            "profit_margin":  _safe(info, "profitMargins"),
            "operating_margin": _safe(info, "operatingMargins"),
            "roe":            _safe(info, "returnOnEquity"),
            "roa":            _safe(info, "returnOnAssets"),
            "debt_equity":    _safe(info, "debtToEquity"),
            # Price history
            "52w_high":       _safe(info, "fiftyTwoWeekHigh") or (fi.fifty_two_week_high if hasattr(fi, 'fifty_two_week_high') else None),
            "52w_low":        _safe(info, "fiftyTwoWeekLow") or (fi.fifty_two_week_low if hasattr(fi, 'fifty_two_week_low') else None),
            "avg_volume":     _safe(info, "averageVolume"),
            "beta":           _safe(info, "beta"),
            "dividend_yield": _safe(info, "dividendYield"),
            # Analyst consensus
            "analyst_target":       target,
            "analyst_target_low":   target_low,
            "analyst_target_high":  target_high,
            "analyst_upside":       analyst_upside,
            "analyst_recommendation": info.get("recommendationKey") if isinstance(info.get("recommendationKey"), str) else None,
            "analyst_count":        _safe(info, "numberOfAnalystOpinions"),
            # Short interest
            "short_pct_float":    _safe(info, "shortPercentOfFloat"),
            # Technical signals
            "rsi_14":         rsi,
            "vol_ratio":      vol_ratio,
            "chg_5d":         chg_5d,
            "chg_20d":        chg_20d,
            "recent_closes":  recent_closes,
            # Catalyst
            "next_earnings":  next_earnings,
        }
    except Exception as e:
        return {
            "name": None, "sector": None, "industry": None, "market_cap": None,
            "pe_ratio": None, "forward_pe": None, "52w_high": None, "52w_low": None,
            "avg_volume": None, "beta": None, "dividend_yield": None,
            "currency": "USD", "exchange": None, "quote_type": None,
            "description": None, "error": str(e),
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

@protected.get("/strategies/{strategy_id}/report")
def get_strategy_report(strategy_id: int, db: Session = Depends(get_db)):
    """Return full report for a strategy: chart, fundamentals, and linked debate."""
    import traceback, logging
    logger = logging.getLogger(__name__)
    try:
        s = db.query(models.DeployedStrategy).filter(
            models.DeployedStrategy.id == strategy_id
        ).first()
        if not s:
            raise HTTPException(status_code=404, detail="Strategy not found")

        # Debate block
        debate_block = None
        dr = None
        if s.debate_round_id:
            dr = db.query(models.DebateRound).filter(
                models.DebateRound.id == s.debate_round_id
            ).first()
            if dr:
                try:
                    raw_proposals = json.loads(dr.proposals_json or "[]")
                except Exception:
                    raw_proposals = []
                proposals_with_match = [
                    {**p, "matched_consensus": (
                        p.get("ticker") == dr.consensus_ticker and
                        p.get("action") == dr.consensus_action
                    )}
                    for p in raw_proposals
                ]
                debate_block = {
                    "id":               dr.id,
                    "timestamp":        dr.timestamp.isoformat(),
                    "consensus_votes":  dr.consensus_votes,
                    "judge_reasoning":  dr.judge_reasoning,
                    "proposals":        proposals_with_match,
                    "enabled_markets":  dr.enabled_markets,
                }

        # If no debate_round_id, try to find matching debate round by ticker + timestamp proximity
        if not dr:
            dr = db.query(models.DebateRound).filter(
                models.DebateRound.consensus_ticker == s.symbol,
            ).order_by(models.DebateRound.id.desc()).first()
            if dr and debate_block is None:
                try:
                    raw_proposals = json.loads(dr.proposals_json or "[]")
                except Exception:
                    raw_proposals = []
                proposals_with_match = [
                    {**p, "matched_consensus": (
                        p.get("ticker") == dr.consensus_ticker and
                        p.get("action") == dr.consensus_action
                    )}
                    for p in raw_proposals
                ]
                debate_block = {
                    "id":               dr.id,
                    "timestamp":        dr.timestamp.isoformat(),
                    "consensus_votes":  dr.consensus_votes,
                    "judge_reasoning":  dr.judge_reasoning,
                    "proposals":        proposals_with_match,
                    "enabled_markets":  dr.enabled_markets,
                }

        # Use pre-generated report from debate round if available (fast path)
        cached_chart = None
        cached_fundamentals = None
        if dr and dr.report_json:
            try:
                cached = json.loads(dr.report_json)
                cached_chart = cached.get("chart")
                cached_fundamentals = cached.get("fundamentals")
            except Exception:
                pass

        # Fall back to empty stubs — never call yfinance on-demand in serverless (times out)
        chart = cached_chart or {
            "symbol": s.symbol, "period": "1mo", "candles": [],
            "entry_price": s.entry_price or 0.0,
            "entry_date": s.timestamp.strftime("%Y-%m-%d") if s.timestamp else None,
            "error": "Chart not yet generated — run the pipeline to refresh.",
        }
        fundamentals = cached_fundamentals or {
            "name": None, "sector": None, "industry": None, "market_cap": None,
            "pe_ratio": None, "forward_pe": None, "52w_high": None, "52w_low": None,
            "avg_volume": None, "beta": None, "dividend_yield": None,
            "currency": "USD", "exchange": None, "quote_type": None, "description": None,
            "error": "Fundamentals not yet generated — run the pipeline to refresh.",
        }

        return {
            "strategy":     _strategy_to_dict(s),
            "debate":       debate_block,
            "chart":        chart,
            "fundamentals": fundamentals,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Report endpoint error: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


@protected.get("/debates")
def get_debates(db: Session = Depends(get_db)):
    if not _is_pipeline_running(db):
        cached = cache_get("debates")
        if cached is not None:
            return cached
    debates = db.query(models.DebateRound).order_by(models.DebateRound.timestamp.desc()).limit(20).all()
    result = [
        {
            "id": d.id,
            "consensus_ticker": d.consensus_ticker,
            "consensus_action": d.consensus_action,
            "consensus_votes": d.consensus_votes,
            "proposals_json": d.proposals_json,
            "enabled_markets": d.enabled_markets,
            "research_context": d.research_context,
            "judge_reasoning": d.judge_reasoning,
            "timestamp": d.timestamp.isoformat() if d.timestamp else None,
            "report_json": d.report_json,
        }
        for d in debates
    ]
    cache_set("debates", result, _TTL_DEBATES)
    return result

# --- Live Pipeline Endpoint ---

@protected.get("/pipeline/events")
def get_pipeline_events(db: Session = Depends(get_db)):
    """Returns pipeline events for the current run_id so the frontend can poll at 2s."""
    run_id_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
    run_id = run_id_conf.value if run_id_conf else None

    is_running_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    is_running = bool(is_running_conf and is_running_conf.value == "1")

    # Stale-lock guard: if debate_running=1 but the run's step is done/error,
    # or the last event is >90s old (thread died on reload), auto-clear the lock.
    run_step = None
    events = []
    if run_id:
        run_row = db.query(models.PipelineRun).filter(models.PipelineRun.run_id == run_id).first()
        run_step = run_row.step if run_row else None

        if is_running and run_step in ("done", "error"):
            is_running = False
            if is_running_conf:
                is_running_conf.value = "0"
                db.commit()

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

        # Stale thread guard: lock held but no new events for >90s → thread died
        if is_running and rows:
            from datetime import timezone
            last_event_time = rows[-1].created_at
            # Handle both naive and tz-aware datetimes
            now_naive = datetime.utcnow()
            try:
                age = (now_naive - last_event_time.replace(tzinfo=None)).total_seconds()
            except Exception:
                age = 0
            if age > 90:
                is_running = False
                if is_running_conf:
                    is_running_conf.value = "0"
                    db.commit()

    return {"run_id": run_id, "is_running": is_running, "run_step": run_step, "events": events}


@protected.get("/pipeline/runs")
def get_pipeline_runs(db: Session = Depends(get_db)):
    """Returns a summary list of all past pipeline runs, newest first."""
    cached = cache_get("pipeline_runs")
    if cached:
        return cached
    from sqlalchemy import func, or_, case

    # ── 1 query: run summaries (started, ended, event count) ─────────────────
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
    if not rows:
        return []

    run_ids = [r.run_id for r in rows]

    # ── 1 query: which runs have any ERROR event ──────────────────────────────
    error_run_ids = {
        r[0] for r in db.query(models.PipelineEvent.run_id)
        .filter(models.PipelineEvent.run_id.in_(run_ids),
                models.PipelineEvent.status == "ERROR")
        .distinct().all()
    }

    # ── 1 query: terminal events for all runs ────────────────────────────────────
    # DEPLOY DONE = debate run complete; MEMORY_WRITE DONE = either run type complete;
    # START DONE = eval run complete (eval emits START DONE at the very end)
    terminal_events = db.query(models.PipelineEvent).filter(
        models.PipelineEvent.run_id.in_(run_ids),
        models.PipelineEvent.step.in_(["DEPLOY", "MEMORY_WRITE", "START"]),
        models.PipelineEvent.status == "DONE",
    ).all()
    deploy_by_run = {e.run_id: e for e in terminal_events if e.step == "DEPLOY"}
    complete_by_run = {e.run_id for e in terminal_events if e.step in ("MEMORY_WRITE", "START")}

    # ── 1 query: current run id + is_running ─────────────────────────────────
    configs = db.query(models.AppConfig).filter(
        models.AppConfig.key.in_(["current_run_id", "debate_running"])
    ).all()
    cfg = {c.key: c.value for c in configs}
    current_run_id = cfg.get("current_run_id")
    is_running = cfg.get("debate_running") == "1"

    # ── 1 query: pipeline run rows (step + params) ───────────────────────────
    pipeline_run_rows = {
        r.run_id: r
        for r in db.query(models.PipelineRun)
        .filter(models.PipelineRun.run_id.in_(run_ids)).all()
    }
    run_steps = {rid: r.step for rid, r in pipeline_run_rows.items()}

    # ── 1 query: all strategies that fall within any run's time window ────────
    min_start = min(r.started_at for r in rows)
    max_end   = max(r.ended_at   for r in rows)
    strategies_in_window = (
        db.query(models.DeployedStrategy)
        .filter(
            models.DeployedStrategy.timestamp >= min_start,
            models.DeployedStrategy.timestamp <= max_end,
        )
        .order_by(models.DeployedStrategy.timestamp.asc())
        .all()
    )

    # ── 1 query: debate rounds for those strategies ───────────────────────────
    dr_ids = [s.debate_round_id for s in strategies_in_window if s.debate_round_id]
    debate_rounds = {}
    if dr_ids:
        for dr in db.query(models.DebateRound).filter(models.DebateRound.id.in_(dr_ids)).all():
            debate_rounds[dr.id] = dr

    # ── Assemble in Python ────────────────────────────────────────────────────
    _INTERMEDIATE_STEPS = {
        "pending", "research", "agents", "consensus", "deploy",
        # eval intermediate steps
        "running", "score_strategies", "close_positions", "darwin_selection", "memory_write",
    }

    result = []
    for row in rows:
        step = run_steps.get(row.run_id)
        pr_row = pipeline_run_rows.get(row.run_id)
        is_eval = pr_row and getattr(pr_row, "run_type", "debate") == "eval"
        is_current_run = row.run_id == current_run_id
        # MEMORY_WRITE DONE is the most authoritative "complete" signal.
        # Even if there are intermediate ERROR events (e.g. KG_INGEST failed but
        # pipeline recovered), the run is "done" if MEMORY_WRITE completed.
        if row.run_id in complete_by_run or step == "done" or row.run_id in deploy_by_run:
            status = "done"
        elif is_current_run and is_running:
            status = "running"
        elif step in _INTERMEDIATE_STEPS:
            status = "error"
        elif step == "error" or (row.run_id in error_run_ids and step is None):
            status = "error"
        else:
            status = "error"  # unknown/incomplete (None step, no deploy)

        # All strategies created within this run's time window (may be multiple)
        run_strategies = [
            s for s in strategies_in_window
            if row.started_at <= s.timestamp <= row.ended_at
        ]
        # Use the first strategy's debate round as the canonical one
        first_strategy = run_strategies[0] if run_strategies else None
        debate_round = debate_rounds.get(first_strategy.debate_round_id) if first_strategy and first_strategy.debate_round_id else None

        # Run params from PipelineRun row
        pr = pipeline_run_rows.get(row.run_id)
        run_params = {}
        if pr:
            if pr.investment_focus:
                run_params["focus"] = pr.investment_focus
            if pr.focus_tickers:
                try:
                    run_params["tickers"] = json.loads(pr.focus_tickers)
                except Exception:
                    pass
            if pr.enabled_markets_json:
                try:
                    markets = list(json.loads(pr.enabled_markets_json).keys())
                    run_params["markets"] = markets
                except Exception:
                    pass

        output = None
        if debate_round:
            try:
                proposals = json.loads(debate_round.proposals_json or "[]")
            except Exception:
                proposals = []
            # Parse verdicts — new runs store JSON list in judge_reasoning
            verdicts = []
            try:
                parsed = json.loads(debate_round.judge_reasoning or "[]")
                if isinstance(parsed, list):
                    verdicts = parsed
            except Exception:
                pass
            # Fallback: legacy single-verdict format
            if not verdicts and debate_round.consensus_ticker:
                verdicts = [{
                    "ticker":    debate_round.consensus_ticker,
                    "action":    debate_round.consensus_action,
                    "reasoning": debate_round.judge_reasoning or "",
                }]
            # Build positions list with strategy ids
            positions = []
            for v in verdicts:
                strat = next((s for s in run_strategies if s.symbol == v["ticker"]), None)
                positions.append({
                    "ticker":      v["ticker"],
                    "action":      v["action"],
                    "horizon":     v.get("horizon", ""),
                    "size":        v.get("size", ""),
                    "target":      v.get("target", ""),
                    "stop":        v.get("stop", ""),
                    "reasoning":   v.get("reasoning", "")[:300],
                    "strategy_id": strat.id if strat else None,
                })
            output = {
                "positions":   positions,
                "proposals":   proposals,
                "debate_id":   debate_round.id,
                # Legacy compat fields (first position)
                "ticker":      positions[0]["ticker"] if positions else debate_round.consensus_ticker,
                "action":      positions[0]["action"] if positions else debate_round.consensus_action,
                "votes":       debate_round.consensus_votes,
                "judge_reasoning": (positions[0]["reasoning"] if positions else ""),
                "strategy_id": positions[0]["strategy_id"] if positions else None,
            }

        deploy_ev = deploy_by_run.get(row.run_id)
        run_type = pipeline_run_rows.get(row.run_id)
        result.append({
            "run_id":        row.run_id,
            "run_type":      (run_type.run_type if run_type and hasattr(run_type, "run_type") else "debate") or "debate",
            "started_at":    row.started_at.isoformat(),
            "ended_at":      row.ended_at.isoformat(),
            "event_count":   row.event_count,
            "status":        status,
            "run_step":      run_steps.get(row.run_id),
            "deploy_detail": deploy_ev.detail if deploy_ev else None,
            "run_params":    run_params,
            "output":        output,
        })

    # Never cache running pipeline — always fresh from DB
    # Cache completed runs with a long TTL — they never change
    any_running = any(r["status"] == "running" for r in result)
    if result and not any_running:
        cache_set("pipeline_runs", result, 86400)  # 24h — completed runs are immutable
    return result


@protected.get("/pipeline/runs/{run_id}")
def get_pipeline_run_events(run_id: str, db: Session = Depends(get_db)):
    """Returns all events for a specific pipeline run."""
    cache_key = f"run_events:{run_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
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
    result = {"run_id": run_id, "events": events}
    # Only cache if this run is complete (has a DONE or ERROR terminal event)
    is_current_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
    if not (is_current_conf and is_current_conf.value == run_id):
        cache_set(cache_key, result, _TTL_RUN_EVENTS)
    return result


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


def _fetch_yahoo_chart(symbol: str, range_: str = "5d", interval: str = "1d") -> dict:
    """Fetch price data via Yahoo Finance v8 chart API — avoids quoteSummary."""
    import requests as _req
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range_}&interval={interval}"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; market-analysis/1.0)"}
    r = _req.get(url, headers=headers, timeout=12)
    r.raise_for_status()
    return r.json()


@protected.get("/quotes")
def get_live_quotes():
    """Fetch live quotes for all tickers across all markets (not filtered by debate config)."""
    import math as _math
    from concurrent.futures import ThreadPoolExecutor, as_completed

    tickers = []
    for market, syms in MARKET_TICKERS.items():
        for s in syms:
            tickers.append((market, s))

    results = []

    def fetch_one(market: str, symbol: str) -> dict:
        try:
            data = _fetch_yahoo_chart(symbol, range_="5d", interval="1d")
            result = data["chart"]["result"][0]
            quotes = result["indicators"]["quote"][0]
            closes = [c for c in (quotes.get("close") or []) if c is not None]
            volumes = quotes.get("volume") or []

            if not closes:
                raise ValueError("empty close data")

            price = round(float(closes[-1]), 4)
            prev  = round(float(closes[-2]), 4) if len(closes) >= 2 else price
            change_pct = round((price - prev) / prev * 100, 2) if prev else 0.0
            vol_raw = next((v for v in reversed(volumes) if v is not None), 0)
            vol = int(vol_raw) if vol_raw and not _math.isnan(float(vol_raw)) else 0
            week_closes = [round(float(c), 4) for c in closes]
            week_change_pct = round((price - week_closes[0]) / week_closes[0] * 100, 2) if len(week_closes) >= 2 else 0.0

            return {
                "market": market, "symbol": symbol,
                "name": TICKER_NAMES.get(symbol, symbol),
                "price": price, "prev_close": prev,
                "change_pct": change_pct, "volume": vol,
                "week_closes": week_closes, "week_change_pct": week_change_pct,
            }
        except Exception as e:
            print(f"[Quotes] {symbol}: {e}")
            return {
                "market": market, "symbol": symbol,
                "name": TICKER_NAMES.get(symbol, symbol),
                "price": None, "prev_close": None, "change_pct": None, "volume": None,
                "error": str(e),
            }

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_one, m, s): (m, s) for m, s in tickers}
        for fut in as_completed(futures):
            results.append(fut.result())

    # Preserve original market/symbol order
    order = {(m, s): i for i, (m, s) in enumerate(tickers)}
    results.sort(key=lambda r: order.get((r["market"], r["symbol"]), 999))
    return results


@protected.get("/market/events")
def get_market_events(db: Session = Depends(get_db)):
    """Fetch upcoming earnings, dividends AND link recent WebResearch news."""
    cached = cache_get("market_events")
    if cached is not None:
        return cached
    from datetime import timezone
    import datetime as _dt
    import re

    events = []

    import requests as _req

    def _yahoo_quote_summary_safe(symbol: str, modules: str) -> dict:
        """Direct quoteSummary call — used only for calendar/earnings."""
        try:
            url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}?modules={modules}"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; market-analysis/1.0)"}
            r = _req.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            data = r.json()
            return (data.get("quoteSummary", {}).get("result") or [{}])[0]
        except Exception:
            return {}

    # 1. Fetch recent WebResearch items once
    recent_research = db.query(models.WebResearch).order_by(models.WebResearch.fetched_at.desc()).limit(300).all()
    seen_news_titles: set[str] = set()

    for market, symbols in MARKET_TICKERS.items():
        for symbol in symbols:
            try:
                name = TICKER_NAMES.get(symbol, symbol)

                # ── Earnings & dividends (US & India only — reliable data) ──
                if market in ("US", "India"):
                    try:
                        cal_data = _yahoo_quote_summary_safe(symbol, "calendarEvents")
                        cal_events_data = cal_data.get("calendarEvents") or {}
                        # Earnings
                        earnings = cal_events_data.get("earnings") or {}
                        ed_raw = earnings.get("earningsDate") or []
                        for ed_item in ed_raw[:1]:
                            try:
                                ts = ed_item.get("raw")
                                if ts:
                                    date_str = _dt.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                                    events.append({
                                        "market": market, "symbol": symbol, "name": name,
                                        "event_type": "Earnings",
                                        "date": date_str,
                                        "detail": None, "url": None,
                                    })
                            except Exception:
                                pass
                        # Dividend
                        div_ts = (cal_events_data.get("dividendDate") or {}).get("raw") or \
                                 (cal_events_data.get("exDividendDate") or {}).get("raw")
                        if div_ts:
                            try:
                                div_date_str = _dt.datetime.utcfromtimestamp(div_ts).strftime("%Y-%m-%d")
                                events.append({
                                    "market": market, "symbol": symbol, "name": name,
                                    "event_type": "Dividend",
                                    "date": div_date_str,
                                    "detail": None, "url": None,
                                })
                            except Exception:
                                pass
                    except Exception:
                        pass

                # ── Map Recent News from WebResearch ──────────────────────
                try:
                    clean_sym = symbol.split(".")[0].replace("-USD", "").replace("=F", "")
                    sym_pattern = re.compile(r'\b' + re.escape(clean_sym) + r'\b')
                    name_lower = name.lower()

                    matched_items = []
                    for r in recent_research:
                        title = r.title or ""
                        snippet = r.snippet or ""
                        query = r.query or ""

                        # 1. Exact query match (e.g. stocktwits:AAPL)
                        is_match = False
                        if f":{clean_sym}" in query or f":{symbol}" in query:
                            is_match = True
                        # 2. Text match (name or symbol)
                        elif name_lower in title.lower() or name_lower in snippet.lower():
                            is_match = True
                        elif sym_pattern.search(title) or sym_pattern.search(snippet):
                            is_match = True

                        if is_match and title not in seen_news_titles:
                            seen_news_titles.add(title)
                            matched_items.append(r)
                            if len(matched_items) >= 8:
                                break

                    for r in matched_items:
                        pub_ts = r.fetched_at.timestamp() if r.fetched_at else 0
                        date_str = r.fetched_at.strftime("%Y-%m-%d") if r.fetched_at else ""
                        events.append({
                            "market": market, "symbol": symbol, "name": name,
                            "event_type": "News",
                            "date": date_str,
                            "pub_ts": pub_ts,
                            "detail": r.query.split(":")[0].capitalize() if ":" in r.query else "Web Research",
                            "url": r.source_url or None,
                            "title": r.title,
                        })
                except Exception:
                    pass

            except Exception:
                pass

    # Sort news by publish timestamp desc (most recent first), earnings/dividends by date asc
    news_events = sorted([e for e in events if e["event_type"] == "News"], key=lambda x: x.get("pub_ts") or 0, reverse=True)
    cal_events  = sorted([e for e in events if e["event_type"] != "News"], key=lambda x: x["date"])
    result = cal_events + news_events
    cache_set("market_events", result, _TTL_MARKET_EVT)
    return result


# --- Darwin / Evolution Endpoints ---

@protected.get("/agents/fitness")
def get_agent_fitness(db: Session = Depends(get_db)):
    """Returns current fitness scores for all agents based on recent predictions."""
    if not _is_pipeline_running(db):
        cached = cache_get("agents_fitness")
        if cached is not None:
            return cached
    from sqlalchemy import func
    from pipeline.validator import _compute_fitness

    from pipeline.validator import _compute_fitness, _compute_streak
    agents = db.query(models.AgentPrompt).all()
    result = []
    for a in agents:
        fitness = _compute_fitness(db, a.agent_name)
        gen = db.query(models.AgentPromptHistory).filter(
            models.AgentPromptHistory.agent_name == a.agent_name
        ).count() + 1
        streak = _compute_streak(db, a.agent_name)
        # Last evolution
        last_evo = (
            db.query(models.AgentPromptHistory)
            .filter(models.AgentPromptHistory.agent_name == a.agent_name)
            .order_by(models.AgentPromptHistory.generation.desc())
            .first()
        )
        # Recent predictions (last 5)
        recent_preds = (
            db.query(models.AgentPrediction)
            .filter(models.AgentPrediction.agent_name == a.agent_name)
            .order_by(models.AgentPrediction.timestamp.desc())
            .limit(5)
            .all()
        )
        result.append({
            "agent_name":    a.agent_name,
            "generation":    gen,
            "fitness_score": fitness["fitness_score"],
            "win_rate":      fitness["win_rate"],
            "avg_return":    fitness["avg_return"],
            "total_scored":  fitness["total_scored"],
            "streak":        streak,
            "updated_at":    a.updated_at.isoformat() if a.updated_at else None,
            "last_evolution": {
                "reason":   last_evo.evolution_reason,
                "replaced_at": last_evo.replaced_at.isoformat() if last_evo and last_evo.replaced_at else None,
                "fitness_score": last_evo.fitness_score,
            } if last_evo else None,
            "recent_predictions": [
                {
                    "symbol":   p.symbol,
                    "prediction": p.prediction,
                    "score":    p.score,
                    "actual_outcome": p.actual_outcome,
                    "timestamp": p.timestamp.isoformat() if p.timestamp else None,
                }
                for p in recent_preds
            ],
        })
    cache_set("agents_fitness", result, _TTL_FITNESS)
    return result


@protected.get("/agents/evolution/{agent_name}")
def get_agent_evolution(agent_name: str, db: Session = Depends(get_db)):
    """Returns full prompt evolution history for a single agent."""
    cache_key = f"agent_evolution:{agent_name}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    history = (
        db.query(models.AgentPromptHistory)
        .filter(models.AgentPromptHistory.agent_name == agent_name)
        .order_by(models.AgentPromptHistory.generation.desc())
        .all()
    )
    result = [
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
    cache_set(cache_key, result, _TTL_EVOLUTION)
    return result

# --- Agent Prompts Endpoint ---

@protected.get("/agents")
def get_agents(db: Session = Depends(get_db)):
    """Get all agent prompts."""
    agents = db.query(models.AgentPrompt).all()
    return [
        {
            "id": a.id,
            "agent_name": a.agent_name,
            "description": a.description,
            "system_prompt": a.system_prompt,
            "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        }
        for a in agents
    ]

@protected.post("/agents")
def create_agent(body: dict, db: Session = Depends(get_db)):
    """Create a new custom agent."""
    name = body.get("agent_name", "").strip()
    description = body.get("description", "").strip()
    system_prompt = body.get("system_prompt", "").strip()

    if not name or not system_prompt:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="agent_name and system_prompt are required")
    
    existing = db.query(models.AgentPrompt).filter(models.AgentPrompt.agent_name == name).first()
    if existing:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Agent '{name}' already exists")

    new_agent = models.AgentPrompt(
        agent_name=name,
        description=description or "Specialist analyst.",
        system_prompt=system_prompt
    )
    db.add(new_agent)
    db.commit()
    cache_invalidate("agents_fitness")
    return {"status": "created", "agent_name": name}

@protected.delete("/agents/{agent_name}")
def delete_agent(agent_name: str, db: Session = Depends(get_db)):
    """Remove an agent and their history."""
    agent = db.query(models.AgentPrompt).filter(models.AgentPrompt.agent_name == agent_name).first()
    if not agent:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # We could archive history or just delete. Removing for simplicity as per user request.
    db.query(models.AgentPromptHistory).filter(models.AgentPromptHistory.agent_name == agent_name).delete()
    db.query(models.AgentPrediction).filter(models.AgentPrediction.agent_name == agent_name).delete()
    db.query(models.AgentMemory).filter(models.AgentMemory.agent_name == agent_name).delete()
    
    db.delete(agent)
    db.commit()
    cache_invalidate("agents_fitness")
    cache_invalidate(f"agent_evolution:{agent_name}")
    return {"status": "deleted", "agent_name": agent_name}

@protected.post("/agents/build-prompt")
def build_agent_prompt(body: dict):
    """
    Interactive AI assistant for designing agent prompts.
    Takes user 'instruction' and 'current_prompt' (optional) and returns 'suggested_prompt' and 'suggested_name'.
    """
    instruction = body.get("instruction", "")
    current_prompt = body.get("current_prompt", "")
    
    if not instruction:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="instruction is required")

    from agents.llm import query_agent

    builder_system = """You are an AI Agent Architect. Your goal is to help a user design a high-performance system prompt for a financial analyst agent.
The analyst agent participates in a 'Debate' where multiple agents (Value, Technical, Macro, Sentiment) discuss tickers.

Each agent prompt MUST follow this structure:
=== IDENTITY ===
(Role, years of experience, unique edge)

=== CONSTITUTION ===
ANALYSIS FRAMEWORK:
(Specific rules, data focus, time-decay rules)
RULES:
(Constraints, things to avoid)

=== EVOLVED_GUIDELINES ===
No evolved guidelines yet. (Default state)

Output ONLY the final system prompt in the exact format above. 
Also, suggest a short, descriptive name for the agent (2-4 words).
Format your entire output as JSON:
{
  "agent_name": "Suggested Name",
  "system_prompt": "...the full prompt...",
  "description": "Short description for dispatcher LLM (15-20 words)."
}
"""
    
    user_input = f"USER INSTRUCTIONS: {instruction}\n"
    if current_prompt:
        user_input += f"\nCURRENT PROMPT TO REFINE:\n{current_prompt}"

    try:
        response_raw = query_agent(builder_system, user_input)
        # Attempt to parse JSON from response
        import json
        import re
        # Find JSON block
        match = re.search(r'\{.*\}', response_raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        else:
            # Fallback if LLM didn't output pure JSON
            return {"status": "error", "raw": response_raw, "detail": "Could not parse AI response as JSON"}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"AI Builder failed: {str(e)}")

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
    from pipeline.validator import _archive_prompt
    _archive_prompt(db, agent_name, "MANUAL", {
        "fitness_score": None, "win_rate": None, "avg_return": None, "total_scored": 0
    })

    agent.system_prompt = new_prompt
    agent.updated_at = datetime.utcnow()
    db.commit()
    cache_invalidate("agents_fitness")
    cache_invalidate(f"agent_evolution:{agent_name}")
    return {"status": "updated", "agent_name": agent_name}


# --- Agent Memory Endpoints ---

@protected.get("/memory")
def get_all_memory(db: Session = Depends(get_db)):
    """Get recent memory notes for all agents."""
    if not _is_pipeline_running(db):
        cached = cache_get("memory_all")
        if cached is not None:
            return cached
    memories = (
        db.query(models.AgentMemory)
        .order_by(models.AgentMemory.created_at.desc())
        .limit(50)
        .all()
    )
    result = [
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
    cache_set("memory_all", result, _TTL_MEMORY)
    return result

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
    if not _is_pipeline_running(db):
        cached = cache_get("research")
        if cached is not None:
            return cached
    research = (
        db.query(models.WebResearch)
        .order_by(models.WebResearch.fetched_at.desc())
        .limit(200)
        .all()
    )
    result = [
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
    cache_set("research", result, _TTL_RESEARCH)
    return result

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


@protected.post("/config/markets/{market_name}/exit-positions")
def exit_market_positions(market_name: str, db: Session = Depends(get_db)):
    """Close all ACTIVE/PENDING strategies for a given market at current market price."""
    from data.market import fetch_market_data
    from datetime import datetime as dt

    tickers = MARKET_TICKERS.get(market_name, [])
    if not tickers:
        raise HTTPException(status_code=404, detail=f"Unknown market: {market_name}")

    closed = []
    for symbol in tickers:
        strats = db.query(models.DeployedStrategy).filter(
            models.DeployedStrategy.symbol == symbol,
            models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]),
        ).all()
        for s in strats:
            sig = fetch_market_data(s.symbol)
            exit_px = sig.price if sig else s.entry_price
            if s.entry_price and exit_px:
                pct = ((exit_px - s.entry_price) / s.entry_price * 100) if s.strategy_type == "LONG" \
                      else ((s.entry_price - exit_px) / s.entry_price * 100)
            else:
                pct = 0.0
            position = s.position_size or 0.0
            s.status = "CLOSED"
            s.exit_price = exit_px
            s.current_return = round(pct, 4)
            s.realized_pnl = round(position * pct / 100, 2) if position else None
            s.close_reason = "MARKET_DISABLED"
            s.closed_at = dt.utcnow()
            closed.append({"id": s.id, "symbol": s.symbol, "pct": round(pct, 2)})

    db.commit()
    cache_invalidate("debates")
    cache_invalidate("pipeline_runs")
    return {"closed": closed, "count": len(closed)}

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
    cache_invalidate("debates")
    cache_invalidate("pipeline_runs")
    return {"status": strategy.status, "id": strategy.id}

# --- Manual Trigger & Scheduling ---

import threading
import json as _json
import uuid as _uuid

class TriggerRequest(BaseModel):
    tickers: List[str] | None = None

@protected.post("/trigger")
def manual_trigger(body: TriggerRequest = TriggerRequest(), db: Session = Depends(get_db)):
    """Manually triggers a new debate round via the pipeline chain. Optionally pass {"tickers": ["AAPL", "NVDA"]} to focus the run."""
    is_running = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if is_running and is_running.value == "1":
        return {"status": "error", "message": "A data extraction is already running. Please wait."}

    focus = [t.strip().upper() for t in body.tickers if t.strip()] if body.tickers else None

    # Acquire concurrency lock
    lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if not lock:
        db.add(models.AppConfig(key="debate_running", value="1"))
    else:
        lock.value = "1"

    run_id = str(_uuid.uuid4())

    # Load investment focus
    focus_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "investment_focus").first()
    investment_focus = focus_conf.value.strip() if focus_conf and focus_conf.value else ""

    run = models.PipelineRun(
        run_id=run_id,
        step="pending",
        investment_focus=investment_focus,
        focus_tickers=_json.dumps(focus) if focus else None,
    )
    db.add(run)

    # Set current_run_id
    run_id_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
    if run_id_conf:
        run_id_conf.value = run_id
    else:
        db.add(models.AppConfig(key="current_run_id", value=run_id))
    db.commit()

    from pipeline.runner import run_full_pipeline
    # Run in a daemon thread so the HTTP response returns immediately and
    # uvicorn --reload can restart without waiting for the pipeline to finish.
    t = threading.Thread(target=run_full_pipeline, args=(run_id,), daemon=True)
    t.start()

    # Invalidate all caches that are affected by a pipeline run completing
    cache_invalidate("pipeline_runs")
    cache_invalidate("debates")
    cache_invalidate("research")
    cache_invalidate("memory_all")
    cache_invalidate("agents_fitness")
    cache_invalidate("kg_full")
    cache_invalidate_prefix("kg_ticker:")

    msg = f"Focused pipeline run on: {', '.join(focus)}" if focus else "Full pipeline started."
    return {"status": "success", "message": msg, "run_id": run_id}

@protected.post("/eval/trigger")
def trigger_eval(db: Session = Depends(get_db)):
    """Manually trigger an evaluation pipeline run (score strategies, evolve agents)."""
    is_running = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if is_running and is_running.value == "1":
        return {"status": "error", "message": "A pipeline is already running. Please wait."}

    # Acquire concurrency lock
    lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if not lock:
        db.add(models.AppConfig(key="debate_running", value="1"))
    else:
        lock.value = "1"
    db.commit()

    # Run eval in a background thread
    from pipeline.validator import evaluate_predictions

    def _run_eval_and_release():
        try:
            evaluate_predictions()
        finally:
            _db = SessionLocal()
            try:
                conf = _db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
                if conf:
                    conf.value = "0"
                _db.commit()
            except Exception:
                pass
            finally:
                _db.close()
            cache_invalidate("pipeline_runs")
            cache_invalidate("agents_fitness")
            cache_invalidate("memory_all")
            cache_invalidate_prefix("agent_evolution:")

    t = threading.Thread(target=_run_eval_and_release, daemon=True)
    t.start()

    cache_invalidate("pipeline_runs")
    return {"status": "success", "message": "Evaluation pipeline started."}


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
    cache_invalidate("pipeline_runs")
    cache_invalidate_prefix("pipeline_events")
    return {"status": "stopped"}


@protected.post("/pipeline/resume/{run_id}")
def resume_pipeline_run(run_id: str, db: Session = Depends(get_db)):
    """Resume a stalled or errored pipeline run from its last saved checkpoint."""
    import threading
    run = db.query(models.PipelineRun).filter(models.PipelineRun.run_id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.step == "done":
        return {"status": "already_complete", "run_id": run_id}

    # Check concurrency lock
    lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if lock and lock.value == "1":
        return {"status": "already_running"}

    # Acquire lock and clear error state if needed
    if lock:
        lock.value = "1"
    else:
        db.add(models.AppConfig(key="debate_running", value="1"))
    if run.step == "error":
        # Determine where to resume from based on saved checkpoint data
        if run.proposals_json and '"verdicts"' in (run.proposals_json or ""):
            run.step = "deploy"
        elif run.proposals_json:
            run.step = "consensus"
        elif run.shared_context:
            run.step = "agents"
        else:
            run.step = "pending"
    db.commit()

    from pipeline.runner import resume_pipeline
    t = threading.Thread(target=resume_pipeline, args=(run_id,), daemon=True)
    t.start()
    cache_invalidate("pipeline_runs")
    return {"status": "resuming", "run_id": run_id, "from_step": run.step}

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
    from data.market import fetch_market_data
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
    cache_invalidate("debates")
    cache_invalidate("pipeline_runs")
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

    # Pre-compute per-position returns first, then derive allocations
    active_strats_list = [s for s in all_strats if s.status == "ACTIVE"]
    n_active = len(active_strats_list)

    # If no position has a size set, assume equal-weight allocation across active positions
    any_sized = any(s.position_size for s in active_strats_list)
    assumed_per_pos = (total_budget / n_active) if (n_active > 0 and not any_sized) else None

    for s in all_strats:
        explicit_size = s.position_size or 0.0

        if s.status == "CLOSED":
            rpnl = s.realized_pnl or 0.0
            realized_pnl += rpnl
            positions.append({
                **_strategy_to_dict(s),
                "pnl_usd": rpnl if explicit_size else None,
                "pnl_pct": s.current_return,
                "current_price": s.exit_price,
                "is_open": False,
            })
        elif s.status == "ACTIVE":
            # Use explicit size if set, else assumed equal-weight size for portfolio math
            effective_size = explicit_size if explicit_size else (assumed_per_pos or 0.0)
            allocated += explicit_size  # only count explicitly sized positions toward "allocated"

            live_price = live_prices.get(s.symbol)
            if live_price and s.entry_price:
                if s.strategy_type == "LONG":
                    pct = ((live_price - s.entry_price) / s.entry_price) * 100
                else:
                    pct = ((s.entry_price - live_price) / s.entry_price) * 100
                s.current_return = round(pct, 4)
            else:
                pct = s.current_return or 0.0

            upnl_for_summary = (effective_size * pct / 100) if effective_size else 0.0
            upnl_for_card = (explicit_size * pct / 100) if explicit_size else None
            unrealized_pnl += upnl_for_summary

            positions.append({
                **_strategy_to_dict(s),
                "pnl_usd": upnl_for_card,
                "pnl_pct": pct,
                "current_price": live_price,
                "is_open": True,
                "assumed_size": round(assumed_per_pos, 2) if assumed_per_pos else None,
            })

    db.commit()  # persist updated current_return values

    # When no positions are explicitly sized, show assumed allocation figures
    effective_allocated = total_budget if (n_active > 0 and not any_sized) else allocated
    available = total_budget - effective_allocated
    total_pnl = realized_pnl + unrealized_pnl

    return {
        "total_budget":    total_budget,
        "allocated":       round(effective_allocated, 2),
        "available":       round(available, 2),
        "realized_pnl":    round(realized_pnl, 2),
        "unrealized_pnl":  round(unrealized_pnl, 2),
        "total_pnl":       round(total_pnl, 2),
        "total_pnl_pct":   round((total_pnl / total_budget * 100) if total_budget else 0, 2),
        "positions":       positions,
        "using_assumed_sizes": not any_sized and n_active > 0,
    }


# ── Knowledge Graph endpoints ─────────────────────────────────────────────────

@protected.get("/knowledge-graph")
def get_knowledge_graph(db: Session = Depends(get_db)):
    """Return all nodes and deduplicated edges (capped at 500 nodes)."""
    if not _is_pipeline_running(db):
        cached = cache_get("kg_full")
        if cached is not None:
            return cached
    from graph.knowledge import get_full_graph
    result = get_full_graph(db, limit_nodes=500)
    cache_set("kg_full", result, _TTL_GRAPH)
    return result


@protected.get("/knowledge-graph/ticker/{symbol}")
def get_ticker_kg(symbol: str, hops: int = 2, db: Session = Depends(get_db)):
    """Return the 1–3 hop subgraph centered on a ticker."""
    hops = max(1, min(hops, 3))
    cache_key = f"kg_ticker:{symbol.upper()}:{hops}"
    if not _is_pipeline_running(db):
        cached = cache_get(cache_key)
        if cached is not None:
            return cached
    from graph.knowledge import get_ticker_subgraph
    result = get_ticker_subgraph(db, symbol.upper(), hops=hops)
    cache_set(cache_key, result, _TTL_GRAPH)
    return result


@protected.get("/cache/stats")
def get_cache_stats():
    """Return current cache state for debugging."""
    return cache_stats()


# --- Data Sources Status ---

@protected.get("/config/data-sources")
def get_data_sources_status():
    """Return which optional API keys are configured (key presence only, never the values)."""
    import os
    sources = [
        # Market data — always on
        {
            "id": "yfinance",
            "name": "Yahoo Finance",
            "category": "Market Data",
            "description": "OHLCV prices, fundamentals, options chain",
            "configured": True,
            "required": True,
            "url": "https://finance.yahoo.com",
        },
        # News RSS — always on
        {
            "id": "rss_global",
            "name": "Global RSS Feeds",
            "category": "News",
            "description": "MarketWatch, WSJ, FT, NYT, Seeking Alpha, Investing.com",
            "configured": True,
            "required": True,
            "url": None,
        },
        {
            "id": "rss_crypto",
            "name": "Crypto RSS Feeds",
            "category": "News",
            "description": "CoinTelegraph, CryptoSlate, Bitcoin Magazine, Decrypt",
            "configured": True,
            "required": True,
            "url": None,
        },
        {
            "id": "rss_india",
            "name": "India RSS Feeds",
            "category": "News",
            "description": "Economic Times, Moneycontrol, Livemint, The Hindu",
            "configured": True,
            "required": True,
            "url": None,
        },
        {
            "id": "google_news",
            "name": "Google News RSS",
            "category": "News",
            "description": "Targeted ticker/topic news queries",
            "configured": True,
            "required": True,
            "url": None,
        },
        # Social — no auth
        {
            "id": "stocktwits",
            "name": "Stocktwits",
            "category": "Social",
            "description": "Trending symbols and message stream (no key needed)",
            "configured": True,
            "required": False,
            "url": "https://stocktwits.com",
        },
        {
            "id": "reddit_wsb",
            "name": "Reddit WallStreetBets",
            "category": "Social",
            "description": "Top posts JSON (unauthenticated)",
            "configured": True,
            "required": False,
            "url": "https://www.reddit.com/r/wallstreetbets",
        },
        # Optional API keys
        {
            "id": "alpha_vantage",
            "name": "Alpha Vantage",
            "category": "Sentiment",
            "description": "News sentiment scores, ticker-aware (ALPHA_VANTAGE_API_KEY)",
            "configured": bool(os.getenv("ALPHA_VANTAGE_API_KEY", "")),
            "required": False,
            "signup_url": "https://www.alphavantage.co/support/#api-key",
            "env_key": "ALPHA_VANTAGE_API_KEY",
        },
        {
            "id": "fred",
            "name": "FRED (Federal Reserve)",
            "category": "Macro",
            "description": "Yield curve, CPI, Fed Funds rate, unemployment, USD index (FRED_API_KEY)",
            "configured": bool(os.getenv("FRED_API_KEY", "")),
            "required": False,
            "signup_url": "https://fred.stlouisfed.org/docs/api/api_key.html",
            "env_key": "FRED_API_KEY",
        },
        {
            "id": "finnhub",
            "name": "Finnhub",
            "category": "Macro",
            "description": "Economic calendar, earnings dates (FINNHUB_API_KEY)",
            "configured": bool(os.getenv("FINNHUB_API_KEY", "")),
            "required": False,
            "signup_url": "https://finnhub.io/register",
            "env_key": "FINNHUB_API_KEY",
        },
        # LLM
        {
            "id": "openrouter",
            "name": "OpenRouter",
            "category": "LLM",
            "description": "Primary LLM gateway for all agents and judge (OPENROUTER_API_KEY)",
            "configured": bool(os.getenv("OPENROUTER_API_KEY", "")),
            "required": True,
            "signup_url": "https://openrouter.ai/keys",
            "env_key": "OPENROUTER_API_KEY",
        },
    ]
    return {"sources": sources}


# --- RSS Feed Management ---

class RssFeedCreate(BaseModel):
    url: str
    label: str
    market: str = "US"

@protected.get("/config/rss-feeds")
def list_rss_feeds(db: Session = Depends(get_db)):
    feeds = db.query(models.RssFeed).order_by(models.RssFeed.market, models.RssFeed.label).all()
    return [
        {
            "id": f.id,
            "url": f.url,
            "label": f.label,
            "market": f.market,
            "is_enabled": f.is_enabled,
            "is_builtin": f.is_builtin,
        }
        for f in feeds
    ]

@protected.post("/config/rss-feeds")
def add_rss_feed(body: RssFeedCreate, db: Session = Depends(get_db)):
    existing = db.query(models.RssFeed).filter(models.RssFeed.url == body.url).first()
    if existing:
        raise HTTPException(status_code=409, detail="Feed URL already exists")
    feed = models.RssFeed(url=body.url, label=body.label, market=body.market, is_enabled=1, is_builtin=0)
    db.add(feed)
    db.commit()
    db.refresh(feed)
    cache_invalidate("rss_feeds")
    return {"id": feed.id, "url": feed.url, "label": feed.label, "market": feed.market, "is_enabled": feed.is_enabled, "is_builtin": feed.is_builtin}

@protected.patch("/config/rss-feeds/{feed_id}/toggle")
def toggle_rss_feed(feed_id: int, db: Session = Depends(get_db)):
    feed = db.query(models.RssFeed).filter(models.RssFeed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    feed.is_enabled = 0 if feed.is_enabled else 1
    db.commit()
    cache_invalidate("rss_feeds")
    return {"id": feed.id, "is_enabled": feed.is_enabled}

@protected.delete("/config/rss-feeds/{feed_id}")
def delete_rss_feed(feed_id: int, db: Session = Depends(get_db)):
    feed = db.query(models.RssFeed).filter(models.RssFeed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    if feed.is_builtin:
        raise HTTPException(status_code=403, detail="Cannot delete built-in feeds — disable them instead")
    db.delete(feed)
    db.commit()
    cache_invalidate("rss_feeds")
    return {"deleted": feed_id}
