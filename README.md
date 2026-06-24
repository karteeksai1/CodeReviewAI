# CodeReviewAI

Async PR reviewer with an Express webhook/API, Redis-backed BullMQ workers, a FastAPI + LangGraph agent layer, Groq-powered review agents, Hugging Face embeddings, Pinecone RAG, and Neon Postgres persistence.

No Docker is required. The intended deployment target is Render for the API, worker, agent, and Redis, Neon for Postgres, Pinecone for vectors, Groq for the LLM, Hugging Face for embeddings, and Vercel for the web dashboard.

## Structure

```text
apps/api      Express webhook, REST API, BullMQ queue, worker, GitHub App services
apps/agent    FastAPI + LangGraph supervisor, Groq agents, aggregation, Hugging Face codebase RAG
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

Set these core values in `.env`:

```bash
NEON_DATABASE_URL="postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/codereviewai?sslmode=require"
REDIS_URL="redis://..."
GROQ_API_KEY="gsk_..."
GROQ_MODEL="llama-3.3-70b-versatile"
HUGGINGFACE_API_KEY="hf_..."
HUGGINGFACE_EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIMENSIONS=384
PINECONE_API_KEY="..."
PINECONE_INDEX="codereviewai"
GITHUB_APP_INSTALL_URL="https://github.com/apps/your-app-name/installations/new"
```

Create the Pinecone index with the same dimension as the Hugging Face model output. The default `sentence-transformers/all-MiniLM-L6-v2` model uses `384` dimensions.

Run services in separate terminals:

```bash
npm run dev:api    # Express API on http://localhost:3001
npm run dev:worker
cd apps/agent && uvicorn main:app --reload --port 8000
npm run dev:web    # Next.js dashboard on http://localhost:3000
```

Open the dashboard at `http://localhost:3000/login`. Default credentials are `admin@codereviewai.local` / `changeme`.

The GitHub webhook endpoint is `POST /webhook`. It verifies the HMAC signature and returns `202 Accepted` after enqueueing review work.

## Deploy

Use `render.yaml` for Render services. Add `NEON_DATABASE_URL` from Neon to both the API and worker services. Add `GROQ_API_KEY`, `HUGGINGFACE_API_KEY`, `PINECONE_API_KEY`, and `PINECONE_INDEX` to the agent service.

Deploy `apps/web` separately to Vercel and set `NEXT_PUBLIC_API_URL` to your Render API URL.
