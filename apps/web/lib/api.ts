export type AuthUser = {
  id: number;
  email: string;
};

export type Review = {
  id: number;
  status: string;
  summary: string | null;
  risk_score: string | null;
  full_name: string;
  number: number;
  title: string;
  findings: Finding[];
  agent_runs?: AgentRun[];
};

export type Finding = {
  id: number;
  category: string;
  severity: string;
  title: string;
  body?: string;
  path: string | null;
  line: number | null;
  confidence?: string | number | null;
  metadata?: {
    rag_context?: Array<{ path?: string; text?: string; score?: number }>;
    provider?: string;
    diff_context?: string;
  };
};

export type AgentRun = {
  id?: number;
  review_id?: number;
  agent: "security" | "performance" | "style" | string;
  status: string;
  finding_count?: number;
  duration_ms?: number | null;
  full_name?: string;
  number?: number;
  title?: string;
  updated_at?: string;
};

export type QueueState = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  jobs: Array<{
    id: string | number;
    state: string;
    eventName?: string;
    repository?: string;
    pullNumber?: number;
    attemptsMade?: number;
    failedReason?: string;
    timestamp?: number;
  }>;
};

export type DashboardStats = {
  reviews: number;
  findings: number;
  high: number;
  latestRisk: string | number;
};

export type ConnectState = {
  githubAppName: string;
  installUrl: string | null;
  indexingJobs: Array<{
    id: number;
    repository_full_name: string;
    status: string;
    chunks: number;
    embedded: number;
    message: string | null;
    created_at: string;
  }>;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function parseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function assertNumericId(value: string, label: string) {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${label} must be numeric.`);
  }
}

export async function fetchHealth() {
  const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
  if (!response.ok) throw new Error("API health check failed");
  return response.json();
}

export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(await parseError(response, "Login failed"));
  return (await response.json()) as { token: string; user: AuthUser };
}

export async function fetchMe(token: string) {
  const response = await fetch(`${API_URL}/auth/me`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Session expired"));
  return (await response.json()) as { user: AuthUser };
}

export async function fetchReviews(owner: string, repo: string, number: string, token: string) {
  const prNumber = number.trim();
  assertNumericId(prNumber, "PR number");
  const params = new URLSearchParams({ owner, repo, number: prNumber });
  const response = await fetch(`${API_URL}/reviews/pr?${params}`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Review lookup failed"));
  return (await response.json()) as { reviews: Review[] };
}

export async function fetchReviewDetail(id: number, token: string) {
  const response = await fetch(`${API_URL}/reviews/${id}`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Review detail failed"));
  return (await response.json()) as { review: Review };
}

export async function fetchQueue(token: string) {
  const response = await fetch(`${API_URL}/reviews/queue`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Queue lookup failed"));
  return (await response.json()) as QueueState;
}

export async function fetchStats(token: string) {
  const response = await fetch(`${API_URL}/reviews/stats`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Stats lookup failed"));
  return (await response.json()) as DashboardStats;
}

export async function fetchAgentRuns(token: string) {
  const response = await fetch(`${API_URL}/reviews/agents`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Agent run lookup failed"));
  return (await response.json()) as { agentRuns: AgentRun[] };
}

export async function fetchConnectState(token: string) {
  const response = await fetch(`${API_URL}/reviews/connect`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Connect state lookup failed"));
  return (await response.json()) as ConnectState;
}

export async function requestIndexing(repository: string, token: string) {
  const response = await fetch(`${API_URL}/reviews/indexing`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ repository })
  });
  if (!response.ok) throw new Error(await parseError(response, "Indexing request failed"));
  return response.json();
}
