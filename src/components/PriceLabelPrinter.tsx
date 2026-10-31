import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { buildPriceLabel, labelFor, printPriceLabel, readLabelSettings, rememberLabelSettings, type LabelArticle, type LabelPolicy, type LabelSettings } from '../lib/priceLabel';

export function PriceLabelPrinter({ article, policies, disabled = false }: { article: LabelArticle; policies: LabelPolicy[]; disabled?: boolean }) {
  const [settings, setSettings] = useState(readLabelSettings);
  const [selection, setSelection] = useState('lista');
  const [confirmed, setConfirmed] = useState(false);
  const [conditions, setConditions] = useState('');
  const [message, setMessage] = useState('');
  const policy = selection === 'lista' ? undefined : policies.find(item => String(item.id) === selection);
  const built = useMemo(() => {
    try {
      if (selection !== 'lista' && !policy) throw new Error('La política seleccionada ya no está disponible.');
      return { value: buildPriceLabel(labelFor(article, policy, conditions), settings), error: '' };
    } catch (error) { return { value: null, error: error instanceof Error ? error.message : 'No se pudo generar la etiqueta.' }; }
  }, [article, policy, selection, conditions, settings]);
  // Confirmation is tied to the exact policy content, including refreshed conditions.
  const fingerprint = JSON.stringify(policy);
  const [confirmedFingerprint, setConfirmedFingerprint] = useState('');
  const ready = !disabled && built.value != null && (!policy || (confirmed && confirmedFingerprint === fingerprint));
  function setting(field: keyof LabelSettings, value: string) {
    setSettings(current => ({ ...current, [field]: Number(value) })); setMessage('');
  }
  function output(mode: 'print' | 'pdf') {
    if (!ready || !built.value) return;
    try {
      rememberLabelSettings(settings);
      if (mode === 'print') {
        printPriceLabel(built.value.svg, settings);
        setMessage('Se abrió el diálogo de impresión. Elegí la impresora y usá escala 100%, sin márgenes ni encabezados.');
      } else {
        built.value.doc.save(`donato-etiqueta-${article.id}.pdf`);
        setMessage('PDF generado. Podés abrirlo desde la aplicación de tu impresora.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo preparar la impresión.'); }
  }
  return <section className="price-label-section" aria-label="Imprimir etiqueta">
    <h2>Imprimir etiqueta</h2>
    <label>Precio para la etiqueta
      <select value={selection} disabled={disabled} onChange={event => { setSelection(event.target.value); setConfirmed(false); setConditions(''); setMessage(''); }}>
        <option value="lista">Precio de lista con IVA</option>
        {policies.map(item => <option key={item.id} value={String(item.id)}>Oferta · Política #{item.id}</option>)}
      </select>
    </label>
    {policy && <>
      <label>Otras condiciones del cartel (si corresponde)
        <textarea value={conditions} maxLength={500} disabled={disabled} placeholder="Ej.: solo contado, días o restricciones adicionales"
          onChange={event => { setConditions(event.target.value); setConfirmed(false); }}/>
      </label>
      <p className="price-label-help">Verificá la vigencia, cantidades y condiciones de esta política en Sigma antes de imprimir.</p>
      <label className="price-label-confirm"><input type="checkbox" checked={confirmed && confirmedFingerprint === fingerprint} disabled={disabled}
        onChange={event => { setConfirmed(event.target.checked); setConfirmedFingerprint(fingerprint); }}/>
        Confirmé que la oferta está vigente y que el cartel incluye todas sus condiciones.</label>
    </>}
    <div className="price-label-settings">
      <label>Ancho (mm)<input type="number" min={40} max={100} step={1} value={settings.width || ''} disabled={disabled} onChange={event => setting('width', event.target.value)}/></label>
      <label>Alto (mm)<input type="number" min={30} max={100} step={1} value={settings.height || ''} disabled={disabled} onChange={event => setting('height', event.target.value)}/></label>
      <label>Copias<input type="number" min={1} max={20} step={1} value={settings.copies || ''} disabled={disabled} onChange={event => setting('copies', event.target.value)}/></label>
    </div>
    {built.value && <figure className="price-label-preview"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.value.svg)}`} alt={`Vista previa de etiqueta del artículo ${article.id}`}/><figcaption>{settings.width} × {settings.height} mm · {settings.copies} {settings.copies === 1 ? 'copia' : 'copias'}</figcaption></figure>}
    {built.error && <p role="alert">{built.error}</p>}
    <div className="price-label-actions">
      <button type="button" disabled={!ready} onClick={() => output('print')}><Printer size={18}/>Imprimir etiqueta</button>
      <button type="button" disabled={!ready} onClick={() => output('pdf')}><Download size={18}/>Descargar PDF</button>
    </div>
    <p className="price-label-help">Usá el tamaño real de tu etiqueta y escala 100%. Para imprimir desde el teléfono, la impresora debe estar configurada en su servicio de impresión. Si usa una app propia, descargá el PDF y abrilo allí.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}
