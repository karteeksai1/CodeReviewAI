# CodeReviewAI

Async PR reviewer with an Express webhook/API, Redis-backed BullMQ workers, a FastAPI + LangGraph agent layer, and RAG over repository source context.

No Docker is required. The intended deployment target is Render for the API, worker, agent, Redis, and Postgres, plus Vercel for the web dashboard.

## Structure

```text
apps/api      Express webhook, REST API, BullMQ queue, worker, GitHub App services
apps/agent    FastAPI + LangGraph supervisor, agents, aggregation, codebase RAG
apps/web      Next.js dashboard for Vercel
render.yaml   Render blueprint
```

## Local Setup

```bash
cp .env.example .env
npm install
python -m venv apps/agent/.venv
source apps/agent/.venv/bin/activate
pip install -r apps/agent/requirements.txt
```

Run services in separate terminals:

```bash
npm run dev:api
npm run dev:worker
cd apps/agent && uvicorn main:app --reload --port 8000
npm run dev:web
```

The GitHub webhook endpoint is `POST /webhook`. It verifies the HMAC signature and returns `202 Accepted` after enqueueing review work.

## Deploy

Use `render.yaml` for Render services. Deploy `apps/web` separately to Vercel and set `NEXT_PUBLIC_API_URL` to your Render API URL.
