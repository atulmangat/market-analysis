from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from database import get_db
from pydantic import BaseModel
from typing import List
from datetime import datetime
import json
import math
import models
import yfinance as yf
from auth import require_auth, verify_password, create_token, check_rate_limit, record_failed_attempt, record_success
from cache import cache_get, cache_set, cache_invalidate, cache_invalidate_prefix, cache_stats

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
            "analyst_recommendation": info.get("recommendationKey"),
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

    # ── 1 query: DEPLOY DONE events for all runs ──────────────────────────────
    deploy_events = db.query(models.PipelineEvent).filter(
        models.PipelineEvent.run_id.in_(run_ids),
        models.PipelineEvent.step == "DEPLOY",
        models.PipelineEvent.status == "DONE",
    ).all()
    deploy_by_run = {e.run_id: e for e in deploy_events}

    # ── 1 query: current run id + is_running ─────────────────────────────────
    configs = db.query(models.AppConfig).filter(
        models.AppConfig.key.in_(["current_run_id", "debate_running"])
    ).all()
    cfg = {c.key: c.value for c in configs}
    current_run_id = cfg.get("current_run_id")
    is_running = cfg.get("debate_running") == "1"

    # ── 1 query: all strategies that fall within any run's time window ────────
    min_start = min(r.started_at for r in rows)
    max_end   = max(r.ended_at   for r in rows)
    strategies_in_window = (
        db.query(models.DeployedStrategy)
        .filter(
            models.DeployedStrategy.timestamp >= min_start,
            models.DeployedStrategy.timestamp <= max_end,
        )
        .order_by(models.DeployedStrategy.timestamp.desc())
        .all()
    )

    # ── 1 query: debate rounds for those strategies ───────────────────────────
    dr_ids = [s.debate_round_id for s in strategies_in_window if s.debate_round_id]
    debate_rounds = {}
    if dr_ids:
        for dr in db.query(models.DebateRound).filter(models.DebateRound.id.in_(dr_ids)).all():
            debate_rounds[dr.id] = dr

    # ── Assemble in Python ────────────────────────────────────────────────────
    result = []
    for row in rows:
        if row.run_id == current_run_id and is_running:
            status = "running"
        elif row.run_id in deploy_by_run:
            # Only truly "done" if DEPLOY step completed successfully
            status = "done"
        else:
            # Stopped mid-way — whether it has an ERROR event or just never finished
            status = "error"

        # Find strategy created within this run's time window
        strategy = next(
            (s for s in strategies_in_window
             if row.started_at <= s.timestamp <= row.ended_at),
            None
        )
        debate_round = debate_rounds.get(strategy.debate_round_id) if strategy and strategy.debate_round_id else None

        output = None
        if debate_round:
            try:
                proposals = json.loads(debate_round.proposals_json or "[]")
            except Exception:
                proposals = []
            output = {
                "ticker":          debate_round.consensus_ticker,
                "action":          debate_round.consensus_action,
                "votes":           debate_round.consensus_votes,
                "judge_reasoning": (debate_round.judge_reasoning or "")[:300],
                "proposals":       proposals,
                "strategy_id":     strategy.id if strategy else None,
                "debate_id":       debate_round.id,
            }

        deploy_ev = deploy_by_run.get(row.run_id)
        result.append({
            "run_id":        row.run_id,
            "started_at":    row.started_at.isoformat(),
            "ended_at":      row.ended_at.isoformat(),
            "event_count":   row.event_count,
            "status":        status,
            "deploy_detail": deploy_ev.detail if deploy_ev else None,
            "output":        output,
        })

    # Cache unless actively running
    if result and not is_running:
        cache_set("pipeline_runs", result, _TTL_RUNS_LIST)
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
                week_closes = [round(float(v), 4) for v in col.tolist() if not _math.isnan(float(v))]
                week_change_pct = round((price - week_closes[0]) / week_closes[0] * 100, 2) if len(week_closes) >= 2 else 0.0

                results.append({
                    "market":           market,
                    "symbol":           symbol,
                    "name":             TICKER_NAMES.get(symbol, symbol),
                    "price":            round(price, 4),
                    "prev_close":       round(prev, 4),
                    "change_pct":       round(change_pct, 2),
                    "volume":           vol,
                    "week_closes":      week_closes,
                    "week_change_pct":  week_change_pct,
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
    cached = cache_get("market_events")
    if cached is not None:
        return cached
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
    result = cal_events + news_events
    cache_set("market_events", result, _TTL_MARKET_EVT)
    return result


# --- Darwin / Evolution Endpoints ---

@protected.get("/agents/fitness")
def get_agent_fitness(db: Session = Depends(get_db)):
    """Returns current fitness scores for all agents based on recent predictions."""
    cached = cache_get("agents_fitness")
    if cached is not None:
        return cached
    from sqlalchemy import func
    from validator import _compute_fitness

    agents = db.query(models.AgentPrompt).all()
    result = []
    for a in agents:
        fitness = _compute_fitness(db, a.agent_name)
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
    cache_invalidate("agents_fitness")
    cache_invalidate(f"agent_evolution:{agent_name}")
    return {"status": "updated", "agent_name": agent_name}


# --- Agent Memory Endpoints ---

@protected.get("/memory")
def get_all_memory(db: Session = Depends(get_db)):
    """Get recent memory notes for all agents."""
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
    cached = cache_get("research")
    if cached is not None:
        return cached
    research = (
        db.query(models.WebResearch)
        .order_by(models.WebResearch.fetched_at.desc())
        .limit(30)
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
    from data_ingestion import fetch_market_data
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

    from pipeline import run_full_pipeline
    run_full_pipeline(run_id)

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
    cached = cache_get("kg_full")
    if cached is not None:
        return cached
    from knowledge_graph import get_full_graph
    result = get_full_graph(db, limit_nodes=500)
    cache_set("kg_full", result, _TTL_GRAPH)
    return result


@protected.get("/knowledge-graph/ticker/{symbol}")
def get_ticker_kg(symbol: str, hops: int = 2, db: Session = Depends(get_db)):
    """Return the 1–3 hop subgraph centered on a ticker."""
    hops = max(1, min(hops, 3))
    cache_key = f"kg_ticker:{symbol.upper()}:{hops}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    from knowledge_graph import get_ticker_subgraph
    result = get_ticker_subgraph(db, symbol.upper(), hops=hops)
    cache_set(cache_key, result, _TTL_GRAPH)
    return result


@protected.get("/cache/stats")
def get_cache_stats():
    """Return current cache state for debugging."""
    return cache_stats()
