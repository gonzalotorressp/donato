import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  CreditCard,
  LogOut,
  ReceiptText,
  ShieldCheck,
  Store,
  WalletCards,
} from 'lucide-react';
import type { UserProfile } from './auth/userProfile';

type ClosureStatus = 'BORRADOR' | 'PENDIENTE_VALIDACION' | 'CERRADO' | 'AJUSTES_AUTORIZADOS';

type Props = {
  profile: UserProfile;
  onSignOut: () => void;
};

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });

const sigma = {
  venta: 2964770.43,
  efectivo: 666287.95,
  cloverDirecto: 492124.19,
  naranja: 49499.48,
  payway: 1431793.93,
  cuentaCorriente: 268881.38,
  pendienteContado: 56183.5,
  retiros: 273800,
};

function NumberInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (value: number) => void; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="money-input"><span>$</span><input type="number" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} /></div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Metric({ label, value, tone = 'default', note }: { label: string; value: number; tone?: 'default' | 'ok' | 'warn'; note?: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export default function App({ profile, onSignOut }: Props) {
  const [status, setStatus] = useState<ClosureStatus>('BORRADOR');
  const [cloverFisico, setCloverFisico] = useState(540451.2);
  const [paywayFisico, setPaywayFisico] = useState(1431793.93);
  const [depositario1, setDepositario1] = useState(230000);
  const [depositario2, setDepositario2] = useState(437000);
  const [retirosSupervisor, setRetirosSupervisor] = useState(0);
  const [cashback, setCashback] = useState(0);
  const [cierreEfectivo, setCierreEfectivo] = useState(600);
  const [cuentaCorrienteOk, setCuentaCorrienteOk] = useState(true);
  const [approved, setApproved] = useState(false);

  const isSupervisor = profile.rol === 'supervisor_caja' || profile.rol === 'administrador';
  const isApprover = profile.rol === 'encargado_donato' || profile.rol === 'administrador';
  const cloverSigmaConciliable = sigma.cloverDirecto + sigma.naranja;
  const retirosFisicos = depositario1 + depositario2 + retirosSupervisor + cierreEfectivo;
  const diferenciaClover = cloverFisico - cloverSigmaConciliable;
  const diferenciaPayway = paywayFisico - sigma.payway;
  const diferenciaRetiros = retirosFisicos - sigma.retiros;

  // Si Clover físico es menor a Sigma, proponemos llevar esa diferencia a efectivo.
  const reclasificacionCloverAEfectivo = Math.max(0, -diferenciaClover);
  const efectivoEsperadoCorregido = sigma.efectivo + reclasificacionCloverAEfectivo - cashback;
  const diferenciaEfectivo = retirosFisicos - efectivoEsperadoCorregido;

  const hasDifferences = useMemo(() => {
    const tolerance = 0.01;
    return Math.abs(diferenciaClover) > tolerance || Math.abs(diferenciaPayway) > tolerance || Math.abs(diferenciaRetiros) > tolerance || Math.abs(diferenciaEfectivo) > tolerance || !cuentaCorrienteOk;
  }, [diferenciaClover, diferenciaPayway, diferenciaRetiros, diferenciaEfectivo, cuentaCorrienteOk]);

  const submitClosure = () => {
    setApproved(false);
    setStatus(hasDifferences ? 'PENDIENTE_VALIDACION' : 'CERRADO');
  };

  const approveAdjustments = () => {
    setApproved(true);
    setStatus('AJUSTES_AUTORIZADOS');
  };

  const roleLabel = profile.rol === 'supervisor_caja' ? 'Supervisor de Caja' : profile.rol === 'encargado_donato' ? 'Encargado Donato' : 'Administrador';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup sidebar-brand"><div className="brand-mark"><Store size={24} /></div><div><strong>Donato</strong><span>Operaciones</span></div></div>
        <nav>
          <button className="nav-item active"><ClipboardCheck size={18} /> Cierre de caja</button>
          <button className="nav-item" disabled><Clock3 size={18} /> Historial</button>
          <button className="nav-item" disabled><ArrowRightLeft size={18} /> Ajustes</button>
        </nav>
        <div className="sidebar-user">
          <span>{roleLabel}</span>
          <strong>{profile.nombre || profile.email}</strong>
          <button onClick={onSignOut}><LogOut size={16} /> Salir</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">CIERRE DE JORNADA</p><h1>Rodrigo · Caja 2</h1><p>11 de septiembre de 2026 · Caso de conciliación</p></div>
          <div className={`status-pill status-${status.toLowerCase()}`}>{status.replaceAll('_', ' ')}</div>
        </header>

        <section className="summary-strip">
          <Metric label="Venta Sigma" value={sigma.venta} />
          <Metric label="Efectivo Sigma" value={sigma.efectivo} />
          <Metric label="Cuenta corriente" value={sigma.cuentaCorriente} />
          <Metric label="Contado pendiente" value={sigma.pendienteContado} tone="warn" note="Requiere revisar comprobante" />
        </section>

        <div className="content-grid">
          <section className="panel physical-panel">
            <div className="panel-heading"><div><p className="eyebrow">1 · FÍSICO</p><h2>Lo que recibe el supervisor</h2></div><ShieldCheck size={22} /></div>

            <div className="form-section">
              <h3><CreditCard size={18} /> Cierres de lote</h3>
              <div className="two-cols">
                <NumberInput label="Clover" value={cloverFisico} onChange={setCloverFisico} hint="Cierre físico del lote" />
                <NumberInput label="Payway" value={paywayFisico} onChange={setPaywayFisico} hint="Cierre físico del lote" />
              </div>
            </div>

            <div className="form-section">
              <h3><ReceiptText size={18} /> Tickets / retiros de efectivo</h3>
              <div className="two-cols">
                <NumberInput label="Depositario · Ticket 1" value={depositario1} onChange={setDepositario1} />
                <NumberInput label="Depositario · Ticket 2" value={depositario2} onChange={setDepositario2} />
                <NumberInput label="Retiros supervisores" value={retirosSupervisor} onChange={setRetirosSupervisor} />
                <NumberInput label="Efectivo cierre de caja" value={cierreEfectivo} onChange={setCierreEfectivo} />
              </div>
              <div className="inline-total"><span>Total efectivo rendido</span><strong>{money.format(retirosFisicos)}</strong></div>
            </div>

            <div className="form-section">
              <h3><WalletCards size={18} /> Cashback</h3>
              <NumberInput label="Efectivo entregado a clientes contra débito" value={cashback} onChange={setCashback} hint="Disminuye el efectivo físico y aumenta el medio electrónico correspondiente" />
            </div>

            <div className="form-section">
              <h3><Banknote size={18} /> Cuenta corriente</h3>
              <label className="check-row"><input type="checkbox" checked={cuentaCorrienteOk} onChange={(event) => setCuentaCorrienteOk(event.target.checked)} /><span><strong>FB9-00011714 · $268.881,38</strong><small>SONIA CORINA CUENCA · documentación recibida</small></span></label>
            </div>

            {isSupervisor ? <button className="primary-button wide" onClick={submitClosure}>{hasDifferences ? 'Enviar cierre para validación' : 'Cerrar jornada'} <ChevronRight size={18} /></button> : null}
          </section>

          <section className="panel reconciliation-panel">
            <div className="panel-heading"><div><p className="eyebrow">2 · CONCILIACIÓN</p><h2>Sigma vs. físico</h2></div><ArrowRightLeft size={22} /></div>

            <div className="compare-list">
              <div className="compare-row">
                <div><span>Clover esperado</span><strong>{money.format(cloverSigmaConciliable)}</strong><small>Clover {money.format(sigma.cloverDirecto)} + Naranja {money.format(sigma.naranja)}</small></div>
                <div className="compare-arrow">→</div>
                <div><span>Cierre físico</span><strong>{money.format(cloverFisico)}</strong><small className={Math.abs(diferenciaClover) > 0.01 ? 'negative' : 'positive'}>{money.format(diferenciaClover)} de diferencia</small></div>
              </div>

              <div className="compare-row">
                <div><span>Payway Sigma</span><strong>{money.format(sigma.payway)}</strong></div>
                <div className="compare-arrow">→</div>
                <div><span>Cierre físico</span><strong>{money.format(paywayFisico)}</strong><small className={Math.abs(diferenciaPayway) > 0.01 ? 'negative' : 'positive'}>{money.format(diferenciaPayway)} de diferencia</small></div>
              </div>

              <div className="compare-row">
                <div><span>RETI asentado</span><strong>{money.format(sigma.retiros)}</strong></div>
                <div className="compare-arrow">→</div>
                <div><span>Retiros físicos</span><strong>{money.format(retirosFisicos)}</strong><small className="negative">{money.format(diferenciaRetiros)} sin reflejar correctamente</small></div>
              </div>
            </div>

            <div className="cash-result">
              <div><p className="eyebrow">ARQUEO CORREGIDO</p><h3>Efectivo esperado</h3><strong>{money.format(efectivoEsperadoCorregido)}</strong></div>
              <div className={Math.abs(diferenciaEfectivo) <= 0.01 ? 'result-ok' : diferenciaEfectivo > 0 ? 'result-surplus' : 'result-shortage'}>
                <span>{Math.abs(diferenciaEfectivo) <= 0.01 ? 'Caja exacta' : diferenciaEfectivo > 0 ? 'Sobrante' : 'Faltante'}</span>
                <strong>{money.format(Math.abs(diferenciaEfectivo))}</strong>
              </div>
            </div>

            {reclasificacionCloverAEfectivo > 0 ? <div className="finding-card"><AlertTriangle size={20} /><div><strong>Posible imputación incorrecta</strong><p>Clover tiene {money.format(reclasificacionCloverAEfectivo)} más en Sigma que en el cierre físico. Si se reclasifica a efectivo, Clover cierra exacto y la diferencia de caja queda en {money.format(Math.abs(diferenciaEfectivo))}.</p></div></div> : null}
          </section>
        </div>

        <section className="panel approval-panel">
          <div className="panel-heading"><div><p className="eyebrow">3 · AUTORIZACIÓN</p><h2>Validación de diferencias</h2></div><ShieldCheck size={22} /></div>
          {status === 'BORRADOR' ? <div className="empty-state"><Clock3 /><div><strong>Esperando cierre del Supervisor de Caja</strong><p>Los ajustes no pueden aprobarse mientras el cierre esté en borrador.</p></div></div> : null}

          {status === 'PENDIENTE_VALIDACION' ? <>
            <div className="adjustment-list">
              {reclasificacionCloverAEfectivo > 0 ? <div className="adjustment"><span>Reclasificación de medio</span><strong>{money.format(reclasificacionCloverAEfectivo)}</strong><p>Clover → Efectivo</p></div> : null}
              {Math.abs(diferenciaRetiros) > 0.01 ? <div className="adjustment"><span>Regularización administrativa</span><strong>{money.format(Math.abs(diferenciaRetiros))}</strong><p>RETI físico no coincide con RETI asentado en Sigma</p></div> : null}
              {Math.abs(diferenciaEfectivo) > 0.01 ? <div className="adjustment"><span>{diferenciaEfectivo > 0 ? 'Sobrante de caja' : 'Faltante de caja'}</span><strong>{money.format(Math.abs(diferenciaEfectivo))}</strong><p>Se registra sólo después de corregir imputaciones y retiros</p></div> : null}
            </div>
            {isApprover ? <button className="primary-button" onClick={approveAdjustments}><CheckCircle2 size={18} /> Validar y autorizar ajustes</button> : <div className="waiting-box">Pendiente de aprobación por Encargado Donato.</div>}
          </> : null}

          {status === 'CERRADO' ? <div className="success-box"><CheckCircle2 /><div><strong>Jornada cerrada sin diferencias</strong><p>No se requieren asientos de ajuste.</p></div></div> : null}

          {status === 'AJUSTES_AUTORIZADOS' ? <div className="authorized-box"><CheckCircle2 /><div><strong>Ajustes autorizados</strong><p>{approved ? 'El Encargado Donato validó las diferencias. Recién en este estado se habilita la ejecución de asientos.' : ''}</p><button className="secondary-button" disabled>Ejecutar asientos en Sigma · falta conectar API</button></div></div> : null}
        </section>
      </main>
    </div>
  );
}
