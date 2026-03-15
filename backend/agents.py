import os
import httpx
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def _call_openrouter(model: str, messages: list, api_key: str) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://market-analysis.space",
        "X-Title": "Market Analysis",
    }
    payload = {"model": model, "messages": messages}
    with httpx.Client(timeout=120) as client:
        res = client.post(OPENROUTER_URL, json=payload, headers=headers)
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]


def query_agent(system_prompt: str, data_context: str) -> str:
    """
    Sends the data context to a specific agent based on its system prompt.
    Tries the primary model, falls back to the secondary model on failure.
    """
    api_key  = os.getenv("OPENROUTER_API_KEY", "").strip()
    model    = os.getenv("LLM_MODEL", "stepfun/step-3.5-flash:free")
    fallback = os.getenv("FALLBACK_LLM_MODEL", "minimax/minimax-m2.5:nitro")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": data_context},
    ]
    try:
        return _call_openrouter(model, messages, api_key)
    except Exception as e:
        print(f"Primary model {model} failed: {repr(e)}. Trying fallback {fallback}...")
        try:
            return _call_openrouter(fallback, messages, api_key)
        except Exception as e2:
            print(f"Fallback model failed too: {repr(e2)}")
            return f"Agent error: {repr(e2)}"
