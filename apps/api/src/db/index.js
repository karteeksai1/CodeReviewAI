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

  await query(`
    alter table repositories add column if not exists user_id bigint references users(id);
    alter table indexing_jobs add column if not exists user_id bigint references users(id);
    alter table reviews add column if not exists mergeable boolean;
    alter table reviews add column if not exists mergeable_state text;
    alter table reviews add column if not exists conflict_details text;
    alter table reviews add column if not exists head_sha text;
    alter table reviews add column if not exists base_sha text;
    create unique index if not exists findings_unique_idx on findings (review_id, category, severity, (coalesce(path, '')), (coalesce(line, 0)), title);
  `);

  await query(`
    update reviews set head_sha = pr.head_sha, base_sha = pr.base_sha from pull_requests pr where pr.id = reviews.pull_request_id and reviews.head_sha is null;
  `);

  await seedDefaultAdmin();

  await query("update repositories set user_id = (select id from users limit 1) where user_id is null;");
  await query("update indexing_jobs set user_id = (select id from users limit 1) where user_id is null;");
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

export async function upsertRepository(repo, installationId, userId = null) {
  if (!pool) return null;
  const [owner, name] = repo.full_name.split("/");
  const result = await query(
    `insert into repositories (github_id, owner, name, full_name, installation_id, default_branch, updated_at, user_id)
     values ($1,$2,$3,$4,$5,$6,now(),$7)
     on conflict (full_name) do update set installation_id = excluded.installation_id, user_id = coalesce(excluded.user_id, repositories.user_id), updated_at = now()
     returning *`,
    [repo.id, owner, name, repo.full_name, installationId, repo.default_branch, userId]
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

export async function createReview({ pullRequestId, queueJobId, status, headSha, baseSha }) {
  if (!pool || !pullRequestId) return null;
  const result = await query(
    "insert into reviews (pull_request_id, queue_job_id, status, started_at, head_sha, base_sha) values ($1,$2,$3,now(),$4,$5) returning *",
    [pullRequestId, queueJobId, status, headSha, baseSha]
  );
  return result.rows[0];
}

export async function updateReview(reviewId, fields) {
  if (!pool || !reviewId) return null;
  const dbFields = {};
  if (fields.status !== undefined) dbFields.status = fields.status;
  if (fields.summary !== undefined) dbFields.summary = fields.summary;
  if (fields.riskScore !== undefined) dbFields.risk_score = fields.riskScore;
  if (fields.risk_score !== undefined) dbFields.risk_score = fields.risk_score;
  if (fields.postedToGithub !== undefined) dbFields.posted_to_github = fields.postedToGithub;
  if (fields.posted_to_github !== undefined) dbFields.posted_to_github = fields.posted_to_github;
  if (fields.completedAt !== undefined) dbFields.completed_at = fields.completedAt;
  if (fields.completed_at !== undefined) dbFields.completed_at = fields.completed_at;
  if (fields.error !== undefined) dbFields.error = fields.error;
  if (fields.mergeable !== undefined) dbFields.mergeable = fields.mergeable;
  if (fields.mergeableState !== undefined) dbFields.mergeable_state = fields.mergeableState;
  if (fields.mergeable_state !== undefined) dbFields.mergeable_state = fields.mergeable_state;
  if (fields.conflictDetails !== undefined) dbFields.conflict_details = fields.conflictDetails;
  if (fields.conflict_details !== undefined) dbFields.conflict_details = fields.conflict_details;
  if (fields.headSha !== undefined) dbFields.head_sha = fields.headSha;
  if (fields.head_sha !== undefined) dbFields.head_sha = fields.head_sha;
  if (fields.baseSha !== undefined) dbFields.base_sha = fields.baseSha;
  if (fields.base_sha !== undefined) dbFields.base_sha = fields.base_sha;

  const keys = Object.keys(dbFields);
  const values = Object.values(dbFields);
  if (keys.length === 0) return null;
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
  const result = await query(
    `update reviews
     set ${setClause}, updated_at = now()
     where id = $1
     returning *`,
    [reviewId, ...values]
  );
  return result.rows[0];
}

export async function insertFindings(reviewId, findings = []) {
  if (!pool || !reviewId || findings.length === 0) return [];
  for (const finding of findings) {
    await query(
      `insert into findings (review_id, category, severity, title, body, path, line, confidence, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (review_id, category, severity, (coalesce(path, '')), (coalesce(line, 0)), title) do nothing`,
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

export async function getDashboardStats(userId) {
  if (!pool) return { reviews: 0, findings: 0, high: 0, latestRisk: 0, reviewsDelta: 0, findingsDelta: 0, highDelta: 0, previousRisk: 0, reviewsHistory: [], findingsHistory: [], highHistory: [], riskHistory: [] };
  const result = await query(`
    with user_revs as (
      select distinct on (pr.id) rev.id, rev.risk_score, rev.created_at
      from reviews rev
      join pull_requests pr on pr.id = rev.pull_request_id
      join repositories r on r.id = pr.repository_id
      where r.user_id = $1
      order by pr.id, rev.created_at desc
    ), user_findings as (
      select f.id, f.severity, f.created_at
      from findings f
      join user_revs rev on rev.id = f.review_id
    )
    select
      (select count(*)::int from user_revs) as reviews,
      (select count(*)::int from user_revs where created_at > now() - interval '24 hours') as "reviewsDelta",
      (select count(*)::int from user_findings) as findings,
      (select count(*)::int from user_findings where created_at > now() - interval '24 hours') as "findingsDelta",
      (select count(*)::int from user_findings where severity in ('critical', 'high')) as high,
      (select count(*)::int from user_findings where severity in ('critical', 'high') and created_at > now() - interval '24 hours') as "highDelta",
      coalesce((select risk_score::float from user_revs where risk_score is not null order by created_at desc limit 1), 0) as "latestRisk",
      coalesce((select risk_score::float from user_revs where risk_score is not null order by created_at desc limit 1 offset 1), 0) as "previousRisk",
      (select array(
        select coalesce(count(ur.id)::int, 0)
        from generate_series(now() - interval '6 days', now(), '1 day') as d
        left join user_revs ur on ur.created_at::date = d::date
        group by d::date
        order by d::date
      )) as "reviewsHistory",
      (select array(
        select coalesce(count(uf.id)::int, 0)
        from generate_series(now() - interval '6 days', now(), '1 day') as d
        left join user_findings uf on uf.created_at::date = d::date
        group by d::date
        order by d::date
      )) as "findingsHistory",
      (select array(
        select coalesce(count(uf.id)::int, 0)
        from generate_series(now() - interval '6 days', now(), '1 day') as d
        left join user_findings uf on uf.created_at::date = d::date and uf.severity in ('critical', 'high')
        group by d::date
        order by d::date
      )) as "highHistory",
      (select array(
        select coalesce(risk_score::float, 0)
        from (
          select risk_score, created_at
          from user_revs
          where risk_score is not null
          order by created_at desc
          limit 7
        ) sub
        order by created_at asc
      )) as "riskHistory"
  `, [userId]);
  return result.rows[0];
}

export async function getRepoStats(userId, repoFullName) {
  if (!pool) return { reviews: 0, findings: 0, high: 0, latestRisk: 0, reviewsDelta: 0, findingsDelta: 0, highDelta: 0, previousRisk: 0, reviewsHistory: [], findingsHistory: [], highHistory: [], riskHistory: [] };
  const result = await query(`
    with user_revs as (
      select distinct on (pr.id) rev.id, rev.risk_score, rev.created_at
      from reviews rev
      join pull_requests pr on pr.id = rev.pull_request_id
      join repositories r on r.id = pr.repository_id
      where r.user_id = $1 and r.full_name = $2
      order by pr.id, rev.created_at desc
    ), user_findings as (
      select f.id, f.severity, f.created_at
      from findings f
      join user_revs rev on rev.id = f.review_id
    )
    select
      (select count(*)::int from user_revs) as reviews,
      (select count(*)::int from user_revs where created_at > now() - interval '24 hours') as "reviewsDelta",
      (select count(*)::int from user_findings) as findings,
      (select count(*)::int from user_findings where created_at > now() - interval '24 hours') as "findingsDelta",
      (select count(*)::int from user_findings where severity in ('critical', 'high')) as high,
      (select count(*)::int from user_findings where severity in ('critical', 'high') and created_at > now() - interval '24 hours') as "highDelta",
      coalesce((select risk_score::float from user_revs where risk_score is not null order by created_at desc limit 1), 0) as "latestRisk",
      coalesce((select risk_score::float from user_revs where risk_score is not null order by created_at desc limit 1 offset 1), 0) as "previousRisk",
      (select array(
        select coalesce(count(ur.id)::int, 0)
        from generate_series(now() - interval '6 days', now(), '1 day') as d
        left join user_revs ur on ur.created_at::date = d::date
        group by d::date
        order by d::date
      )) as "reviewsHistory",
      (select array(
        select coalesce(count(uf.id)::int, 0)
        from generate_series(now() - interval '6 days', now(), '1 day') as d
        left join user_findings uf on uf.created_at::date = d::date
        group by d::date
        order by d::date
      )) as "findingsHistory",
      (select array(
        select coalesce(count(uf.id)::int, 0)
        from generate_series(now() - interval '6 days', now(), '1 day') as d
        left join user_findings uf on uf.created_at::date = d::date and uf.severity in ('critical', 'high')
        group by d::date
        order by d::date
      )) as "highHistory",
      (select array(
        select coalesce(risk_score::float, 0)
        from (
          select risk_score, created_at
          from user_revs
          where risk_score is not null
          order by created_at desc
          limit 7
        ) sub
        order by created_at asc
      )) as "riskHistory"
  `, [userId, repoFullName]);
  return result.rows[0];
}

export async function listRecentAgentRuns(userId, limit = 20) {
  if (!pool) return [];
  const result = await query(
    `select ar.*, r.status as review_status, pr.number, pr.title, repositories.full_name
     from agent_runs ar
     join reviews r on r.id = ar.review_id
     join pull_requests pr on pr.id = r.pull_request_id
     join repositories on repositories.id = pr.repository_id
     where repositories.user_id = $1
     order by ar.updated_at desc
     limit $2`,
    [userId, limit]
  );
  return result.rows;
}

export async function getReviewDetail(userId, reviewId) {
  if (!pool) return null;
  const result = await query(
    `select
       r.*,
       pr.number,
       pr.title,
       repositories.full_name,
       coalesce(json_agg(distinct f.*) filter (where f.id is not null), '[]'::json) as findings,
       coalesce(json_agg(distinct ar.*) filter (where ar.id is not null), '[]'::json) as agent_runs
     from reviews r
     join pull_requests pr on pr.id = r.pull_request_id
     join repositories on repositories.id = pr.repository_id
     left join findings f on f.review_id = r.id
     left join agent_runs ar on ar.review_id = r.id
     where r.id = $2 and repositories.user_id = $1
     group by r.id, pr.number, pr.title, repositories.full_name`,
    [userId, Number(reviewId)]
  );
  return result.rows[0] ?? null;
}

export async function createIndexingJob(repositoryFullName, userId) {
  if (!pool) return null;
  const result = await query(
    `insert into indexing_jobs (repository_full_name, status, message, user_id)
     values ($1, 'queued', 'Repository indexing request created', $2)
     returning *`,
    [repositoryFullName, userId]
  );
  return result.rows[0];
}

export async function listIndexingJobs(userId, limit = 10) {
  if (!pool) return [];
  const result = await query("select * from indexing_jobs where user_id = $1 order by created_at desc limit $2", [userId, limit]);
  return result.rows;
}

export async function updateIndexingJob(id, fields) {
  if (!pool) return null;
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  if (keys.length === 0) return null;
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
  const result = await query(
    `update indexing_jobs
     set ${setClause}, updated_at = now()
     where id = $1
     returning *`,
    [id, ...values]
  );
  return result.rows[0];
}

export async function listReviewsByPr({ userId, owner, repo, number }) {
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
     where repositories.user_id = $1 and repositories.owner = $2 and repositories.name = $3 and pr.number = $4
     group by r.id, pr.number, pr.title, repositories.full_name
     order by r.created_at desc`,
    [userId, owner, repo, prNumber]
  );
  return result.rows;
}
