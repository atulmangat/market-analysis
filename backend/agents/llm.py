"""
Single LLM gateway for the entire system.

All LLM calls MUST go through query_agent(). No other module should call
_call_minimax or _call_openrouter directly. This ensures:
  - Unified primary/fallback model retry logic
  - Consistent token usage tracking (persisted to llm_usage table)
  - Single place to swap models, add rate-limiting, or mock in tests

Primary: MiniMax direct API (MINIMAX_API_KEY + LLM_MODEL)
Fallback: OpenRouter (OPENROUTER_API_KEY + FALLBACK_LLM_MODEL)

Public API
----------
query_agent(system_prompt, data_context, *, caller, run_id, timeout, retries) -> str | None
"""

import os
import re
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

MINIMAX_URL   = "https://api.minimax.io/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# HTTP status codes worth retrying (transient errors)
_RETRYABLE = {429, 500, 502, 503, 504}

def _strip_think(text: str) -> str:
    """Remove <think>…</think> reasoning blocks emitted by MiniMax M2.7."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


# ── Internal HTTP layer ────────────────────────────────────────────────────────

def _call_minimax(model: str, messages: list, api_key: str,
                  retries: int = 3, timeout: int = 120) -> tuple[str, dict]:
    """
    Raw HTTP POST to MiniMax direct API. Returns (content, usage_dict).
    Uses the OpenAI-compatible /v1/chat/completions endpoint.
    Raises on non-retryable errors or after exhausting retries.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"model": model, "messages": messages}
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(MINIMAX_URL, json=payload, headers=headers)
                if res.status_code in _RETRYABLE:
                    # MiniMax uses 429 for both rate-limit AND insufficient balance.
                    # Insufficient balance is permanent — fail fast instead of retrying.
                    body_text = res.text
                    if "insufficient_balance" in body_text or "1008" in body_text:
                        raise Exception(f"MiniMax insufficient balance (account needs credits): {body_text[:200]}")
                    wait = 2 ** attempt
                    print(f"[llm] minimax {model} → {res.status_code}, retry {attempt+1}/{retries} in {wait}s…")
                    time.sleep(wait)
                    last_exc = Exception(f"HTTP {res.status_code}: {res.text[:200]}")
                    continue
                res.raise_for_status()
                body = res.json()
                content = body["choices"][0]["message"]["content"]
                # MiniMax M2.7 is a reasoning model — strip <think>…</think> blocks
                # so downstream parsers only see the final answer.
                content = _strip_think(content)
                raw_usage = body.get("usage") or {}
                usage = {
                    "prompt_tokens":     raw_usage.get("prompt_tokens", 0),
                    "completion_tokens": raw_usage.get("completion_tokens", 0),
                    "reasoning_tokens":  (raw_usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0),
                    "total_tokens":      raw_usage.get("total_tokens", 0),
                    "cost":              raw_usage.get("cost", 0.0) or 0.0,
                }
                return content, usage
        except httpx.TimeoutException as e:
            wait = 2 ** attempt
            print(f"[llm] minimax {model} timed out, retry {attempt+1}/{retries} in {wait}s…")
            time.sleep(wait)
            last_exc = e
        except Exception:
            raise  # non-retryable (401, 403, bad JSON, …)
    raise last_exc or Exception(f"minimax {model} failed after {retries} retries")


