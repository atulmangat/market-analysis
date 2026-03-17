<div align="center">

# ◈ Market Analysis

**A multi-agent AI trading system where four specialized LLM agents debate every trade, vote on LONG/SHORT strategies, and evolve over time through Darwinian selection.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-market--analysis.space-6366f1?style=for-the-badge&logo=vercel)](https://market-analysis.space)
[![Python](https://img.shields.io/badge/Python-3.11-3776ab?style=for-the-badge&logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react)](https://react.dev)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

</div>

---

## What is this?

Four AI agents — a **Value Investor**, **Technical Analyst**, **Macro Economist**, and **Sentiment Analyst** — each independently research the markets, form a thesis, and debate their recommended trade. A judge synthesises the debate and deploys a consensus LONG/SHORT strategy.

Every agent carries **persistent memory** across rounds. Agents that perform well gain conviction. Agents that underperform have their prompts automatically rewritten by an LLM reflection loop — survival of the fittest.

> *This is not financial advice. It's an experiment in multi-agent reasoning.*

---

## Features

| | |
|---|---|
| 🤖 **Multi-Agent Debate** | Value Investor, Technical Analyst, Macro Economist, Sentiment Analyst argue every trade |
| 🧠 **Persistent Memory** | Each agent remembers past wins/losses and updates its reasoning accordingly |
| 🧬 **Darwinian Evolution** | Underperforming agent prompts are auto-rewritten via LLM reflection |
| 📊 **Strategy Reports** | Each trade comes with a full report: price chart, fundamentals, agent debate breakdown |
| 📰 **Live Research** | Real-time news from curated RSS feeds + Stocktwits social sentiment |
| 📈 **Live P&L Tracking** | Active positions tracked against real market prices with auto stop-loss/take-profit |
| 🌍 **4 Markets** | US Equities, India NSE, Crypto, MCX Futures |
| ⚡ **Live Pipeline** | Watch the debate happen in real-time, step by step |
| 🔁 **Auto Schedule** | Runs on configurable interval (default: every 60 minutes) |
| ✋ **Manual Approval** | Optional manual review before strategies go live |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Pipeline Run                        │
│                                                         │
│  Web Research ──► Agent Context                         │
│     RSS feeds      Current date + news age labels       │
│     Stocktwits     Per-ticker fundamentals              │
│     yfinance       Agent memory (last 50 notes)         │
│                           │                             │
│                    ┌──────▼──────┐                      │
│              ┌─────┤   4 Agents  ├─────┐                │
│              │     └─────────────┘     │                │
│        Value Investor           Technical Analyst       │
│        Macro Economist          Sentiment Analyst       │
│              │                         │                │
│              └──────────┬──────────────┘                │
│                         │                               │
│                   ┌─────▼──────┐                        │
│                   │   Judge    │  Majority vote          │
│                   └─────┬──────┘  + reasoning           │
│                         │                               │
│                ┌────────▼────────┐                      │
│                │ Deploy Strategy │  LONG / SHORT         │
│                └────────┬────────┘  1 active per ticker │
│                         │                               │
│              ┌──────────▼──────────┐                    │
│              │  Generate Report    │  Chart + Fundamentals│
│              │  Write Agent Memory │  LESSON / INSIGHT   │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘

Later: Validator scores each strategy against live prices,
       closes at -10% stop-loss / +15% take-profit,
       and auto-rewrites underperforming agent prompts.
```

---

## Stack

| Layer | Tech |
|---|---|
| **Backend** | Python · FastAPI · SQLAlchemy · PostgreSQL (Neon) |
| **LLMs** | OpenRouter (any model, primary + fallback) |
| **Market Data** | yfinance · Google News RSS · Stocktwits |
| **Frontend** | React · TypeScript · Vite · Tailwind CSS |
| **Deploy** | Vercel (frontend + backend serverless) |

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

## The Agents

Each agent has a distinct investment philosophy with a structured 5-step reasoning framework:

| Agent | Philosophy | Edge |
|---|---|---|
| **Value Investor** | Fundamental mispricing vs intrinsic value | Finds assets trading far from fair value with a clear catalyst |
| **Technical Analyst** | Price structure & momentum | Identifies breakouts, breakdowns, compression setups |
| **Macro Economist** | Regime identification | Maps macro drivers (rates, geopolitics, flows) to assets |
| **Sentiment Analyst** | Crowd psychology | Fades peak greed, buys peak fear, spots retail/smart money divergence |

Agents **evolve**: after enough losing trades, the validator triggers an LLM reflection that rewrites the agent's system prompt — preserving what worked, fixing what didn't.

---

## Project Structure

```
market-analysis/
├── backend/
│   ├── main.py                   # FastAPI app + APScheduler cron setup
│   ├── api/routes.py             # All REST endpoints under /api
│   ├── pipeline/
│   │   ├── runner.py             # Full pipeline run (research → KG → debate → deploy)
│   │   ├── orchestrator.py       # Agent prompts, debate logic, judge
│   │   └── validator.py          # P&L scoring + agent prompt evolution
│   ├── agents/
│   │   ├── llm.py                # OpenRouter wrapper (primary + fallback model)
│   │   └── memory.py             # Per-agent persistent notes (max 50)
│   ├── graph/knowledge.py        # KG ingest + 2-hop BFS retrieval
│   ├── data/
│   │   ├── research.py           # Google News RSS + Yahoo Finance fetcher
│   │   ├── market.py             # Live price via yfinance
│   │   ├── fundamentals.py       # Fundamentals enrichment (Alpha Vantage / Finnhub)
│   │   └── macro.py              # Macro data (FRED)
│   └── core/
│       ├── models.py             # SQLAlchemy models
│       ├── database.py           # Neon PostgreSQL session factory
│       ├── cache.py              # Two-level DB-backed cache
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

## Key Data Flows

**Pipeline cycle:**
`run_full_pipeline()` → fetch news/RSS (cached 30 min) → KG ingest (LLM extracts EVENT nodes + edges, 150s timeout) → 4 agents query OpenRouter in parallel with research + KG subgraph + memory → judge picks best trade → deploy `DeployedStrategy` → write `AgentMemory`

**Evaluation cycle:**
`evaluate_predictions()` → fetch live prices → update `current_return` → write STRATEGY_RESULT/LESSON memory → close at −10% stop-loss / +15% take-profit → auto-improve low-scoring agent prompts via LLM reflection

**Report:**
Pre-generated at pipeline time (chart + fundamentals cached on `DebateRound.report_json`) → served instantly from cache, no blocking yfinance calls on request

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
