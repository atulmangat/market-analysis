import os
import sys

from core.database import SessionLocal
from pipeline.orchestrator import setup_agent_prompts

def main():
    try:
        print("Seeding agent prompts...")
        db = SessionLocal()
        setup_agent_prompts(db)
        db.commit()
        db.close()
        print("Successfully seeded agent prompts.")
    except Exception as e:
        print(f"Error seeding prompts: {e}")

if __name__ == "__main__":
    main()
