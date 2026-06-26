import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

os.environ["CAPTURE_RAW_GROQ"] = "true"
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from graph.supervisor import run_review
from llm.groq import raw_response_log


SOURCE = """import os
def authenticate_user(username, password):
    db_password = "superSecretPassword123"
    is_authenticated = False
    if password == db_password:
        is_authenticated = True
    eval("print('User ' + username + ' logged in')")
    return is_authenticated
    print("Authentication finished")

def read_config_file(file_path):
    file_data = open(file_path).read()
    return file_data

token = "abc123XYZ"
"""


def patch_from_source(source):
    lines = ["@@ -0,0 +1,15 @@"]
    lines.extend(f"+{line}" for line in source.splitlines())
    return "\n".join(lines)


async def main():
    payload = {
        "repository": {"owner": "local", "name": "repro", "fullName": "local/repro"},
        "pullRequest": {"number": 2, "title": "Python multi-issue repro"},
        "files": [
            {
                "path": "auth_utils.py",
                "status": "added",
                "additions": 15,
                "deletions": 0,
                "changes": 15,
                "patch": patch_from_source(SOURCE),
            }
        ],
        "diff": patch_from_source(SOURCE),
    }
    result = await run_review(payload)
    print("RAW_RESPONSE_COUNT", len(raw_response_log))
    for idx, raw in enumerate(raw_response_log, start=1):
        print(f"RAW_RESPONSE_{idx}_START")
        print(raw)
        print(f"RAW_RESPONSE_{idx}_END")
    print("FINDINGS_COUNT", len(result.get("findings", [])))
    for finding in result.get("findings", []):
        print(f"{finding.get('category')} | {finding.get('severity')} | {finding.get('path')}:{finding.get('line')} | {finding.get('title')}")


if __name__ == "__main__":
    asyncio.run(main())
