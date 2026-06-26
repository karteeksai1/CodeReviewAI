import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient

os.environ["CAPTURE_RAW_GROQ"] = "true"
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from main import app
from repro_js_findings import SOURCE, patch_from_source


payload = {
    "repository": {"owner": "local", "name": "repro", "fullName": "local/repro"},
    "pullRequest": {"number": 1, "title": "JS multi-issue repro"},
    "files": [
        {
            "path": "authUtils.js",
            "status": "added",
            "additions": 22,
            "deletions": 0,
            "changes": 22,
            "patch": patch_from_source(SOURCE),
        }
    ],
    "diff": patch_from_source(SOURCE),
}


client = TestClient(app)
response = client.post("/review", json=payload, headers={"x-request-id": "repro-endpoint"})
print("STATUS", response.status_code)
data = response.json()
print("FINDINGS_COUNT", len(data.get("findings", [])))
for finding in data.get("findings", []):
    print(f"{finding.get('category')} | {finding.get('severity')} | {finding.get('path')}:{finding.get('line')} | {finding.get('title')}")
