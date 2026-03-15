# Market Analysis

A multi-agent AI stock market analysis system. Multiple AI agents debate every trade across US, India, Crypto, and Commodities markets — then vote on a LONG or SHORT strategy. Agents accumulate persistent memory, and underperforming prompts are auto-improved via Darwinian selection.

**Live at [market-analysis.space](https://market-analysis.space)**

---

## Features

- **Multi-Agent Debate** — Specialized AI agents analyze stocks from different perspectives and vote on a consensus trading action
- **Live Price Tracking** — Active strategies monitored against real-time market prices
- **Auto Stop-Loss / Take-Profit** — Positions close automatically at −10% (stop-loss) or +15% (take-profit)
- **Persistent Agent Memory** — Each agent accumulates observations across rounds, shaping future decisions
- **Darwinian Evolution** — Underperforming agents are automatically rewritten via LLM reflection
- **Multi-Market Coverage** — US stocks, India NSE, Crypto pairs, MCX Futures
- **Web Research** — Real-time news from Google News RSS + Yahoo Finance (30-min cache)
- **Approval Modes** — Auto-deploy or manual approval workflow for strategies
- **Full Dashboard** — Strategy controls, agent memory feed, debate history, live quotes, and market toggles

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy, APScheduler, SQLite / PostgreSQL |
| LLM | OpenRouter (OpenAI-compatible), primary + fallback model |
| Market Data | yfinance, feedparser (Google News RSS) |
| Auth | JWT (python-jose), bcrypt |
| Frontend | React 19, Vite, Tailwind CSS, TypeScript |
| Deploy | Vercel (serverless) or Railway (always-on) |

---

## Getting Started

### Prerequisites

- Python 3.8+
- Node 16+
- [OpenRouter API key](https://openrouter.ai)

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create your .env file
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env

uvicorn main:app --reload
```

Backend runs at `http://localhost:8000` — API docs at `/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and polls the backend every 10 seconds.

---

## Environment Variables

Create `backend/.env`:

```env
# Required
OPENROUTER_API_KEY=your_key_here

# Auth
APP_PASSWORD=your_strong_password
JWT_SECRET=your_random_string_min_32_chars

# LLM models (optional)
LLM_MODEL=stepfun/step-3.5-flash:free
FALLBACK_LLM_MODEL=minimax/minimax-m2.5:nitro

# Production only
DATABASE_URL=postgresql://user:pass@host:5432/dbname
FRONTEND_URL=https://your-frontend.vercel.app
CRON_SECRET=your_cron_secret
```

---

## Deployment

### Vercel (Serverless)

1. Push to GitHub and import into Vercel
2. Deploy `backend/` as a Vercel Functions project, `frontend/` as a separate static project
3. Set all environment variables in Vercel dashboard
4. Cron jobs (`backend/vercel.json`) run automatically:
   - Debate: daily at 9 AM UTC
   - Evaluate: daily at 10 AM UTC

### Railway (Always-On)

1. Create a Railway project and connect your GitHub repo
2. Railway auto-detects `backend/railway.toml` and deploys the backend
3. APScheduler runs continuously — no cron config needed
4. Set environment variables in the Railway dashboard

---

## Architecture

### Debate Cycle (default: every 60 min)

```
Fetch news + prices → Agents debate in parallel → Majority vote → Deploy strategy → Write agent memory
```

### Evaluation Cycle (default: every 60 min)

```
Fetch live prices → Update returns → Close at SL/TP → Score predictions → Auto-improve weak agents
```

### Markets & Tickers

| Market | Tickers |
|---|---|
| US | AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, META, NFLX |
| India (NSE) | RELIANCE.NS, TCS.NS, INFY.NS, HDFC.NS, SBIN.NS, LT.NS, WIPRO.NS, MARUTI.NS |
| Crypto | BTC-USD, ETH-USD, SOL-USD, XRP-USD, ADA-USD, DOGE-USD, MATIC-USD |
| MCX Futures | GOLD=F, SILVER=F, CRUDEOIL=F, NATURALGAS=F, COPPER=F |

Per-market enable/disable is configurable from the dashboard.

### Key Modules

| File | Responsibility |
|---|---|
| `main.py` | FastAPI app, APScheduler setup, CORS, cron endpoints |
| `orchestrator.py` | `run_debate()` — research, agent queries, consensus, deployment |
| `agents.py` | `query_agent()` — OpenRouter wrapper with primary/fallback retry |
| `api.py` | REST endpoints under `/api` |
| `validator.py` | `evaluate_predictions()` — scoring, SL/TP closes, auto-prompt improvement |
| `memory_manager.py` | Read/write/prune per-agent memory notes (max 50, injected into context) |
| `web_research.py` | News fetching with 30-min DB cache |
| `data_ingestion.py` | yfinance price fetching |
| `models.py` | SQLAlchemy ORM models |
| `database.py` | DB session factory and `get_db` dependency |

---

## API Reference

All endpoints are prefixed with `/api`:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/trigger` | Manually trigger a debate round |
| `GET` | `/strategies` | List all strategies |
| `POST` | `/strategies/approve` | Approve a PENDING strategy |
| `GET` | `/memories` | Agent memory feed |
| `GET` | `/research` | Web research feed |
| `POST` | `/config/schedule` | Set debate interval (minutes) |
| `POST` | `/config/markets` | Enable/disable markets |
| `POST` | `/cron/debate` | Vercel Cron — debate (requires `CRON_SECRET`) |
| `POST` | `/cron/evaluate` | Vercel Cron — evaluate (requires `CRON_SECRET`) |
| `GET` | `/` | Health check |

---

## License

MIT
