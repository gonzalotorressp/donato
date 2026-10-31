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
const { default: priceHandler } = await import('../api/sigma/precio.js');
const { signArticleContext, readArticleContext } = await import('../server/article-context.js');
const { sigmaRetryAfter } = await import('../server/policy-cache.js');
const originalFetch = globalThis.fetch;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function mock({ cached = false, busy = false, upstream = null, access = true, auth = true, batches, policies: suppliedPolicies, article } = {}) {
  const actions = [];
  const sigmaCalls = [];
  const articleCalls = [];
  const policies = suppliedPolicies || [
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
      if (args.p_action === 'stage') return json({ retryAfter: args.p_payload.retryAfter });
      return json({});
    }
    if (url.includes('ExportArticulosPrecios')) return json([{ id: 154, precio: 1611.57, moneda: 'ARS' }]);
    if (url.includes('ExportArticulos')) { articleCalls.push(url); return json([article || { id: 154, proveedorCodigo: 9, ivaPorcentual: 21 }]); }
    if (url.includes('ExportPoliticasDescuento')) {
      sigmaCalls.push(url);
      if (upstream) return upstream();
      return json(batches ? batches[sigmaCalls.length - 1] : policies);
    }
    throw new Error('Unexpected URL: ' + url);
  };
  return { actions, sigmaCalls, articleCalls };
}

