import { jsonResponse } from '../contracts.js';
import { ApiError } from '../errors.js';
import { githubClientFromEnv } from '../github.js';
import { readJson, route } from './route.js';

function publicProject(project, env) {
  return {
    ...project,
    dashboardUrl: project.dashboardUrl ?? (env.DASHBOARD_ORIGIN ? `${env.DASHBOARD_ORIGIN}/p/${project.id}` : null),
  };
}

export function createProjectRoutes(env) {
  const repository = env.REPOSITORY;
  const github = githubClientFromEnv(env);
  return [
    route('POST', /^\/v1\/projects\/github$/, async (request) => {
      let body;
      try { body = await readJson(request); } catch { throw new ApiError(422, 'invalid_json', 'A JSON request body is required'); }
      if (typeof body.repository_url !== 'string') throw new ApiError(422, 'invalid_repository_url', 'repository_url is required');
      const resolved = await github.resolveRepository({ repositoryUrl: body.repository_url, ref: body.ref });
      const now = new Date().toISOString();
      const project = await repository.upsertProject({
        ownerId: env.OWNER_ID ?? 'single-user',
        sourceType: 'github',
        sourceIdentity: resolved.identity,
        sourceVersion: resolved.sourceVersion,
        sourceMetadata: resolved,
        now,
      });
      project.repositoryUrl = resolved.repositoryUrl;
      project.sourceRef = resolved.resolvedRef ?? body.ref ?? null;
      return jsonResponse({ status: 'ready', project: publicProject(project, env) });
    }),
    route('GET', /^\/v1\/projects\/(?<projectId>prj_[A-Za-z0-9]+)$/, async (_request, _routeEnv, match) => {
      const project = await repository.getProject(match.projectId, env.OWNER_ID ?? 'single-user');
      if (!project) throw new ApiError(404, 'project_not_found', 'Project not found');
      return jsonResponse(publicProject(project, env));
    }),
  ];
}
