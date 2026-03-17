<div align="center">

# ◈ Market Analysis

**A multi-agent AI system that runs a structured pipeline — fetching live market data, building a knowledge graph, querying four specialised LLM agents, and deploying LONG/SHORT strategies via an independent judge.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-market--analysis.space-6366f1?style=for-the-badge&logo=vercel)](https://market-analysis.space)
[![Python](https://img.shields.io/badge/Python-3.11-3776ab?style=for-the-badge&logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react)](https://react.dev)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

</div>

---

## What is this?

Each pipeline run fetches live news and market data, extracts structured events into a knowledge graph, then queries four specialised LLM agents in parallel — a **Value Investor**, **Technical Analyst**, **Macro Economist**, and **Sentiment Analyst**. Each agent independently analyses the shared research context plus their own persistent memory and proposes a ticker + LONG/SHORT action. An independent **judge LLM** reviews all four proposals alongside portfolio budget context and selects the best trade to deploy.

Deployed strategies are tracked against live prices. A validator loop closes positions at −10% stop-loss or +15% take-profit. Agents that consistently underperform have their system prompts automatically evolved via an LLM reflection loop — agents on a losing streak receive aggressive rewrites, while high-fitness agents can donate their strategy patterns to struggling peers via crossover.

> *This is not financial advice.*

---

## Features

| | |
|---|---|
| 🤖 **4 Specialised Agents** | Value Investor, Technical Analyst, Macro Economist, Sentiment Analyst — each with structured reasoning frameworks |
| 🧠 **Persistent Agent Memory** | Each agent accumulates up to 200 notes (INSIGHT, OBSERVATION, LESSON) across runs |
| 🧬 **Prompt Evolution** | Fitness scored on win rate + avg return; underperforming agents are mutated or receive crossover from elite agents |
| 🕸️ **Knowledge Graph** | LLM extracts EVENT nodes and relationships from news articles; agents query a 2-hop subgraph as context |
| 📊 **Strategy Reports** | Each deployed trade generates a price chart + fundamentals report cached at pipeline time |
| 📰 **Live Research** | Real-time news via Google News RSS + Yahoo Finance; cached 30 min to avoid redundant fetches |
| 📈 **Live P&L Tracking** | Active positions tracked against real market prices with auto stop-loss / take-profit |
| 🌍 **4 Markets** | US Equities, India NSE, Crypto, MCX Futures — per-market enable/disable from settings |
| ⚡ **Live Pipeline View** | Watch every step in real-time with per-step status, agent pills, and event logs |
| 🔁 **Auto + Manual Modes** | Strategies deploy immediately (auto) or queue for manual approval |
| ↻ **Pipeline Resume** | Failed or stopped runs can be resumed from their last checkpoint |

---

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│                        Pipeline Run                          │
│                                                              │
│  1. WEB_RESEARCH                                             │
│     Google News RSS + Yahoo Finance for all enabled tickers  │
│     Cached 30 min. Falls back to DB cache if fetch fails.    │
│                                                              │
│  2. KG_INGEST                                                │
│     LLM extracts EVENT nodes + typed edges from articles     │
│     Upserted into KGNode / KGEdge with semantic dedup        │
│     150s hard timeout — pipeline continues if it times out   │
│                                                              │
│  3. AGENT_QUERY  (4 agents in parallel)                      │
│     Each agent receives:                                     │
│       - Shared research context + KG 2-hop subgraph          │
│       - Their own memory notes (tiered by recency)           │
│       - Portfolio budget + open positions                     │
│       - Market constraint (enabled tickers only)             │
│     Each outputs: TICKER:SYMBOL, ACTION:LONG|SHORT           │
│                                                              │
│  4. JUDGE                                                    │
│     Independent LLM reviews all 4 proposals                  │
│     Selects best trade(s) with position sizing               │
│     Enforces 1 active strategy per ticker                    │
│                                                              │
│  5. DEPLOY                                                   │
│     Saves DeployedStrategy with entry price                  │
│     Writes INSIGHT / OBSERVATION memory per agent            │
│     Generates price chart + fundamentals report              │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Background: Validator scores strategies vs live prices
  → closes at −10% stop-loss / +15% take-profit
  → writes LESSON / STRATEGY_RESULT memory
  → fitness score = (win_rate × 60) + (avg_return × 40)
  → agents below fitness 55/100 trigger prompt mutation
  → agents on 3+ loss streak trigger aggressive rewrite
  → elite agents (fitness > 70) donate strategy patterns via crossover
```

---

## The Agents

Each agent has a structured 5-step reasoning framework baked into its system prompt:

| Agent | Focus | Framework |
|---|---|---|
| **Value Investor** | Fundamental mispricing vs intrinsic value | Date-filter news → screen P/E vs sector median → identify catalyst → review memory → state exact mispricing |
| **Technical Analyst** | Price structure and momentum | Check news staleness → analyse 5-day price sequence for breakout/breakdown/compression → confirm with volume → size the setup |
| **Macro Economist** | Regime identification and macro flows | Identify current macro regime → map rate/FX/commodity drivers → check geopolitical risk → pick the asset most exposed to the regime shift |
| **Sentiment Analyst** | Crowd psychology and positioning | Score news sentiment → detect retail vs smart money divergence → check for peak fear/greed → fade the crowd or follow the smart money |

Agent prompts are versioned. Each evolution is archived with its fitness score so you can see how prompts improved over time.

---

## Stack

| Layer | Tech |
|---|---|
| **Backend** | Python 3.11 · FastAPI · SQLAlchemy · PostgreSQL (Neon) |
| **LLMs** | OpenRouter — any model, configurable primary + fallback |
| **Market Data** | yfinance (prices) · Google News RSS · Yahoo Finance RSS |
| **Optional enrichment** | FRED (macro data) · Finnhub · Alpha Vantage (fundamentals) |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS |
| **Deploy** | Vercel serverless (frontend + backend) |

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai) API key

### 1. Clone

```bash
git clone https://github.com/atulmangat/market-analysis.git
cd market-analysis
```

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
OPENROUTER_API_KEY=sk-or-...
APP_PASSWORD=your_password_here

# Optional: override default models
LLM_MODEL=stepfun/step-3.5-flash:free
FALLBACK_LLM_MODEL=minimax/minimax-m2.5:nitro

# Optional: PostgreSQL (defaults to local SQLite)
DATABASE_URL=postgresql://user:pass@host/db

# Optional enrichment (all degrade gracefully if missing)
FRED_API_KEY=your_key
FINNHUB_API_KEY=your_key
ALPHA_VANTAGE_API_KEY=your_key
```

```bash
uvicorn main:app --reload
# API →  http://localhost:8000
# Docs → http://localhost:8000/docs
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## Deployment (Vercel)

> Auto-deploy on git push is **disabled**. Always deploy manually.

```bash
# Frontend → market-analysis.space (deploy from repo ROOT)
cd market-analysis
npx vercel --prod --yes

# Backend → backend-jet-nine-93.vercel.app
cd backend
npx vercel --prod --yes
```

**Backend env vars** (set in Vercel project settings):

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | Your OpenRouter key |
| `DATABASE_URL` | Neon / Supabase PostgreSQL URL |
| `APP_PASSWORD` | Dashboard login password |
| `JWT_SECRET` | Random 64-char hex string |

**Frontend env vars:**

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend URL + `/api` |

---

## Project Structure

```
market-analysis/
├── backend/
│   ├── main.py                   # FastAPI app + APScheduler cron setup
│   ├── api/routes.py             # All REST endpoints under /api
│   ├── pipeline/
│   │   ├── runner.py             # Full pipeline run (research → KG → agents → judge → deploy)
│   │   ├── orchestrator.py       # Agent prompts, debate logic, judge, market config
│   │   └── validator.py          # P&L scoring, fitness computation, prompt evolution
│   ├── agents/
│   │   ├── llm.py                # OpenRouter wrapper (primary + fallback model retry)
│   │   └── memory.py             # Per-agent persistent notes (max 200, tiered retrieval)
│   ├── graph/knowledge.py        # KG ingest + 2-hop BFS retrieval
│   ├── data/
│   │   ├── research.py           # Google News RSS + Yahoo Finance fetcher
│   │   ├── market.py             # Live price + news via yfinance
│   │   ├── fundamentals.py       # Alpha Vantage / Finnhub enrichment
│   │   └── macro.py              # FRED macro data
│   └── core/
│       ├── models.py             # SQLAlchemy models
│       ├── database.py           # Neon PostgreSQL session factory
│       ├── cache.py              # DB-backed cache with per-key TTL
│       └── auth.py               # JWT auth
├── frontend/
│   └── src/
│       ├── App.tsx               # Main orchestrator — all state, effects, handlers
│       ├── pages/                # Dashboard, Markets, Portfolio, Pipeline, KnowledgeGraph, Settings, Agents
│       ├── components/           # Badge, StatusChip, StatPill, KnowledgeGraphViewer, …
│       └── templates/            # Stock/Crypto/Commodity report panels
└── CLAUDE.md                     # AI coding instructions
```

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
  <sub>Built with <a href="https://claude.ai/code">Claude Code</a> · <a href="https://market-analysis.space">market-analysis.space</a></sub>
</div>
