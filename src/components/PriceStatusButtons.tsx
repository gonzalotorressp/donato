import { CheckCircle2, EyeOff, XCircle } from 'lucide-react';

export type PriceCheckStatus = 'ok' | 'error' | 'missing';

const OPTIONS = [
  { value: 'ok' as const, label: 'Precio correcto', Icon: CheckCircle2, color: '#15803d', background: '#dcfce7' },
  { value: 'error' as const, label: 'Precio incorrecto', Icon: XCircle, color: '#b91c1c', background: '#fee2e2' },
  { value: 'missing' as const, label: 'Precio no presente', Icon: EyeOff, color: '#a16207', background: '#fef3c7' },
];

export function PriceStatusButtons({ status, onChange, label, disabled = false }: {
  status: PriceCheckStatus | null;
  onChange: (status: PriceCheckStatus) => void;
  label: string;
  disabled?: boolean;
}) {
  return <div role="group" aria-label={label} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {OPTIONS.map(({ value, label: optionLabel, Icon, color, background }) => <button
      key={value} type="button" title={optionLabel} aria-label={optionLabel}
      aria-pressed={status === value} disabled={disabled} onClick={() => onChange(value)}
      style={{ width: 54, height: 54, display: 'grid', placeItems: 'center', borderRadius: 12,
        border: status === value ? '3px solid ' + color : '1px solid #cbd5e1',
        background: status === value ? background : '#fff', color,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.65 : 1 }}>
      <Icon size={28}/>
    </button>)}
  </div>;
}
