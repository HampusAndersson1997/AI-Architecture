import { DashboardApi, parseDashboardLocation } from './api.js';
import { buildGraphModel, filterGraph } from './graph-view.js';

const palette = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#ca8a04', '#dc2626', '#db2777', '#4f46e5'];
const state = { graph: null, filtered: null, selectedNodeId: null, view: 'graph', api: null, projectId: null, token: null, diff: null };
const elements = Object.fromEntries([
  'title', 'subtitle', 'warning-banner', 'search-input', 'graph-view', 'layers-view', 'tour-view', 'domain-view', 'node-details', 'stats', 'diff-base', 'diff-head', 'diff-button', 'diff-status',
].map((id) => [id, document.getElementById(id)]));

function setWarning(message, kind = 'warning') {
  elements['warning-banner'].textContent = message;
  elements['warning-banner'].dataset.kind = kind;
  elements['warning-banner'].hidden = !message;
}

function nodeById(id) {
  return state.graph.nodes.find((node) => node.id === id);
}

function renderDetails(node) {
  elements['node-details'].replaceChildren();
  if (!node) {
    const hint = document.createElement('p');
    hint.textContent = 'Select a node to inspect its summary, path, tags, and relationships.';
    elements['node-details'].append(hint);
    return;
  }
  const heading = document.createElement('h2');
  heading.textContent = node.name;
  const summary = document.createElement('p');
  summary.textContent = node.summary;
  const metadata = document.createElement('dl');
  for (const [label, value] of [['Type', node.type], ['Path', node.filePath ?? '—'], ['Tags', (node.tags ?? []).join(', ') || '—']]) {
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value;
    metadata.append(term, description);
  }
  const related = state.graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const relationHeading = document.createElement('h3'); relationHeading.textContent = `Relationships (${related.length})`;
  const list = document.createElement('ul');
  for (const edge of related.slice(0, 30)) {
    const item = document.createElement('li');
    const other = edge.source === node.id ? edge.target : edge.source;
    item.textContent = `${edge.type}: ${nodeById(other)?.name ?? other}`;
    list.append(item);
  }
  elements['node-details'].append(heading, summary, metadata, relationHeading, list);
}

function renderGraph() {
  const container = elements['graph-view'];
  container.replaceChildren();
  const width = Math.max(700, container.clientWidth || 900);
  const height = Math.max(520, container.clientHeight || 620);
  const model = buildGraphModel(state.filtered, width, height);
  const positions = new Map(model.nodes.map((node) => [node.id, node]));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Project structural graph');
  for (const edge of model.edges) {
    const source = positions.get(edge.source); const target = positions.get(edge.target);
    if (!source || !target) continue;
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', source.x); line.setAttribute('y1', source.y);
    line.setAttribute('x2', target.x); line.setAttribute('y2', target.y);
    line.setAttribute('class', `edge edge-${edge.type}`);
    svg.append(line);
  }
  for (const node of model.nodes) {
    const group = document.createElementNS(svg.namespaceURI, 'g');
    const diffClass = state.diff?.added.has(node.id) ? ' diff-added' : state.diff?.changed.has(node.id) ? ' diff-changed' : '';
    group.setAttribute('class', `node node-${node.type}${state.selectedNodeId === node.id ? ' selected' : ''}${diffClass}`);
    group.setAttribute('transform', `translate(${node.x},${node.y})`);
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('r', node.type === 'file' || node.type === 'config' || node.type === 'document' ? '11' : '7');
    circle.setAttribute('fill', palette[node.colorIndex]);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', '15'); label.setAttribute('y', '4');
    label.textContent = node.name.length > 32 ? `${node.name.slice(0, 29)}…` : node.name;
    const select = () => { state.selectedNodeId = node.id; renderDetails(node); renderGraph(); };
    group.addEventListener('click', select);
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') select(); });
    group.append(circle, label); svg.append(group);
  }
  container.append(svg);
}

function renderLayers() {
  const container = elements['layers-view']; container.replaceChildren();
  for (const layer of state.graph.layers ?? []) {
    const card = document.createElement('article'); card.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = layer.name;
    const description = document.createElement('p'); description.textContent = layer.description;
    const count = document.createElement('strong'); count.textContent = `${layer.nodeIds.length} nodes`;
    const list = document.createElement('ul');
    for (const id of layer.nodeIds.slice(0, 15)) {
      const node = nodeById(id); const item = document.createElement('li');
      const button = document.createElement('button'); button.textContent = node?.name ?? id;
      button.addEventListener('click', () => { state.selectedNodeId = id; renderDetails(node); });
      item.append(button); list.append(item);
    }
    card.append(heading, description, count, list); container.append(card);
  }
}

