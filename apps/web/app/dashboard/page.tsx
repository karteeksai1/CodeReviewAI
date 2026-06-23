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
  retryJob,
  type AgentRun,
  type ConnectState,
  type DashboardStats,
  type QueueState,
  type Review
} from "../../lib/api";
import { useAuth } from "../../lib/auth";

type Tab = "reviews" | "agents" | "queue" | "connect";

const emptyStats: DashboardStats = { reviews: 0, findings: 0, high: 0, latestRisk: 0 };
const emptyQueue: QueueState = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, jobs: [] };

export default function Home() {
  const router = useRouter();
  const { user, token, loading: authLoading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("reviews");
  const [healthStatus, setHealthStatus] = useState<"checking" | "ok" | "down">("checking");
  const [healthDetails, setHealthDetails] = useState<{
    postgres: boolean;
    redis: boolean;
    agent: boolean;
    pinecone: boolean;
    groq: boolean;
  } | null>(null);
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
  const [initialFetching, setInitialFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const prNumberValid = /^[1-9]\d*$/.test(number.trim());
  const canSearch = Boolean(owner.trim() && repo.trim() && prNumberValid && token && !loading);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    fetchHealth()
      .then((data) => {
        setHealthDetails(data);
        setHealthStatus(data.status === "healthy" ? "ok" : "down");
      })
      .catch(() => {
        setHealthStatus("down");
      });
  }, []);

  useEffect(() => {
    if (!token) return;
    const activeToken = token;
    let mounted = true;
    async function refresh() {
      try {
        const [statsData, queueData, agentsData, connectData, healthData] = await Promise.all([
          fetchStats(activeToken),
          fetchQueue(activeToken),
          fetchAgentRuns(activeToken),
          fetchConnectState(activeToken),
          fetchHealth().catch(() => null)
        ]);
        if (!mounted) return;
        setStats(statsData);
        setQueue(queueData);
        setAgentRuns(agentsData.agentRuns);
        setConnectState(connectData);
        if (healthData) {
          setHealthDetails(healthData);
          setHealthStatus(healthData.status === "healthy" ? "ok" : "down");
        } else {
          setHealthStatus("down");
        }
        setInitialFetching(false);
      } catch {
        if (mounted) {
          setHealthStatus("down");
          setInitialFetching(false);
        }
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

  const riskDelta = useMemo(() => {
    const current = Number(visibleStats.latestRisk);
    const prev = Number(stats.previousRisk ?? 0);
    return current - prev;
  }, [visibleStats, stats]);

  async function lookup() {
    if (!token) return;
    if (!owner.trim() || !repo.trim()) {
      setError("Owner and repo are required.");
      return;
    }
    if (!prNumberValid) {
      setError("PR number must be a positive integer.");
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

  async function handleRetry(jobId: string) {
    if (!token) return;
    setRetryingJobId(jobId);
    try {
      await retryJob(jobId, token);
      const queueData = await fetchQueue(token);
      setQueue(queueData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry request failed");
    } finally {
      setRetryingJobId(null);
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
    return (
      <main className="login-shell">
        <div className="skeleton-loader" style={{ width: "300px", height: "80px", borderRadius: "12px" }}></div>
      </main>
    );
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
          <div className="user-email">
            {user.email}
            {user.isAdmin && <span className="admin-tag">Admin</span>}
          </div>
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
          <div className="status health-status-container">
            <span className="health-label">Services:</span>
            <div className="health-micro-badge" title="Neon Postgres Connection">
              <span className="dot" style={{ background: healthDetails?.postgres ? "var(--green)" : "var(--red)" }} />
              <span>DB</span>
            </div>
            <div className="health-micro-badge" title="Redis / BullMQ Queue Connection">
              <span className="dot" style={{ background: healthDetails?.redis ? "var(--green)" : "var(--red)" }} />
              <span>Queue</span>
            </div>
            <div className="health-micro-badge" title="FastAPI Agent Bridge Connection">
              <span className="dot" style={{ background: healthDetails?.agent ? "var(--green)" : "var(--red)" }} />
              <span>Agent</span>
            </div>
            <div className="health-micro-badge" title="Pinecone RAG Vector Store Status">
              <span className="dot" style={{ background: healthDetails?.pinecone ? "var(--green)" : "var(--red)" }} />
              <span>RAG</span>
            </div>
            <div className="health-micro-badge" title="Groq Inference API Connection">
              <span className="dot" style={{ background: healthDetails?.groq ? "var(--green)" : "var(--red)" }} />
              <span>Groq</span>
            </div>
          </div>
        </div>

        <div className="grid">
          <Metric
            label="Reviews"
            value={visibleStats.reviews}
            trend={stats.reviewsDelta && stats.reviewsDelta > 0 ? `▲ +${stats.reviewsDelta} 24h` : undefined}
          />
          <Metric
            label="Findings"
            value={visibleStats.findings}
            trend={stats.findingsDelta && stats.findingsDelta > 0 ? `▲ +${stats.findingsDelta} 24h` : undefined}
          />
          <Metric
            label="High risk"
            value={visibleStats.high}
            trend={stats.highDelta && stats.highDelta > 0 ? `▲ +${stats.highDelta} 24h` : undefined}
            isAlert={visibleStats.high > 0}
          />
          <Metric
            label="Latest risk"
            value={visibleStats.latestRisk}
            trend={
              riskDelta > 0
                ? `▲ +${riskDelta.toFixed(1)}`
                : riskDelta < 0
                ? `▼ ${riskDelta.toFixed(1)}`
                : "—"
            }
            trendColor={riskDelta > 0 ? "var(--red)" : riskDelta < 0 ? "var(--green)" : undefined}
            hasTooltip
          />
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
            initialFetching={initialFetching}
            setActiveTab={setActiveTab}
          />
        ) : null}

        {activeTab === "agents" ? (
          <AgentsView
            agentRuns={agentRuns}
            initialFetching={initialFetching}
            setActiveTab={setActiveTab}
          />
        ) : null}

        {activeTab === "queue" ? (
          <QueueView
            queue={queue}
            initialFetching={initialFetching}
            handleRetry={handleRetry}
            retryingJobId={retryingJobId}
          />
        ) : null}

        {activeTab === "connect" ? (
          <ConnectView
            connectState={connectState}
            repositoryToIndex={repositoryToIndex}
            setRepositoryToIndex={setRepositoryToIndex}
            startIndexing={startIndexing}
            user={user}
            initialFetching={initialFetching}
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
  initialFetching: boolean;
  setActiveTab: (tab: Tab) => void;
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
            onChange={(event) => props.setNumber(event.target.value.replace(/\D/g, "").replace(/^0+/, ""))}
            aria-invalid={props.number.length > 0 && !props.prNumberValid}
          />
          <button onClick={props.lookup} disabled={!props.canSearch} title="Search reviews">
            <Search size={16} />{props.loading ? "Loading" : "Search"}
          </button>
        </div>
      </div>
      {props.number.length > 0 && !props.prNumberValid ? <p className="input-hint">PR number must be a positive integer without leading zeros.</p> : null}
      
      {props.initialFetching ? (
        <div className="review-layout">
          <div className="skeleton-container">
            <div className="skeleton" style={{ height: "45px", width: "100%", marginBottom: "12px" }} />
            <div className="skeleton" style={{ height: "55px", width: "100%", marginBottom: "8px" }} />
            <div className="skeleton" style={{ height: "55px", width: "100%", marginBottom: "8px" }} />
            <div className="skeleton" style={{ height: "55px", width: "100%", marginBottom: "8px" }} />
          </div>
          <div className="skeleton" style={{ height: "260px", width: "100%" }} />
        </div>
      ) : (
        <div className="review-layout">
          <div className="table">
            <div className="row head"><div>Status</div><div>Summary</div><div>Risk</div><div>Findings</div></div>
            {props.reviews.length === 0 ? (
              <div className="onboarding-empty-state">
                <h3>No PR Reviews Loaded</h3>
                <p>Lookup reviews by repository details and PR number, or connect a repository and index it to receive webhooks.</p>
                <button className="onboarding-btn" onClick={() => props.setActiveTab("connect")}>
                  Connect a repo to see your first review here →
                </button>
              </div>
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
      )}
    </section>
  );
}

function ReviewDetail({ review }: { review: Review | null }) {
  if (!review) {
    return (
      <aside className="detail-panel">
        <h2>Review detail</h2>
        <p className="muted">Select a review row to inspect findings, agents, and RAG sources.</p>
      </aside>
    );
  }
  return (
    <aside className="detail-panel">
      <h2>{review.full_name} #{review.number}</h2>
      <p className="muted">{review.summary ?? review.title}</p>
      
      <div className="timeline-container">
        <h3>Analysis Pipeline</h3>
        <div className="timeline-flow">
          {(review.agent_runs ?? []).map((run) => (
            <div className={`timeline-node ${run.status}`} key={run.agent}>
              <div className="node-icon" />
              <div className="node-content">
                <span className="node-agent">{run.agent}</span>
                <small className="node-meta">
                  {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : "running"}
                  {run.status === "completed" ? ` · ${run.finding_count} findings` : ` · ${run.status}`}
                </small>
                {run.error && <p className="node-error">{run.error}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="finding-list">
        <h3>Findings List</h3>
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
            
            {finding.metadata?.rag_context && finding.metadata.rag_context.length > 0 && (
              <div className="rag-sources-section">
                <h4>Retrieved RAG Chunks</h4>
                <div className="rag-sources-grid">
                  {finding.metadata.rag_context.map((source, index) => (
                    <div className="rag-source-card" key={index}>
                      <div className="rag-source-header">
                        <span className="rag-source-path">{source.path}</span>
                        {source.score !== undefined && (
                          <span className="rag-source-score">score: {source.score.toFixed(3)}</span>
                        )}
                      </div>
                      <pre className="rag-source-chunk"><code>{source.text}</code></pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

function AgentsView({ agentRuns, initialFetching, setActiveTab }: {
  agentRuns: AgentRun[];
  initialFetching: boolean;
  setActiveTab: (tab: Tab) => void;
}) {
  if (initialFetching) {
    return (
      <section className="section">
        <div className="section-head"><h2>Agent runs</h2></div>
        <div className="skeleton-container">
          <div className="skeleton" style={{ height: "45px", width: "100%", marginBottom: "12px" }} />
          <div className="skeleton" style={{ height: "55px", width: "100%", marginBottom: "8px" }} />
          <div className="skeleton" style={{ height: "55px", width: "100%", marginBottom: "8px" }} />
        </div>
      </section>
    );
  }

  if (agentRuns.length === 0) {
    return (
      <section className="section">
        <div className="section-head"><h2>Agent runs</h2></div>
        <div className="onboarding-empty-state">
          <h3>No Agent Runs Recorded</h3>
          <p>Agent runs track individual security, performance, and style analyses. They will appear here once a PR review is triggered by a GitHub webhook.</p>
          <button className="onboarding-btn" onClick={() => setActiveTab("connect")}>
            Go to Connect Tab to configure webhook →
          </button>
        </div>
      </section>
    );
  }

  function getAgentDesc(agent: string) {
    if (agent === "security") return "Analyzed diff for secrets, authorization issues, injection vulnerabilities, and security flaws.";
    if (agent === "performance") return "Analyzed diff for resource leaks, optimization hot paths, and performance regressions.";
    if (agent === "style") return "Analyzed diff for formatting consistency, styling issues, and code smells.";
    return "Analyzed repository diff.";
  }

  return (
    <section className="section">
      <div className="section-head"><h2>Agent runs</h2><span className="muted">Polling every 5 seconds</span></div>
      <div className="table">
        <div className="row agent-runs-row head">
          <div>Agent</div>
          <div>Target</div>
          <div>Analysis Description</div>
          <div>Duration</div>
          <div>Outcome</div>
        </div>
        {agentRuns.map((run) => (
          <div className="row agent-runs-row" key={`${run.review_id}-${run.agent}`}>
            <div>
              <span className={`agent-chip ${run.agent}`}>{run.agent}</span>
            </div>
            <div>
              <strong>{run.full_name} #{run.number}</strong>
            </div>
            <div className="agent-run-desc">
              {getAgentDesc(run.agent)}
              {run.error && <p className="run-error-msg">{run.error}</p>}
            </div>
            <div>{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : "-"}</div>
            <div>
              <span className={`badge ${run.status === "failed" ? "failed" : run.status === "completed" ? "" : "running"}`}>
                {run.status === "completed" ? `${run.finding_count ?? 0} findings` : run.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function QueueView({ queue, initialFetching, handleRetry, retryingJobId }: {
  queue: QueueState;
  initialFetching: boolean;
  handleRetry: (jobId: string) => Promise<void>;
  retryingJobId: string | null;
}) {
  if (initialFetching) {
    return (
      <section className="section">
        <div className="section-head"><h2>Queue</h2></div>
        <div className="skeleton-container">
          <div className="skeleton" style={{ height: "45px", width: "100%", marginBottom: "12px" }} />
          <div className="skeleton" style={{ height: "55px", width: "100%", marginBottom: "8px" }} />
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="section-head"><h2>Queue</h2><span className="muted">BullMQ job states</span></div>
      <div className="grid queue-grid">
        <Metric label="Waiting" value={queue.waiting} />
        <Metric label="Active" value={queue.active} />
        <Metric label="Delayed" value={queue.delayed} />
        <Metric label="Failed" value={queue.failed} isAlert={queue.failed > 0} />
      </div>
      <div className="table">
        <div className="row queue-row head"><div>State</div><div>Repository</div><div>Event</div><div>Attempts</div></div>
        {queue.jobs.length === 0 ? (
          <div className="onboarding-empty-state">
            <h3>Queue is Empty</h3>
            <p>No queued review jobs are currently in progress or waiting. Trigger reviews automatically by opening a PR on a connected repository.</p>
          </div>
        ) : null}
        {queue.jobs.map((job) => (
          <div className="row queue-row" key={job.id}>
            <div>
              <div className={badgeClass(job.state)}>{job.state}</div>
              {job.state === "failed" && (
                <button
                  className="retry-btn"
                  onClick={() => handleRetry(String(job.id))}
                  disabled={retryingJobId === String(job.id)}
                >
                  {retryingJobId === String(job.id) ? "Retrying..." : "Retry"}
                </button>
              )}
            </div>
            <div>
              <strong>{job.repository ?? "unknown"}</strong>
              {job.pullNumber ? ` #${job.pullNumber}` : ""}
              {job.state === "failed" && job.failedReason && (
                <div className="job-error-msg">{job.failedReason}</div>
              )}
            </div>
            <div>{job.eventName ?? "review"}</div>
            <div>{job.attemptsMade ?? 0}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConnectView({ connectState, repositoryToIndex, setRepositoryToIndex, startIndexing, user, initialFetching }: {
  connectState: ConnectState | null;
  repositoryToIndex: string;
  setRepositoryToIndex: (value: string) => void;
  startIndexing: () => void;
  user: any;
  initialFetching: boolean;
}) {
  if (initialFetching) {
    return (
      <section className="section">
        <div className="section-head"><h2>Connect repository</h2></div>
        <div className="skeleton" style={{ height: "180px", width: "100%", marginBottom: "16px" }} />
      </section>
    );
  }

  const showSetupCard = !connectState?.installUrl && user?.isAdmin;

  return (
    <section className="section">
      <div className="section-head"><h2>Connect repository</h2><Database size={20} /></div>
      
      {showSetupCard && (
        <div className="setup-required-card">
          <h3>GitHub App Setup Required</h3>
          <p>The <code>GITHUB_APP_INSTALL_URL</code> environment variable is not configured. To enable deep-linking and allow users to install the GitHub App directly from this dashboard, configure it in your <code>.env</code> file:</p>
          <pre><code>GITHUB_APP_INSTALL_URL=https://github.com/apps/your-app-name/installations/new</code></pre>
          <p className="muted text-xs">This card is only visible to administrators.</p>
        </div>
      )}

      <div className="connect-grid">
        {connectState?.installUrl && (
          <div className="connect-panel">
            <h3>GitHub App</h3>
            <p className="muted">{connectState?.githubAppName ?? "CodeReviewAI"}</p>
            <a className="primary-link" href={connectState.installUrl}>Install GitHub App</a>
          </div>
        )}
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

function Metric({ label, value, trend, trendColor, isAlert, hasTooltip }: {
  label: string;
  value: string | number;
  trend?: string;
  trendColor?: string;
  isAlert?: boolean;
  hasTooltip?: boolean;
}) {
  return (
    <div className={`metric ${isAlert ? "alert" : ""}`}>
      <div className="metric-label">
        {label}
        {hasTooltip && (
          <div className="tooltip-wrapper">
            <span className="tooltip-trigger">ⓘ</span>
            <div className="tooltip-content">
              <h4>Risk Score Rubric</h4>
              <p>Scored 0–100 based on unique findings and severity weights:</p>
              <ul>
                <li><strong>Critical:</strong> 100 pts</li>
                <li><strong>High:</strong> 80 pts</li>
                <li><strong>Medium:</strong> 55 pts</li>
                <li><strong>Low:</strong> 25 pts</li>
                <li><strong>Info:</strong> 10 pts</li>
              </ul>
              <p className="formula">Formula: sum(weights) / 3 (capped at 100)</p>
            </div>
          </div>
        )}
      </div>
      <div className="metric-value-row">
        <div className="metric-value">{value}</div>
        {trend && (
          <span className="metric-trend" style={{ color: trendColor }}>
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}

function badgeClass(status: string) {
  if (status === "failed") return "badge failed";
  if (status === "active" || status === "in_progress" || status === "running" || status === "waiting") return "badge running";
  return "badge";
}