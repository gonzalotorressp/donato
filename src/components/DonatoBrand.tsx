type DonatoBrandProps = {
  subtitle?: string;
};

export function DonatoBrand({ subtitle = 'Operaciones' }: DonatoBrandProps) {
  return (
    <div className="brand-lockup">
      <div className="brand-mark donato-mark" aria-hidden="true">
        <span className="donato-word">donato</span>
        <span className="brand-dot dot-one" />
        <span className="brand-dot dot-two" />
        <span className="brand-dot dot-three" />
      </div>
      <div className="brand-copy">
        <strong>Donato</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
