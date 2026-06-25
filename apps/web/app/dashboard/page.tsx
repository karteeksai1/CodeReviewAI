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
  fetchRepoStats,
  requestIndexing,
  retryJob,
  deleteJob,
  deleteIndexingJob,
  parseGitHubUrl,
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
  const [isCheckingHealth, setIsCheckingHealth] = useState(true);
  const [healthDetails, setHealthDetails] = useState<{
    postgres: string | boolean;
    redis: string | boolean;
    agent: string | boolean;
    pinecone: string | boolean;
    groq: string | boolean;
  } | null>(null);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [number, setNumber] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [repoStats, setRepoStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueState>(emptyQueue);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [connectState, setConnectState] = useState<ConnectState | null>(null);
  const [repositoryToIndex, setRepositoryToIndex] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialFetching, setInitialFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [highlightedRunKey, setHighlightedRunKey] = useState<string | null>(null);

  const prNumberValid = /^[1-9]\d*$/.test(number.trim());
  const canSearch = Boolean(owner.trim() && repo.trim() && prNumberValid && token && !loading);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as Tab;
    if (tab && ["reviews", "agents", "queue", "connect"].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.pushState(null, "", url.toString());
  };

  useEffect(() => {
    let mounted = true;
    let isFirstCheck = true;
    async function checkHealth() {
      if (isFirstCheck) setIsCheckingHealth(true);
      try {
        const data = await fetchHealth();
        if (!mounted) return;
        setHealthDetails(data);
        setHealthStatus(data.status === "healthy" ? "ok" : "down");
      } catch {
        if (mounted) {
          setHealthStatus("down");
        }
      } finally {
        isFirstCheck = false;
        if (mounted) setIsCheckingHealth(false);
      }
    }
    checkHealth();
    const healthTimer = window.setInterval(checkHealth, 5000);
    return () => {
      mounted = false;
      window.clearInterval(healthTimer);
    };
  }, []);

  useEffect(() => {
    if (!token) return;

    try {
      const cachedStats = localStorage.getItem("dashboard_stats");
      const cachedQueue = localStorage.getItem("dashboard_queue");
      const cachedAgents = localStorage.getItem("dashboard_agents");
      const cachedConnect = localStorage.getItem("dashboard_connect");
      if (cachedStats) setStats(JSON.parse(cachedStats));
      if (cachedQueue) setQueue(JSON.parse(cachedQueue));
      if (cachedAgents) setAgentRuns(JSON.parse(cachedAgents));
      if (cachedConnect) setConnectState(JSON.parse(cachedConnect));
      if (cachedStats || cachedQueue || cachedAgents || cachedConnect) {
        setInitialFetching(false);
      }
    } catch {}

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

        if (activeTab === "reviews" && owner.trim() && repo.trim()) {
          try {
            const rStats = await fetchRepoStats(owner.trim(), repo.trim(), activeToken);
            if (mounted) setRepoStats(rStats);
          } catch {}
        } else {
          setRepoStats(null);
        }

        try {
          localStorage.setItem("dashboard_stats", JSON.stringify(statsData));
          localStorage.setItem("dashboard_queue", JSON.stringify(queueData));
          localStorage.setItem("dashboard_agents", JSON.stringify(agentsData.agentRuns));
          localStorage.setItem("dashboard_connect", JSON.stringify(connectData));
        } catch {}
        setInitialFetching(false);
      } catch {
        if (mounted) {
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

  const handleAgentRunClick = async (fullName: string, prNumber: number) => {
    const [ownerPart, repoPart] = fullName.split("/");
    setOwner(ownerPart);
    setRepo(repoPart);
    setNumber(String(prNumber));
    switchTab("reviews");
    if (token) {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchReviews(ownerPart, repoPart, String(prNumber), token);
        setReviews(data.reviews);
        setSelectedReview(data.reviews[0] ?? null);
        try {
          const rStats = await fetchRepoStats(ownerPart, repoPart, token);
          setRepoStats(rStats);
        } catch {}
      } catch (err) {
        setReviews([]);
        setSelectedReview(null);
        setError(err instanceof Error ? err.message : "Review lookup failed");
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePipelineNodeClick = (agent: string, reviewId: number) => {
    switchTab("agents");
    const key = `${reviewId}-${agent}`;
    setHighlightedRunKey(key);
    setTimeout(() => {
      setHighlightedRunKey(null);
    }, 3000);
  };

  const handleReindex = async (repoName: string) => {
    if (!token) return;
    try {
      await requestIndexing(repoName, token);
      setConnectState(await fetchConnectState(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-indexing request failed");
    }
  };

  const visibleStats = useMemo(() => {
    const localFindings = reviews.flatMap((review) => review.findings ?? []);
    if (repoStats) return repoStats;
    if (stats.reviews || stats.findings || stats.high || Number(stats.latestRisk)) return stats;
    return {
      reviews: reviews.length,
      findings: localFindings.length,
      high: localFindings.filter((finding) => ["critical", "high"].includes(finding.severity)).length,
      latestRisk: reviews[0]?.risk_score ?? "0"
    };
  }, [reviews, stats, repoStats]);

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
      try {
        const rStats = await fetchRepoStats(owner.trim(), repo.trim(), token);
        setRepoStats(rStats);
      } catch {}
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

  async function handleDeleteJob(jobId: string) {
    if (!token) return;
    setDeletingJobId(jobId);
    try {
      await deleteJob(jobId, token);
      const queueData = await fetchQueue(token);
      setQueue(queueData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dismiss job failed");
    } finally {
      setDeletingJobId(null);
    }
  }

  async function handleDeleteIndexing(id: number) {
    if (!token) return;
    try {
      await deleteIndexingJob(id, token);
      setConnectState(await fetchConnectState(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete indexing job failed");
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

  const failedCount = useMemo(() => {
    return queue.jobs.filter((job) => job.state === "failed").length;
  }, [queue.jobs]);

  if (authLoading || !user) {
    return (
      <main className="login-shell">
        <div className="skeleton-loader" style={{ width: "300px", height: "80px", borderRadius: "12px" }}></div>
      </main>
    );
  }

  const getServiceStatus = (serviceKey: string, serviceName: string, statusVal: string | boolean | undefined) => {
    const current = isCheckingHealth ? "checking" : (statusVal ?? "unknown");
    let stateWord = "unknown";
    let cssClass = "unknown";
    if (current === "checking") {
      stateWord = (serviceKey === "pinecone" || serviceKey === "groq") ? "processing" : "checking";
      cssClass = "checking";
    } else if (current === "ok" || current === true) {
      stateWord = "operational";
      cssClass = "ok";
    } else if (current === "down" || current === false) {
      stateWord = "down";
      cssClass = "down";
    }
    return {
      title: `${serviceName}: ${stateWord}`,
      cssClass
    };
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={24} />CodeReviewAI</div>
        <nav className="nav">
          <NavButton tab="reviews" activeTab={activeTab} setActiveTab={switchTab} icon={<GitPullRequest size={18} />} label="Reviews" />
          <NavButton tab="agents" activeTab={activeTab} setActiveTab={switchTab} icon={<Activity size={18} />} label="Agents" />
          <NavButton tab="queue" activeTab={activeTab} setActiveTab={switchTab} icon={<RefreshCw size={18} />} label="Queue" badge={failedCount > 0 ? failedCount : undefined} badgeAlert={failedCount > 0} />
          <NavButton tab="connect" activeTab={activeTab} setActiveTab={switchTab} icon={<GitBranch size={18} />} label="Connect" />
          <button className="nav-item logout-nav-item" onClick={() => { logout(); router.replace("/"); }}>
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">
            {user.email}
            {user.isAdmin && <span className="admin-tag">Admin</span>}
          </div>
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
            <div className="health-micro-badge" title={getServiceStatus("postgres", "Database", healthDetails?.postgres).title} aria-label={getServiceStatus("postgres", "Database", healthDetails?.postgres).title}>
              <span className={`dot ${getServiceStatus("postgres", "Database", healthDetails?.postgres).cssClass}`} />
              <span>DB</span>
            </div>
            <div className="health-micro-badge" title={getServiceStatus("redis", "Queue", healthDetails?.redis).title} aria-label={getServiceStatus("redis", "Queue", healthDetails?.redis).title}>
              <span className={`dot ${getServiceStatus("redis", "Queue", healthDetails?.redis).cssClass}`} />
              <span>Queue</span>
            </div>
            <div className="health-micro-badge" title={getServiceStatus("agent", "Agent", healthDetails?.agent).title} aria-label={getServiceStatus("agent", "Agent", healthDetails?.agent).title}>
              <span className={`dot ${getServiceStatus("agent", "Agent", healthDetails?.agent).cssClass}`} />
              <span>Agent</span>
            </div>
            <div className="health-micro-badge" title={getServiceStatus("pinecone", "RAG", healthDetails?.pinecone).title} aria-label={getServiceStatus("pinecone", "RAG", healthDetails?.pinecone).title}>
              <span className={`dot ${getServiceStatus("pinecone", "RAG", healthDetails?.pinecone).cssClass}`} />
              <span>RAG</span>
            </div>
            <div className="health-micro-badge" title={getServiceStatus("groq", "LLM", healthDetails?.groq).title} aria-label={getServiceStatus("groq", "LLM", healthDetails?.groq).title}>
              <span className={`dot ${getServiceStatus("groq", "LLM", healthDetails?.groq).cssClass}`} />
              <span>LLM</span>
            </div>
          </div>
        </div>

        {activeTab !== "connect" && (
          <div className="grid">
            <Metric
              label={repoStats ? `${owner}/${repo} Reviews` : "Reviews"}
              value={visibleStats.reviews}
              trend={visibleStats.reviewsDelta && visibleStats.reviewsDelta > 0 ? `▲ +${visibleStats.reviewsDelta} 24h` : undefined}
              history={visibleStats.reviewsHistory}
            />
            <Metric
              label={repoStats ? "Repo Findings" : "Findings"}
              value={visibleStats.findings}
              trend={visibleStats.findingsDelta && visibleStats.findingsDelta > 0 ? `▲ +${visibleStats.findingsDelta} 24h` : undefined}
              history={visibleStats.findingsHistory}
            />
            <Metric
              label="High risk"
              value={visibleStats.high}
              trend={visibleStats.highDelta && visibleStats.highDelta > 0 ? `▲ +${visibleStats.highDelta} 24h` : undefined}
              isAlert={visibleStats.high > 0}
              history={visibleStats.highHistory}
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
              history={visibleStats.riskHistory}
            />
          </div>
        )}

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
            setActiveTab={switchTab}
            onPipelineNodeClick={handlePipelineNodeClick}
          />
        ) : null}

        {activeTab === "agents" ? (
          <AgentsView
            agentRuns={agentRuns}
            initialFetching={initialFetching}
            setActiveTab={switchTab}
            onRunClick={handleAgentRunClick}
            highlightedRunKey={highlightedRunKey}
          />
        ) : null}

        {activeTab === "queue" ? (
          <QueueView
            queue={queue}
            initialFetching={initialFetching}
            handleRetry={handleRetry}
            handleDelete={handleDeleteJob}
            retryingJobId={retryingJobId}
            deletingJobId={deletingJobId}
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
            onReindex={handleReindex}
            onDeleteIndexing={handleDeleteIndexing}
          />
        ) : null}
      </section>
    </main>
  );
}

function NavButton({ tab, activeTab, setActiveTab, icon, label, badge, badgeAlert }: {
  tab: Tab;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  badgeAlert?: boolean;
}) {
  return (
    <button className={`nav-item ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
      {icon}
      <span>{label}</span>
      {badge !== undefined && (
        <span className={`nav-badge ${badgeAlert ? "alert" : ""}`}>{badge}</span>
      )}
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
  onPipelineNodeClick?: (agent: string, reviewId: number) => void;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>Pull request lookup</h2>
        <div className="lookup">
          <input
            placeholder="owner"
            value={props.owner}
            onChange={(event) => {
              const val = event.target.value;
              const parsed = parseGitHubUrl(val);
              if (parsed && (val.includes("/") || val.includes("github.com"))) {
                props.setOwner(parsed.owner);
                props.setRepo(parsed.repo);
                if (parsed.prNumber) props.setNumber(parsed.prNumber);
              } else {
                props.setOwner(val);
              }
            }}
          />
          <input
            placeholder="repo"
            value={props.repo}
            onChange={(event) => {
              const val = event.target.value;
              const parsed = parseGitHubUrl(val);
              if (parsed && (val.includes("/") || val.includes("github.com"))) {
                props.setOwner(parsed.owner);
                props.setRepo(parsed.repo);
                if (parsed.prNumber) props.setNumber(parsed.prNumber);
              } else {
                props.setRepo(val);
              }
            }}
          />
          <input
            placeholder="PR #"
            inputMode="numeric"
            value={props.number}
            onChange={(event) => {
              const val = event.target.value;
              const parsed = parseGitHubUrl(val);
              if (parsed && (val.includes("/") || val.includes("github.com"))) {
                props.setOwner(parsed.owner);
                props.setRepo(parsed.repo);
                if (parsed.prNumber) props.setNumber(parsed.prNumber);
              } else {
                props.setNumber(val.replace(/\D/g, "").replace(/^0+/, ""));
              }
            }}
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
          <ReviewDetail review={props.selectedReview} onPipelineNodeClick={props.onPipelineNodeClick} />
        </div>
      )}
    </section>
  );
}

function ReviewDetail({ review, onPipelineNodeClick }: { review: Review | null; onPipelineNodeClick?: (agent: string, reviewId: number) => void }) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("severity");

  const severityWeight = (sev: string) => {
    switch (sev.toLowerCase()) {
      case "critical": return 5;
      case "high": return 4;
      case "medium": return 3;
      case "low": return 2;
      case "info": return 1;
      default: return 0;
    }
  };

  const filteredAndSortedFindings = useMemo(() => {
    let list = [...(review?.findings ?? [])];
    if (severityFilter !== "all") {
      list = list.filter((f) => f.severity.toLowerCase() === severityFilter.toLowerCase());
    }
    if (categoryFilter !== "all") {
      list = list.filter((f) => f.category.toLowerCase() === categoryFilter.toLowerCase());
    }
    list.sort((a, b) => {
      if (sortBy === "severity") {
        return severityWeight(b.severity) - severityWeight(a.severity);
      }
      if (sortBy === "line") {
        return (a.line ?? 0) - (b.line ?? 0);
      }
      return 0;
    });
    return list;
  }, [review?.findings, severityFilter, categoryFilter, sortBy]);

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
            <button
              className={`timeline-node ${run.status}`}
              key={run.agent}
              onClick={() => onPipelineNodeClick?.(run.agent, review.id)}
              style={{ background: "transparent", border: 0, textAlign: "left", cursor: "pointer", width: "100%", padding: 0 }}
            >
              <div className="node-icon" />
              <div className="node-content">
                <span className="node-agent">{run.agent}</span>
                <small className="node-meta">
                  {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : "running"}
                  {run.status === "completed" ? ` · ${run.finding_count} findings` : ` · ${run.status}`}
                </small>
                {run.error && <p className="node-error">{run.error}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="finding-list">
        <h3>Findings List</h3>
        <div className="finding-list-controls">
          <select className="filter-select" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All Categories</option>
            <option value="security">Security</option>
            <option value="performance">Performance</option>
            <option value="style">Style</option>
          </select>
          <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="severity">Sort by Severity</option>
            <option value="line">Sort by Line Number</option>
          </select>
        </div>
        {filteredAndSortedFindings.length === 0 ? <p className="muted">No matching findings recorded for this review.</p> : null}
        {filteredAndSortedFindings.map((finding) => (
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

function AgentsView({ agentRuns, initialFetching, setActiveTab, onRunClick, highlightedRunKey }: {
  agentRuns: AgentRun[];
  initialFetching: boolean;
  setActiveTab: (tab: Tab) => void;
  onRunClick: (fullName: string, prNumber: number) => void;
  highlightedRunKey: string | null;
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
          <button
            className={`row agent-runs-row row-button ${highlightedRunKey === `${run.review_id}-${run.agent}` ? "highlighted" : ""}`}
            key={`${run.review_id}-${run.agent}`}
            onClick={() => onRunClick(run.full_name ?? "", run.number ?? 0)}
          >
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
          </button>
        ))}
      </div>
    </section>
  );
}

function QueueView({ queue, initialFetching, handleRetry, handleDelete, retryingJobId, deletingJobId }: {
  queue: QueueState;
  initialFetching: boolean;
  handleRetry: (jobId: string) => Promise<void>;
  handleDelete: (jobId: string) => Promise<void>;
  retryingJobId: string | null;
  deletingJobId: string | null;
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
          <QueueRow
            key={job.id}
            job={job}
            handleRetry={handleRetry}
            handleDelete={handleDelete}
            retryingJobId={retryingJobId}
            deletingJobId={deletingJobId}
          />
        ))}
      </div>
    </section>
  );
}

function QueueRow({ job, handleRetry, handleDelete, retryingJobId, deletingJobId }: {
  job: any;
  handleRetry: (jobId: string) => Promise<void>;
  handleDelete: (jobId: string) => Promise<void>;
  retryingJobId: string | null;
  deletingJobId: string | null;
}) {
  const [showError, setShowError] = useState(false);
  const isStale = job.state === "failed" && job.failedReason?.includes("installation");
  return (
    <div className="row queue-row">
      <div>
        <div className={badgeClass(isStale ? "stale" : job.state)}>
          {isStale ? "Stale / Unrecoverable" : job.state}
        </div>
        {job.state === "failed" && (
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              className="retry-btn"
              onClick={() => handleRetry(String(job.id))}
              disabled={retryingJobId === String(job.id) || deletingJobId === String(job.id) || isStale}
            >
              {retryingJobId === String(job.id) ? "Retrying..." : "Retry"}
            </button>
            <button
              className="retry-btn"
              style={{ background: "transparent", color: "var(--red)", borderColor: "var(--red)" }}
              onClick={() => handleDelete(String(job.id))}
              disabled={retryingJobId === String(job.id) || deletingJobId === String(job.id)}
            >
              {deletingJobId === String(job.id) ? "Dismissing..." : "Dismiss"}
            </button>
          </div>
        )}
      </div>
      <div>
        <strong>{job.repository ?? "unknown"}</strong>
        {job.pullNumber ? ` #${job.pullNumber}` : ""}
        {job.state === "failed" && job.failedReason && (
          <div className="job-error-container">
            <button className="toggle-error-btn" onClick={() => setShowError(!showError)}>
              {showError ? "Hide error" : "View error"}
            </button>
            {showError && <div className="job-error-msg">{job.failedReason}</div>}
          </div>
        )}
      </div>
      <div>{job.eventName ?? "review"}</div>
      <div>{job.attemptsMade ?? 0}</div>
    </div>
  );
}

function ConnectView({ connectState, repositoryToIndex, setRepositoryToIndex, startIndexing, user, initialFetching, onReindex, onDeleteIndexing }: {
  connectState: ConnectState | null;
  repositoryToIndex: string;
  setRepositoryToIndex: (value: string) => void;
  startIndexing: () => void;
  user: any;
  initialFetching: boolean;
  onReindex: (repoName: string) => void;
  onDeleteIndexing: (id: number) => Promise<void>;
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

  const groupedJobs = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const job of (connectState?.indexingJobs ?? [])) {
      if (!groups[job.repository_full_name]) {
        groups[job.repository_full_name] = [];
      }
      groups[job.repository_full_name].push(job);
    }
    return Object.entries(groups).map(([repoName, jobs]) => {
      const sorted = [...jobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return {
        repository_full_name: repoName,
        latestJob: sorted[0],
        history: sorted.slice(1)
      };
    });
  }, [connectState?.indexingJobs]);

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
            <input
              placeholder="owner/repo"
              value={repositoryToIndex}
              onChange={(event) => {
                const val = event.target.value;
                const parsed = parseGitHubUrl(val);
                if (parsed && (val.includes("/") || val.includes("github.com"))) {
                  setRepositoryToIndex(`${parsed.owner}/${parsed.repo}`);
                } else {
                  setRepositoryToIndex(val);
                }
              }}
            />
            <button onClick={startIndexing} disabled={!/^[\w.-]+\/[\w.-]+$/.test(repositoryToIndex)}><RefreshCw size={16} />Index</button>
          </div>
        </div>
      </div>
      <div className="run-list">
        {groupedJobs.map((group) => (
          <RepoIndexingCard
            key={group.repository_full_name}
            group={group}
            onReindex={onReindex}
            onDelete={onDeleteIndexing}
          />
        ))}
      </div>
    </section>
  );
}

function RepoIndexingCard({ group, onReindex, onDelete }: {
  group: { repository_full_name: string; latestJob: any; history: any[] };
  onReindex: (repoName: string) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="repo-indexing-card-container" style={{ marginBottom: "16px" }}>
      <IndexingJobCard job={group.latestJob} onReindex={onReindex} onDelete={onDelete} />
      
      {group.history.length > 0 && (
        <div style={{ marginLeft: "16px", marginTop: "8px" }}>
          <button
            className="reindex-btn"
            style={{ fontSize: "11px", padding: "2px 6px" }}
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? "Hide historical attempts ▲" : `Show historical attempts (${group.history.length}) ▼`}
          </button>
          
          {showHistory && (
            <div style={{ marginTop: "8px", display: "grid", gap: "8px" }}>
              {group.history.map((histJob) => (
                <IndexingJobCard key={histJob.id} job={histJob} onReindex={onReindex} onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IndexingJobCard({ job, onReindex, onDelete }: {
  job: any;
  onReindex: (repoName: string) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <article className="run-card">
      <div className="connect-job-header">
        <strong>{job.repository_full_name}</strong>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button className="reindex-btn" onClick={() => onReindex(job.repository_full_name)}>
            <RefreshCw size={12} /> Re-index
          </button>
          
          {confirmDelete ? (
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <button
                className="reindex-btn"
                style={{ color: "var(--red)", borderColor: "var(--red)" }}
                onClick={() => onDelete(job.id)}
              >
                Confirm
              </button>
              <button
                className="reindex-btn"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="reindex-btn"
              style={{ color: "var(--red)" }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="progress-track">
        <span style={{ width: `${job.chunks ? Math.min(100, (job.embedded / job.chunks) * 100) : 12}%` }} />
      </div>
      <p className="muted">{job.status} · {job.embedded}/{job.chunks} embedded · {formatRelativeTime(job.created_at)}</p>
    </article>
  );
}

function Metric({ label, value, trend, trendColor, isAlert, hasTooltip, history }: {
  label: string;
  value: string | number;
  trend?: string;
  trendColor?: string;
  isAlert?: boolean;
  hasTooltip?: boolean;
  history?: number[];
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
        <div className="metric-trend-sparkline">
          {history && <Sparkline data={history} />}
          {trend && (
            <span className="metric-trend" style={{ color: trendColor }}>
              {trend}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min;
  const width = 80;
  const height = 24;
  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="sparkline">
      <polyline
        fill="none"
        stroke="var(--green)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function badgeClass(status: string) {
  if (status === "failed" || status === "stale") return "badge failed";
  if (status === "active" || status === "in_progress" || status === "running" || status === "waiting") return "badge running";
  return "badge";
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}