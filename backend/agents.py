import os
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Status codes worth retrying (transient)
_RETRYABLE = {429, 500, 502, 503, 504}


def _call_openrouter(model: str, messages: list, api_key: str, retries: int = 3) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://market-analysis.space",
        "X-Title": "Market Analysis",
    }
    payload = {"model": model, "messages": messages}
    last_exc = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=120) as client:
                res = client.post(OPENROUTER_URL, json=payload, headers=headers)
                if res.status_code in _RETRYABLE:
                    wait = 2 ** attempt  # 1s, 2s, 4s
                    print(f"[agents] {model} returned {res.status_code}, retrying in {wait}s (attempt {attempt+1}/{retries})…")
                    time.sleep(wait)
                    last_exc = Exception(f"HTTP {res.status_code}: {res.text[:200]}")
                    continue
                res.raise_for_status()
                return res.json()["choices"][0]["message"]["content"]
        except httpx.TimeoutException as e:
            wait = 2 ** attempt
            print(f"[agents] {model} timed out, retrying in {wait}s (attempt {attempt+1}/{retries})…")
            time.sleep(wait)
            last_exc = e
        except Exception as e:
            # Non-retryable (e.g. 401, 403, bad JSON) — fail immediately
            raise e
    raise last_exc or Exception(f"{model} failed after {retries} retries")


def query_agent(system_prompt: str, data_context: str) -> str:
    """
    Sends the data context to a specific agent based on its system prompt.
    Tries the primary model with retries, falls back to secondary with retries.
    Returns None only if both models fail all retries.
    """
    api_key  = os.getenv("OPENROUTER_API_KEY", "").strip()
    model    = os.getenv("LLM_MODEL", "stepfun/step-3.5-flash:free")
    fallback = os.getenv("FALLBACK_LLM_MODEL", "minimax/minimax-m2.5:nitro")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": data_context},
    ]
    try:
        return _call_openrouter(model, messages, api_key, retries=3)
    except Exception as e:
        print(f"Primary model {model} failed: {repr(e)}. Trying fallback {fallback}...")
        try:
            return _call_openrouter(fallback, messages, api_key, retries=3)
        except Exception as e2:
            print(f"Fallback model {fallback} failed too: {repr(e2)}")
            return None
