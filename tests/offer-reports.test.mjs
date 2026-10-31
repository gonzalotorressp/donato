import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let saveSurvey, controlsFor, emptyOffer, preparePhoto, ReportForm, PolicyControl;
test.before(async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  try {
    const survey = await server.ssrLoadModule('/src/lib/priceSurvey.ts');
    saveSurvey = survey.savePriceSurvey; controlsFor = survey.surveyControls; emptyOffer = survey.emptyOfferDraft;
    preparePhoto = (await server.ssrLoadModule('/src/lib/offerReports.ts')).prepareOfferPhoto;
    ReportForm = (await server.ssrLoadModule('/src/components/ExpiredOfferReport.tsx')).ExpiredOfferReport;
    PolicyControl = (await server.ssrLoadModule('/src/components/PolicyPriceControl.tsx')).PolicyPriceControl;
  } finally { await server.close(); }
});

function mockClient({ authError = false, uploadError = false, saveError = false, alreadySaved = false, existingPhoto = false } = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: authError ? null : { id: '00000000-0000-0000-0000-000000000111' } }, error: null }) },
    storage: { from: bucket => {
      assert.equal(bucket, 'donato-ofertas-carteles');
      return {
        upload: async (path, blob, options) => { calls.push({ action: 'upload', path, type: blob.type, options });
          return { error: uploadError ? { message: 'upload failed' } : existingPhoto ? { statusCode: '409', message: 'already exists' } : null }; },
        remove: async paths => { calls.push({ action: 'cleanup', paths }); return { error: null }; },
      };
    } },
    rpc: async (name, args) => {
      assert.equal(name, 'donato_guardar_relevamiento_precios');
      calls.push({ action: args.p_solo_consultar ? 'check' : 'save', args });
      return { data: { guardado: args.p_solo_consultar ? alreadySaved : !saveError }, error: !args.p_solo_consultar && saveError ? { message: 'save failed' } : null };
    },
  };
  return { client, calls };
}
const article = { id: '111', descripcion: 'COCA COLA 2000CC RET', precioConIva: 3650, precioSinIva: 3016.53, ivaPorcentual: 21 };
const policy = { id: 10093, precio: null, descuento: 5.82 };
const values = () => ({
  id: '00000000-0000-0000-0000-000000001111', article,
  controls: controlsFor(article, 'ok', '', [policy], { 10093: { status: 'error', observedPrice: '3500,00' } }),
  offer: { enabled: true, photo: new Blob(['jpeg test'], { type: 'image/jpeg' }),
    photoId: '00000000-0000-0000-0000-000000002222', price: '3200,00', note: ' Cartel en góndola ' },
  policies: [policy], policyNote: 'Consulta completa',
});

test('one survey includes list, selected policy and offer evidence in one save call', async () => {
  const { client, calls } = mockClient();
  const input = values();
  assert.equal(await saveSurvey(client, input), input.id);
  assert.deepEqual(calls.map(call => call.action), ['check', 'upload', 'save']);
  const payload = calls[2].args.p_payload;
  assert.equal(payload.controles.length, 2);
  assert.equal(payload.controles[0].politica_id, null);
  assert.equal(payload.controles[1].politica_id, '10093');
  assert.equal(payload.controles[1].precio_observado, 3500);
  assert.equal(payload.controles[1].politica_snapshot.precioCalculadoConIva, 3437.57);
  assert.equal(payload.oferta.precio_cartel, 3200);
  assert.equal(payload.oferta.observacion, 'Cartel en góndola');
  assert.equal(payload.oferta.foto_path, calls[1].path);
  assert.equal(calls[1].options.upsert, false);
});

test('a survey can save marked policies without requiring a list control or offer', async () => {
  const { client, calls } = mockClient();
  const input = values();
  input.controls = controlsFor(article, null, '', [policy], { 10093: { status: 'missing', observedPrice: '' } });
  input.offer = emptyOffer();
  await saveSurvey(client, input);
  assert.deepEqual(calls.map(call => call.action), ['check', 'save']);
  assert.equal(calls[1].args.p_payload.controles.length, 1);
  assert.equal(calls[1].args.p_payload.oferta, null);
});

test('failed photo upload prevents the survey save', async () => {
  const { client, calls } = mockClient({ uploadError: true });
  await assert.rejects(() => saveSurvey(client, values()), /No se pudo subir la foto/);
  assert.deepEqual(calls.map(call => call.action), ['check', 'upload']);
});

test('a failed atomic save cleans up only its unlinked photo', async () => {
  const { client, calls } = mockClient({ saveError: true });
  await assert.rejects(() => saveSurvey(client, values()), /save failed/);
  assert.deepEqual(calls.map(call => call.action), ['check', 'upload', 'save', 'cleanup']);
  assert.deepEqual(calls[3].paths, [calls[1].path]);
});

test('retrying an already committed survey does not upload or write again', async () => {
  const { client, calls } = mockClient({ alreadySaved: true });
  await saveSurvey(client, values());
  assert.deepEqual(calls.map(call => call.action), ['check']);
});

test('a retry can reuse the same uploaded photo without overwriting it', async () => {
  const { client, calls } = mockClient({ existingPhoto: true });
  await saveSurvey(client, values());
  assert.deepEqual(calls.map(call => call.action), ['check', 'upload', 'save']);
});

test('empty survey, invalid observed price, missing photo and expired session cannot be saved', async () => {
  const { client, calls } = mockClient({ authError: true });
  await assert.rejects(() => saveSurvey(client, values()), /Iniciá sesión/);
  assert.equal(calls.length, 0);
  await assert.rejects(() => saveSurvey(client, { ...values(), controls: [], offer: emptyOffer() }), /Marcá al menos/);
  assert.throws(() => controlsFor(article, 'error', 'invalid', [], {}), /lista inválido/);
  assert.throws(() => controlsFor(article, null, '', [policy], { 10093: { status: 'error', observedPrice: 'invalid' } }), /10093 inválido/);
  await assert.rejects(() => saveSurvey(client, { ...values(), offer: { ...values().offer, photo: null } }), /foto válida/);
  await assert.rejects(() => preparePhoto({ type: 'image/svg+xml', size: 10 }), /JPG, PNG o WebP/);
});

test('policy and offer editors collect drafts without individual save buttons', () => {
  const policyHtml = renderToStaticMarkup(createElement(PolicyControl, { policyId: 10093,
    value: { status: 'error', observedPrice: '3500' }, onChange: () => {} }));
  assert.ok(policyHtml.includes('Precio observado'));
  assert.equal(policyHtml.includes('Guardar'), false);
  const offerHtml = renderToStaticMarkup(createElement(ReportForm, { article,
    value: values().offer, onChange: () => {}, onProcessingChange: () => {} }));
  assert.ok(offerHtml.includes('capture="environment"'));
  assert.ok(offerHtml.includes('Sacar foto'));
  assert.equal(offerHtml.includes('Guardar'), false);
});