async function request({ force = false, id = '154', method = 'GET', context, route = handler } = {}) {
  const response = { headers: {}, statusCode: null, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  await route({ method, query: { id, force: force ? '1' : '', context }, headers: { authorization: 'Bearer test' } }, response);
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

test('real Sigma policy 10093 matches article 111 by group EA1 and provider 00004', async () => {
  const policy = JSON.parse(readFileSync(new URL('./fixtures/policy10093.json', import.meta.url), 'utf8'));
  const article = { id: 111, grupoCodigo: 'EA1', proveedorCodigo: '00004', ivaPorcentual: 21 };
  const variants = [
    policy,
    { ...policy, id: 20001, articuloGrupoCodigo: 'EA2' },
    { ...policy, id: 20002, articuloProveedorCodigo: '00005' },
    { ...policy, id: 20003, clienteId: 99 },
    { ...policy, id: 20004, listaPrecio: '5' },
    { ...policy, id: 20005, sucursal: '0001' },
  ];
  for (const context of [undefined, signArticleContext(article)]) {
    mock({ cached: true, policies: variants, article });
    const response = await request({ id: '111', context });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.politicasEncontradas.map(p => p.id), [10093]);
    const found = response.body.politicasEncontradas[0];
    assert.deepEqual(found.alcance, ['Proveedor', 'Grupo']);
    assert.equal(found.restricciones.articuloGrupoCodigo, 'EA1');
    assert.equal(found.descuento, 5.82);
    assert.equal(found.cantidadMinima, 8);
    assert.equal(found.cantidadEnBultos, 'N');
    assert.ok(found.motivosEvaluacion.includes('Requiere validar cantidad y bultos'));
  }
});

test('Sigma prefixed provider/category/group/division fields all constrain matching', async () => {
  const article = { id: 154, proveedorCodigo: '00009', rubroCodigo: 'D014', grupoCodigo: 'EA1', divisionCodigo: '0002' };
  const policies = [
    { id: 1, articuloProveedorCodigo: '9', descuento: 5 },
    { id: 2, articuloRubroCodigo: 'D014', descuento: 5 },
    { id: 3, articuloGrupoCodigo: 'EA1', descuento: 5 },
    { id: 4, articuloDivisionCodigo: '2', descuento: 5 },
    { id: 5, articuloGrupoCodigo: 'EA1', articuloRubroCodigo: 'wrong', descuento: 5 },
    { id: 6, articuloGrupoCodigo: 'other', descuento: 5 },
    { id: 7, articuloProveedorCodigo: '9', proveedorCodigo: '10', descuento: 5 },
  ];
  mock({ cached: true, policies });
  const response = await request({ context: signArticleContext(article) });
  assert.deepEqual(response.body.politicasEncontradas.map(p => p.id), [1, 2, 3, 4]);
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
  assert.equal(response.statusCode, 202);
  assert.equal(response.headers['Retry-After'], '3');
  assert.equal(state.sigmaCalls.length, 0);
});

test('upstream 429 records cooldown without replacing previous snapshot', async () => {
  const state = mock({ upstream: () => new Response('rate limit', { status: 429 }) });
  const response = await request({ force: true });
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.pending, true);
  assert.equal(response.body.retryAfter, 31);
  assert.deepEqual(state.actions.map(a => a.p_action), ['claim', 'stage']);
  assert.equal(state.actions.at(-1).p_payload.page, 1);
  assert.deepEqual(state.actions.at(-1).p_payload.rows, []);
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

test('signed article data avoids the duplicate master lookup', async () => {
  const state = mock({ cached: true });
  const context = signArticleContext({ id: 154, proveedorCodigo: 9 });
  assert.equal((await request({ context })).statusCode, 200);
  assert.equal(state.articleCalls.length, 0);
  assert.equal(readArticleContext(context, '155'), null);
  assert.equal(readArticleContext(context + 'x', '154'), null);
  assert.equal(readArticleContext('invalid', '154'), null);
});

test('price -> policy routes consult the article master only once', async () => {
  const state = mock();
  const price = await request({ route: priceHandler });
  assert.equal(price.statusCode, 200);
  assert.equal(price.body.precioConIva, 1950);
  assert.ok(price.body.contextoPoliticas);
  const policies = await request({ context: price.body.contextoPoliticas });
  assert.equal(policies.statusCode, 200);
  assert.equal(state.articleCalls.length, 1);
  assert.equal(policies.body.politicasEncontradas.length, 2);
});

test('expired article signatures fall back to the master', async () => {
  const now = Date.now;
  let context;
  try { Date.now = () => now() - 11 * 60 * 1000; context = signArticleContext({ id: 154 }); }
  finally { Date.now = now; }
  assert.equal(readArticleContext(context, '154'), null);
  const state = mock({ cached: true });
  assert.equal((await request({ context })).statusCode, 200);
  assert.equal(state.articleCalls.length, 1);
});

test('rate-limit delays respect Retry-After seconds, dates and Sigma milliseconds', () => {
  assert.equal(sigmaRetryAfter(new Response('', { headers: { 'Retry-After': '2' } }), ''), 3);
  assert.equal(sigmaRetryAfter(new Response(''), 'Please wait 4120ms'), 5);
  const now = Date.parse('2026-10-31T15:00:00Z');
  assert.equal(sigmaRetryAfter(new Response('', { headers: { 'Retry-After': 'Sat, 31 Oct 2026 15:00:05 GMT' } }), '', now), 6);
});

test('a limited second page resumes at page 2 and keeps page 1', async () => {
  const firstPage = Array.from({ length: 1000 }, (_, id) => ({ id, articuloId: 154 }));
  let lease = 'lease-1', stagedRows = [], page = 1, pending = false;
  let published;
  const pages = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json({ id: 'user' });
    if (url.endsWith('/rpc/has_application_access')) return json(true);
    if (url.endsWith('/rpc/donato_policy_cache')) {
      const a = JSON.parse(init.body);
      if (a.p_action === 'claim') return json({ cached: false, lease, stagedRows, page });
      if (a.p_action === 'stage') {
        ({ rows: stagedRows, page } = a.p_payload);
        pending = true;
        return json({ retryAfter: 3 });
      }
      if (a.p_action === 'publish') { published = a.p_payload; return json({ updatedAt: '2026-10-31T15:00:00Z' }); }
    }
    if (url.includes('ExportPoliticasDescuento')) {
      const requested = new URL(url).searchParams.get('page'); pages.push(requested);
      if (requested === '1') return json(firstPage);
      return pending ? json([{ id: 1001, articuloId: 154 }]) : new Response('Please wait 2000ms', { status: 429 });
    }
    throw new Error('Unexpected URL: ' + url);
  };
  const context = signArticleContext({ id: 154 });
  assert.equal((await request({ context })).statusCode, 202);
  assert.equal(page, 2);
  assert.equal(stagedRows.length, 1000);
  lease = 'lease-2';
  assert.equal((await request({ context })).statusCode, 200);
  assert.deepEqual(pages, ['1', '2', '2']);
  assert.equal(published.length, 1001);
});

test('browser automatically retries a pending response and retains signed context', async () => {
  const apiSource = readFileSync(new URL('../src/lib/apiJson.ts', import.meta.url), 'utf8')
    .replace('response: Response, fallback: string', 'response, fallback');
  const apiUrl = 'data:text/javascript,' + encodeURIComponent(apiSource);
  const source = readFileSync(new URL('../src/lib/pricePolicies.ts', import.meta.url), 'utf8')
    .replace("'./apiJson'", JSON.stringify(apiUrl))
    .replace(/export async function fetchPricePolicies\([\s\S]*?\) \{/, 'export async function fetchPricePolicies(id, token, context, force, onProgress) {');
  const helperUrl = 'data:text/javascript,' + encodeURIComponent(source);
  const { fetchPricePolicies } = await import(helperUrl);
  const calls = [], progress = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    return calls.length === 1 ? json({ pending: true, retryAfter: 3, policiesReady: true }, 202) : json({ consultaCompleta: true });
  };
  const timeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = fn => { fn(); return 0; };
    const result = await fetchPricePolicies('154', 'test-token', 'signed-context', true, message => progress.push(message));
    assert.equal(result.consultaCompleta, true);
    assert.equal(progress.length, 1);
    assert.match(progress[0], /Reintento automático/);
    assert.match(calls[0], /force=1/);
    assert.doesNotMatch(calls[1], /force=/);
    assert.match(calls[1], /context=signed-context/);
  } finally { globalThis.setTimeout = timeout; }
});

test.after(() => { globalThis.fetch = originalFetch; });
