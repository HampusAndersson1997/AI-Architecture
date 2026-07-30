const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'at', 'be', 'does', 'for', 'how', 'in', 'is', 'it', 'of', 'on', 'the', 'to', 'what', 'where', 'which', 'with']);

function terms(value) {
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9_./-]+/g) ?? [])].filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function nodeText(node) {
  return `${node.name ?? ''} ${node.summary ?? ''} ${node.filePath ?? ''} ${(node.tags ?? []).join(' ')}`.toLowerCase();
}

export function lexicalSearch(graph, query, limit = 10) {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];
  return graph.nodes
    .map((node) => {
      const text = nodeText(node);
      const name = String(node.name ?? '').toLowerCase();
      const path = String(node.filePath ?? '').toLowerCase();
      let score = 0;
      const matchedTerms = [];
      for (const term of queryTerms) {
        if (!text.includes(term)) continue;
        matchedTerms.push(term);
        score += 1;
        if (name.includes(term)) score += 4;
        if (path.includes(term)) score += 2;
        if ((node.tags ?? []).some((tag) => String(tag).toLowerCase().includes(term))) score += 2;
      }
      return { node, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export function answerGraphQuery(graph, question) {
  const results = lexicalSearch(graph, question, 8);
  if (results.length === 0) {
    return { answer: 'The current graph does not contain enough evidence to answer that question.', evidence: [], graphVersion: graph.project.sourceVersion };
  }
  const evidence = results.slice(0, 5).map(({ node, score }) => ({
    nodeId: node.id,
    name: node.name,
    filePath: node.filePath ?? null,
    summary: node.summary,
    score,
  }));
  const names = evidence.map((item) => item.name).join(', ');
  return {
    answer: `The strongest graph evidence is in ${names}. ${evidence[0].summary}`,
    evidence,
    graphVersion: graph.project.sourceVersion,
  };
}

function stableNode(node) {
  return JSON.stringify({ type: node.type, name: node.name, summary: node.summary, filePath: node.filePath ?? null, tags: [...(node.tags ?? [])].sort() });
}

export function compareGraphs(base, head) {
  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const headNodes = new Map(head.nodes.map((node) => [node.id, node]));
  const addedNodeIds = [...headNodes.keys()].filter((id) => !baseNodes.has(id)).sort();
  const removedNodeIds = [...baseNodes.keys()].filter((id) => !headNodes.has(id)).sort();
  const changedNodeIds = [...headNodes.keys()].filter((id) => baseNodes.has(id) && stableNode(baseNodes.get(id)) !== stableNode(headNodes.get(id))).sort();
  const edgeKey = (edge) => `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
  const baseEdges = new Set(base.edges.map(edgeKey));
  const headEdges = new Set(head.edges.map(edgeKey));
  return {
    baseSourceVersion: base.project.sourceVersion,
    headSourceVersion: head.project.sourceVersion,
    addedNodeIds,
    removedNodeIds,
    changedNodeIds,
    addedEdges: head.edges.filter((edge) => !baseEdges.has(edgeKey(edge))),
    removedEdges: base.edges.filter((edge) => !headEdges.has(edgeKey(edge))),
  };
}
