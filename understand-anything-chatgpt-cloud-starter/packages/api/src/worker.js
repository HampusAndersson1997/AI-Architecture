import { createApp } from './index.js';
import { repositoryFromEnv } from './db.js';
import { createProjectRoutes } from './routes/projects.js';
import { createAnalysisRoutes } from './routes/analyses.js';
import { createArtifactRoutes } from './routes/artifacts.js';

export function createWorkerApp(env) {
  env.REPOSITORY ??= repositoryFromEnv(env);
  const routes = [
    ...createProjectRoutes(env),
    ...createAnalysisRoutes(env),
    ...createArtifactRoutes(env),
  ];
  return createApp(env, routes);
}

export default {
  async fetch(request, env) {
    return createWorkerApp(env).fetch(request);
  },
};
