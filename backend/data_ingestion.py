import yfinance as yf
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from datetime import datetime


def fetch_market_data(symbol: str = "AAPL"):
    """
    Fetches the latest market data for a given symbol and stores it in the database.
    """
    ticker = yf.Ticker(symbol)
    try:
        # Get the history for the last day
        hist = ticker.history(period="1d")
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

    except Exception as e:
        print(f"Error fetching data for {symbol}: {e}")
        return None


def fetch_news():
    """
    Fetches real news using the web research module.
    Falls back to basic headlines if web research fails.
    """
    try:
        from web_research import fetch_web_research
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
