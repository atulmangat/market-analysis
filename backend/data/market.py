import yfinance as yf
from sqlalchemy.orm import Session
from core.database import SessionLocal
import core.models as models
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

_executor = ThreadPoolExecutor(max_workers=4)


def _fetch_history(symbol: str):
    return yf.Ticker(symbol).history(period="1d")


def fetch_market_data(symbol: str = "AAPL", timeout: int = 15):
    """
    Fetches the latest market data for a given symbol and stores it in the database.
    Times out after `timeout` seconds to avoid hanging on bad symbols.
    """
    try:
        future = _executor.submit(_fetch_history, symbol)
        hist = future.result(timeout=timeout)
        if hist.empty:
            print(f"No data found for {symbol}")
            return None

        # Get the latest row
        latest = hist.iloc[-1]

        db = SessionLocal()

        signal = models.MarketSignal(
            symbol=symbol,
            price=float(latest['Close']),
            volume=int(latest['Volume']),
            timestamp=datetime.utcnow()
        )

        db.add(signal)
        db.commit()
        db.refresh(signal)
        db.close()

        print(f"Successfully saved market signal for {symbol}: ${signal.price}")
        return signal

    except FuturesTimeoutError:
        print(f"Timeout fetching data for {symbol} (>{timeout}s) — skipping")
        return None
    except Exception as e:
        print(f"Error fetching data for {symbol}: {e}")
        return None


def fetch_news():
    """
    Fetches real news using the web research module.
    Falls back to basic headlines if web research fails.
    """
    try:
        from data.research import fetch_web_research
        research = fetch_web_research()
        if research:
            return [r["title"] for r in research[:10] if r.get("title")]
    except Exception as e:
        print(f"[DataIngestion] Web research failed, using fallback: {e}")

    # Fallback headlines if web research is unavailable
    return [
        "Global markets react to recent central bank interest rate decisions.",
        "Tech sector sees increased investment following AI advancements.",
        "Geopolitical tensions in Europe cause fluctuations in energy prices.",
        "New trade agreement expected to boost manufacturing exports."
    ]


if __name__ == "__main__":
    fetch_market_data("AAPL")
    fetch_market_data("MSFT")
    fetch_market_data("NVDA")
