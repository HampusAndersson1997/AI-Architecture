function layerMap(graph) {
  const map = new Map();
  for (const layer of graph.layers ?? []) {
    for (const nodeId of layer.nodeIds ?? []) map.set(nodeId, layer.id);
  }
  return map;
}

export function layerColorIndex(layerId) {
  let hash = 2166136261;
  for (const character of String(layerId)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 8;
}

export function buildGraphModel(graph, width = 1000, height = 700) {
  const memberships = layerMap(graph);
  const layers = [...new Set((graph.nodes ?? []).map((node) => memberships.get(node.id) ?? 'unassigned'))].sort();
  const grouped = new Map(layers.map((layerId) => [layerId, []]));
  for (const node of [...(graph.nodes ?? [])].sort((left, right) => left.id.localeCompare(right.id))) {
    grouped.get(memberships.get(node.id) ?? 'unassigned').push(node);
  }
  const positioned = [];
  layers.forEach((layerId, layerIndex) => {
    const nodes = grouped.get(layerId);
    const x = ((layerIndex + 1) / (layers.length + 1)) * width;
    nodes.forEach((node, nodeIndex) => {
      const y = ((nodeIndex + 1) / (nodes.length + 1)) * height;
      positioned.push({ ...node, layerId, colorIndex: layerColorIndex(layerId), x: Math.round(x), y: Math.round(y) });
    });
  });
  const known = new Set(positioned.map((node) => node.id));
  return {
    nodes: positioned,
    edges: (graph.edges ?? []).filter((edge) => known.has(edge.source) && known.has(edge.target)),
    layers,
  };
}

export function filterGraph(graph, query) {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return graph;
  const matched = new Set((graph.nodes ?? []).filter((node) =>
    `${node.name ?? ''} ${node.summary ?? ''} ${node.filePath ?? ''} ${(node.tags ?? []).join(' ')}`.toLowerCase().includes(normalized),
  ).map((node) => node.id));
  const included = new Set(matched);
  for (const edge of graph.edges ?? []) {
    if (matched.has(edge.source)) included.add(edge.target);
    if (matched.has(edge.target)) included.add(edge.source);
  }
  return {
    ...graph,
    nodes: (graph.nodes ?? []).filter((node) => included.has(node.id)),
    edges: (graph.edges ?? []).filter((edge) => included.has(edge.source) && included.has(edge.target)),
    layers: (graph.layers ?? []).map((layer) => ({ ...layer, nodeIds: (layer.nodeIds ?? []).filter((id) => included.has(id)) })).filter((layer) => layer.nodeIds.length),
    tour: graph.tour ?? [],
  };
}
