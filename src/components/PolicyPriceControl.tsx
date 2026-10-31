import { useId } from 'react';
import { PriceStatusButtons } from './PriceStatusButtons';
import type { PolicyControlDraft } from '../lib/priceSurvey';

export function PolicyPriceControl({ policyId, value, onChange, disabled = false }: {
  policyId: number; value: PolicyControlDraft;
  onChange: (value: PolicyControlDraft) => void; disabled?: boolean;
}) {
  const inputId = useId();
  return <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #dce3ec', display: 'grid', gap: 10 }}>
    <PriceStatusButtons label={'Estado de la etiqueta de la política ' + policyId}
      status={value.status} disabled={disabled} onChange={status => onChange({ ...value, status })}/>
    {value.status && <p role="status" style={{ margin: 0, fontSize: 13 }}>
      {value.status === 'ok' ? '✓ Precio correcto' : value.status === 'error' ? '✕ Precio incorrecto' : '— Precio no presente'} · Se guardará con el relevamiento.
    </p>}
    {value.status === 'error' && <label htmlFor={inputId}>Precio observado (opcional)
      <input id={inputId} value={value.observedPrice} disabled={disabled} inputMode="decimal"
        onChange={event => onChange({ ...value, observedPrice: event.target.value })} placeholder="Ej.: 1950,00"
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }}/>
    </label>}
  </div>;
}
