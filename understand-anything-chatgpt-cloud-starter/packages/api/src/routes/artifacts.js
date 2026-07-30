import { authenticateRequest, timingSafeEqualText } from '../auth.js';
import { jsonResponse, validateKnowledgeGraph } from '../contracts.js';
import { ApiError } from '../errors.js';
import { answerGraphQuery, compareGraphs, lexicalSearch } from '../graph.js';
import { createScopedToken, verifyScopedToken } from '../tokens.js';
import { readJson, route } from './route.js';

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadGraph(env, project) {
  if (!project.latestGraphKey) throw new ApiError(409, 'graph_not_ready', 'No validated graph is available');
  const object = await env.ARTIFACTS.get(project.latestGraphKey);
  if (!object) throw new ApiError(500, 'graph_artifact_missing', 'Graph metadata exists but the artifact is missing');
  const graph = await object.json();
  validateKnowledgeGraph(graph);
  return graph;
}

async function loadGraphVersion(env, repository, projectId, sourceVersion) {
  const versions = await repository.listGraphVersions(projectId);
  const version = versions.find((item) => (item.sourceVersion ?? item.source_version) === sourceVersion);
  if (!version) throw new ApiError(404, 'graph_version_not_found', `Graph version ${sourceVersion} was not found`);
  const key = version.artifactKey ?? version.artifact_key;
  const object = await env.ARTIFACTS.get(key);
  if (!object) throw new ApiError(500, 'graph_artifact_missing', 'Graph artifact is missing');
  return object.json();
}

