"use client";

import { Activity, GitPullRequest, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchHealth, fetchReviews, type Review } from "../lib/api";

export default function Home() {
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [number, setNumber] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchHealth().then(() => setHealth("ok")).catch(() => setHealth("down"));
  }, []);

  const metrics = useMemo(() => {
    const findings = reviews.flatMap((review) => review.findings ?? []);
    return {
      reviews: reviews.length,
      findings: findings.length,
      high: findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length,
      latestRisk: reviews[0]?.risk_score ?? "0"
    };
  }, [reviews]);

  async function lookup() {
    if (!owner || !repo || !number) return;
    setLoading(true);
    try {
      setReviews((await fetchReviews(owner, repo, number)).reviews);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={24} />CodeReviewAI</div>
        <nav className="nav">
          <div className="nav-item active"><GitPullRequest size={18} />Reviews</div>
          <div className="nav-item"><Activity size={18} />Agents</div>
          <div className="nav-item"><RefreshCw size={18} />Queue</div>
        </nav>
      </aside>
      <section className="main">
        <div className="topbar">
          <div>
            <h1 className="title">Async PR reviewer</h1>
            <p className="subtitle">Track queued reviews, agent findings, and GitHub posting status.</p>
          </div>
          <div className="status" title="API health">
            <span className="dot" style={{ background: health === "ok" ? "#1c7c54" : "#b42318" }} />
            {health === "checking" ? "Checking API" : health === "ok" ? "API online" : "API offline"}
          </div>
        </div>
        <div className="grid">
          <Metric label="Reviews" value={metrics.reviews} />
          <Metric label="Findings" value={metrics.findings} />
          <Metric label="High risk" value={metrics.high} />
          <Metric label="Latest risk" value={metrics.latestRisk} />
        </div>
        <section className="section">
          <div className="section-head">
            <h2>Pull request lookup</h2>
            <div className="lookup">
              <input placeholder="owner" value={owner} onChange={(event) => setOwner(event.target.value)} />
              <input placeholder="repo" value={repo} onChange={(event) => setRepo(event.target.value)} />
              <input placeholder="PR #" value={number} onChange={(event) => setNumber(event.target.value)} />
              <button onClick={lookup} disabled={loading} title="Search reviews"><Search size={16} />{loading ? "Loading" : "Search"}</button>
            </div>
          </div>
          <div className="table">
            <div className="row head"><div>Status</div><div>Summary</div><div>Risk</div><div>Findings</div></div>
            {reviews.length === 0 ? (
              <div className="row"><div className="badge running">Ready</div><div>Search for a PR after a webhook has queued a review.</div><div>0</div><div>0</div></div>
            ) : reviews.map((review) => (
              <div className="row" key={review.id}>
                <div className={badgeClass(review.status)}>{review.status}</div>
                <div><strong>{review.full_name} #{review.number}</strong><div className="findings">{review.summary ?? review.title}</div></div>
                <div>{review.risk_score ?? "0"}</div>
                <div>{review.findings?.length ?? 0}</div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>;
}

function badgeClass(status: string) {
  if (status === "failed") return "badge failed";
  if (status === "in_progress" || status === "queued") return "badge running";
  return "badge";
}
