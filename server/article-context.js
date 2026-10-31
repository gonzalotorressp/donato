import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 10 * 60 * 1000;
const FIELDS = ['proveedorCodigo', 'rubroCodigo', 'grupoCodigo', 'divisionCodigo'];
function signature(payload) {
  return createHmac('sha256', process.env.DONATO_POLICY_CACHE_SECRET)
    .update('donato-article-v1:' + payload).digest();
}

export function signArticleContext(article) {
  if (!process.env.DONATO_POLICY_CACHE_SECRET) return null;
  const payload = Buffer.from(JSON.stringify({
    id: String(article.id), issuedAt: Date.now(),
    ...Object.fromEntries(FIELDS.map(field => [field, article[field] ?? null])),
  })).toString('base64url');
  return payload + '.' + signature(payload).toString('base64url');
}

export function readArticleContext(value, id) {
  if (typeof value !== 'string' || value.length > 4096 || !process.env.DONATO_POLICY_CACHE_SECRET) return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const expected = signature(parts[0]);
    const received = Buffer.from(parts[1], 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const article = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const age = Date.now() - article.issuedAt;
    if (article.id !== String(id) || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
    return article;
  } catch { return null; }
}
