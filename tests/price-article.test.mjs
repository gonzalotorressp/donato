import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let resolveArticle, loadMetadata;
test.before(async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  try { const module=await server.ssrLoadModule('/src/lib/resolvePriceArticle.ts'); resolveArticle=module.resolvePriceArticle;loadMetadata=module.loadPriceLabelMetadata; }
  finally { await server.close(); }
});

const catalog = [
  { articulo_codigo: '111', ean_unidad: '7790895000218', ean_bulto: null, unidades_por_bulto:8, synced_at:'2026-10-03T15:14:16Z' },
  { articulo_codigo: '154', ean_unidad: '7798054012980', ean_bulto: '7798054012997', unidades_por_bulto:6 },
  { articulo_codigo: '15210410', ean_unidad: null, ean_bulto: null },
];
function clientFor(rows = catalog, fail = false) {
  const calls = [];
  return { calls, client: { rpc: async (name, { p_codigo: value }) => {
    assert.equal(name, 'donato_price_resolve_article');
    calls.push(value);
    return { data: rows.filter(row => [row.articulo_codigo, row.ean_unidad, row.ean_bulto].includes(value)).slice(0, 3), error: fail ? { message: 'unavailable' } : null };
  } } };
}

test('a short Sigma code is used directly', async () => {
  const { client, calls } = clientFor();
  assert.equal(await resolveArticle(client, ' 111 '), '111');
  assert.equal(calls.length, 0);
});

test('unit and case EANs resolve to their canonical Sigma article', async () => {
  const { client } = clientFor();
  assert.equal(await resolveArticle(client, '7790895000218'), '111');
  assert.equal(await resolveArticle(client, '7798054012980'), '154');
  assert.equal(await resolveArticle(client, '7798054012997'), '154');
});

test('an eight-digit article code is accepted and not assumed to be an EAN', async () => {
  const { client } = clientFor();
  assert.equal(await resolveArticle(client, '15210410'), '15210410');
  assert.equal(await resolveArticle(client, '123456789'), '123456789');
});

test('ambiguous barcodes and conflicting article/EAN matches cannot select the wrong product', async () => {
  const { client } = clientFor([
    ...catalog, { articulo_codigo: '999', ean_unidad: '7790895000218' },
    { articulo_codigo: '777', ean_unidad: '15210410' },
  ]);
  await assert.rejects(() => resolveArticle(client, '7790895000218'), /varios artículos/);
  await assert.rejects(() => resolveArticle(client, '15210410'), /varios artículos/);
});

test('unknown EANs, unavailable catalog and invalid text return useful errors', async () => {
  const { client, calls } = clientFor();
  await assert.rejects(() => resolveArticle(client, '9999999999999'), /EAN no encontrado/);
  await assert.rejects(() => resolveArticle(client, ''), /código Sigma o EAN válido/);
  await assert.rejects(() => resolveArticle(client, '111,ean_unidad.not.is.null'), /código Sigma o EAN válido/);
  assert.equal(calls.length, 1);
  await assert.rejects(() => resolveArticle(clientFor(catalog, true).client, '7790895000218'), /No se pudo resolver/);
});

test('retail metadata uses the unit EAN, preserves sync age and fails without blocking price lookup', async () => {
  const {client}=clientFor();
  assert.deepEqual(await loadMetadata(client,'111'),{eanUnidad:'7790895000218',unidadesPorBulto:8,etiquetaActualizada:'2026-10-03T15:14:16Z'});
  assert.equal((await loadMetadata(client,'154')).eanUnidad,'7798054012980');
  assert.ok((await loadMetadata(clientFor(catalog,true).client,'111')).etiquetaAviso);
  assert.ok((await loadMetadata(client,'999')).etiquetaAviso);
});
