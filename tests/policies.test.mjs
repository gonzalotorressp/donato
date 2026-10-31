import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-public';
process.env.DONATO_POLICY_CACHE_SECRET = 'test-secret';
process.env.SIGMA_API_TOKEN = 'test-sigma';
const { default: handler } = await import('../api/sigma/politicas-articulo.js');
const originalFetch = globalThis.fetch;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function mock({ cached = false, busy = false, upstream = null, access = true, auth = true, batches } = {}) {
  const actions = [];
  const sigmaCalls = [];
  const policies = [
    { id: 1, articuloId: 154, descuento: 10 },
    { id: 2, proveedorCodigo: '0009', descuento: 5, cantidadMinima: 6 },
    { id: 3, articuloId: 155, descuento: 50 },
    { id: 4, articuloId: 154, clienteId: 99, descuento: 50 },
    { id: 5, articuloId: 154, listaPrecio: 5, descuento: 50 },
    { id: 6, articuloId: 154, sucursal: '0001', descuento: 50 },
  ];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json(auth ? { id: 'user' } : {}, auth ? 200 : 401);
    if (url.endsWith('/rpc/has_application_access')) return json(access);
    if (url.endsWith('/rpc/donato_policy_cache')) {
      const args = JSON.parse(init.body);
      actions.push(args);
      if (args.p_action === 'claim') return json(cached && !args.p_force
        ? { cached: true, complete: true, rows: policies, updatedAt: '2026-10-31T14:00:00Z' }
        : { cached: false, lease: busy ? null : 'lease' });
      if (args.p_action === 'publish') return json({ updatedAt: '2026-10-31T14:00:00Z' });
      return json({});
    }
    if (url.includes('ExportArticulos')) return json([{ id: 154, proveedorCodigo: 9 }]);
    if (url.includes('ExportPoliticasDescuento')) {
      sigmaCalls.push(url);
      if (upstream) return upstream();
      return json(batches ? batches[sigmaCalls.length - 1] : policies);
    }
    throw new Error('Unexpected URL: ' + url);
  };
  return { actions, sigmaCalls };
}

async function request({ force = false, id = '154', method = 'GET' } = {}) {
  const response = { headers: {}, statusCode: null, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ method, query: { id, force: force ? '1' : '' }, headers: { authorization: 'Bearer test' } }, response);
  return response;
}

test('all server files have valid syntax (Vite does not compile API files)', () => {
  for (const path of [...globSync('api/**/*.js'), ...globSync('server/**/*.js')]) execFileSync(process.execPath, ['--check', path]);
});

test('cold request persists a complete snapshot and evaluates article/supplier policies', async () => {
  const state = mock();
  const response = await request();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.politicasEncontradas.map(p => p.id), [1, 2]);
  assert.equal(response.body.politicasEncontradas[1].evaluacion, 'requiere_validacion');
  assert.equal(response.body.consultaCompleta, true);
  assert.deepEqual(state.actions.map(a => a.p_action), ['claim', 'publish']);
  assert.equal(state.actions[1].p_payload.length, 6);
});

test('shared cache is read without downloading policies again', async () => {
  const state = mock({ cached: true });
  const response = await request();
  assert.equal(response.body.desdeCache, true);
  assert.equal(state.sigmaCalls.length, 0);
});

test('forced refresh bypasses a fresh snapshot', async () => {
  const state = mock({ cached: true });
  assert.equal((await request({ force: true })).body.desdeCache, false);
  assert.equal(state.actions[0].p_force, true);
  assert.equal(state.sigmaCalls.length, 1);
});

test('concurrent refresh gets a retry response without a second export', async () => {
  const state = mock({ busy: true });
  const response = await request();
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['Retry-After'], '3');
  assert.equal(state.sigmaCalls.length, 0);
});

test('upstream 429 releases lock and does not replace previous snapshot', async () => {
  const state = mock({ upstream: () => new Response('rate limit', { status: 429 }) });
  const response = await request({ force: true });
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /429/);
  assert.deepEqual(state.actions.map(a => a.p_action), ['claim', 'release']);
});

test('non-JSON upstream returns a readable JSON error', async () => {
  const state = mock({ upstream: () => new Response('A server error has occurred') });
  const response = await request();
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /no JSON/);
  assert.doesNotMatch(response.body.error, /Unexpected token/);
  assert.equal(state.actions.at(-1).p_action, 'release');
});

test('all pages are fetched before the cache is published', async () => {
  const state = mock({ batches: [Array.from({ length: 1000 }, (_, id) => ({ id, articuloId: 154 })), []] });
  assert.equal((await request()).statusCode, 200);
  assert.equal(state.sigmaCalls.length, 2);
  assert.equal(state.actions.at(-1).p_payload.length, 1000);
});

test('pagination cap cannot silently publish a partial export', async () => {
  const state = mock({ upstream: () => json(Array.from({ length: 1000 }, (_, id) => ({ id }))) });
  const response = await request();
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /límite de páginas/);
  assert.equal(state.actions.some(a => a.p_action === 'publish'), false);
});

test('unauthenticated, unauthorized, invalid and unsupported requests are rejected', async () => {
  mock({ auth: false }); assert.equal((await request()).statusCode, 401);
  mock({ access: false }); assert.equal((await request()).statusCode, 403);
  const state = mock(); assert.equal((await request({ id: 'invalid' })).statusCode, 400);
  assert.equal((await request({ method: 'POST' })).statusCode, 405);
  assert.equal(state.actions.length, 0);
});

test('client handles plain-text platform failures without JSON parser details', async () => {
  // Node 22+ strips the Response annotation; no test framework dependency needed.
  const source = readFileSync(new URL('../src/lib/apiJson.ts', import.meta.url), 'utf8')
    .replace('response: Response, fallback: string', 'response, fallback');
  const { readApiJson } = await import('data:text/javascript,' + encodeURIComponent(source));
  await assert.rejects(() => readApiJson(new Response('A server error', { status: 500 }), 'No se pudieron consultar políticas'), /HTTP 500/);
  await assert.rejects(() => readApiJson(json({ error: 'Sesión requerida' }, 401), 'Error'), /Sesión requerida/);
  assert.deepEqual(await readApiJson(json({ ok: true }), 'Error'), { ok: true });
});

test.after(() => { globalThis.fetch = originalFetch; });
