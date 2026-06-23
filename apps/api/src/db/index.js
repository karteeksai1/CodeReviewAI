import bcrypt from "bcryptjs";
import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

const { Pool } = pg;

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.nodeEnv === "production" ? { rejectUnauthorized: false } : false
    })
  : null;

export async function query(sql, params = []) {
  if (!pool) throw new Error("NEON_DATABASE_URL or DATABASE_URL is not configured");
  return pool.query(sql, params);
}

export async function initDb() {
  if (!pool) {
    logger.warn("NEON_DATABASE_URL or DATABASE_URL is not configured; persistence is disabled");
    return;
  }
  if (!config.autoMigrate) return;

  await query(`
    create table if not exists repositories (
      id bigserial primary key,
      github_id bigint unique,
      owner text not null,
      name text not null,
      full_name text not null unique,
      installation_id bigint,
      default_branch text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists pull_requests (
      id bigserial primary key,
      repository_id bigint references repositories(id),
      github_id bigint,
      number integer not null,
      title text,
      author_login text,
      head_sha text,
      base_sha text,
      is_draft boolean not null default false,
      state text not null default 'open',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(repository_id, number)
    );
    create table if not exists reviews (
      id bigserial primary key,
      pull_request_id bigint references pull_requests(id),
      queue_job_id text,
      status text not null,
      summary text,
      risk_score numeric,
      posted_to_github boolean not null default false,
      started_at timestamptz,
      completed_at timestamptz,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists findings (
      id bigserial primary key,
      review_id bigint references reviews(id) on delete cascade,
      category text not null,
      severity text not null,
      title text not null,
      body text not null,
      path text,
      line integer,
      confidence numeric,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table if not exists agent_runs (
      id bigserial primary key,
      review_id bigint references reviews(id) on delete cascade,
      agent text not null,
      status text not null,
      started_at timestamptz,
      completed_at timestamptz,
      duration_ms integer,
      finding_count integer not null default 0,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(review_id, agent)
    );
    create table if not exists indexing_jobs (
      id bigserial primary key,
      repository_full_name text not null,
      status text not null,
      chunks integer not null default 0,
      embedded integer not null default 0,
      message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists users (
      id bigserial primary key,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    );
  `);

  await seedDefaultAdmin();
}

async function seedDefaultAdmin() {
  const existing = await query("select id from users limit 1");
  if (existing.rows.length > 0) return;

  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  await query(
    "insert into users (email, password_hash) values ($1, $2)",
    [config.adminEmail.toLowerCase(), passwordHash]
  );
  logger.info({ email: config.adminEmail }, "Seeded default admin user");
}

export async function findUserByEmail(email) {
  if (!pool) return null;
  const result = await query("select id, email, password_hash from users where email = $1", [email]);
  return result.rows[0] ?? null;
}

export async function upsertRepository(repo, installationId) {
  if (!pool) return null;
  const [owner, name] = repo.full_name.split("/");
  const result = await query(
    `insert into repositories (github_id, owner, name, full_name, installation_id, default_branch, updated_at)
     values ($1,$2,$3,$4,$5,$6,now())
     on conflict (full_name) do update set installation_id = excluded.installation_id, updated_at = now()
     returning *`,
    [repo.id, owner, name, repo.full_name, installationId, repo.default_branch]
  );
  return result.rows[0];
}

export async function upsertPullRequest(repositoryId, pr) {
  if (!pool || !repositoryId) return null;
  const result = await query(
    `insert into pull_requests (repository_id, github_id, number, title, author_login, head_sha, base_sha, is_draft, state, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     on conflict (repository_id, number) do update set title = excluded.title, head_sha = excluded.head_sha, base_sha = excluded.base_sha, is_draft = excluded.is_draft, updated_at = now()
     returning *`,
    [repositoryId, pr.id, pr.number, pr.title, pr.user?.login, pr.head?.sha, pr.base?.sha, Boolean(pr.draft), pr.state ?? "open"]
  );
  return result.rows[0];
}

export async function createReview({ pullRequestId, queueJobId, status }) {
  if (!pool || !pullRequestId) return null;
  const result = await query(
    "insert into reviews (pull_request_id, queue_job_id, status, started_at) values ($1,$2,$3,now()) returning *",
    [pullRequestId, queueJobId, status]
  );
  return result.rows[0];
}

export async function updateReview(reviewId, fields) {
  if (!pool || !reviewId) return null;
  const result = await query(
    `update reviews set status = coalesce($2,status), summary = coalesce($3,summary), risk_score = coalesce($4,risk_score), posted_to_github = coalesce($5,posted_to_github), completed_at = coalesce($6,completed_at), error = coalesce($7,error), updated_at = now() where id = $1 returning *`,
    [reviewId, fields.status, fields.summary, fields.riskScore, fields.postedToGithub, fields.completedAt, fields.error]
  );
  return result.rows[0];
}

