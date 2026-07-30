import { requireAuthentication } from './auth.js';
import { jsonResponse } from './contracts.js';
import { errorResponse } from './errors.js';

function allowedCorsOrigin(request, env) {
  const origin = request.headers.get('origin');
  const configured = env?.DASHBOARD_ORIGIN;
  return origin && configured && origin === configured ? origin : null;
}

function withCors(response, request, env) {
  const origin = allowedCorsOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
  headers.set('access-control-allow-headers', 'authorization,content-type,x-callback-token,x-dashboard-token,x-upload-token');
  headers.set('access-control-max-age', '86400');
  headers.append('vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createApp(env, routes = []) {
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS' && allowedCorsOrigin(request, env)) {
          return withCors(new Response(null, { status: 204 }), request, env);
        }
        if (url.pathname === '/health') return withCors(jsonResponse({ status: 'ok' }), request, env);
        for (const route of routes) {
          const match = route.match(request.method, url);
          if (!match) continue;
          if (route.auth !== 'none') {
            const authFailure = requireAuthentication(request, env);
            if (authFailure) return withCors(authFailure, request, env);
          }
          return withCors(await route.handle(request, env, match), request, env);
        }
        const authFailure = requireAuthentication(request, env);
        if (authFailure) return withCors(authFailure, request, env);
        return withCors(jsonResponse({ error: { code: 'not_found', message: 'Route not found' } }, 404), request, env);
      } catch (error) {
        return withCors(errorResponse(error), request, env);
      }
    },
  };
}
