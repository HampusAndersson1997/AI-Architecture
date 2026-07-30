import { validateJob, validateProject } from './contracts.js';

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function projectRecord(input, existingId = undefined) {
  return validateProject({
    id: existingId ?? id('prj'),
    sourceType: input.sourceType,
    sourceIdentity: input.sourceIdentity,
    sourceVersion: input.sourceVersion,
    status: input.status ?? 'ready',
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
    ownerId: input.ownerId,
    latestGraphKey: input.latestGraphKey ?? null,
    latestGraphDigest: input.latestGraphDigest ?? null,
    dashboardUrl: input.dashboardUrl ?? null,
  });
}

function jobRecord(input) {
  return validateJob({
    id: id('job'),
    projectId: input.projectId,
    sourceVersion: input.sourceVersion,
    mode: input.mode,
    status: 'queued',
    phase: 'preflight',
    progress: 0,
    createdAt: input.now,
    updatedAt: input.now,
    error: null,
    githubRunId: null,
  });
}

export class MemoryRepository {
  constructor() {
    this.projects = new Map();
    this.jobs = new Map();
    this.graphVersions = [];
    this.uploads = new Map();
  }

  async upsertProject(input) {
    const existing = [...this.projects.values()].find((project) =>
      project.ownerId === input.ownerId
      && project.sourceType === input.sourceType
      && project.sourceIdentity === input.sourceIdentity,
    );
    if (existing) {
      const updated = { ...existing, sourceVersion: input.sourceVersion, status: input.status ?? existing.status, updatedAt: input.now };
      validateProject(updated);
      this.projects.set(updated.id, updated);
      return structuredClone(updated);
    }
    const created = projectRecord(input);
    this.projects.set(created.id, created);
    return structuredClone(created);
  }

  async getProject(projectId, ownerId = 'single-user') {
    const project = this.projects.get(projectId);
    return project && project.ownerId === ownerId ? structuredClone(project) : null;
  }

  async listProjects() {
    return [...this.projects.values()].map((value) => structuredClone(value));
  }