export async function insertFindings(reviewId, findings = []) {
  if (!pool || !reviewId || findings.length === 0) return [];
  for (const finding of findings) {
    await query(
      `insert into findings (review_id, category, severity, title, body, path, line, confidence, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [reviewId, finding.category, finding.severity, finding.title, finding.body, finding.path, finding.line, finding.confidence, JSON.stringify(finding.metadata ?? {})]
    );
  }
  return findings;
}

export async function upsertAgentRuns(reviewId, runs = []) {
  if (!pool || !reviewId || runs.length === 0) return [];
  const rows = [];
  for (const run of runs) {
    const result = await query(
      `insert into agent_runs (review_id, agent, status, started_at, completed_at, duration_ms, finding_count, error, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now())
       on conflict (review_id, agent) do update set
         status = excluded.status,
         started_at = coalesce(excluded.started_at, agent_runs.started_at),
         completed_at = excluded.completed_at,
         duration_ms = excluded.duration_ms,
         finding_count = excluded.finding_count,
         error = excluded.error,
         updated_at = now()
       returning *`,
      [
        reviewId,
        run.agent,
        run.status,
        run.started_at ?? run.startedAt ?? null,
        run.completed_at ?? run.completedAt ?? null,
        run.duration_ms ?? run.durationMs ?? null,
        run.finding_count ?? run.findingCount ?? 0,
        run.error ?? null
      ]
    );
    rows.push(result.rows[0]);
  }
  return rows;
}

export async function getDashboardStats() {
  if (!pool) return { reviews: 0, findings: 0, high: 0, latestRisk: 0, reviewsDelta: 0, findingsDelta: 0, highDelta: 0, previousRisk: 0 };
  const result = await query(`
    select
      (select count(*)::int from reviews) as reviews,
      (select count(*)::int from reviews where created_at > now() - interval '24 hours') as "reviewsDelta",
      (select count(*)::int from findings) as findings,
      (select count(*)::int from findings where created_at > now() - interval '24 hours') as "findingsDelta",
      (select count(*)::int from findings where severity in ('critical', 'high')) as high,
      (select count(*)::int from findings where severity in ('critical', 'high') and created_at > now() - interval '24 hours') as "highDelta",
      coalesce((select risk_score::float from reviews where risk_score is not null order by created_at desc limit 1), 0) as "latestRisk",
      coalesce((select risk_score::float from reviews where risk_score is not null order by created_at desc limit 1 offset 1), 0) as "previousRisk"
  `);
  return result.rows[0];
}

export async function listRecentAgentRuns(limit = 20) {
  if (!pool) return [];
  const result = await query(
    `select ar.*, r.status as review_status, pr.number, pr.title, repositories.full_name
     from agent_runs ar
     join reviews r on r.id = ar.review_id
     join pull_requests pr on pr.id = r.pull_request_id
     join repositories on repositories.id = pr.repository_id
     order by ar.updated_at desc
     limit $1`,
    [limit]
  );
  return result.rows;
}

export async function getReviewDetail(reviewId) {
  if (!pool) return null;
  const result = await query(
    `select
       r.*,
       pr.number,
       pr.title,
       pr.head_sha,
       pr.base_sha,
       repositories.full_name,
       coalesce(json_agg(distinct f.*) filter (where f.id is not null), '[]'::json) as findings,
       coalesce(json_agg(distinct ar.*) filter (where ar.id is not null), '[]'::json) as agent_runs
     from reviews r
     join pull_requests pr on pr.id = r.pull_request_id
     join repositories on repositories.id = pr.repository_id
     left join findings f on f.review_id = r.id
     left join agent_runs ar on ar.review_id = r.id
     where r.id = $1
     group by r.id, pr.number, pr.title, pr.head_sha, pr.base_sha, repositories.full_name`,
    [Number(reviewId)]
  );
  return result.rows[0] ?? null;
}

export async function createIndexingJob(repositoryFullName) {
  if (!pool) return null;
  const result = await query(
    `insert into indexing_jobs (repository_full_name, status, message)
     values ($1, 'queued', 'Repository indexing request created')
     returning *`,
    [repositoryFullName]
  );
  return result.rows[0];
}

export async function listIndexingJobs(limit = 10) {
  if (!pool) return [];
  const result = await query("select * from indexing_jobs order by created_at desc limit $1", [limit]);
  return result.rows;
}

export async function listReviewsByPr({ owner, repo, number }) {
  if (!pool) return [];
  const prNumber = Number(number);
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    const err = new Error("PR number must be numeric.");
    err.statusCode = 400;
    throw err;
  }
  const result = await query(
    `select r.*, pr.number, pr.title, repositories.full_name,
      coalesce(json_agg(f.* order by f.created_at) filter (where f.id is not null), '[]'::json) as findings
     from reviews r
     join pull_requests pr on pr.id = r.pull_request_id
     join repositories on repositories.id = pr.repository_id
     left join findings f on f.review_id = r.id
     where repositories.owner = $1 and repositories.name = $2 and pr.number = $3
     group by r.id, pr.number, pr.title, repositories.full_name
     order by r.created_at desc`,
    [owner, repo, prNumber]
  );
  return result.rows;
}
