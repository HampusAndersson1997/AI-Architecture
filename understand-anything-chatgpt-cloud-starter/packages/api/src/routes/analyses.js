import { AnalysisModes, jsonResponse, validateKnowledgeGraph } from '../contracts.js';
import { ApiError } from '../errors.js';
import { githubClientFromEnv } from '../github.js';
import { createScopedToken } from '../tokens.js';
import { readJson, route } from './route.js';

export function createAnalysisRoutes(env) {
  const repository = env.REPOSITORY;
  const github = githubClientFromEnv(env);
  return [
    route('POST', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)\/analyses$/, async (request, _routeEnv, match) => {
      let body;
      try { body = await readJson(request); } catch { throw new ApiError(422, 'invalid_json', 'A JSON request body is required'); }
      if (!AnalysisModes.includes(body.mode)) throw new ApiError(422, 'invalid_analysis_mode', 'mode must be full, incremental, or review');
      const project = await repository.getProject(match.projectId, env.OWNER_ID ?? 'single-user');
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      if (project.status !== 'ready' && body.mode !== 'review') throw new ApiError(409, 'source_not_ready', 'Project source is not ready for analysis');
      if (body.mode === 'review' && !project.latestGraphKey) {
        throw new ApiError(409, 'review_requires_graph', 'Review mode requires an existing graph');
      }
      if (body.source_ref != null && body.source_ref !== project.sourceVersion) {
        throw new ApiError(409, 'source_version_mismatch', 'source_ref must match the durable project source version; refresh the project first');
      }
      const now = new Date().toISOString();
      let job = await repository.createOrReuseJob({
        projectId: project.id,
        sourceVersion: project.sourceVersion,
        mode: body.mode,
        now,
      });
      if (body.mode === 'review' && job.githubRunId == null) {
        try {
          const object = await env.ARTIFACTS.get(project.latestGraphKey);
          if (!object) throw new TypeError('persisted graph artifact is missing');
          const graph = validateKnowledgeGraph(await object.json());
          if (graph.project.id !== project.id) throw new TypeError('persisted graph project id does not match');
          if (graph.project.sourceVersion !== project.sourceVersion) throw new TypeError('persisted graph source version does not match');
          job = await repository.updateJob(job.id, { status: 'completed', phase: 'complete', progress: 100, error: null, updatedAt: now });
        } catch (error) {
          job = await repository.updateJob(job.id, { status: 'failed', phase: 'validate', progress: 99, error: `Review failed: ${error.message}`, updatedAt: now });
        }
        return jsonResponse(job, 202);
      }
      if (job.githubRunId == null) {
        const callbackOrigin = env.API_ORIGIN ?? new URL(request.url).origin;
        let sourceType = project.sourceType;
        let repositoryUrl = '';
        let sourceUrl = '';
        let sourceRef = project.sourceVersion;
        if (project.sourceType === 'github') {
          repositoryUrl = project.repositoryUrl ?? `https://${project.sourceIdentity}`;
          sourceRef = project.sourceVersion;
        } else if (project.sourceType === 'upload') {
          const uploadId = project.sourceIdentity.replace(/^upload:/, '');
          const upload = await repository.getUpload(uploadId);
          if (!upload || upload.status !== 'ready') throw new ApiError(409, 'upload_not_ready', 'Uploaded source is not ready');
          const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
          const token = await createScopedToken(env.SOURCE_DOWNLOAD_TOKEN_SECRET, { scope: 'source-download', subject: uploadId, expiresAt });
          sourceUrl = `${callbackOrigin}/v1/uploads/${uploadId}/download?token=${encodeURIComponent(token)}`;
          sourceRef = project.sourceVersion;
        } else {
          throw new ApiError(409, 'unsupported_source_type', 'Project source type is not supported');
        }
        await github.dispatchAnalysis({
          projectId: project.id,
          sourceType,
          repositoryUrl,
          sourceUrl,
          sourceRef,
          sourceVersion: project.sourceVersion,
          mode: body.mode,
          callbackUrl: `${callbackOrigin}/v1/internal/jobs/${job.id}/callback`,
          enableOptionalEnrichment: Boolean(body.enable_optional_enrichment),
          privateCodeEnrichmentConsent: Boolean(body.private_code_enrichment_consent),
        });
        job = await repository.updateJob(job.id, { githubRunId: 0, updatedAt: now });
      }
      return jsonResponse(job, 202);
    }),
  ];
}
