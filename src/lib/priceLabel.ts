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
export const defaultLabelSettings: LabelSettings = { width: 80, height: 39, copies: 1 };
const settingsKey = 'donato.price-label.v3';
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
type TextLine = { text: string; y: number; size: number; bold: boolean; x: number; center?: boolean };
// Shared millimetre layout keeps the preview, system print and PDF identical.
export function buildPriceLabel(label: PriceLabel, settings: LabelSettings) {
  validateLabelSettings(settings);
  const { width, height, copies } = settings;
  const doc = new jsPDF({ unit: 'mm', format: [width, height], orientation: width > height ? 'landscape' : 'portrait', compress: true });
  const margin = width >= 76 ? 4 : 2.5;
  const inner = width - 2 * margin;
  const lines: TextLine[] = [];
  const add = (text: string, x: number, y: number, size: number, bold = false, center = false) => lines.push({ text, x, y, size, bold, center });
  const wrap = (text: string, size: number, bold: boolean, available = inner) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    return doc.splitTextToSize(text, available) as string[];
  };
  let descriptionSize = 10;
  let descriptionLines = wrap(label.description, descriptionSize, true);
  while (descriptionLines.length > 2 && descriptionSize > 8) {
    descriptionSize--; descriptionLines = wrap(label.description, descriptionSize, true);
  }
  if (descriptionLines.length > 2) throw new Error('La descripción no entra. Aumentá el ancho de la etiqueta.');
  let descriptionY = 4.8;
  for (const text of descriptionLines) { add(text, margin, descriptionY, descriptionSize, true); descriptionY += descriptionSize * .38; }
  const bodyTop = descriptionY - descriptionSize * .38 + 2.4;
  const rightX = width * .54;
  const rightWidth = width - margin - rightX;
  const priceWidth = rightX - margin - 2;
  const price = label.price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }).replace(/\s/g, ' ');
  let priceSize = 30;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(priceSize);
  while (doc.getTextWidth(price) > priceWidth && priceSize > 14) { priceSize--; doc.setFontSize(priceSize); }
  if (doc.getTextWidth(price) > priceWidth) throw new Error('El precio no entra en la etiqueta. Aumentá el ancho.');
  const priceY = bodyTop + 8.2;
  add(price, margin, priceY, priceSize, true);
  const caption = wrap('Precio final · IVA incluido', 6.5, false, priceWidth);
  let leftBottom = priceY + 2.6;
  for (const text of caption) { add(text, margin, leftBottom, 6.5); leftBottom += 2.5; }
  leftBottom -= 2.5;
  const pesos = (value: number) => value.toLocaleString('es-AR', {style:'currency',currency:'ARS'}).replace(/\s/g, ' ');
  let rightY = bodyTop + 1.7;
  for (const text of [`Precio sin IVA: ${pesos(label.netPrice)}`, `Por ${label.referenceUnit}: ${pesos(label.referencePrice)}`,
    `Contenido: ${label.content}`, `Unidades por caja: ${label.unitsPerCase}`]) {
    for (const part of wrap(text, 6.5, false, rightWidth)) { add(part, rightX, rightY, 6.5); rightY += 2.7; }
  }
  let bodyBottom = Math.max(leftBottom, rightY - 2.7);
  const barcode = barcodeData(label.ean);
  const module = Math.min(.66, inner / (barcode.data.length + barcode.quietLeft + barcode.quietRight));
  if (module < .264) throw new Error('El EAN necesita una etiqueta más ancha para conservar su lectura.');
  // Shelf labels have a short physical holder. Preserve the encoded modules and
  // quiet zones while using a compact bar height; validate the printed reader too.
  const barHeight = 7.5;
  const guardExtension = 5 * module;
  const barcodeBottom = height - 4.2;
  const barcodeTop = barcodeBottom - barHeight - guardExtension;
  const barcodeLeft = (width - (barcode.data.length + barcode.quietLeft + barcode.quietRight) * module) / 2 + barcode.quietLeft * module;
  if (label.conditions) {
    const conditionSize = 6.5;
    const conditionLines = wrap(`${label.source} · ${label.conditions}`, conditionSize, false);
    let y = bodyBottom + 2.5;
    for (const text of conditionLines) { add(text, margin, y, conditionSize); y += 2.4; }
    bodyBottom = y - 2.4;
  }
  if (bodyBottom + .7 > barcodeTop) throw new Error('El contenido no entra en el fleje. Aumentá el ancho o elegí un alto mayor; no se recortan textos ni condiciones.');
  add(label.ean, width / 2, height - 1.2, 7, false, true);
  const brand = `DONATO · Art. ${label.articleId}`;
  doc.setFont('helvetica','normal');doc.setFontSize(5.5);
  const eanWidth = doc.getTextWidth(label.ean) * 7 / 5.5;
  if (margin + doc.getTextWidth(brand) + 2 < (width - eanWidth) / 2) add(brand, margin, height - 1.2, 5.5);
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
      doc.text(line.text, line.x, line.y, {align: line.center ? 'center' : 'left'});
    }
  };
  for (let i = 0; i < copies; i++) {
    if (i) doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
    draw();
  }
  doc.setProperties({ title: `Etiqueta Donato - Artículo ${label.articleId}` });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${bars.map(bar => `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="black"/>`).join('')}${lines.map(line => `<text x="${line.x}" y="${line.y}" text-anchor="${line.center ? 'middle' : 'start'}" font-family="Helvetica,Arial,sans-serif" font-size="${line.size * 25.4 / 72}" font-weight="${line.bold ? 700 : 400}" fill="black">${escapeXml(line.text)}</text>`).join('')}</svg>`;
  return { doc, svg, barcodeBounds: {x:barcodeLeft,y:barcodeTop,width:barcode.data.length*module,height:barHeight+guardExtension,module} };
}

export function printPriceLabel(svg: string, settings: LabelSettings) {
  validateLabelSettings(settings);
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('El navegador bloqueó la impresión. Permití las ventanas emergentes o descargá el PDF.');
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiqueta Donato</title><style>@page{size:${settings.width}mm ${settings.height}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}.label{width:${settings.width}mm;height:${settings.height}mm;break-after:page;page-break-after:always;overflow:hidden}.label:last-child{break-after:auto;page-break-after:auto}svg{display:block}@media screen{body{background:#ddd}.label{margin:10px;background:white}}</style></head><body>${Array.from({length:settings.copies}, () => `<div class="label">${svg}</div>`).join('')}</body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}

