"use client";

import {
  Activity,
  Database,
  GitBranch,
  GitPullRequest,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAgentRuns,
  fetchConnectState,
  fetchHealth,
  fetchQueue,
  fetchReviewDetail,
  fetchReviews,
  fetchStats,
  requestIndexing,
  type AgentRun,
  type ConnectState,
  type DashboardStats,
  type QueueState,
  type Review
} from "../lib/api";
import { useAuth } from "../lib/auth";

type Tab = "reviews" | "agents" | "queue" | "connect";

const emptyStats: DashboardStats = { reviews: 0, findings: 0, high: 0, latestRisk: 0 };
const emptyQueue: QueueState = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, jobs: [] };

export default function Home() {
  const router = useRouter();
  const { user, token, loading: authLoading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("reviews");
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [number, setNumber] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [queue, setQueue] = useState<QueueState>(emptyQueue);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [connectState, setConnectState] = useState<ConnectState | null>(null);
  const [repositoryToIndex, setRepositoryToIndex] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prNumberValid = /^\d+$/.test(number.trim());
  const canSearch = Boolean(owner.trim() && repo.trim() && prNumberValid && token && !loading);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    fetchHealth().then(() => setHealth("ok")).catch(() => setHealth("down"));
  }, []);

  useEffect(() => {
    if (!token) return;
    const activeToken = token;
    let mounted = true;
    async function refresh() {
      try {
        const [statsData, queueData, agentsData, connectData] = await Promise.all([
          fetchStats(activeToken),
          fetchQueue(activeToken),
          fetchAgentRuns(activeToken),
          fetchConnectState(activeToken)
        ]);
        if (!mounted) return;
        setStats(statsData);
        setQueue(queueData);
        setAgentRuns(agentsData.agentRuns);
        setConnectState(connectData);
      } catch {
        if (mounted) setHealth("down");
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [token]);

  const visibleStats = useMemo(() => {
    const localFindings = reviews.flatMap((review) => review.findings ?? []);
    if (stats.reviews || stats.findings || stats.high || Number(stats.latestRisk)) return stats;
    return {
      reviews: reviews.length,
      findings: localFindings.length,
      high: localFindings.filter((finding) => ["critical", "high"].includes(finding.severity)).length,
      latestRisk: reviews[0]?.risk_score ?? "0"
    };
  }, [reviews, stats]);

  async function lookup() {
    if (!token) return;
    if (!owner.trim() || !repo.trim()) {
      setError("Owner and repo are required.");
      return;
    }
    if (!prNumberValid) {
      setError("PR number must be numeric.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReviews(owner.trim(), repo.trim(), number.trim(), token);
      setReviews(data.reviews);
      setSelectedReview(data.reviews[0] ?? null);
    } catch (err) {
      setReviews([]);
      setSelectedReview(null);
      setError(err instanceof Error ? err.message : "Review lookup failed");
    } finally {
      setLoading(false);
    }
  }

  async function openReview(review: Review) {
    if (!token) return;
    setSelectedReview(review);
    try {
      setSelectedReview((await fetchReviewDetail(review.id, token)).review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review detail failed");
    }
  }

  async function startIndexing() {
    if (!token || !repositoryToIndex.trim()) return;
    try {
      await requestIndexing(repositoryToIndex.trim(), token);
      setRepositoryToIndex("");
      setConnectState(await fetchConnectState(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Indexing request failed");
    }
  }

  if (authLoading || !user) {
    return <main className="login-shell"><p className="login-subtitle">Loading session...</p></main>;
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={24} />CodeReviewAI</div>
        <nav className="nav">
          <NavButton tab="reviews" activeTab={activeTab} setActiveTab={setActiveTab} icon={<GitPullRequest size={18} />} label="Reviews" />
          <NavButton tab="agents" activeTab={activeTab} setActiveTab={setActiveTab} icon={<Activity size={18} />} label="Agents" />
          <NavButton tab="queue" activeTab={activeTab} setActiveTab={setActiveTab} icon={<RefreshCw size={18} />} label="Queue" />
          <NavButton tab="connect" activeTab={activeTab} setActiveTab={setActiveTab} icon={<GitBranch size={18} />} label="Connect" />
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">{user.email}</div>
          <button className="logout-button" onClick={() => { logout(); router.replace("/login"); }}>
            <LogOut size={16} />Sign out
          </button>
        </div>
      </aside>

      <section className="main">
        <div className="topbar">
          <div>
            <h1 className="title">Async PR reviewer</h1>
            <p className="subtitle">Live queue, agent runs, review findings, and repository indexing.</p>
          </div>
          <div className="status" title="API health">
            <span className="dot" style={{ background: health === "ok" ? "#1c7c54" : "#b42318" }} />
            {health === "checking" ? "Checking API" : health === "ok" ? "API online" : "API offline"}
          </div>
        </div>

        <div className="grid">
          <Metric label="Reviews" value={visibleStats.reviews} />
          <Metric label="Findings" value={visibleStats.findings} />
          <Metric label="High risk" value={visibleStats.high} />
          <Metric label="Latest risk" value={visibleStats.latestRisk} />
        </div>

        {error ? <p className="lookup-error">{error}</p> : null}

        {activeTab === "reviews" ? (
          <ReviewsView
            owner={owner}
            repo={repo}
            number={number}
            loading={loading}
            canSearch={canSearch}
            prNumberValid={prNumberValid}
            reviews={reviews}
            selectedReview={selectedReview}
            setOwner={setOwner}
            setRepo={setRepo}
            setNumber={setNumber}
            lookup={lookup}
            openReview={openReview}
          />
        ) : null}

        {activeTab === "agents" ? <AgentsView agentRuns={agentRuns} /> : null}
        {activeTab === "queue" ? <QueueView queue={queue} /> : null}
        {activeTab === "connect" ? (
          <ConnectView
            connectState={connectState}
            repositoryToIndex={repositoryToIndex}
            setRepositoryToIndex={setRepositoryToIndex}
            startIndexing={startIndexing}
          />
        ) : null}
      </section>
    </main>
  );
}

function NavButton({ tab, activeTab, setActiveTab, icon, label }: {
  tab: Tab;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button className={`nav-item ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
      {icon}{label}
    </button>
  );
}

function ReviewsView(props: {
  owner: string;
  repo: string;
  number: string;
  loading: boolean;
  canSearch: boolean;
  prNumberValid: boolean;
  reviews: Review[];
  selectedReview: Review | null;
  setOwner: (value: string) => void;
  setRepo: (value: string) => void;
  setNumber: (value: string) => void;
  lookup: () => void;
  openReview: (review: Review) => void;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>Pull request lookup</h2>
        <div className="lookup">
          <input placeholder="owner" value={props.owner} onChange={(event) => props.setOwner(event.target.value)} />
          <input placeholder="repo" value={props.repo} onChange={(event) => props.setRepo(event.target.value)} />
          <input
            placeholder="PR #"
            inputMode="numeric"
            value={props.number}
            onChange={(event) => props.setNumber(event.target.value)}
            aria-invalid={props.number.length > 0 && !props.prNumberValid}
          />
          <button onClick={props.lookup} disabled={!props.canSearch} title="Search reviews">
            <Search size={16} />{props.loading ? "Loading" : "Search"}
          </button>
        </div>
      </div>
      {props.number.length > 0 && !props.prNumberValid ? <p className="input-hint">PR number must contain digits only.</p> : null}
      <div className="review-layout">
        <div className="table">
          <div className="row head"><div>Status</div><div>Summary</div><div>Risk</div><div>Findings</div></div>
          {props.reviews.length === 0 ? (
            <div className="row"><div className="badge running">Ready</div><div>Search for a PR after a webhook has queued a review.</div><div>0</div><div>0</div></div>
          ) : props.reviews.map((review) => (
            <button className="row row-button" key={review.id} onClick={() => props.openReview(review)}>
              <div className={badgeClass(review.status)}>{review.status}</div>
              <div><strong>{review.full_name} #{review.number}</strong><div className="findings">{review.summary ?? review.title}</div></div>
              <div>{review.risk_score ?? "0"}</div>
              <div>{review.findings?.length ?? 0}</div>
            </button>
          ))}
        </div>
        <ReviewDetail review={props.selectedReview} />
      </div>
    </section>
  );
}

function ReviewDetail({ review }: { review: Review | null }) {
  if (!review) {
    return <aside className="detail-panel"><h2>Review detail</h2><p className="muted">Select a review row to inspect findings, agents, and RAG sources.</p></aside>;
  }
  return (
    <aside className="detail-panel">
      <h2>{review.full_name} #{review.number}</h2>
      <p className="muted">{review.summary ?? review.title}</p>
      <div className="agent-chip-row">
        {(review.agent_runs ?? []).map((run) => <span className={`agent-chip ${run.agent}`} key={run.agent}>{run.agent} · {run.status}</span>)}
      </div>
      <div className="finding-list">
        {(review.findings ?? []).length === 0 ? <p className="muted">No findings recorded for this review.</p> : null}
        {(review.findings ?? []).map((finding) => (
          <article className="finding-card" key={finding.id}>
            <div className="finding-top">
              <span className={`severity ${finding.severity}`}>{finding.severity}</span>
              <span className={`agent-chip ${finding.category}`}>{finding.category}</span>
            </div>
            <strong>{finding.title}</strong>
            <p>{finding.body}</p>
            <code>{finding.path ?? "unknown file"}{finding.line ? `:${finding.line}` : ""}</code>
            <div className="rag-list">
              {(finding.metadata?.rag_context ?? []).slice(0, 3).map((source, index) => (
                <div className="rag-source" key={`${source.path}-${index}`}>
                  <span>{source.path ?? "RAG source"}</span>
                  <p>{source.text ?? "Source context unavailable."}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function AgentsView({ agentRuns }: { agentRuns: AgentRun[] }) {
  const grouped = agentRuns.reduce<Record<string, AgentRun[]>>((acc, run) => {
    const key = `${run.full_name ?? "repository"} #${run.number ?? "PR"}`;
    acc[key] = [...(acc[key] ?? []), run];
    return acc;
  }, {});
  return (
    <section className="section">
      <div className="section-head"><h2>Agent runs</h2><span className="muted">Polling every 5 seconds</span></div>
      {Object.keys(grouped).length === 0 ? <div className="empty-state">No agent runs yet.</div> : null}
      <div className="run-list">
        {Object.entries(grouped).map(([label, runs]) => (
          <article className="run-card" key={label}>
            <div><strong>{label}</strong><p className="muted">{runs[0]?.title}</p></div>
            <div className="timeline">
              {["security", "performance", "style"].map((agent) => {
                const run = runs.find((item) => item.agent === agent);
                return <div className={`timeline-step ${run?.status ?? "pending"}`} key={agent}><span>{agent}</span><small>{run?.status ?? "pending"}</small></div>;
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function QueueView({ queue }: { queue: QueueState }) {
  return (
    <section className="section">
      <div className="section-head"><h2>Queue</h2><span className="muted">BullMQ job states</span></div>
      <div className="grid queue-grid">
        <Metric label="Waiting" value={queue.waiting} />
        <Metric label="Active" value={queue.active} />
        <Metric label="Delayed" value={queue.delayed} />
        <Metric label="Failed" value={queue.failed} />
      </div>
      <div className="table">
        <div className="row queue-row head"><div>State</div><div>Repository</div><div>Event</div><div>Attempts</div></div>
        {queue.jobs.length === 0 ? <div className="row queue-row"><div className="badge running">Idle</div><div>No queued jobs yet.</div><div>-</div><div>0</div></div> : null}
        {queue.jobs.map((job) => (
          <div className="row queue-row" key={job.id}>
            <div className={badgeClass(job.state)}>{job.state}</div>
            <div>{job.repository ?? "unknown"}{job.pullNumber ? ` #${job.pullNumber}` : ""}</div>
            <div>{job.eventName ?? "review"}</div>
            <div>{job.attemptsMade ?? 0}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConnectView({ connectState, repositoryToIndex, setRepositoryToIndex, startIndexing }: {
  connectState: ConnectState | null;
  repositoryToIndex: string;
  setRepositoryToIndex: (value: string) => void;
  startIndexing: () => void;
}) {
  return (
    <section className="section">
      <div className="section-head"><h2>Connect repository</h2><Database size={20} /></div>
      <div className="connect-grid">
        <div className="connect-panel">
          <h3>GitHub App</h3>
          <p className="muted">{connectState?.githubAppName ?? "CodeReviewAI"}</p>
          {connectState?.installUrl ? <a className="primary-link" href={connectState.installUrl}>Install GitHub App</a> : <p className="input-hint">Set GITHUB_APP_INSTALL_URL to enable install deep-linking.</p>}
        </div>
        <div className="connect-panel">
          <h3>Index codebase</h3>
          <div className="lookup compact">
            <input placeholder="owner/repo" value={repositoryToIndex} onChange={(event) => setRepositoryToIndex(event.target.value)} />
            <button onClick={startIndexing} disabled={!/^[\w.-]+\/[\w.-]+$/.test(repositoryToIndex)}><RefreshCw size={16} />Index</button>
          </div>
        </div>
      </div>
      <div className="run-list">
        {(connectState?.indexingJobs ?? []).map((job) => (
          <article className="run-card" key={job.id}>
            <strong>{job.repository_full_name}</strong>
            <div className="progress-track"><span style={{ width: `${job.chunks ? Math.min(100, (job.embedded / job.chunks) * 100) : 12}%` }} /></div>
            <p className="muted">{job.status} · {job.embedded}/{job.chunks} embedded</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>;
}

function badgeClass(status: string) {
  if (status === "failed") return "badge failed";
  if (status === "active" || status === "in_progress" || status === "running" || status === "waiting") return "badge running";
  return "badge";
}
