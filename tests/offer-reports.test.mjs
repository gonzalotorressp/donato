import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let saveReport, preparePhoto, ReportForm;
test.before(async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const service = await server.ssrLoadModule('/src/lib/offerReports.ts');
    saveReport = service.saveExpiredOfferReport; preparePhoto = service.prepareOfferPhoto;
    ReportForm = (await server.ssrLoadModule('/src/components/ExpiredOfferReport.tsx')).ExpiredOfferReport;
  } finally { await server.close(); }
});

function mockClient({ authError = false, uploadError = false, insertError = false } = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: authError ? null : { id: '00000000-0000-0000-0000-000000000111' } }, error: null }) },
    storage: { from: bucket => {
      assert.equal(bucket, 'donato-ofertas-carteles');
      return {
        upload: async (path, blob, options) => { calls.push({ action: 'upload', path, type: blob.type, options }); return { error: uploadError ? { message: 'upload failed' } : null }; },
        remove: async paths => { calls.push({ action: 'cleanup', paths }); return { error: null }; },
      };
    } },
    from: table => {
      assert.equal(table, 'donato_ofertas_reportadas');
      return { insert: async row => { calls.push({ action: 'insert', row }); return { error: insertError ? { message: 'insert failed' } : null }; } };
    },
  };
  return { client, calls };
}
const values = () => ({ article: { id: '111', descripcion: 'COCA COLA 2000CC RET', precioConIva: 3650 },
  photo: new Blob(['jpeg test'], { type: 'image/jpeg' }), observedPrice: 3200,
  note: ' Cartel de oferta en góndola ', policies: [], policyNote: 'No se encontraron políticas' });

test('offer report uploads photo before recording article, price and policy evidence', async () => {
  const { client, calls } = mockClient();
  const id = await saveReport(client, values());
  assert.deepEqual(calls.map(call => call.action), ['upload', 'insert']);
  assert.equal(calls[0].path, `00000000-0000-0000-0000-000000000111/${id}.jpg`);
  assert.equal(calls[0].options.upsert, false);
  assert.equal(calls[1].row.foto_path, calls[0].path);
  assert.equal(calls[1].row.articulo_id, '111');
  assert.equal(calls[1].row.precio_cartel, 3200);
  assert.equal(calls[1].row.observacion, 'Cartel de oferta en góndola');
  assert.deepEqual(calls[1].row.politicas_snapshot.politicas, []);
});

test('failed photo upload cannot create a report without evidence', async () => {
  const { client, calls } = mockClient({ uploadError: true });
  await assert.rejects(() => saveReport(client, values()), /No se pudo subir la foto/);
  assert.deepEqual(calls.map(call => call.action), ['upload']);
});

test('failed report insert cleans up only its uploaded photo', async () => {
  const { client, calls } = mockClient({ insertError: true });
  await assert.rejects(() => saveReport(client, values()), /No se pudo guardar el aviso/);
  assert.deepEqual(calls.map(call => call.action), ['upload', 'insert', 'cleanup']);
  assert.deepEqual(calls[2].paths, [calls[0].path]);
});

test('a session and a valid photo are required before upload', async () => {
  const { client, calls } = mockClient({ authError: true });
  await assert.rejects(() => saveReport(client, values()), /Iniciá sesión/);
  assert.equal(calls.length, 0);
  await assert.rejects(() => saveReport(client, { ...values(), photo: new Blob([]) }), /foto válida/);
  await assert.rejects(() => preparePhoto({ type: 'image/svg+xml', size: 10 }), /JPG, PNG o WebP/);
});

test('offer-report entry is available for an article with no matching policies', () => {
  const html = renderToStaticMarkup(createElement(ReportForm, { client: null, article: values().article,
    policies: [], policyNote: 'No se encontraron políticas', onSaved: () => {} }));
  assert.ok(html.includes('Informar oferta no vigente'));
  assert.ok(html.includes('aria-expanded="false"'));
});
