import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# We'll default to a free Llama 3 endpoint on OpenRouter for development, or what the user prefers.
# The user prefers stepfun/step-3.5-flash:free with minimax/minimax-m2.5:nitro as fallback
MODEL_NAME = os.getenv("LLM_MODEL", "stepfun/step-3.5-flash:free")
FALLBACK_MODEL_NAME = os.getenv("FALLBACK_LLM_MODEL", "minimax/minimax-m2.5:nitro")

# OpenRouter client configuration
client = OpenAI(
  base_url="https://openrouter.ai/api/v1",
  api_key=os.getenv("OPENROUTER_API_KEY", "dummy_key"), # Expecting this to be in .env
)

def query_agent(system_prompt: str, data_context: str) -> str:
    """
    Sends the data context to a specific agent based on its system prompt.
    Tries the primary model, falls back to the secondary model on failure.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": data_context}
    ]
    try:
        completion = client.chat.completions.create(
          model=MODEL_NAME,
          messages=messages
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"Primary model {MODEL_NAME} failed: {e}. Trying fallback {FALLBACK_MODEL_NAME}...")
        try:
            completion_fallback = client.chat.completions.create(
                model=FALLBACK_MODEL_NAME,
                messages=messages
            )
            return completion_fallback.choices[0].message.content
        except Exception as e2:
            print(f"Fallback model failed too: {e2}")
            return "Agent error: Unable to generate response."
