import donatoLogo from '../../logo donato.jpg';

type DonatoBrandProps = {
  subtitle?: string;
};

export function DonatoBrand({ subtitle = 'Operaciones' }: DonatoBrandProps) {
  return (
    <div className="brand-lockup">
      <div className="brand-mark donato-mark">
        <img
          className="donato-logo-image"
          src={donatoLogo}
          alt="Logo Donato"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%' }}
        />
      </div>
      <div className="brand-copy">
        <strong>Donato</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
