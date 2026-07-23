# CodeReviewAI — Features & Architecture

> Async, multi-agent pull request reviewer powered by LangGraph, hybrid RAG, and GitHub App integration. Reviews your code the way a senior engineer would — parallel agents, codebase-aware context, and deterministic checks before any LLM guess.

---

## How it works

When a pull request is opened, reopened, or updated on a connected repository, CodeReviewAI automatically:

1. Receives the event via a verified GitHub App webhook
2. Enqueues a review job in BullMQ (async — never blocks your CI pipeline)
3. Fetches the PR diff and mergeability status from GitHub's API
4. Runs deterministic static analysis on changed files before any LLM call
5. Retrieves relevant codebase context from Pinecone using hybrid RAG
6. Dispatches three parallel agents (Security, Performance, Style) via a LangGraph supervisor graph
7. Deduplicates, severity-ranks, and merges all findings
8. Posts a structured review comment directly on the GitHub PR with inline line annotations

---

## Core features

### Multi-agent parallel review
Three specialized agents run in parallel, not sequentially — Security, Performance, and Style each analyze the diff independently and simultaneously. A LangGraph supervisor graph manages routing, skips agents when their category is not relevant to the diff (with an explicit reason surfaced in the UI), and aggregates results. Total review time is bounded by the slowest agent, not the sum of all three.

### Hybrid RAG with codebase awareness
Each agent query combines:
- **Dense vector search** via Pinecone for semantic similarity
- **BM25 sparse retrieval** for keyword precision

Retrieved context grounds findings in your actual codebase — instead of generic advice like "move secrets to environment variables," the tool references the specific pattern your codebase already uses (e.g. "replace with `process.env.STRIPE_KEY`, consistent with your existing `config.js` pattern").

### Cross-file dependency-aware retrieval
When a function signature, class definition, or export changes in the PR, the system queries Pinecone for other files in the indexed codebase that reference or import that specific symbol — and injects those callers as context for the review agents. This catches breaking changes that only become apparent when you see what else depends on the changed code.

Language-isolated: Python changes only retrieve Python context, JS/TS changes only retrieve JS/TS context, enforced via Pinecone metadata filtering on file extension at index time.

### Deterministic static analysis before LLM
A dedicated static analysis node runs before any LLM agent, using purpose-built tools that parse and apply rules deterministically:

- **Python**: Ruff (linting/style), Bandit (security), MyPy (type errors)
- **JavaScript/TypeScript**: ESLint (linting/style), Semgrep (security patterns)
- **All languages**: Semgrep with auto config for cross-language vulnerability patterns

Static findings are normalized into a consistent schema (`tool`, `severity`, `category`, `file`, `line`, `message`, `rule`) and injected into each agent's prompt. The LLM's role shifts from discoverer to explainer — it explains *why* a Bandit finding matters and suggests a concrete fix, rather than probabilistically guessing whether the issue exists. This eliminates an entire class of false positives.

### Merge conflict detection with file-level detail
On every review, the system fetches GitHub's computed `mergeable_state` for the PR and surfaces it prominently alongside the AI findings:

- ✅ Mergeable
- ⚠️ Has conflicts with main — affected files: `config.js` (PR lines 1–11, main lines 1–31), `paymentService.js` (PR lines 1–61, main lines 1–31)
- ⏳ Checking mergeability...

Conflict detection and AI code review are always independent — a PR with merge conflicts still gets a full security and performance review, not a "conflicts detected, skipping review" shortcut.

### Unresolved merge marker detection
If `<<<<<<< HEAD`, `=======`, or `>>>>>>>` markers are found committed in a changed file, the system emits a deterministic finding immediately — no LLM judgment needed, no probability of missing it.

### Semantic finding deduplication
When multiple agents or multiple tool passes surface the same underlying issue (e.g. a hardcoded credential flagged by both Bandit and the security agent), findings are clustered by file, line proximity, and category — then merged into a single finding using the highest severity and most specific description. Alert fatigue from redundant findings is a first-class concern, not an afterthought.