def _call_openrouter(model: str, messages: list, api_key: str,
                     retries: int = 3, timeout: int = 120) -> tuple[str, dict]:
    """
    Raw HTTP POST to OpenRouter. Returns (content, usage_dict).
    Used for fallback model only.
    Raises on non-retryable errors or after exhausting retries.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://market-analysis.space",
        "X-Title": "Market Analysis",
    }
    payload = {"model": model, "messages": messages}
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(OPENROUTER_URL, json=payload, headers=headers)
                if res.status_code in _RETRYABLE:
                    wait = 2 ** attempt
                    print(f"[llm] openrouter {model} → {res.status_code}, retry {attempt+1}/{retries} in {wait}s…")
                    time.sleep(wait)
                    last_exc = Exception(f"HTTP {res.status_code}: {res.text[:200]}")
                    continue
                res.raise_for_status()
                body = res.json()
                content = body["choices"][0]["message"]["content"]
                raw_usage = body.get("usage") or {}
                usage = {
                    "prompt_tokens":     raw_usage.get("prompt_tokens", 0),
                    "completion_tokens": raw_usage.get("completion_tokens", 0),
                    "reasoning_tokens":  (raw_usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0),
                    "total_tokens":      raw_usage.get("total_tokens", 0),
                    "cost":              raw_usage.get("cost", 0.0) or 0.0,
                }
                return content, usage
        except httpx.TimeoutException as e:
            wait = 2 ** attempt
            print(f"[llm] openrouter {model} timed out, retry {attempt+1}/{retries} in {wait}s…")
            time.sleep(wait)
            last_exc = e
        except Exception:
            raise  # non-retryable (401, 403, bad JSON, …)
    raise last_exc or Exception(f"openrouter {model} failed after {retries} retries")


# ── Usage persistence ──────────────────────────────────────────────────────────

def _save_usage(model: str, caller: str | None, run_id: str | None,
                prompt_tokens: int, completion_tokens: int, reasoning_tokens: int,
                total_tokens: int, cost: float) -> None:
    """Persist token counts to llm_usage table. Best-effort — never raises."""
    try:
        from core.database import SessionLocal
        import core.models as models
        db = SessionLocal()
        try:
            db.add(models.LLMUsage(
                model=model,
                caller=caller,
                run_id=run_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                reasoning_tokens=reasoning_tokens,
                total_tokens=total_tokens,
                cost=cost,
            ))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[llm] usage tracking failed (non-fatal): {e}")


# ── Public gateway ─────────────────────────────────────────────────────────────

def query_agent(
    system_prompt: str,
    data_context: str,
    *,
    caller: str | None = None,
    run_id: str | None = None,
    timeout: int = 120,
    retries: int = 3,
) -> str | None:
    """
    Send a prompt to the LLM. This is the ONLY entry-point for LLM calls.

    Primary: MiniMax direct API (MINIMAX_API_KEY + LLM_MODEL).
    Fallback: OpenRouter (OPENROUTER_API_KEY + FALLBACK_LLM_MODEL).

    Parameters
    ----------
    system_prompt : str
        The agent/system role description.
    data_context : str
        The user-turn message (market data, research, etc.).
    caller : str | None
        Human-readable label for the call site, e.g. "agent:Value Investor",
        "judge", "kg_ingest", "validator:mutate:Macro Economist".
        Stored in llm_usage for per-component analytics.
    run_id : str | None
        Pipeline run UUID, if available. Links usage rows to pipeline runs.
    timeout : int
        Per-attempt HTTP timeout in seconds (default 120).
        Pass 40 for KG ingest to keep it snappy on free-tier models.
    retries : int
        Number of attempts per model (default 3). Pass 2 for KG ingest.

    Returns
    -------
    str | None
        LLM response text, or None if both primary and fallback fail.
    """
    minimax_key  = os.getenv("MINIMAX_API_KEY", "").strip()
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model    = os.getenv("LLM_MODEL", "MiniMax-M2.7")
    fallback = os.getenv("FALLBACK_LLM_MODEL", "stepfun/step-3.5-flash:free")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": data_context},
    ]

    def _log_llm_event(used_model: str, content: str, usage: dict) -> None:
        """Write a LLM_CALL pipeline event so the SSE stream shows it in the UI."""
        if not run_id:
            return
        try:
            from core.database import SessionLocal
            import core.models as _m
            _db = SessionLocal()
            try:
                snippet = (content or "")[:120].replace("\n", " ").strip()
                tokens = usage.get("total_tokens", 0)
                label = caller or "llm"
                detail = f"[{used_model}] {label} — {tokens} tokens → {snippet}…" if snippet else f"[{used_model}] {label} — {tokens} tokens"
                _db.add(_m.PipelineEvent(
                    run_id=run_id, step="LLM_CALL", status="DONE", detail=detail,
                    agent_name=(caller.split(":")[-1] if caller and ":" in caller else None),
                ))
                _db.commit()
            finally:
                _db.close()
        except Exception:
            pass  # never block the LLM call over a logging failure

    # Primary: MiniMax direct
    if minimax_key:
        try:
            content, usage = _call_minimax(model, messages, minimax_key,
                                           retries=retries, timeout=timeout)
            _save_usage(model, caller, run_id, **usage)
            _log_llm_event(model, content, usage)
            return content
        except Exception as primary_err:
            print(f"[llm] primary minimax {model} failed ({repr(primary_err)}), trying fallback {fallback}…")
    else:
        print(f"[llm] MINIMAX_API_KEY not set, skipping primary model {model}")

    # Fallback: OpenRouter
    if openrouter_key:
        try:
            content, usage = _call_openrouter(fallback, messages, openrouter_key,
                                              retries=retries, timeout=timeout)
            _save_usage(fallback, caller, run_id, **usage)
            _log_llm_event(fallback, content, usage)
            return content
        except Exception as fallback_err:
            print(f"[llm] fallback openrouter {fallback} also failed: {repr(fallback_err)}")
    else:
        print(f"[llm] OPENROUTER_API_KEY not set, fallback {fallback} skipped")

    return None