export function createArtifactRoutes(env) {
  const repository = env.REPOSITORY;
  const ownerId = env.OWNER_ID ?? 'single-user';
  return [
    route('POST', /^\/v1\/uploads$/, async (request) => {
      let body;
      try { body = await readJson(request); } catch { throw new ApiError(422, 'invalid_json', 'A JSON request body is required'); }
      if (typeof body.filename !== 'string' || !body.filename.toLowerCase().endsWith('.zip')) {
        throw new ApiError(422, 'invalid_upload_type', 'Only .zip project archives are accepted');
      }
      const maximum = Number(env.MAX_UPLOAD_BYTES ?? 104_857_600);
      if (body.expected_size_bytes != null && (!Number.isInteger(body.expected_size_bytes) || body.expected_size_bytes < 1)) {
        throw new ApiError(422, 'invalid_upload_size', 'expected_size_bytes must be a positive integer');
      }
      if (body.expected_size_bytes > maximum) throw new ApiError(413, 'upload_too_large', `Upload exceeds the ${maximum} byte limit`);
      const now = new Date();
      const uploadId = randomId('upl');
      const project = await repository.upsertProject({
        ownerId, sourceType: 'upload', sourceIdentity: `upload:${uploadId}`, sourceVersion: 'pending', status: 'pending', now: now.toISOString(),
      });
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      const objectKey = `uploads/${uploadId}/source.zip`;
      await repository.createUpload({ id: uploadId, projectId: project.id, objectKey, filename: body.filename, expectedSizeBytes: body.expected_size_bytes ?? null, status: 'pending', expiresAt: expiresAt.toISOString(), createdAt: now.toISOString() });
      const token = await createScopedToken(env.UPLOAD_TOKEN_SECRET, { scope: 'upload', subject: uploadId, expiresAt: Math.floor(expiresAt.getTime() / 1000) });
      const origin = new URL(request.url).origin;
      const uploadUrl = `${origin}/v1/uploads/${uploadId}/content#token=${encodeURIComponent(token)}`;
      const dashboardOrigin = env.DASHBOARD_ORIGIN ?? origin;
      return jsonResponse({
        upload_id: uploadId,
        project_id: project.id,
        upload_url: uploadUrl,
        upload_page_url: `${dashboardOrigin}/upload.html#upload_url=${encodeURIComponent(uploadUrl)}&project_id=${encodeURIComponent(project.id)}`,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
        constraints: { content_type: 'application/zip', maximum_bytes: maximum, no_symlinks: true, no_path_traversal: true },
      });
    }),
    route('PUT', /^\/v1\/uploads\/(?<uploadId>upl_[A-Za-z0-9]+)\/content$/, async (request, _routeEnv, match) => {
      const token = request.headers.get('x-upload-token') ?? match.url.searchParams.get('token');
      if (!await verifyScopedToken(env.UPLOAD_TOKEN_SECRET, token, { scope: 'upload', subject: match.uploadId })) {
        throw new ApiError(401, 'invalid_upload_token', 'Upload token is invalid or expired');
      }
      const upload = await repository.getUpload(match.uploadId);
      if (!upload) throw new ApiError(404, 'upload_not_found', 'Upload session not found');
      const contentType = request.headers.get('content-type') ?? '';
      if (!contentType.includes('application/zip') && !contentType.includes('application/octet-stream')) {
        throw new ApiError(415, 'invalid_upload_content_type', 'Upload content-type must be application/zip');
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      const maximum = Number(env.MAX_UPLOAD_BYTES ?? 104_857_600);
      if (bytes.byteLength === 0 || bytes.byteLength > maximum) throw new ApiError(413, 'upload_too_large', 'Upload is empty or exceeds the configured limit');
      const expectedSize = upload.expectedSizeBytes ?? upload.expected_size_bytes;
      if (expectedSize != null && bytes.byteLength !== Number(expectedSize)) throw new ApiError(409, 'upload_size_mismatch', 'Uploaded byte count does not match the declared size');
      const zipMagic = bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08));
      if (!zipMagic) throw new ApiError(422, 'invalid_zip_signature', 'Uploaded content is not a ZIP archive');
      const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
      const digest = [...new Uint8Array(digestBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      await env.ARTIFACTS.put(upload.objectKey ?? upload.object_key, bytes, { customMetadata: { sha256: digest } });
      await repository.updateUpload(match.uploadId, { status: 'ready' });
      await repository.updateProject(upload.projectId ?? upload.project_id, { sourceVersion: digest, status: 'ready', updatedAt: new Date().toISOString(), ownerId });
      return jsonResponse({ upload_id: match.uploadId, project_id: upload.projectId ?? upload.project_id, status: 'ready', source_digest: digest });
    }, { auth: 'none' }),
    route('GET', /^\/v1\/uploads\/(?<uploadId>upl_[A-Za-z0-9]+)\/download$/, async (_request, _routeEnv, match) => {
      const token = match.url.searchParams.get('token');
      if (!await verifyScopedToken(env.SOURCE_DOWNLOAD_TOKEN_SECRET, token, { scope: 'source-download', subject: match.uploadId })) {
        throw new ApiError(401, 'invalid_source_token', 'Source download token is invalid or expired');
      }
      const upload = await repository.getUpload(match.uploadId);
      if (!upload || upload.status !== 'ready') throw new ApiError(404, 'upload_not_ready', 'Uploaded source is not ready');
      const object = await env.ARTIFACTS.get(upload.objectKey ?? upload.object_key);
      if (!object) throw new ApiError(404, 'upload_artifact_missing', 'Uploaded source artifact is missing');
      const headers = { 'content-type': 'application/zip', 'cache-control': 'private, no-store', 'content-disposition': 'attachment; filename="source.zip"' };
      if (object.size != null) headers['content-length'] = String(object.size);
      return new Response(object.body ?? await object.arrayBuffer(), { status: 200, headers });
    }, { auth: 'none' }),
    route('GET', /^\/v1\/jobs\/(?<jobId>job_[A-Za-z0-9]+)$/, async (_request, _routeEnv, match) => {
      const job = await repository.getJob(match.jobId);
      if (!job) throw new ApiError(404, 'job_not_found', 'Job not found');
      return jsonResponse(job);
    }),
    route('POST', /^\/v1\/internal\/jobs\/(?<jobId>job_[A-Za-z0-9]+)\/callback$/, async (request, _routeEnv, match) => {
      const supplied = request.headers.get('x-callback-token') ?? '';
      if (!env.ANALYZER_CALLBACK_TOKEN || !timingSafeEqualText(supplied, env.ANALYZER_CALLBACK_TOKEN)) {
        throw new ApiError(401, 'invalid_callback_token', 'Callback token is invalid');
      }
      const job = await repository.getJob(match.jobId);
      if (!job) throw new ApiError(404, 'job_not_found', 'Job not found');
      let body;
      try { body = await readJson(request); } catch { throw new ApiError(422, 'invalid_json', 'A JSON callback body is required'); }
      const now = new Date().toISOString();
      if (body.status === 'running') {
        const updated = await repository.updateJob(job.id, { status: 'running', phase: body.phase ?? job.phase, progress: body.progress ?? job.progress, updatedAt: now });
        return jsonResponse(updated);
      }
      if (body.status === 'failed') {
        const updated = await repository.updateJob(job.id, { status: 'failed', phase: body.phase ?? job.phase, progress: body.progress ?? job.progress, error: body.error ?? 'Analyzer failed', updatedAt: now });
        return jsonResponse(updated);
      }
      if (body.status !== 'completed' || !body.graph) throw new ApiError(422, 'invalid_callback_state', 'Completed callback must include graph');
      let graph;
      try {
        graph = validateKnowledgeGraph(body.graph);
        if (graph.project.id !== job.projectId) throw new TypeError('graph project id does not match job project');
        if (body.source_version !== job.sourceVersion) throw new TypeError('callback source version does not match job source version');
        if (graph.project.sourceVersion !== job.sourceVersion) throw new TypeError('graph source version does not match job source version');
      } catch (error) {
        await repository.updateJob(job.id, { status: 'failed', phase: 'validate', progress: Math.min(99, body.progress ?? 99), error: `Graph validation failed: ${error.message}`, updatedAt: now });
        throw new ApiError(422, 'graph_validation_failed', `Graph validation failed: ${error.message}`);
      }
      const serialized = JSON.stringify(graph);
      const digest = await sha256Hex(serialized);
      const sourceVersion = job.sourceVersion;
      const artifactKey = `projects/${job.projectId}/graphs/${encodeURIComponent(sourceVersion)}-${digest.slice(0, 12)}.json`;
      await env.ARTIFACTS.put(artifactKey, serialized, { customMetadata: { sha256: digest, validation: 'valid' } });
      await repository.saveGraphVersion({
        id: randomId('grv'), projectId: job.projectId, sourceVersion, schemaVersion: graph.version,
        analyzerVersion: body.analyzer_version ?? 'unknown', artifactKey, digest,
        sizeBytes: new TextEncoder().encode(serialized).byteLength, validationStatus: 'valid', createdAt: now,
      });
      const completed = await repository.updateJob(job.id, { status: 'completed', phase: 'complete', progress: 100, error: null, updatedAt: now });
      return jsonResponse(completed);
    }, { auth: 'none' }),
    route('POST', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)\/dashboard-access$/, async (_request, _routeEnv, match) => {
      const project = await repository.getProject(match.projectId, ownerId);
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const token = await createScopedToken(env.DASHBOARD_TOKEN_SECRET, { scope: 'dashboard', subject: project.id, expiresAt });
      const origin = env.DASHBOARD_ORIGIN ?? new URL(_request.url).origin;
      return jsonResponse({ project_id: project.id, dashboard_url: `${origin}/p/${project.id}#token=${encodeURIComponent(token)}`, expires_at: new Date(expiresAt * 1000).toISOString() });
    }),
    route('GET', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)\/graph$/, async (request, _routeEnv, match) => {
      const token = request.headers.get('x-dashboard-token') ?? match.url.searchParams.get('token');
      const dashboardAllowed = await verifyScopedToken(env.DASHBOARD_TOKEN_SECRET, token, { scope: 'dashboard', subject: match.projectId });
      if (!dashboardAllowed && !authenticateRequest(request, env)) throw new ApiError(401, 'unauthorized', 'A valid dashboard token or Bearer credential is required');
      const project = await repository.getProject(match.projectId, ownerId);
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      return jsonResponse(await loadGraph(env, project), 200, { 'cache-control': 'private, max-age=60' });
    }, { auth: 'none' }),
    route('GET', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)\/search$/, async (_request, _routeEnv, match) => {
      const project = await repository.getProject(match.projectId, ownerId);
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      const query = match.url.searchParams.get('q') ?? '';
      if (!query.trim()) throw new ApiError(422, 'invalid_search_query', 'q is required');
      const limit = Number(match.url.searchParams.get('limit') ?? 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiError(422, 'invalid_search_limit', 'limit must be an integer from 1 to 50');
      const graph = await loadGraph(env, project);
      const results = lexicalSearch(graph, query, limit).map(({ node, score, matchedTerms }) => ({ node_id: node.id, name: node.name, file_path: node.filePath ?? null, summary: node.summary, score, matched_terms: matchedTerms }));
      return jsonResponse({ project_id: project.id, graph_version: graph.project.sourceVersion, query, results });
    }),
    route('POST', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)\/query$/, async (request, _routeEnv, match) => {
      const project = await repository.getProject(match.projectId, ownerId);
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      const body = await readJson(request);
      if (typeof body.question !== 'string' || !body.question.trim()) throw new ApiError(422, 'invalid_question', 'question is required');
      const result = answerGraphQuery(await loadGraph(env, project), body.question);
      return jsonResponse({ answer: result.answer, graph_version: result.graphVersion, evidence: result.evidence.map((item) => ({ node_id: item.nodeId, name: item.name, file_path: item.filePath, summary: item.summary, score: item.score })) });
    }),
    route('POST', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)\/compare$/, async (request, _routeEnv, match) => {
      const token = request.headers.get('x-dashboard-token') ?? match.url.searchParams.get('token');
      const dashboardAllowed = await verifyScopedToken(env.DASHBOARD_TOKEN_SECRET, token, { scope: 'dashboard', subject: match.projectId });
      if (!dashboardAllowed && !authenticateRequest(request, env)) throw new ApiError(401, 'unauthorized', 'A valid dashboard token or Bearer credential is required');
      const project = await repository.getProject(match.projectId, ownerId);
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      const body = await readJson(request);
      if (typeof body.base_ref !== 'string' || typeof body.head_ref !== 'string') throw new ApiError(422, 'invalid_compare_request', 'base_ref and head_ref are required');
      const base = await loadGraphVersion(env, repository, project.id, body.base_ref);
      const head = body.head_ref === body.base_ref ? base : await loadGraphVersion(env, repository, project.id, body.head_ref);
      const diff = compareGraphs(base, head);
      return jsonResponse({ base_ref: diff.baseSourceVersion, head_ref: diff.headSourceVersion, added_node_ids: diff.addedNodeIds, removed_node_ids: diff.removedNodeIds, changed_node_ids: diff.changedNodeIds, added_edges: diff.addedEdges, removed_edges: diff.removedEdges });
    }, { auth: 'none' }),
  ];
}
