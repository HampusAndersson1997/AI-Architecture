function utf8Bytes(value) {
  return new TextEncoder().encode(String(value));
}

export function timingSafeEqualText(left, right) {
  const a = utf8Bytes(left);
  const b = utf8Bytes(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export function authenticateRequest(request, env) {
  const expected = env?.API_KEY;
  if (typeof expected !== 'string' || expected.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && timingSafeEqualText(match[1], expected));
}

export function requireAuthentication(request, env) {
  if (!authenticateRequest(request, env)) {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Missing or invalid credentials' } }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer' },
    });
  }
  return null;
}
