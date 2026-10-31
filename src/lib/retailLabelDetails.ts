import JsBarcode from 'jsbarcode';

export type ContentUnit = 'ml' | 'l' | 'g' | 'kg' | 'unidad';
export type RetailLabelDetails = { ean: string; unitsPerCase: string; quantity: string; unit: ContentUnit };
export function suggestedLabelContent(description: string): { quantity: string; unit: ContentUnit } {
  // A suggestion only: X6/X12 in descriptions can mean a logistical case,
  // rather than the contents of the unit being sold. The operator confirms it.
  const matches = [...description.toUpperCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(KG|KGS|GRS|GR|G|ML|CC|LTS|LT|L)(?![A-Z])/g)];
  if (matches.length !== 1) return { quantity: '', unit: 'unidad' };
  const [, amount, raw] = matches[0];
  const unit: ContentUnit = /^(CC|ML)$/.test(raw) ? 'ml' : /^(LT|LTS|L)$/.test(raw) ? 'l' : /^(KG|KGS)$/.test(raw) ? 'kg' : 'g';
  return { quantity: amount.replace('.', ','), unit };
}
export function barcodeData(value: string) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(value)) throw new Error('Ingresá el EAN de la unidad (8 o 13 dígitos, o UPC de 12), conservando sus ceros iniciales.');
  const format = value.length === 8 ? 'EAN8' : value.length === 12 ? 'UPC' : 'EAN13';
  const encoded: { encodings?: { data: string }[] } = {};
  try { JsBarcode(encoded, value, { format, displayValue: false, flat: true }); }
  catch { throw new Error('El EAN no es válido: revisá el número y su dígito verificador.'); }
  const data = encoded.encodings?.map(item => item.data).join('') || '';
  const expectedLength = value.length === 8 ? 67 : 95;
  if (data.length !== expectedLength || !/^[01]+$/.test(data)) throw new Error('No se pudo generar el código de barras.');
  return { data, format, quietLeft: format === 'EAN13' ? 11 : format === 'UPC' ? 9 : 7, quietRight: format === 'UPC' ? 9 : 7 };
}
export function referenceContent(details: RetailLabelDetails) {
  const amount = Number(details.quantity.trim().replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:[.,]\d{1,6})?$/.test(details.quantity.trim())) throw new Error('Indicá el contenido positivo de la unidad de venta (hasta 6 decimales).');
  if (!['ml', 'l', 'g', 'kg', 'unidad'].includes(details.unit)) throw new Error('Elegí la unidad del contenido.');
  const quantity = details.unit === 'g' || details.unit === 'ml' ? amount / 1000 : amount;
  const unit = details.unit === 'g' || details.unit === 'kg' ? 'kilo' : details.unit === 'ml' || details.unit === 'l' ? 'litro' : 'unidad';
  return { quantity, unit, text: `${amount.toLocaleString('es-AR', { maximumFractionDigits: 6 })} ${details.unit === 'unidad' ? 'unidades' : details.unit}` };
}