### Enforced severity rubric
Findings are classified against a concrete severity model, not whatever the model feels like returning:

| Severity | Definition |
|----------|------------|
| **Critical** | Direct path to system compromise: RCE, auth bypass, committed production secrets |
| **High** | Significant real-world impact: crashes, SQL injection, merge conflicts, exposed API keys |
| **Medium** | Real issues, not immediately dangerous: performance regressions, poor error handling |
| **Low** | Code quality, no immediate risk: code smells, minor maintainability issues |
| **Info** | Suggestions only, no action required |

### Materiality filtering
Agents are prompted to only emit findings with a concrete, demonstrable problem directly evidenced in the diff. Speculative findings ("this code could have concurrency issues if used in a multithreaded environment") and self-negating findings ("no database queries found — consider optimizing your database queries") are explicitly suppressed by prompt rules verified against known repro cases.

### Async queue with real-time dashboard
Review jobs are processed asynchronously via BullMQ backed by Redis — PRs are never blocked waiting for a review to complete. A live dashboard shows:

- Per-service health indicators (DB, Queue, Agent, RAG, LLM) with real-time state
- Agent runs table with per-agent duration, finding count, and outcome
- Queue state (waiting/active/delayed/failed) with retry/dismiss actions on failed jobs
- Review history per PR with `latest`/`outdated` tags per commit SHA

### Per-user data isolation
Each user's connected repositories, indexed codebases, review history, and findings are fully scoped to their account. No data from one user's repos is ever surfaced in another user's dashboard.

### GitHub App native integration
Installs directly via GitHub's App marketplace pattern — no manual webhook setup required. Reviews are posted as native GitHub PR review comments with inline annotations on specific diff lines. The bot appears as `deva-codereviewai` in the PR timeline, indistinguishable in format from a human reviewer's comments.

---

## Architecture

```
GitHub PR event
      │
      ▼
Express webhook handler (HMAC-verified)
      │
      ▼
BullMQ job queue (Redis-backed)
      │
      ▼
Static Analysis Node
│  ├── Ruff / Bandit / MyPy  (Python)
│  └── ESLint / Semgrep      (JS/TS)
      │
      ▼
RAG Retrieval (Pinecone hybrid search)
│  ├── File-local context
│  └── Cross-file dependency lookup (changed symbols → callers)
      │
      ▼
LangGraph Supervisor
│  ├── Security Agent  ──┐
│  ├── Performance Agent ├── parallel
│  └── Style Agent    ──┘
      │
      ▼
Finding aggregation + semantic dedup + severity normalization
      │
      ▼
GitHub PR review comment (inline annotations)
      │
      ▼
Postgres (findings, reviews, agent runs stored per commit SHA)
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, Vanilla CSS, deployed on Vercel |
| Webhook handler | Express.js, HMAC signature verification |
| Agent orchestration | FastAPI, LangGraph |
| LLM inference | Groq (Llama family) |
| Vector store | Pinecone (hybrid BM25 + dense, per-repo namespaces) |
| Queue | BullMQ + Redis |
| Database | Neon Postgres |
| Auth | Google OAuth + GitHub App |
| Deployment | Vercel (frontend), Railway/Render (backend services) |

---

## What makes this different from existing tools

| | CodeReviewAI | GitHub Copilot Review | SonarQube | CodeRabbit |
|--|--|--|--|--|
| Multi-agent parallel analysis | ✅ | ❌ | ❌ | Partial |
| Codebase-aware RAG context | ✅ | ❌ | ❌ | ❌ |
| Cross-file dependency tracking | ✅ | ❌ | ✅ (AST-based) | ❌ |
| Static analysis + LLM hybrid | ✅ | ❌ | ✅ (static only) | Partial |
| Async queue (never blocks CI) | ✅ | ❌ | ✅ | ✅ |
| Merge conflict line-level detail | ✅ | ✅ | ❌ | Partial |
| Per-user data isolation | ✅ | ✅ | ✅ | ✅ |
| Self-hostable / open pipeline | ✅ | ❌ | ✅ | ❌ |
