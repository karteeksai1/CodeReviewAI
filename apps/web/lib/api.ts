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
  findings: Array<{ id: number; category: string; severity: string; title: string; path: string | null; line: number | null }>;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

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
  const params = new URLSearchParams({ owner, repo, number });
  const response = await fetch(`${API_URL}/reviews/pr?${params}`, {
    cache: "no-store",
    headers: authHeaders(token)
  });
  if (!response.ok) throw new Error(await parseError(response, "Review lookup failed"));
  return (await response.json()) as { reviews: Review[] };
}
