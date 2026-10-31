import { jsPDF } from 'jspdf';
import { discountedPolicyPrice } from './discountedPolicyPrice';

export type LabelArticle = { id: string; descripcion?: string; precioConIva: number | null; precioSinIva: number; ivaPorcentual: number | null };
export type LabelPolicy = {
  id: number; precio: number | null; descuento: number | null;
  cantidadMinima: number | null; cantidadMaxima: number | null; cantidadEnBultos: string | null;
  politicaPorBulto?: string | null; vigenciaDesde: string | null; vigenciaHasta: string | null;
  condicionVenta: string | null; dia?: string | null; motivosEvaluacion?: string[];
};
export type LabelSettings = { width: number; height: number; copies: number };
export type PriceLabel = { articleId: string; description: string; price: number; source: string; conditions: string };
export const defaultLabelSettings: LabelSettings = { width: 58, height: 60, copies: 1 };
const settingsKey = 'donato.price-label.v1';
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
export function labelFor(article: LabelArticle, policy?: LabelPolicy, additionalConditions = ''): PriceLabel {
  let price = article.precioConIva;
  const conditions: string[] = [];
  if (policy) {
    if (policy.politicaPorBulto === 'S') throw new Error('Esta política es por bulto. Falta validar la conversión antes de generar una etiqueta unitaria.');
    price = policy.precio != null
      ? discountedPolicyPrice(Number(policy.precio), 0, article.ivaPorcentual)?.gross ?? null
      : policy.descuento != null
        ? discountedPolicyPrice(Number(article.precioSinIva), Number(policy.descuento), article.ivaPorcentual)?.gross ?? null : null;
    const units = policy.cantidadEnBultos === 'S' ? 'bultos' : 'unidades';
    if (policy.cantidadMinima != null) conditions.push(`Desde ${policy.cantidadMinima} ${units}`);
    if (policy.cantidadMaxima != null) conditions.push(`Hasta ${policy.cantidadMaxima} ${units}`);
    if (policy.descuento != null && policy.precio == null) conditions.push(`Descuento ${policy.descuento}%`);
    conditions.push(`Vigencia: ${policyDate(policy.vigenciaDesde)} al ${policyDate(policy.vigenciaHasta)}`);
    if (policy.condicionVenta) conditions.push(`Condición de venta: ${policy.condicionVenta}`);
    if (policy.dia) conditions.push(`Día: ${policy.dia}`);
    if (additionalConditions.trim()) conditions.push(additionalConditions.trim());
  }
  if (price == null || !Number.isFinite(price) || price < 0) throw new Error('No hay un precio con IVA disponible para esta etiqueta.');
  if (!article.descripcion?.trim()) throw new Error('Falta la descripción del artículo para imprimir.');
  return { articleId: article.id, description: article.descripcion.trim(), price,
    source: policy ? `OFERTA · Política #${policy.id}` : 'Precio de lista · Unidad', conditions: conditions.join(' · ') };
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[value]!));
type TextLine = { text: string; y: number; size: number; bold: boolean };
// Shared millimetre layout keeps the preview, system print and PDF identical.
export function buildPriceLabel(label: PriceLabel, settings: LabelSettings) {
  validateLabelSettings(settings);
  const { width, height, copies } = settings;
  const doc = new jsPDF({ unit: 'mm', format: [width, height], orientation: width > height ? 'landscape' : 'portrait', compress: true });
  const inner = width - 6;
  const lines: TextLine[] = [];
  const add = (text: string, y: number, size: number, bold = false) => lines.push({ text, y, size, bold });
  const wrap = (text: string, size: number, bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    return doc.splitTextToSize(text, inner) as string[];
  };
  const compact = height < 40;
  add('DONATO', compact ? 4 : 5.5, compact ? 8 : 10, true);
  let descriptionSize = compact ? 9 : 12;
  let descriptionLines = wrap(label.description, descriptionSize, true);
  while (descriptionLines.length > (height < 40 ? 2 : 4) && descriptionSize > 8) {
    descriptionSize--; descriptionLines = wrap(label.description, descriptionSize, true);
  }
  let y = compact ? 8 : 10;
  for (const text of descriptionLines) { add(text, y, descriptionSize, true); y += descriptionSize * .4; }
  const price = label.price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }).replace(/\s/g, ' ');
  let priceSize = Math.min(compact ? 20 : 36, width * .55);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(priceSize);
  while (doc.getTextWidth(price) > inner && priceSize > 14) { priceSize--; doc.setFontSize(priceSize); }
  if (doc.getTextWidth(price) > inner) throw new Error('El precio no entra en la etiqueta. Aumentá el ancho.');
  y += priceSize * .35;
  add(price, y, priceSize, true); y += 3.4;
  add('Precio por unidad · IVA incluido', y, 7); y += 3.2;
  if (label.conditions || !compact) {
    for (const text of wrap(label.source, 7, true)) { add(text, y, 7, true); y += 2.8; }
  }
  const footerY = height - 2.5;
  if (label.conditions) {
    let conditionSize = 8;
    let conditionLines = wrap(label.conditions, conditionSize, false);
    while (y + conditionLines.length * conditionSize * .39 > footerY - 3 && conditionSize > 6) {
      conditionSize -= .5; conditionLines = wrap(label.conditions, conditionSize, false);
    }
    for (const text of conditionLines) { add(text, y, conditionSize); y += conditionSize * .39; }
  }
  if (y > footerY - 1) throw new Error('El contenido no entra en la etiqueta. Aumentá el alto o el ancho.');
  add(`Artículo ${label.articleId}${!label.conditions ? ' · Lista 4' : ''}`, footerY, 6);
  const draw = () => {
    doc.setTextColor(0);
    for (const line of lines) {
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal'); doc.setFontSize(line.size);
      doc.text(line.text, 3, line.y);
    }
  };
  for (let i = 0; i < copies; i++) {
    if (i) doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
    draw();
  }
  doc.setProperties({ title: `Etiqueta Donato - Artículo ${label.articleId}` });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${lines.map(line => `<text x="3" y="${line.y}" font-family="Helvetica,Arial,sans-serif" font-size="${line.size * 25.4 / 72}" font-weight="${line.bold ? 700 : 400}" fill="black">${escapeXml(line.text)}</text>`).join('')}</svg>`;
  return { doc, svg };
}

export function printPriceLabel(svg: string, settings: LabelSettings) {
  validateLabelSettings(settings);
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('El navegador bloqueó la impresión. Permití las ventanas emergentes o descargá el PDF.');
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiqueta Donato</title><style>@page{size:${settings.width}mm ${settings.height}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}.label{width:${settings.width}mm;height:${settings.height}mm;break-after:page;page-break-after:always;overflow:hidden}.label:last-child{break-after:auto;page-break-after:auto}svg{display:block}@media screen{body{background:#ddd}.label{margin:10px;background:white}}</style></head><body>${Array.from({length:settings.copies}, () => `<div class="label">${svg}</div>`).join('')}</body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}
