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

## Deploying to Vercel

IMPORTANT: Auto-deploy on git push is DISABLED for both Vercel projects. Always deploy manually using the CLI commands below. Never rely on a git push to trigger a deployment.

IMPORTANT: Deploy from the correct location. The `.vercel/project.json` in each directory pins the project.

### Frontend → market-analysis.space
```bash
cd /path/to/market-analysis   # repo ROOT (not frontend/)
npx vercel --prod --yes
```
This deploys to the `market-analysis-frontend` Vercel project, which owns `market-analysis.space`.
The root `.vercel/project.json` is linked to `market-analysis-frontend`.

### Backend
```bash
cd backend
npx vercel --prod --yes
```
This deploys to the `backend` Vercel project (aliased to `backend-jet-nine-93.vercel.app`).
The frontend `VITE_API_URL` on the `market-analysis-frontend` project points to this backend.

### Do NOT deploy frontend from frontend/
The `frontend/` subdirectory is linked to the `frontend` Vercel project which is NOT connected to `market-analysis.space`.

## Environment Variables

Create `backend/.env`:
```
OPENROUTER_API_KEY=your_key_here
LLM_MODEL=stepfun/step-3.5-flash:free          # optional override
FALLBACK_LLM_MODEL=minimax/minimax-m2.5:nitro  # optional override

# Optional enrichment data sources (all degrade gracefully if missing)
FRED_API_KEY=your_key_here            # free at https://fred.stlouisfed.org/docs/api/api_key.html
FINNHUB_API_KEY=your_key_here         # free tier at https://finnhub.io/
ALPHA_VANTAGE_API_KEY=your_key_here   # free tier at https://www.alphavantage.co/
```

The backend uses **OpenRouter** (OpenAI-compatible API) for all LLM calls. Primary model falls back to the secondary model on failure.

## Architecture

### Backend modules
| File | Responsibility |
|---|---|
| `main.py` | FastAPI app, APScheduler setup, CORS. Schedules `run_debate` and `evaluate_predictions` via cron. |
| `pipeline.py` | `run_full_pipeline(run_id)` — 4-step sequential pipeline: research → KG ingest → agents → consensus → deploy. Each step logs to `PipelineRun`. KG ingest has a 45s hard timeout to prevent serverless hangs. |
| `orchestrator.py` | Helper functions used by pipeline: `fetch_research_items`, `build_shared_retrieval_context`, `run_debate_panel`, `run_judge`, `get_enabled_markets`. |
| `knowledge_graph.py` | `ingest_retrieval_to_graph()` — extracts structured EVENT nodes and edges from research via LLM. `get_ticker_subgraph()` — 2-hop BFS for agent context. `build_kg_context_for_ticker()` — convenience wrapper. |
| `agents.py` | `query_agent()` — thin wrapper around OpenRouter with primary/fallback model retry. |
| `api.py` | FastAPI router for all REST endpoints under `/api`. Key endpoints: `/trigger`, `/system/stop`, `/system/status`, `/strategies/approve`, `/pipeline/runs`, `/pipeline/events`, `/config/*`. |
| `cache.py` | Two-level DB-backed cache (`cache_get`/`cache_set`/`cache_invalidate`). TTLs defined per endpoint in `api.py`. |
| `validator.py` | `evaluate_predictions()` — scores active strategies vs live prices, closes at −10% stop-loss or +15% take-profit, auto-improves agent prompts via LLM reflection. |
| `memory_manager.py` | Read/write/prune per-agent `AgentMemory` notes (max 50 per agent). |
| `web_research.py` | Fetches real-time news from Google News RSS + Yahoo Finance. Cached in DB for 30 minutes. |
| `data_ingestion.py` | Fetches current price for a ticker via `yfinance`. |
| `models.py` | SQLAlchemy models: `MarketSignal`, `AgentPrediction`, `DeployedStrategy`, `AgentPrompt`, `MarketConfig`, `DebateRound`, `AppConfig`, `AgentMemory`, `WebResearch`, `PipelineRun`, `PipelineEvent`, `KGNode`, `KGEdge`, `CacheEntry`. |
| `database.py` | Neon PostgreSQL (production) via `DATABASE_URL` env var. Session factory, `get_db` dependency, `ensure_tables()` for cold-start safety. |
| `seed.py` | One-time seeding utility. |

### Frontend
React + Vite app. Refactored into 30 files under `frontend/src/`. Polls the backend every 10 seconds (pipeline poller: 2s while running, 8s idle).

| File/Dir | Responsibility |
|---|---|
| `App.tsx` | AppInner orchestrator — all state, effects, handlers, layout (~820 lines) |
| `types.ts` | All TypeScript interfaces and type aliases |
| `constants.ts` | TICKER_DB, MARKET_TICKERS, NAV, NOTE_COLORS, STEP_META, KG_COLORS |
| `utils.ts` | Auth helpers (getToken/setToken/clearToken/authHeaders), apiFetch, formatters, detectAssetClass |
| `hooks/useToast.ts` | Toast notification hook |
| `components/` | Badge, StatusChip, Card, SectionHeader, Toggle, StatPill, AgentProposalCard, DebateSection, PriceVolumeChart, KnowledgeGraphViewer, ToastList, StatDrawer, LoginModal |
| `templates/` | CryptoReportTemplate, StockReportTemplate, CommodityReportTemplate, StrategyReportPanel |
| `pages/` | LandingPage, DashboardPage, MarketsPage, KnowledgeGraphPage, PortfolioPage, MemoryPage, PipelinePage, SettingsPage |

### Key data flows
1. **Pipeline cycle**: `run_full_pipeline(run_id)` →
   - **Research**: fetch web news + RSS for all enabled tickers (cached 30 min)
   - **KG Ingest**: LLM extracts EVENT nodes + edges from research → upsert into `KGNode`/`KGEdge` (45s timeout guard)
   - **Agents**: 4 agents query OpenRouter in parallel, each gets research + KG subgraph + memory context → propose TICKER + LONG/SHORT
   - **Consensus (Judge)**: LLM judge reviews all proposals + budget context → picks best trade
   - **Deploy**: save `DeployedStrategy`, write `AgentMemory`, generate chart/fundamentals report
2. **Evaluation cycle**: `evaluate_predictions()` → fetch live prices → update `current_return` on active strategies → close at −10% stop-loss or +15% take-profit → write LESSON/STRATEGY_RESULT memory → auto-improve low-scoring agent prompts via LLM.
3. **Approval modes**: `auto` (strategies deploy immediately as ACTIVE) vs `manual` (strategies start as PENDING, require frontend approval).
4. **Concurrency lock**: `debate_running` key in `AppConfig` — set to `"1"` on start, `"0"` on finish/error. Force-reset via `POST /api/system/stop`.

### Markets and tickers
Defined in `orchestrator.py → MARKET_TICKERS`: US (8 stocks), India (8 NSE stocks with `.NS` suffix), Crypto (7 pairs with `-USD` suffix), MCX (5 futures with `=F` suffix). Per-market enable/disable is persisted in `MarketConfig` table and controlled from the frontend.

### APScheduler concurrency lock
A `debate_running` key in `AppConfig` acts as a distributed lock to prevent concurrent debate runs. Always released in the `finally` block.
