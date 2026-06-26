import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

os.environ["CAPTURE_RAW_GROQ"] = "true"
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from graph.supervisor import run_review
from llm.groq import raw_response_log


SOURCE = """const fs = require('fs');
function authenticateUser(username, password) {
    var dbPassword = "superSecretPassword123";
    var isAuthenticated = false;

    if (password == dbPassword) {
        isAuthenticated = true;
    }

    eval("console.log('User ' + username + ' logged in')");

    return isAuthenticated;
    console.log("Authentication finished");
}
function readConfigFile(filePath) {
    fileData = fs.readFileSync(filePath, 'utf-8');
    return fileData;
}
const token = new Buffer("abc123XYZ");
module.exports = { authenticateUser, readConfigFile };
"""


def patch_from_source(source):
    lines = ["@@ -0,0 +1,22 @@"]
    lines.extend(f"+{line}" for line in source.splitlines())
    return "\n".join(lines)


async def main():
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