function renderTour() {
  const container = elements['tour-view']; container.replaceChildren();
  for (const step of state.graph.tour ?? []) {
    const card = document.createElement('article'); card.className = 'tour-step';
    const heading = document.createElement('h2'); heading.textContent = `${step.order}. ${step.title}`;
    const description = document.createElement('p'); description.textContent = step.description;
    const list = document.createElement('ol');
    for (const id of step.nodeIds ?? []) { const item = document.createElement('li'); item.textContent = nodeById(id)?.name ?? id; list.append(item); }
    card.append(heading, description, list); container.append(card);
  }
}

function renderDomain() {
  const container = elements['domain-view']; container.replaceChildren();
  const domain = state.graph.domain;
  if (!domain) {
    const card = document.createElement('article'); card.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = 'Domain graph not generated';
    const text = document.createElement('p'); text.textContent = 'The structural graph remains valid. Add a deterministic domain artifact or optional consented enrichment to populate business flows.';
    card.append(heading, text); container.append(card); return;
  }
  if (domain.warning) {
    const warning = document.createElement('article'); warning.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = 'Domain interpretation';
    const text = document.createElement('p'); text.textContent = domain.warning;
    warning.append(heading, text); container.append(warning);
  }
  for (const group of domain.domains ?? []) {
    const card = document.createElement('article'); card.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = group.name;
    const description = document.createElement('p'); description.textContent = group.description;
    const count = document.createElement('strong'); count.textContent = `${group.nodeIds?.length ?? 0} nodes`;
    card.append(heading, description, count); container.append(card);
  }
  for (const flow of domain.flows ?? []) {
    const card = document.createElement('article'); card.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = flow.name;
    const description = document.createElement('p'); description.textContent = flow.description ?? '';
    const list = document.createElement('ol');
    for (const step of flow.steps ?? []) { const item = document.createElement('li'); item.textContent = step.name; list.append(item); }
    card.append(heading, description, list); container.append(card);
  }
}

function showView(view) {
  state.view = view;
  for (const name of ['graph', 'layers', 'tour', 'domain']) {
    document.getElementById(`${name}-view`).hidden = name !== view;
  }
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  if (view === 'graph') renderGraph();
}

async function start() {
  try {
    const { projectId, token } = parseDashboardLocation(location.href);
    const configuredOrigin = document.querySelector('meta[name="ua-api-origin"]')?.content || location.origin;
    const api = new DashboardApi(configuredOrigin);
    state.api = api; state.projectId = projectId; state.token = token;
    setWarning('Loading private graph…', 'info');
    state.graph = await api.getGraph(projectId, token);
    state.filtered = state.graph;
    elements.title.textContent = state.graph.project.name;
    elements.subtitle.textContent = state.graph.project.description ?? `Source ${state.graph.project.sourceVersion}`;
    elements.stats.textContent = `${state.graph.nodes.length} nodes · ${state.graph.edges.length} edges · ${state.graph.layers.length} layers`;
    setWarning('Read-only access token. The graph may be stale if the repository changed after this source version.', 'info');
    renderGraph(); renderLayers(); renderTour(); renderDomain(); renderDetails(null);
    elements['search-input'].addEventListener('input', (event) => { state.filtered = filterGraph(state.graph, event.target.value); renderGraph(); });
    elements['diff-head'].value = state.graph.project.sourceVersion;
    elements['diff-button'].addEventListener('click', async () => {
      const baseRef = elements['diff-base'].value.trim();
      const headRef = elements['diff-head'].value.trim();
      if (!baseRef || !headRef) { elements['diff-status'].textContent = 'Enter both persisted versions.'; return; }
      elements['diff-button'].disabled = true; elements['diff-status'].textContent = 'Comparing…';
      try {
        const result = await state.api.compare(state.projectId, state.token, baseRef, headRef);
        state.diff = { added: new Set(result.added_node_ids ?? []), changed: new Set(result.changed_node_ids ?? []) };
        elements['diff-status'].textContent = `${result.added_node_ids?.length ?? 0} added · ${result.removed_node_ids?.length ?? 0} removed · ${result.changed_node_ids?.length ?? 0} changed`;
        showView('graph'); renderGraph();
      } catch (error) { elements['diff-status'].textContent = error.message; }
      finally { elements['diff-button'].disabled = false; }
    });
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  } catch (error) {
    setWarning(error.message, 'error');
    elements.subtitle.textContent = 'Unable to load graph';
  }
}

start();
