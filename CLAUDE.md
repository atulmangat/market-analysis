# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multi-agent AI stock market analysis system. Four LLM agents (Value Investor, Technical Analyst, Macro Economist, Sentiment Analyst) debate each round, vote on a consensus LONG/SHORT strategy, and deploy it. Agents accumulate persistent memory across rounds, and a validator loop scores past predictions and can auto-improve agent prompts via LLM reflection.

## Running the System

### Backend (FastAPI)
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt  # if needed
uvicorn main:app --reload
```
Backend runs at `http://localhost:8000`. API docs at `/docs`.

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at `http://localhost:5173` and calls the backend at `http://localhost:8000/api`.

### Lint (frontend)
```bash
cd frontend
npm run lint
```

### Build (frontend)
```bash
cd frontend
npm run build
```

## Environment Variables

Create `backend/.env`:
```
OPENROUTER_API_KEY=your_key_here
LLM_MODEL=stepfun/step-3.5-flash:free          # optional override
FALLBACK_LLM_MODEL=minimax/minimax-m2.5:nitro  # optional override
```

The backend uses **OpenRouter** (OpenAI-compatible API) for all LLM calls. Primary model falls back to the secondary model on failure.

## Architecture

### Backend modules
| File | Responsibility |
|---|---|
| `main.py` | FastAPI app, APScheduler setup, CORS. Runs `run_debate` and `evaluate_predictions` on a configurable interval (default 60 min). |
| `orchestrator.py` | `run_debate()` — fetches web research + news, queries each agent, extracts `TICKER:X, ACTION:LONG/SHORT` via regex, votes for consensus, deploys strategy, writes agent memory. |
| `agents.py` | `query_agent()` — thin wrapper around OpenRouter with primary/fallback model retry. |
| `api.py` | FastAPI router for all REST endpoints under `/api`. Includes `/trigger` for manual debate, `/strategies/approve` for manual approval, schedule/market/mode config endpoints. |
| `validator.py` | `evaluate_predictions()` — scores active strategies against live prices, closes at −10% (stop-loss) or +15% (take-profit), writes LESSON/STRATEGY_RESULT memory, auto-improves underperforming agent prompts via LLM. |
| `memory_manager.py` | Read/write/prune per-agent `AgentMemory` notes. Each agent carries up to 50 recent notes injected into their LLM context. |
| `web_research.py` | Fetches real-time news from Google News RSS + Yahoo Finance. Caches results in DB for 30 minutes to avoid redundant fetches. |
| `data_ingestion.py` | Fetches current price for a ticker via `yfinance` and stores as `MarketSignal`. |
| `models.py` | SQLAlchemy models: `MarketSignal`, `AgentPrediction`, `DeployedStrategy`, `AgentPrompt`, `MarketConfig`, `DebateRound`, `AppConfig`, `AgentMemory`, `WebResearch`. |
| `database.py` | SQLite DB at `./market_analysis.db`. Session factory and `get_db` dependency. |
| `seed.py` | One-time seeding utility. |

### Frontend
Single-page React app (`frontend/src/App.tsx`) — all UI in one file. Polls the backend every 10 seconds. Displays: deployed strategies with approval controls, agent memory feed, debate history timeline by ticker, market selection toggles, schedule interval picker, and web research feed.

### Key data flows
1. **Debate cycle**: `run_debate()` → fetch web research (cached 30 min) → each agent gets research + memory + performance summary → LLM response → regex extract ticker/action → majority vote → deploy `DeployedStrategy` → write `AgentMemory` observations.
2. **Evaluation cycle**: `evaluate_predictions()` → fetch live prices → update `current_return` on active strategies → write STRATEGY_RESULT/LESSON memory → close at stop-loss/take-profit thresholds → auto-improve low-scoring agent prompts.
3. **Approval modes**: `auto` (strategies deploy immediately as ACTIVE) vs `manual` (strategies start as PENDING, require frontend approval).

### Markets and tickers
Defined in `orchestrator.py → MARKET_TICKERS`: US (8 stocks), India (8 NSE stocks with `.NS` suffix), Crypto (7 pairs with `-USD` suffix), MCX (5 futures with `=F` suffix). Per-market enable/disable is persisted in `MarketConfig` table and controlled from the frontend.

### APScheduler concurrency lock
A `debate_running` key in `AppConfig` acts as a distributed lock to prevent concurrent debate runs. Always released in the `finally` block.