  async updateProject(projectId, patch) {
    const existing = this.projects.get(projectId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    validateProject(updated);
    this.projects.set(projectId, updated);
    return structuredClone(updated);
  }

  async createOrReuseJob(input) {
    const active = [...this.jobs.values()].find((job) =>
      job.projectId === input.projectId
      && job.sourceVersion === input.sourceVersion
      && job.mode === input.mode
      && ['queued', 'running'].includes(job.status),
    );
    if (active) return structuredClone(active);
    const created = jobRecord(input);
    this.jobs.set(created.id, created);
    return structuredClone(created);
  }

  async getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async updateJob(jobId, patch) {
    const existing = this.jobs.get(jobId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    validateJob(updated);
    this.jobs.set(jobId, updated);
    return structuredClone(updated);
  }

  async saveGraphVersion(record) {
    this.graphVersions.push(structuredClone(record));
    const project = this.projects.get(record.projectId);
    if (project) {
      this.projects.set(project.id, {
        ...project,
        latestGraphKey: record.artifactKey,
        latestGraphDigest: record.digest,
        sourceVersion: record.sourceVersion,
        status: 'ready',
        updatedAt: record.createdAt,
      });
    }
    return record;
  }

  async listGraphVersions(projectId) {
    return this.graphVersions.filter((record) => record.projectId === projectId).map((value) => structuredClone(value));
  }

  async createUpload(upload) {
    this.uploads.set(upload.id, structuredClone(upload));
    return structuredClone(upload);
  }

  async getUpload(uploadId) {
    const upload = this.uploads.get(uploadId);
    return upload ? structuredClone(upload) : null;
  }

  async updateUpload(uploadId, patch) {
    const existing = this.uploads.get(uploadId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.uploads.set(uploadId, updated);
    return structuredClone(updated);
  }
}

function rowToProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourceIdentity: row.source_identity,
    sourceVersion: row.source_version,
    status: row.status,
    latestGraphKey: row.latest_graph_key,
    latestGraphDigest: row.latest_graph_digest,
    dashboardUrl: row.dashboard_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sourceVersion: row.source_version,
    mode: row.mode,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    error: row.error,
    githubRunId: row.github_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1Repository {
  constructor(database) {
    this.database = database;
  }

  async upsertProject(input) {
    const existingRow = await this.database.prepare(
      'SELECT * FROM projects WHERE owner_id = ? AND source_type = ? AND source_identity = ? LIMIT 1',
    ).bind(input.ownerId, input.sourceType, input.sourceIdentity).first();
    if (existingRow) {
      await this.database.prepare(
        'UPDATE projects SET source_version = ?, status = ?, updated_at = ? WHERE id = ?',
      ).bind(input.sourceVersion, input.status ?? existingRow.status, input.now, existingRow.id).run();
      return validateProject({ ...rowToProject(existingRow), sourceVersion: input.sourceVersion, status: input.status ?? existingRow.status, updatedAt: input.now });
    }
    const project = projectRecord(input);
    await this.database.prepare(
      `INSERT INTO projects (id, owner_id, source_type, source_identity, source_version, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(project.id, project.ownerId, project.sourceType, project.sourceIdentity, project.sourceVersion, project.status, project.createdAt, project.updatedAt).run();
    return project;
  }

  async getProject(projectId, ownerId = 'single-user') {
    const row = await this.database.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ? LIMIT 1').bind(projectId, ownerId).first();
    const project = rowToProject(row);
    return project ? validateProject(project) : null;
  }


  async updateProject(projectId, patch) {
    const existing = await this.getProject(projectId, patch.ownerId ?? 'single-user');
    if (!existing) return null;
    const updated = validateProject({ ...existing, ...patch });
    await this.database.prepare(
      `UPDATE projects SET source_version = ?, status = ?, latest_graph_key = ?, latest_graph_digest = ?, dashboard_url = ?, updated_at = ? WHERE id = ?`,
    ).bind(updated.sourceVersion, updated.status, updated.latestGraphKey ?? null, updated.latestGraphDigest ?? null, updated.dashboardUrl ?? null, updated.updatedAt, projectId).run();
    return updated;
  }

  async createOrReuseJob(input) {
    const row = await this.database.prepare(
      `SELECT * FROM jobs WHERE project_id = ? AND source_version = ? AND mode = ?
       AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`,
    ).bind(input.projectId, input.sourceVersion, input.mode).first();
    if (row) return validateJob(rowToJob(row));
    const job = jobRecord(input);
    await this.database.prepare(
      `INSERT INTO jobs (id, project_id, source_version, mode, status, phase, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(job.id, job.projectId, job.sourceVersion, job.mode, job.status, job.phase, job.progress, job.createdAt, job.updatedAt).run();
    return job;
  }

  async getJob(jobId) {
    const row = await this.database.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').bind(jobId).first();
    const job = rowToJob(row);
    return job ? validateJob(job) : null;
  }

  async updateJob(jobId, patch) {
    const existing = await this.getJob(jobId);
    if (!existing) return null;
    const updated = validateJob({ ...existing, ...patch });
    await this.database.prepare(
      `UPDATE jobs SET status = ?, phase = ?, progress = ?, error = ?, github_run_id = ?, updated_at = ? WHERE id = ?`,
    ).bind(updated.status, updated.phase, updated.progress, updated.error ?? null, updated.githubRunId ?? null, updated.updatedAt, jobId).run();
    return updated;
  }

  async saveGraphVersion(record) {
    await this.database.batch([
      this.database.prepare(
        `INSERT INTO graph_versions (id, project_id, source_version, schema_version, analyzer_version, artifact_key, digest, size_bytes, validation_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(record.id, record.projectId, record.sourceVersion, record.schemaVersion, record.analyzerVersion, record.artifactKey, record.digest, record.sizeBytes, record.validationStatus, record.createdAt),
      this.database.prepare(
        `UPDATE projects SET latest_graph_key = ?, latest_graph_digest = ?, source_version = ?, status = 'ready', updated_at = ? WHERE id = ?`,
      ).bind(record.artifactKey, record.digest, record.sourceVersion, record.createdAt, record.projectId),
    ]);
    return record;
  }

  async listGraphVersions(projectId) {
    const result = await this.database.prepare('SELECT * FROM graph_versions WHERE project_id = ? ORDER BY created_at DESC').bind(projectId).all();
    return result.results ?? [];
  }

  async createUpload(upload) {
    await this.database.prepare(
      `INSERT INTO upload_sessions (id, project_id, object_key, filename, expected_size_bytes, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(upload.id, upload.projectId ?? null, upload.objectKey, upload.filename, upload.expectedSizeBytes ?? null, upload.status, upload.expiresAt, upload.createdAt).run();
    return upload;
  }

  async getUpload(uploadId) {
    return this.database.prepare('SELECT * FROM upload_sessions WHERE id = ? LIMIT 1').bind(uploadId).first();
  }

  async updateUpload(uploadId, patch) {
    const existing = await this.getUpload(uploadId);
    if (!existing) return null;
    const status = patch.status ?? existing.status;
    const projectId = patch.projectId ?? patch.project_id ?? existing.project_id;
    await this.database.prepare('UPDATE upload_sessions SET status = ?, project_id = ? WHERE id = ?')
      .bind(status, projectId, uploadId).run();
    return { ...existing, ...patch, status, project_id: projectId };
  }
}

export function repositoryFromEnv(env) {
  return env?.DB ? new D1Repository(env.DB) : new MemoryRepository();
}
