import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir, writeFile } from 'node:fs/promises';

let labels, Printer;
test.before(async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  try {
    labels = await server.ssrLoadModule('/src/lib/priceLabel.ts');
    Printer = (await server.ssrLoadModule('/src/components/PriceLabelPrinter.tsx')).PriceLabelPrinter;
  } finally { await server.close(); }
});
const article = { id: '111', descripcion: 'COCA COLA 2000CC RET', precioConIva: 3650, precioSinIva: 3016.53, ivaPorcentual: 21 };
const policy = { id: 10093, precio: null, descuento: 5.82, cantidadMinima: 8, cantidadMaxima: 9999,
  cantidadEnBultos: 'N', vigenciaDesde: '2026-10-25T00:00:00', vigenciaHasta: '2026-11-30', condicionVenta: null };

test('list, discounted and fixed prices include IVA and preserve all offer conditions', () => {
  assert.equal(labels.labelFor(article).price, 3650);
  const offer = labels.labelFor(article, policy, 'Solo contado');
  assert.equal(offer.price, 3437.57);
  for (const text of ['Desde 8 unidades', 'Hasta 9999 unidades', 'Descuento 5.82%', '25/10/2026', '30/11/2026', 'Solo contado']) assert.ok(offer.conditions.includes(text));
  assert.equal(labels.labelFor(article, { ...policy, precio: 1000 }).price, 1210);
  assert.ok(labels.labelFor(article, { ...policy, cantidadEnBultos: 'S' }).conditions.includes('Desde 8 bultos'));
});

test('missing IVA, missing descriptions, invalid prices and unconverted bulto policies cannot print', () => {
  assert.throws(() => labels.labelFor({ ...article, ivaPorcentual: null }, policy), /IVA/);
  assert.throws(() => labels.labelFor({ ...article, precioConIva: NaN }), /IVA/);
  assert.throws(() => labels.labelFor({ ...article, descripcion: '' }), /descripción/);
  assert.throws(() => labels.labelFor(article, { ...policy, politicaPorBulto: 'S' }), /por bulto/);
  assert.throws(() => labels.labelFor(article, { ...policy, descuento: 101 }), /IVA/);
});

test('PDF has exact physical size, one page per copy and matching safe SVG preview', async () => {
  const offer = labels.labelFor(article, policy);
  const { doc, svg } = labels.buildPriceLabel(offer, { width: 58, height: 60, copies: 3 });
  assert.equal(doc.getNumberOfPages(), 3);
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 58) < .01);
  assert.ok(Math.abs(doc.internal.pageSize.getHeight() - 60) < .01);
  assert.ok(svg.includes('3.437,57'));
  assert.ok(svg.includes('viewBox="0 0 58 60"'));
  const escaped = labels.buildPriceLabel(labels.labelFor({ ...article, descripcion: '<script>& "COCA"' }), labels.defaultLabelSettings).svg;
  assert.ok(!escaped.includes('<script>')); assert.ok(escaped.includes('&lt;script&gt;&amp;'));
  await mkdir('tmp/pdfs', { recursive: true });
  await writeFile('tmp/pdfs/offer-label.pdf', Buffer.from(doc.output('arraybuffer')));
  const list = labels.buildPriceLabel(labels.labelFor(article), { width: 50, height: 30, copies: 1 });
  await writeFile('tmp/pdfs/list-label.pdf', Buffer.from(list.doc.output('arraybuffer')));
  const landscape = labels.buildPriceLabel(offer, { width: 80, height: 50, copies: 1 });
  assert.ok(Math.abs(landscape.doc.internal.pageSize.getWidth() - 80) < .01);
  await writeFile('tmp/pdfs/wide-label.pdf', Buffer.from(landscape.doc.output('arraybuffer')));
});

test('invalid dimensions, copies and content overflow are rejected instead of clipped', () => {
  const input = labels.labelFor(article);
  for (const settings of [{width:39,height:60,copies:1}, {width:58,height:101,copies:1}, {width:58,height:60,copies:1.5}, {width:58,height:60,copies:21}]) {
    assert.throws(() => labels.buildPriceLabel(input, settings));
  }
  assert.throws(() => labels.buildPriceLabel(labels.labelFor(article, policy, 'Condiciones adicionales '.repeat(20)), {width:40,height:30,copies:1}), /no entra/);
});

test('system printing contains only labels with no app UI; popup blocking is actionable', () => {
  const settings = { width:58, height:60, copies:2 };
  let html = '', printed = false;
  globalThis.window = { open: () => ({ document: {write: value => {html=value;}, close(){}}, focus(){}, print(){printed=true;} }) };
  try {
    labels.printPriceLabel(labels.buildPriceLabel(labels.labelFor(article), settings).svg, settings);
    assert.equal(printed, true);
    assert.equal((html.match(/class="label"/g) || []).length, 2);
    assert.ok(html.includes('size:58mm 60mm;margin:0'));
    assert.ok(!html.includes('Guardar relevamiento'));
    globalThis.window.open = () => null;
    assert.throws(() => labels.printPriceLabel('<svg/>', settings), /bloqueó/);
  } finally { delete globalThis.window; }
});

test('printer section starts with list price, editable dimensions and matching buttons', () => {
  const html = renderToStaticMarkup(createElement(Printer, {article,policies:[policy]}));
  for (const text of ['Imprimir etiqueta', 'Descargar PDF', 'Ancho (mm)', 'Alto (mm)', 'Copias', '10093', '3650']) {
    if (text !== '3650') assert.ok(html.includes(text));
  }
  assert.ok(html.includes('Vista previa de etiqueta del artículo 111'));
  assert.ok(!html.includes('Guardar control'));
});
