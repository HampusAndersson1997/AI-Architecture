export const AnalysisModes = Object.freeze(['full', 'incremental', 'review']);
export const JobStatuses = Object.freeze(['queued', 'running', 'failed', 'completed']);
export const JobPhases = Object.freeze([
  'preflight', 'scan', 'batch', 'analyze', 'assemble', 'architecture',
  'tour', 'validate', 'save', 'complete',
]);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} must be one of: ${allowed.join(', ')}`);
  }
}

function requireIsoDate(value, label) {
  requireString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO date-time`);
}

export function validateProject(input) {
  const project = requireObject(input, 'project');
  requireString(project.id, 'id');
  requireEnum(project.sourceType, ['github', 'upload'], 'sourceType');
  requireString(project.sourceIdentity, 'sourceIdentity');
  requireString(project.sourceVersion, 'sourceVersion');
  requireEnum(project.status, ['pending', 'ready', 'analyzing', 'failed'], 'status');
  requireIsoDate(project.createdAt, 'createdAt');
  requireIsoDate(project.updatedAt, 'updatedAt');
  return input;
}

export function validateJob(input) {
  const job = requireObject(input, 'job');
  requireString(job.id, 'id');
  requireString(job.projectId, 'projectId');
  requireEnum(job.status, JobStatuses, 'status');
  requireEnum(job.phase, JobPhases, 'phase');
  requireEnum(job.mode, AnalysisModes, 'mode');
  if (!Number.isInteger(job.progress) || job.progress < 0 || job.progress > 100) {
    throw new TypeError('progress must be an integer from 0 to 100');
  }
  if (job.status === 'completed' && (job.phase !== 'complete' || job.progress !== 100)) {
    throw new TypeError('completed job must be in complete phase at 100 percent');
  }
  requireIsoDate(job.createdAt, 'createdAt');
  requireIsoDate(job.updatedAt, 'updatedAt');
  return input;
}

export function validateKnowledgeGraph(input) {
  const graph = requireObject(input, 'knowledge graph');
  requireString(graph.version, 'version');
  requireObject(graph.project, 'project');
  requireString(graph.project.id, 'project.id');
  requireString(graph.project.name, 'project.name');
  requireString(graph.project.sourceVersion, 'project.sourceVersion');
  for (const key of ['nodes', 'edges', 'layers', 'tour']) {
    if (!Array.isArray(graph[key])) throw new TypeError(`${key} must be an array`);
  }

  const ids = new Set();
  for (const [index, node] of graph.nodes.entries()) {
    requireObject(node, `nodes[${index}]`);
    requireString(node.id, `nodes[${index}].id`);
    if (ids.has(node.id)) throw new TypeError(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    requireString(node.type, `nodes[${index}].type`);
    requireString(node.name, `nodes[${index}].name`);
    requireString(node.summary, `nodes[${index}].summary`);
    if (!Array.isArray(node.tags)) throw new TypeError(`nodes[${index}].tags must be an array`);
  }

  for (const [index, edge] of graph.edges.entries()) {
    requireObject(edge, `edges[${index}]`);
    requireString(edge.source, `edges[${index}].source`);
    requireString(edge.target, `edges[${index}].target`);
    requireString(edge.type, `edges[${index}].type`);
    if (!ids.has(edge.source)) throw new TypeError(`edges[${index}] source does not exist: ${edge.source}`);
    if (!ids.has(edge.target)) throw new TypeError(`edges[${index}] target does not exist: ${edge.target}`);
  }

  for (const collection of ['layers', 'tour']) {
    for (const [index, item] of graph[collection].entries()) {
      requireObject(item, `${collection}[${index}]`);
      if (!Array.isArray(item.nodeIds)) throw new TypeError(`${collection}[${index}].nodeIds must be an array`);
      for (const id of item.nodeIds) {
        if (!ids.has(id)) throw new TypeError(`${collection}[${index}] references missing node: ${id}`);
      }
    }
  }
  return input;
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}
