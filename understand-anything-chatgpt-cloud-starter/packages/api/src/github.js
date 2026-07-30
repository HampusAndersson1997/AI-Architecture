import { ApiError } from './errors.js';

export function normalizeGitHubRepositoryUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError(422, 'invalid_repository_url', 'repository_url must be a valid URL');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new ApiError(422, 'unsupported_repository_host', 'Only https://github.com repository URLs are supported');
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ApiError(422, 'invalid_repository_url', 'Provide a repository URL in the form https://github.com/owner/repository');
  }
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new ApiError(422, 'invalid_repository_url', 'GitHub owner or repository contains invalid characters');
  }
  return {
    owner,
    repository,
    fullName: `${owner}/${repository}`,
    identity: `github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`,
    repositoryUrl: `https://github.com/${owner}/${repository}`,
  };
}

export class GitHubClient {
  constructor(env, fetchImpl = fetch) {
    this.env = env;
    this.fetchImpl = fetchImpl;
  }

  headers() {
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': this.env.GITHUB_API_VERSION ?? '2022-11-28',
      'user-agent': 'understand-anything-chatgpt',
    };
    if (this.env.GITHUB_TOKEN) headers.authorization = `Bearer ${this.env.GITHUB_TOKEN}`;
    return headers;
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...options,
      headers: { ...this.headers(), ...(options.headers ?? {}) },
    });
    if (response.status === 404) throw new ApiError(404, 'github_repository_not_found', 'GitHub repository or ref was not found');
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(401, 'github_authorization_required', 'GitHub authorization is required for this repository');
    }
    if (!response.ok) throw new ApiError(502, 'github_api_error', `GitHub API returned ${response.status}`);
    return response;
  }

  async resolveRepository({ repositoryUrl, ref }) {
    const normalized = normalizeGitHubRepositoryUrl(repositoryUrl);
    const repositoryResponse = await this.request(`/repos/${normalized.fullName}`);
    const repository = await repositoryResponse.json();
    const resolvedRef = ref || repository.default_branch;
    const commitResponse = await this.request(`/repos/${normalized.fullName}/commits/${encodeURIComponent(resolvedRef)}`);
    const commit = await commitResponse.json();
    return { ...normalized, sourceVersion: commit.sha, resolvedRef, private: Boolean(repository.private) };
  }

  async dispatchAnalysis(payload) {
    const analyzerRepository = this.env.ANALYZER_REPOSITORY;
    if (!analyzerRepository || !this.env.GITHUB_TOKEN) {
      throw new ApiError(503, 'analyzer_not_configured', 'ANALYZER_REPOSITORY and GITHUB_TOKEN are required');
    }
    const workflow = this.env.ANALYZER_WORKFLOW ?? 'analyze.yml';
    const response = await this.request(`/repos/${analyzerRepository}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ref: this.env.ANALYZER_WORKFLOW_REF ?? 'main',
        inputs: {
          project_id: payload.projectId,
          source_type: payload.sourceType,
          repository_url: payload.repositoryUrl ?? '',
          source_url: payload.sourceUrl ?? '',
          source_ref: payload.sourceRef,
          source_version: payload.sourceVersion,
          mode: payload.mode,
          callback_url: payload.callbackUrl,
        },
      }),
    });
    await response.arrayBuffer();
  }
}

export function githubClientFromEnv(env) {
  return env.GITHUB_CLIENT ?? new GitHubClient(env);
}
