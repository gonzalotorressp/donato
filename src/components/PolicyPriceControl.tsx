import { useId, useState } from 'react';
import { PriceStatusButtons, type PriceCheckStatus } from './PriceStatusButtons';

export function PolicyPriceControl({ policyId, onSave }: {
  policyId: number;
  onSave: (status: PriceCheckStatus, observedPrice: number | null) => Promise<void>;
}) {
  const inputId = useId();
  const [status, setStatus] = useState<PriceCheckStatus | null>(null);
  const [observedPrice, setObservedPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  return <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #dce3ec', display: 'grid', gap: 10 }}>
    <PriceStatusButtons label={'Estado de la etiqueta de la política ' + policyId}
      status={status} disabled={saving} onChange={value => { setStatus(value); setMessage(''); }}/>
    {status && <p role="status" style={{ margin: 0, fontSize: 13 }}>
      {status === 'ok' ? '✓ Precio correcto' : status === 'error' ? '✕ Precio incorrecto' : '— Precio no presente'} · Selección sin guardar.
    </p>}
    {status === 'error' && <label htmlFor={inputId}>Precio observado (opcional)
      <input id={inputId} value={observedPrice} disabled={saving} inputMode="decimal"
        onChange={event => setObservedPrice(event.target.value)} placeholder="Ej.: 1950,00"
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }}/>
    </label>}
    <button type="button" className="primary-button" disabled={!status || saving} onClick={async () => {
      if (!status || saving) return;
      setSaving(true); setMessage('');
      try {
        const amount = status === 'error' ? observedPrice.trim().replace(',', '.') : '';
        if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('Precio observado inválido');
        await onSave(status, amount ? Number(amount) : null);
        setStatus(null); setObservedPrice(''); setMessage('Control de política guardado');
      } catch (error) {
        setMessage('Error al guardar: ' + (error instanceof Error ? error.message : String(error)));
      } finally { setSaving(false); }
    }}>{saving ? 'Guardando…' : 'Guardar control de política'}</button>
    {message && <p role="status" style={{ margin: 0, fontSize: 13 }}>{message}</p>}
  </div>;
}
