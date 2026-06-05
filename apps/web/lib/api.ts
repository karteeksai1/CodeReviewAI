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

export async function fetchHealth() {
  const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
  if (!response.ok) throw new Error("API health check failed");
  return response.json();
}

export async function fetchReviews(owner: string, repo: string, number: string) {
  const params = new URLSearchParams({ owner, repo, number });
  const response = await fetch(`${API_URL}/reviews/pr?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Review lookup failed");
  return (await response.json()) as { reviews: Review[] };
}
