import { timingSafeEqualText } from './auth.js';

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sign(secret, payloadPart) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function createScopedToken(secret, { scope, subject, expiresAt }) {
  if (!secret || secret.length < 16) throw new TypeError('token secret must be at least 16 characters');
  const payload = { scope, subject, exp: expiresAt };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadPart}.${await sign(secret, payloadPart)}`;
}

export async function verifyScopedToken(secret, token, { scope, subject, now = Math.floor(Date.now() / 1000) }) {
  try {
    if (!secret || typeof token !== 'string') return false;
    const [payloadPart, signature] = token.split('.');
    if (!payloadPart || !signature || token.split('.').length !== 2) return false;
    const expectedSignature = await sign(secret, payloadPart);
    if (!timingSafeEqualText(signature, expectedSignature)) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    return payload.scope === scope && payload.subject === subject && Number.isInteger(payload.exp) && payload.exp >= now;
  } catch {
    return false;
  }
}
