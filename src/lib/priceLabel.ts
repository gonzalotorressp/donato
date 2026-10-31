import { jsPDF } from 'jspdf';
import { discountedPolicyPrice } from './discountedPolicyPrice';
import { barcodeData, referenceContent, suggestedLabelContent, type RetailLabelDetails } from './retailLabelDetails';

export type LabelArticle = { id: string; descripcion?: string; precioConIva: number | null; precioSinIva: number; ivaPorcentual: number | null;
  eanUnidad?: string | null; unidadesPorBulto?: number | null; etiquetaActualizada?: string | null; etiquetaAviso?: string };
export type LabelPolicy = {
  id: number; precio: number | null; descuento: number | null;
  cantidadMinima: number | null; cantidadMaxima: number | null; cantidadEnBultos: string | null;
  politicaPorBulto?: string | null; vigenciaDesde: string | null; vigenciaHasta: string | null;
  condicionVenta: string | null; dia?: string | null; motivosEvaluacion?: string[];
};
export type LabelSettings = { width: number; height: number; copies: number };
export type PriceLabel = { articleId: string; description: string; price: number; netPrice: number; source: string; conditions: string;
  ean: string; unitsPerCase: number; referencePrice: number; referenceUnit: string; content: string };
export const defaultLabelSettings: LabelSettings = { width: 80, height: 80, copies: 1 };
const settingsKey = 'donato.price-label.v2';
export function validateLabelSettings(value: LabelSettings) {
  if (!Number.isFinite(value.width) || value.width < 40 || value.width > 100 ||
      !Number.isFinite(value.height) || value.height < 30 || value.height > 100 ||
      !Number.isInteger(value.copies) || value.copies < 1 || value.copies > 20) {
    throw new Error('Elegí un ancho de 40 a 100 mm, alto de 30 a 100 mm y de 1 a 20 copias.');
  }
}
export function readLabelSettings(): LabelSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || 'null');
    if (saved) { validateLabelSettings(saved); return { width: saved.width, height: saved.height, copies: saved.copies }; }
  } catch { /* Preferencias locales opcionales. */ }
  return { ...defaultLabelSettings };
}
export function rememberLabelSettings(value: LabelSettings) {
  validateLabelSettings(value);
  try { localStorage.setItem(settingsKey, JSON.stringify(value)); } catch { /* La impresión sigue disponible. */ }
}
function policyDate(value: string | null) {
  if (!value) return 'sin informar';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
export function defaultRetailDetails(article: LabelArticle): RetailLabelDetails {
  return { ean: article.eanUnidad || '', unitsPerCase: article.unidadesPorBulto == null ? '' : String(article.unidadesPorBulto),
    ...suggestedLabelContent(article.descripcion || '') };
}
export function labelFor(article: LabelArticle, policy?: LabelPolicy, additionalConditions = '', details = defaultRetailDetails(article)): PriceLabel {
  let price = article.precioConIva;
  let netPrice = Number(article.precioSinIva);
  const conditions: string[] = [];
  if (policy) {
    if (policy.politicaPorBulto === 'S') throw new Error('Esta política es por bulto. Falta validar la conversión antes de generar una etiqueta unitaria.');
    const calculated = policy.precio != null
      ? discountedPolicyPrice(Number(policy.precio), 0, article.ivaPorcentual)
      : policy.descuento != null
        ? discountedPolicyPrice(Number(article.precioSinIva), Number(policy.descuento), article.ivaPorcentual) : null;
    price = calculated?.gross ?? null;
    netPrice = calculated?.net ?? NaN;
    const units = policy.cantidadEnBultos === 'S' ? 'bultos' : 'unidades';
    if (policy.cantidadMinima != null) conditions.push(`Desde ${policy.cantidadMinima} ${units}`);
    if (policy.cantidadMaxima != null) conditions.push(`Hasta ${policy.cantidadMaxima} ${units}`);
    if (policy.descuento != null && policy.precio == null) conditions.push(`Descuento ${policy.descuento}%`);
    conditions.push(`Vigencia: ${policyDate(policy.vigenciaDesde)} al ${policyDate(policy.vigenciaHasta)}`);
    if (policy.condicionVenta != null) conditions.push(`Condición de venta: ${policy.condicionVenta}`);
    if (policy.dia != null) conditions.push(`Día: ${policy.dia}`);
    if (additionalConditions.trim()) conditions.push(additionalConditions.trim());
  }
  if (price == null || !Number.isFinite(price) || price < 0) throw new Error('No hay un precio con IVA disponible para esta etiqueta.');
  if (!article.descripcion?.trim()) throw new Error('Falta la descripción del artículo para imprimir.');
  if (!Number.isFinite(netPrice) || netPrice < 0) throw new Error('No hay un precio sin IVA válido para esta etiqueta.');
  const ean = details.ean.trim(); barcodeData(ean);
  const unitsPerCase = Number(details.unitsPerCase);
  if (!/^\d+$/.test(details.unitsPerCase) || !Number.isSafeInteger(unitsPerCase) || unitsPerCase < 1) throw new Error('Indicá las unidades por caja (un entero positivo).');
  const content = referenceContent(details);
  const referencePrice = Math.round((price / content.quantity + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(referencePrice)) throw new Error('No se pudo calcular el precio por medida.');
  return { articleId: article.id, description: article.descripcion.trim(), price, netPrice,
    ean, unitsPerCase, referencePrice, referenceUnit: content.unit, content: content.text,
    source: policy ? `OFERTA · Política #${policy.id}` : 'Precio de lista · Unidad', conditions: conditions.join(' · ') };
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[value]!));
type TextLine = { text: string; y: number; size: number; bold: boolean; x?: number };
// Shared millimetre layout keeps the preview, system print and PDF identical.
export function buildPriceLabel(label: PriceLabel, settings: LabelSettings) {
  validateLabelSettings(settings);
  const { width, height, copies } = settings;
  const doc = new jsPDF({ unit: 'mm', format: [width, height], orientation: width > height ? 'landscape' : 'portrait', compress: true });
  const margin = width >= 76 ? 4 : 3;
  const inner = width - 2 * margin;
  const lines: TextLine[] = [];
  const add = (text: string, y: number, size: number, bold = false) => lines.push({ text, y, size, bold });
  const wrap = (text: string, size: number, bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    return doc.splitTextToSize(text, inner) as string[];
  };
  const heading = `DONATO · Art. ${label.articleId} · ${label.conditions ? label.source : 'Lista 4'}`;
  let headingSize = 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(headingSize);
  while (doc.getTextWidth(heading) > inner && headingSize > 6) { headingSize -= .5; doc.setFontSize(headingSize); }
  if (doc.getTextWidth(heading) > inner) throw new Error('El encabezado no entra en la etiqueta. Aumentá el ancho.');
  add(heading, 5.5, headingSize, true);
  let descriptionSize = width < 60 ? 10 : 12;
  let descriptionLines = wrap(label.description, descriptionSize, true);
  while (descriptionLines.length > 2 && descriptionSize > 8) {
    descriptionSize--; descriptionLines = wrap(label.description, descriptionSize, true);
  }
  let y = 10;
  for (const text of descriptionLines) { add(text, y, descriptionSize, true); y += descriptionSize * .4; }
  const price = label.price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }).replace(/\s/g, ' ');
  let priceSize = Math.min(36, width * .55);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(priceSize);
  while (doc.getTextWidth(price) > inner && priceSize > 14) { priceSize--; doc.setFontSize(priceSize); }
  if (doc.getTextWidth(price) > inner) throw new Error('El precio no entra en la etiqueta. Aumentá el ancho.');
  y += priceSize * .35;
  add(price, y, priceSize, true); y += 3.4;
  add('Precio final por unidad de venta · IVA incluido', y, 7); y += 3.2;
  const pesos = (value: number) => value.toLocaleString('es-AR', {style:'currency',currency:'ARS'}).replace(/\s/g, ' ');
  const packageDetails = width < 76 ? [`Contenido: ${label.content}`, `Unidades por caja: ${label.unitsPerCase}`]
    : [`Contenido: ${label.content} · Unidades por caja: ${label.unitsPerCase}`];
  for (const text of [`Precio sin IVA: ${pesos(label.netPrice)}`, `Precio por ${label.referenceUnit}: ${pesos(label.referencePrice)}`, ...packageDetails]) {
    for (const part of wrap(text, 8, false)) { add(part, y, 8); y += 3.1; }
  }
  const barcode = barcodeData(label.ean);
  const module = Math.min(.33, inner / (barcode.data.length + barcode.quietLeft + barcode.quietRight));
  if (module < .264) throw new Error('El EAN necesita una etiqueta más ancha para conservar su lectura.');
  const barHeight = (barcode.format === 'EAN8' ? 18.23 : 22.85) * module / .33;
  const guardExtension = 5 * module;
  const barcodeBottom = height - 5.5;
  const barcodeTop = barcodeBottom - barHeight - guardExtension;
  const barcodeLeft = (width - (barcode.data.length + barcode.quietLeft + barcode.quietRight) * module) / 2 + barcode.quietLeft * module;
  if (label.conditions) {
    let conditionSize = 8;
    let conditionLines = wrap(label.conditions, conditionSize, false);
    while (y + conditionLines.length * conditionSize * .39 > barcodeTop - 2 && conditionSize > 6) {
      conditionSize -= .5; conditionLines = wrap(label.conditions, conditionSize, false);
    }
    for (const text of conditionLines) { add(text, y, conditionSize); y += conditionSize * .39; }
  }
  if (y > barcodeTop - 1) throw new Error('El contenido no entra en la etiqueta. Aumentá el alto o el ancho (sugerido: 80 × 80 mm).');
  lines.push({ text: label.ean, x: width / 2, y: barcodeBottom + 3, size: 8, bold: false });
  const bars = [...barcode.data].flatMap((value, index) => {
    if (value !== '1') return [];
    const middle = barcode.format === 'EAN8' ? 31 : 45;
    const guard = index < 3 || index >= middle && index < middle + 5 || index >= barcode.data.length - 3;
    return [{ x: barcodeLeft + index * module, y: barcodeTop, width: module, height: barHeight + (guard ? guardExtension : 0) }];
  });
  const draw = () => {
    doc.setTextColor(0);
    doc.setFillColor('#000000');
    for (const bar of bars) doc.rect(bar.x, bar.y, bar.width, bar.height, 'F');
    for (const line of lines) {
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal'); doc.setFontSize(line.size);
      doc.text(line.text, line.x ?? margin, line.y, {align: line.x ? 'center' : 'left'});
    }
  };
  for (let i = 0; i < copies; i++) {
    if (i) doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
    draw();
  }
  doc.setProperties({ title: `Etiqueta Donato - Artículo ${label.articleId}` });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${bars.map(bar => `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="black"/>`).join('')}${lines.map(line => `<text x="${line.x ?? margin}" y="${line.y}" text-anchor="${line.x ? 'middle' : 'start'}" font-family="Helvetica,Arial,sans-serif" font-size="${line.size * 25.4 / 72}" font-weight="${line.bold ? 700 : 400}" fill="black">${escapeXml(line.text)}</text>`).join('')}</svg>`;
  return { doc, svg };
}

export function printPriceLabel(svg: string, settings: LabelSettings) {
  validateLabelSettings(settings);
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('El navegador bloqueó la impresión. Permití las ventanas emergentes o descargá el PDF.');
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiqueta Donato</title><style>@page{size:${settings.width}mm ${settings.height}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}.label{width:${settings.width}mm;height:${settings.height}mm;break-after:page;page-break-after:always;overflow:hidden}.label:last-child{break-after:auto;page-break-after:auto}svg{display:block}@media screen{body{background:#ddd}.label{margin:10px;background:white}}</style></head><body>${Array.from({length:settings.copies}, () => `<div class="label">${svg}</div>`).join('')}</body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}
