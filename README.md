# CodeReviewAI
CodeReviewAI is an enterprise-grade, asynchronous, multi-agent code review system designed to analyze pull requests in parallel. By combining an ultra-fast Node.js ingest layer with a distributed LangGraph supervisor workflow and a hybrid-search codebase RAG, CodeReviewAI provides context-aware, deep architectural reviews that look beyond simple lint rules.


**🛠️ Tech Stack**
Ingest & Orchestration Layer
Runtime: Node.js
Framework: Express
Task Queue: Bull (Redis-backed)
Database: PostgreSQL (Neon)
Git Integration: Octokit (GitHub Apps Auth)


**AI & Agentic Layer**
Runtime: Python
Framework: FastAPI
Agent Orchestration: LangGraph (Supervisor Pattern)
Vector Database: Pinecone (Per-repo namespaces)
Search Architecture: Dual-Embedding Hybrid Search (Dense + BM25 Sparse)


**Repository Structure**
codereviewai/
├── apps/
│   ├── api/                    # Express — webhook + REST gateway
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── webhook.js
│   │   │   │   └── reviews.js
│   │   │   ├── queue/
│   │   │   │   ├── index.js    # Queue definitions
│   │   │   │   └── worker.js   # Background worker processing
│   │   │   ├── services/
│   │   │   │   ├── github.js   # Octokit client integration
│   │   │   │   └── agent-bridge.js # HTTP link to FastAPI
│   │   │   └── db/
│   │   │       └── index.js    # Postgres connector
│   │   └── package.json
│   │
│   └── agent/                  # Python — LangGraph Core
│       ├── graph/
│       │   ├── state.py        # Global state definition
│       │   ├── supervisor.py   # Multi-agent coordinator
│       │   ├── agents/
│       │   │   ├── security.py
│       │   │   ├── performance.py
│       │   │   └── style.py
│       │   └── nodes/
│       │       ├── aggregator.py
│       │       └── github_poster.py
│       ├── rag/
│       │   ├── indexer.py      # Codebase parsing & ingestion
│       │   └── retriever.py    # Hybrid dense-sparse retrieval
│       ├── main.py             # FastAPI exposure layer
│       └── requirements.txt
│
├── docker-compose.yml
└── .env


**🚀 Environment Configuration**
Create a root .env file containing the following properties:
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/codereviewai
REDIS_URL=redis://localhost:6339
GITHUB_APP_ID=your_github_app_id
GITHUB_PRIVATE_KEY=your_multi_line_private_key
GITHUB_WEBHOOK_SECRET=your_webhook_secret
FASTAPI_URL=http://localhost:8000
PINECONE_API_KEY=your_pinecone_key
PINECONE_ENVIRONMENT=your_environment
OPENAI_API_KEY=your_openai_key
