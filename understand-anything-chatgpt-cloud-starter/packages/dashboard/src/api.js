export function parseDashboardLocation(input) {
  const url = new URL(input);
  const match = /^\/p\/(?<projectId>prj_[A-Za-z0-9]+)\/?$/.exec(url.pathname);
  const token = new URLSearchParams(url.hash.slice(1)).get('token') ?? url.searchParams.get('token');
  if (!match || !token) throw new Error('Dashboard URL must contain a project id and access token');
  return { projectId: match.groups.projectId, token };
}

export class DashboardApi {
  constructor(origin, fetchImpl = fetch) {
    this.origin = String(origin).replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  async getGraph(projectId, token) {
    const url = new URL(`${this.origin}/v1/projects/${encodeURIComponent(projectId)}/graph`);
    const response = await this.fetchImpl(url.toString(), { headers: { accept: 'application/json', 'x-dashboard-token': token } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Graph API returned ${response.status}`);
    return body;
  }

  async compare(projectId, token, baseRef, headRef) {
    const url = `${this.origin}/v1/projects/${encodeURIComponent(projectId)}/compare`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-dashboard-token': token },
      body: JSON.stringify({ base_ref: baseRef, head_ref: headRef }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Compare API returned ${response.status}`);
    return body;
  }
}
