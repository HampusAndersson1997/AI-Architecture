export function route(method, pattern, handler, options = {}) {
  return {
    auth: options.auth ?? 'bearer',
    match(requestMethod, url) {
      if (requestMethod.toUpperCase() !== method.toUpperCase()) return null;
      const match = pattern.exec(url.pathname);
      return match ? { ...match.groups, url } : null;
    },
    handle: handler,
  };
}

export async function readJson(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new TypeError('Request content-type must be application/json');
  }
  return request.json();
}
