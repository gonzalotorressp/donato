import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  CreditCard,
  EyeOff,
  FileText,
  LockKeyhole,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WalletCards,
} from 'lucide-react';
import type { UserProfile } from './auth/userProfile';
import { DonatoBrand } from './components/DonatoBrand';
import { supabase } from './lib/supabase';
import './blind.css';

type ClosureStatus = 'BORRADOR' | 'PENDIENTE_VALIDACION' | 'CERRADO' | 'AJUSTES_AUTORIZADOS' | 'AJUSTADO';

type Props = {
  profile: UserProfile;
  onSignOut: () => void;
};

type Journey = {
  fecha: string;
  usuarioCodigo: number;
  usuarioNombre: string;
  cajaCodigo: number | null;
};

type ClosureRow = {
  id: string;
  fecha: string;
  usuario_sigma_codigo: number;
  usuario_sigma_nombre: string;
  caja_codigo: number;
  estado: ClosureStatus;
  supervisor_user_id: string;
  declaracion_ciega?: BlindDeclaration | null;
  carga_ciega_cerrada_at?: string | null;
  correccion_estado?: string | null;
  correccion_motivo?: string | null;
};

type SigmaSnapshot = {
  venta: number;
  efectivo: number;
  cloverDirecto: number;
  naranja: number;
  payway: number;
  cuentaCorriente: number;
  pendienteContado: number;
  retiros: number;
  cuentaCorrienteDocumentos: Array<{
    comprobante: string;
    clienteCodigo: string;
    clienteNombre: string;
    importe: number;
  }>;
};

type MoneyRow = { id: string; referencia: string; importe: number };
type CurrentAccountRow = { id: string; comprobante: string; cliente: string; importe: number };

type BlindDeclaration = {
  cloverFisico: number;
  paywayFisico: number;
  cierreEfectivo: number;
  depositario: MoneyRow[];
  retirosSupervisor: MoneyRow[];
  cashbacks: MoneyRow[];
  cuentasCorrientes: CurrentAccountRow[];
};

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
let nextId = 1;
const rowId = () => `row-${Date.now()}-${nextId++}`;

function todayArgentina() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function displayDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function NumberInput({ label, value, onChange, hint, disabled = false }: { label: string; value: number; onChange: (value: number) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`money-input ${disabled ? 'locked-input' : ''}`}>
        <span>$</span>
        <input disabled={disabled} type="number" step="0.01" value={value || ''} onChange={(event) => onChange(Number(event.target.value) || 0)} />
      </div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Metric({ label, value, tone = 'default', note }: { label: string; value: number; tone?: 'default' | 'warn'; note?: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function blankDeclaration(): BlindDeclaration {
  return {
    cloverFisico: 0,
    paywayFisico: 0,
    cierreEfectivo: 0,
    depositario: [{ id: rowId(), referencia: '', importe: 0 }],
    retirosSupervisor: [],
    cashbacks: [],
    cuentasCorrientes: [],
  };
}

export default function App({ profile, onSignOut }: Props) {
  const [today] = useState(todayArgentina());
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [closure, setClosure] = useState<ClosureRow | null>(null);
  const [declaration, setDeclaration] = useState<BlindDeclaration>(blankDeclaration());
  const [snapshot, setSnapshot] = useState<SigmaSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');

  const isSupervisor = profile.rol === 'supervisor_caja' || profile.rol === 'administrador';
  const isApprover = profile.rol === 'encargado_donato' || profile.rol === 'administrador';
  const roleLabel = profile.rol === 'supervisor_caja' ? 'Supervisor de Caja' : profile.rol === 'encargado_donato' ? 'Encargado Donato' : 'Administrador';
  const blindClosed = Boolean(closure?.carga_ciega_cerrada_at);

  async function authHeaders() {
    if (!supabase) throw new Error('Supabase no está configurado');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('La sesión expiró');
    return { Authorization: `Bearer ${token}` };
  }

  async function loadDashboard() {
    if (!supabase) return;
    setLoadingDashboard(true);
    setDashboardError(null);
    try {
      const headers = await authHeaders();
      const [sigmaResponse, closureResponse] = await Promise.all([
        fetch(`/api/sigma/jornadas?fecha=${today}`, { headers, cache: 'no-store' }),
        supabase
          .from('donato_cierres_caja')
          .select('id,fecha,usuario_sigma_codigo,usuario_sigma_nombre,caja_codigo,estado,supervisor_user_id,declaracion_ciega,carga_ciega_cerrada_at,correccion_estado,correccion_motivo')
          .eq('fecha', today),
      ]);

      if (!sigmaResponse.ok) {
        const body = await sigmaResponse.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudieron consultar las jornadas de Sigma');
      }
      if (closureResponse.error) throw new Error(closureResponse.error.message);

      const sigmaData = await sigmaResponse.json();
      setJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
      setClosures((closureResponse.data ?? []) as ClosureRow[]);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'No se pudo cargar la jornada');
    } finally {
      setLoadingDashboard(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const closureByUser = useMemo(() => new Map(closures.map((item) => [item.usuario_sigma_codigo, item])), [closures]);
  const pendingJourneys = useMemo(() => journeys.filter((journey) => !closureByUser.has(journey.usuarioCodigo)), [journeys, closureByUser]);
  const inProgressClosures = useMemo(() => closures.filter((item) => ['BORRADOR', 'PENDIENTE_VALIDACION'].includes(item.estado)), [closures]);
  const completedClosures = useMemo(() => closures.filter((item) => ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado)), [closures]);

  const total = (rows: MoneyRow[]) => rows.reduce((sum, row) => sum + Number(row.importe || 0), 0);
  const totalDepositario = total(declaration.depositario);
  const totalSupervisor = total(declaration.retirosSupervisor);
  const totalCashback = total(declaration.cashbacks);
  const totalCuentaCorrienteFisica = declaration.cuentasCorrientes.reduce((sum, row) => sum + Number(row.importe || 0), 0);
  const efectivoRendido = totalDepositario + totalSupervisor + declaration.cierreEfectivo;

  const cloverSigmaConciliable = snapshot ? snapshot.cloverDirecto + snapshot.naranja : 0;
  const diferenciaClover = snapshot ? declaration.cloverFisico - cloverSigmaConciliable : 0;
  const diferenciaPayway = snapshot ? declaration.paywayFisico - snapshot.payway : 0;
  const diferenciaRetiros = snapshot ? efectivoRendido - snapshot.retiros : 0;
  const diferenciaCuentaCorriente = snapshot ? totalCuentaCorrienteFisica - snapshot.cuentaCorriente : 0;
  const reclasificacionCloverAEfectivo = snapshot ? Math.max(0, -diferenciaClover) : 0;
  const efectivoEsperadoCorregido = snapshot ? snapshot.efectivo + reclasificacionCloverAEfectivo - totalCashback : 0;
  const diferenciaEfectivo = snapshot ? efectivoRendido - efectivoEsperadoCorregido : 0;

  const hasDifferences = useMemo(() => {
    const tolerance = 0.01;
    if (!snapshot) return false;
    return Math.abs(diferenciaClover) > tolerance || Math.abs(diferenciaPayway) > tolerance || Math.abs(diferenciaRetiros) > tolerance || Math.abs(diferenciaCuentaCorriente) > tolerance || Math.abs(diferenciaEfectivo) > tolerance;
  }, [snapshot, diferenciaClover, diferenciaPayway, diferenciaRetiros, diferenciaCuentaCorriente, diferenciaEfectivo]);

  async function startPendingJourney(journey: Journey) {
    if (!supabase || !isSupervisor) return;
    setBusy(true);
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('donato_cierres_caja')
        .insert({
          fecha: journey.fecha,
          usuario_sigma_codigo: journey.usuarioCodigo,
          usuario_sigma_nombre: journey.usuarioNombre,
          caja_codigo: journey.cajaCodigo ?? 0,
          estado: 'BORRADOR',
          supervisor_user_id: profile.userId,
        })
        .select('id,fecha,usuario_sigma_codigo,usuario_sigma_nombre,caja_codigo,estado,supervisor_user_id,declaracion_ciega,carga_ciega_cerrada_at,correccion_estado,correccion_motivo')
        .single();
      if (error) throw new Error(error.message);
      setSelectedJourney(journey);
      setClosure(data as ClosureRow);
      setDeclaration(blankDeclaration());
      setSnapshot(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo iniciar el cierre');
    } finally {
      setBusy(false);
    }
  }

  async function openExistingClosure(item: ClosureRow) {
    const journey: Journey = {
      fecha: item.fecha,
      usuarioCodigo: item.usuario_sigma_codigo,
      usuarioNombre: item.usuario_sigma_nombre,
      cajaCodigo: item.caja_codigo || null,
    };
    setSelectedJourney(journey);
    setClosure(item);
    setDeclaration(item.declaracion_ciega && Object.keys(item.declaracion_ciega).length ? item.declaracion_ciega : blankDeclaration());
    setSnapshot(null);
    setActionError(null);
    if (item.carga_ciega_cerrada_at) await loadSnapshot(item.id);
  }

  async function loadSnapshot(cierreId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/sigma/snapshot?cierreId=${encodeURIComponent(cierreId)}`, { headers, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo consultar Sigma');
      setSnapshot(body.snapshot as SigmaSnapshot);
      return body.snapshot as SigmaSnapshot;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo revelar Sigma');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function updateMoneyRows(key: 'depositario' | 'retirosSupervisor' | 'cashbacks', id: string, patch: Partial<MoneyRow>) {
    setDeclaration((current) => ({
      ...current,
      [key]: current[key].map((row) => row.id === id ? { ...row, ...patch } : row),
    }));
  }

  function addMoneyRow(key: 'depositario' | 'retirosSupervisor' | 'cashbacks') {
    setDeclaration((current) => ({ ...current, [key]: [...current[key], { id: rowId(), referencia: '', importe: 0 }] }));
  }

  function removeMoneyRow(key: 'depositario' | 'retirosSupervisor' | 'cashbacks', id: string) {
    setDeclaration((current) => ({ ...current, [key]: current[key].filter((row) => row.id !== id) }));
  }

  function addCurrentAccount() {
    setDeclaration((current) => ({
      ...current,
      cuentasCorrientes: [...current.cuentasCorrientes, { id: rowId(), comprobante: '', cliente: '', importe: 0 }],
    }));
  }

  function updateCurrentAccount(id: string, patch: Partial<CurrentAccountRow>) {
    setDeclaration((current) => ({
      ...current,
      cuentasCorrientes: current.cuentasCorrientes.map((row) => row.id === id ? { ...row, ...patch } : row),
    }));
  }

  async function closeBlindLoad() {
    if (!supabase || !closure || !selectedJourney) return;
    setBusy(true);
    setActionError(null);
    try {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('donato_cierres_caja')
        .update({
          estado: 'PENDIENTE_VALIDACION',
          clover_fisico: declaration.cloverFisico,
          payway_fisico: declaration.paywayFisico,
          cashback_fisico: totalCashback,
          efectivo_cierre: declaration.cierreEfectivo,
          efectivo_rendido: efectivoRendido,
          declaracion_ciega: declaration,
          carga_ciega_cerrada_at: now,
          submitted_at: now,
        })
        .eq('id', closure.id);
      if (updateError) throw new Error(updateError.message);

      const retiroRows = [
        ...declaration.depositario.filter((row) => row.importe > 0).map((row) => ({ cierre_id: closure.id, tipo: 'depositario', importe: row.importe, ticket_referencia: row.referencia || null, created_by: profile.userId })),
        ...declaration.retirosSupervisor.filter((row) => row.importe > 0).map((row) => ({ cierre_id: closure.id, tipo: 'supervisor', importe: row.importe, ticket_referencia: row.referencia || null, created_by: profile.userId })),
        ...(declaration.cierreEfectivo > 0 ? [{ cierre_id: closure.id, tipo: 'cierre', importe: declaration.cierreEfectivo, ticket_referencia: 'Cierre de caja', created_by: profile.userId }] : []),
      ];
      if (retiroRows.length) {
        const { error } = await supabase.from('donato_cierre_retiros').insert(retiroRows);
        if (error) throw new Error(error.message);
      }

      const cashbackRows = declaration.cashbacks.filter((row) => row.importe > 0).map((row) => ({ cierre_id: closure.id, importe: row.importe, referencia: row.referencia || null, created_by: profile.userId }));
      if (cashbackRows.length) {
        const { error } = await supabase.from('donato_cierre_cashback').insert(cashbackRows);
        if (error) throw new Error(error.message);
      }

      const ccRows = declaration.cuentasCorrientes.filter((row) => row.importe > 0 || row.comprobante).map((row) => ({
        cierre_id: closure.id,
        comprobante: row.comprobante || 'SIN NUMERO',
        cliente_nombre: row.cliente || null,
        importe: row.importe,
        documentacion_recibida: true,
      }));
      if (ccRows.length) {
        const { error } = await supabase.from('donato_cierre_cuentas_corrientes').insert(ccRows);
        if (error) throw new Error(error.message);
      }

      const { error: auditError } = await supabase.from('donato_cierre_auditoria').insert({
        cierre_id: closure.id,
        user_id: profile.userId,
        accion: 'CARGA_CIEGA_CERRADA',
        detalle: declaration,
      });
      if (auditError) throw new Error(auditError.message);

      const updatedClosure: ClosureRow = { ...closure, estado: 'PENDIENTE_VALIDACION', declaracion_ciega: declaration, carga_ciega_cerrada_at: now };
      setClosure(updatedClosure);
      const revealed = await loadSnapshot(closure.id);
      if (!revealed) return;

      const cloverExpected = revealed.cloverDirecto + revealed.naranja;
      const diffClover = declaration.cloverFisico - cloverExpected;
      const diffPayway = declaration.paywayFisico - revealed.payway;
      const diffRetiros = efectivoRendido - revealed.retiros;
      const diffCc = totalCuentaCorrienteFisica - revealed.cuentaCorriente;
      const reclass = Math.max(0, -diffClover);
      const expectedCash = revealed.efectivo + reclass - totalCashback;
      const diffCash = efectivoRendido - expectedCash;
      const differences = [diffClover, diffPayway, diffRetiros, diffCc, diffCash].some((value) => Math.abs(value) > 0.01);
      const finalStatus: ClosureStatus = differences ? 'PENDIENTE_VALIDACION' : 'CERRADO';

      const { error: sigmaSaveError } = await supabase
        .from('donato_cierres_caja')
        .update({
          estado: finalStatus,
          venta_sigma: revealed.venta,
          efectivo_sigma: revealed.efectivo,
          clover_sigma: revealed.cloverDirecto,
          payway_sigma: revealed.payway,
          naranja_sigma: revealed.naranja,
          retiros_sigma: revealed.retiros,
          cuenta_corriente_sigma: revealed.cuentaCorriente,
          diferencia_efectivo: diffCash,
          closed_at: finalStatus === 'CERRADO' ? new Date().toISOString() : null,
        })
        .eq('id', closure.id);
      if (sigmaSaveError) throw new Error(sigmaSaveError.message);
      setClosure((current) => current ? { ...current, estado: finalStatus } : current);
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo cerrar la carga ciega');
    } finally {
      setBusy(false);
    }
  }

  async function requestCorrection() {
    if (!supabase || !closure || !correctionReason.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('donato_cierres_caja')
        .update({ correccion_estado: 'PENDIENTE', correccion_motivo: correctionReason.trim(), correccion_solicitada_at: new Date().toISOString() })
        .eq('id', closure.id);
      if (error) throw new Error(error.message);
      setClosure((current) => current ? { ...current, correccion_estado: 'PENDIENTE', correccion_motivo: correctionReason.trim() } : current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo solicitar la corrección');
    } finally {
      setBusy(false);
    }
  }

  async function approveAdjustments() {
    if (!supabase || !closure || !isApprover) return;
    setBusy(true);
    setActionError(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('donato_cierres_caja')
        .update({ estado: 'AJUSTES_AUTORIZADOS', encargado_user_id: profile.userId, validated_at: now })
        .eq('id', closure.id);
      if (error) throw new Error(error.message);
      setClosure((current) => current ? { ...current, estado: 'AJUSTES_AUTORIZADOS' } : current);
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudieron autorizar los ajustes');
    } finally {
      setBusy(false);
    }
  }

  function renderMoneyRows(key: 'depositario' | 'retirosSupervisor' | 'cashbacks', placeholder: string) {
    const rows = declaration[key];
    if (!rows.length) return <p className="empty-detail">Sin registros cargados.</p>;
    return (
      <div className="detail-rows">
        {rows.map((row) => (
          <div className="detail-row" key={row.id}>
            <input disabled={blindClosed} className="text-input" placeholder={placeholder} value={row.referencia} onChange={(event) => updateMoneyRows(key, row.id, { referencia: event.target.value })} />
            <div className={`money-input compact ${blindClosed ? 'locked-input' : ''}`}><span>$</span><input disabled={blindClosed} type="number" step="0.01" value={row.importe || ''} onChange={(event) => updateMoneyRows(key, row.id, { importe: Number(event.target.value) || 0 })} /></div>
            {!blindClosed ? <button className="icon-button" type="button" onClick={() => removeMoneyRow(key, row.id)}><Trash2 size={16} /></button> : null}
          </div>
        ))}
      </div>
    );
  }

  if (!selectedJourney || !closure) {
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand"><DonatoBrand /></div>
          <nav><button className="nav-item active"><ClipboardCheck size={18} /> Cierre de caja</button><button className="nav-item" disabled><Clock3 size={18} /> Historial</button><button className="nav-item" disabled><ArrowRightLeft size={18} /> Ajustes</button></nav>
          <div className="sidebar-user"><span>{roleLabel}</span><strong>{profile.nombre || profile.email}</strong><button onClick={onSignOut}><LogOut size={16} /> Salir</button></div>
        </aside>
        <main className="workspace">
          <header className="topbar">
            <div><p className="eyebrow">CIERRE DE CAJA · HOY</p><h1>Jornadas del {displayDate(today)}</h1><p>Sólo aparecen usuarios con actividad de venta del día actual.</p></div>
            <button className="refresh-button" onClick={() => void loadDashboard()} disabled={loadingDashboard}><RefreshCw size={16} /> Actualizar</button>
          </header>

          <div className="blind-notice"><LockKeyhole size={22} /><div><strong>Detección automática + control ciego</strong><p>Si Sigma registra ventas hoy y el usuario todavía no tiene un cierre, aparece como pendiente. Los importes esperados permanecen ocultos hasta cerrar la declaración física.</p></div></div>
          {dashboardError ? <div className="error-banner">{dashboardError}</div> : null}

          <section className="panel dashboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">PENDIENTES</p><h2>Cierres a realizar hoy</h2></div><EyeOff size={22} /></div>
            {loadingDashboard ? <div className="empty-state"><Clock3 /><div><strong>Consultando Sigma…</strong><p>Buscando usuarios con ventas de hoy.</p></div></div> : pendingJourneys.length ? (
              <div className="cashier-list">
                {pendingJourneys.map((journey) => (
                  <button key={journey.usuarioCodigo} className="cashier-card" onClick={() => void startPendingJourney(journey)} disabled={!isSupervisor || busy}>
                    <div className="cashier-avatar">{journey.usuarioNombre.slice(0, 1)}</div>
                    <div><strong>{journey.usuarioNombre}</strong><span>{journey.cajaCodigo ? `Caja ${journey.cajaCodigo} · ` : ''}Usuario Sigma {journey.usuarioCodigo}</span></div>
                    <div className="cashier-state pending">Pendiente</div>
                  </button>
                ))}
              </div>
            ) : <div className="success-box"><CheckCircle2 /><div><strong>No hay cierres pendientes detectados</strong><p>Todo usuario con ventas de hoy ya tiene un cierre iniciado o finalizado.</p></div></div>}
          </section>

          {inProgressClosures.length ? <section className="panel dashboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">EN CURSO</p><h2>Cierres iniciados hoy</h2></div><Clock3 size={22} /></div>
            <div className="cashier-list">
              {inProgressClosures.map((item) => <button key={item.id} className="cashier-card" onClick={() => void openExistingClosure(item)}><div className="cashier-avatar">{item.usuario_sigma_nombre.slice(0, 1)}</div><div><strong>{item.usuario_sigma_nombre}</strong><span>Caja {item.caja_codigo || '—'} · Usuario Sigma {item.usuario_sigma_codigo}</span></div><div className={`cashier-state ${item.estado === 'PENDIENTE_VALIDACION' ? 'review' : ''}`}>{item.estado === 'BORRADOR' ? 'Carga iniciada' : 'Validar'}</div></button>)}
            </div>
          </section> : null}

          {completedClosures.length ? <section className="panel dashboard-panel compact-panel">
            <div className="panel-heading"><div><p className="eyebrow">COMPLETADOS HOY</p><h2>Cierres finalizados</h2></div><CheckCircle2 size={22} /></div>
            <div className="cashier-list">
              {completedClosures.map((item) => <button key={item.id} className="cashier-card completed" onClick={() => void openExistingClosure(item)}><div className="cashier-avatar">{item.usuario_sigma_nombre.slice(0, 1)}</div><div><strong>{item.usuario_sigma_nombre}</strong><span>Caja {item.caja_codigo || '—'} · Usuario Sigma {item.usuario_sigma_codigo}</span></div><div className="cashier-state done">{item.estado.replaceAll('_', ' ')}</div></button>)}
            </div>
          </section> : null}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><DonatoBrand /></div>
        <nav><button className="nav-item active"><ClipboardCheck size={18} /> Cierre de caja</button><button className="nav-item" disabled><Clock3 size={18} /> Historial</button><button className="nav-item" disabled><ArrowRightLeft size={18} /> Ajustes</button></nav>
        <div className="sidebar-user"><span>{roleLabel}</span><strong>{profile.nombre || profile.email}</strong><button onClick={onSignOut}><LogOut size={16} /> Salir</button></div>
      </aside>

      <main className="workspace">
        <button className="back-button" onClick={() => { setSelectedJourney(null); setClosure(null); setSnapshot(null); void loadDashboard(); }}><ArrowLeft size={17} /> Volver a jornadas</button>
        <header className="topbar">
          <div><p className="eyebrow">CIERRE DE JORNADA</p><h1>{selectedJourney.usuarioNombre} · {selectedJourney.cajaCodigo ? `Caja ${selectedJourney.cajaCodigo}` : 'Caja por detectar'}</h1><p>{displayDate(selectedJourney.fecha)} · Usuario Sigma {selectedJourney.usuarioCodigo}</p></div>
          <div className={blindClosed ? `status-pill status-${closure.estado.toLowerCase()}` : 'blind-badge'}>{blindClosed ? closure.estado.replaceAll('_', ' ') : <><EyeOff size={16} /> CONTROL CIEGO</>}</div>
        </header>

        {!blindClosed ? <div className="blind-notice"><EyeOff size={22} /><div><strong>Control ciego activo</strong><p>No se muestran venta, efectivo, Clover, Payway, RETI ni cuentas corrientes de Sigma. Cargá únicamente lo que recibiste físicamente.</p></div></div> : null}
        {actionError ? <div className="error-banner">{actionError}</div> : null}

        {blindClosed && snapshot ? <section className="summary-strip reveal-animation"><Metric label="Venta Sigma" value={snapshot.venta} /><Metric label="Efectivo Sigma" value={snapshot.efectivo} /><Metric label="Cuenta corriente Sigma" value={snapshot.cuentaCorriente} /><Metric label="Contado pendiente" value={snapshot.pendienteContado} tone={snapshot.pendienteContado ? 'warn' : 'default'} note={snapshot.pendienteContado ? 'Documento pendiente detectado' : undefined} /></section> : null}

        <div className={blindClosed ? 'content-grid' : 'blind-form-grid'}>
          <section className="panel physical-panel">
            <div className="panel-heading"><div><p className="eyebrow">1 · DECLARACIÓN FÍSICA</p><h2>{blindClosed ? 'Carga ciega cerrada' : 'Lo que recibe el supervisor'}</h2></div>{blindClosed ? <LockKeyhole size={22} /> : <ShieldCheck size={22} />}</div>

            <div className="form-section"><h3><CreditCard size={18} /> Cierres de lote</h3><div className="two-cols"><NumberInput disabled={blindClosed} label="Clover" value={declaration.cloverFisico} onChange={(value) => setDeclaration((current) => ({ ...current, cloverFisico: value }))} hint="Importe del ticket de cierre" /><NumberInput disabled={blindClosed} label="Payway" value={declaration.paywayFisico} onChange={(value) => setDeclaration((current) => ({ ...current, paywayFisico: value }))} hint="Importe del ticket de cierre" /></div></div>

            <div className="form-section"><div className="section-title-row"><h3><ReceiptText size={18} /> Tickets del depositario</h3>{!blindClosed ? <button className="add-row-button" type="button" onClick={() => addMoneyRow('depositario')}><Plus size={15} /> Agregar</button> : null}</div>{renderMoneyRows('depositario', 'Nº ticket / referencia')}<div className="inline-total"><span>Total depositario</span><strong>{money.format(totalDepositario)}</strong></div></div>

            <div className="form-section"><div className="section-title-row"><h3><Banknote size={18} /> Retiros de supervisores</h3>{!blindClosed ? <button className="add-row-button" type="button" onClick={() => addMoneyRow('retirosSupervisor')}><Plus size={15} /> Agregar</button> : null}</div>{renderMoneyRows('retirosSupervisor', 'Supervisor / referencia')}</div>

            <div className="form-section"><h3><Banknote size={18} /> Efectivo al cierre</h3><NumberInput disabled={blindClosed} label="Efectivo entregado al cerrar la caja" value={declaration.cierreEfectivo} onChange={(value) => setDeclaration((current) => ({ ...current, cierreEfectivo: value }))} /><div className="inline-total"><span>Total efectivo rendido</span><strong>{money.format(efectivoRendido)}</strong></div></div>

            <div className="form-section"><div className="section-title-row"><h3><WalletCards size={18} /> Cashback</h3>{!blindClosed ? <button className="add-row-button" type="button" onClick={() => addMoneyRow('cashbacks')}><Plus size={15} /> Agregar</button> : null}</div>{renderMoneyRows('cashbacks', 'Ticket / terminal / referencia')}<div className="inline-total"><span>Total cashback</span><strong>{money.format(totalCashback)}</strong></div></div>

            <div className="form-section"><div className="section-title-row"><h3><FileText size={18} /> Facturas en cuenta corriente recibidas</h3>{!blindClosed ? <button className="add-row-button" type="button" onClick={addCurrentAccount}><Plus size={15} /> Agregar</button> : null}</div>{declaration.cuentasCorrientes.length ? <div className="cc-rows">{declaration.cuentasCorrientes.map((row) => <div className="cc-row" key={row.id}><input disabled={blindClosed} className="text-input" placeholder="Comprobante" value={row.comprobante} onChange={(event) => updateCurrentAccount(row.id, { comprobante: event.target.value })} /><input disabled={blindClosed} className="text-input" placeholder="Cliente" value={row.cliente} onChange={(event) => updateCurrentAccount(row.id, { cliente: event.target.value })} /><div className={`money-input compact ${blindClosed ? 'locked-input' : ''}`}><span>$</span><input disabled={blindClosed} type="number" value={row.importe || ''} onChange={(event) => updateCurrentAccount(row.id, { importe: Number(event.target.value) || 0 })} /></div>{!blindClosed ? <button className="icon-button" onClick={() => setDeclaration((current) => ({ ...current, cuentasCorrientes: current.cuentasCorrientes.filter((item) => item.id !== row.id) }))}><Trash2 size={16} /></button> : null}</div>)}</div> : <p className="empty-detail">Sin documentación de cuenta corriente cargada.</p>}<div className="inline-total"><span>Total cuenta corriente declarada</span><strong>{money.format(totalCuentaCorrienteFisica)}</strong></div></div>

            {!blindClosed && isSupervisor ? <button className="primary-button wide close-blind-button" onClick={() => void closeBlindLoad()} disabled={busy}><LockKeyhole size={18} /> {busy ? 'Cerrando…' : 'Cerrar carga ciega y comparar con Sigma'}</button> : null}
          </section>

          {blindClosed && snapshot ? <section className="panel reconciliation-panel reveal-animation">
            <div className="panel-heading"><div><p className="eyebrow">2 · CONCILIACIÓN</p><h2>Sigma vs. declaración física</h2></div><ArrowRightLeft size={22} /></div>
            <div className="compare-list">
              <div className="compare-row"><div><span>Clover esperado</span><strong>{money.format(cloverSigmaConciliable)}</strong><small>Clover/QR Clover + Naranja conciliable</small></div><div className="compare-arrow">→</div><div><span>Declarado físico</span><strong>{money.format(declaration.cloverFisico)}</strong><small className={Math.abs(diferenciaClover) > 0.01 ? 'negative' : 'positive'}>{money.format(diferenciaClover)} de diferencia</small></div></div>
              <div className="compare-row"><div><span>Payway Sigma</span><strong>{money.format(snapshot.payway)}</strong></div><div className="compare-arrow">→</div><div><span>Declarado físico</span><strong>{money.format(declaration.paywayFisico)}</strong><small className={Math.abs(diferenciaPayway) > 0.01 ? 'negative' : 'positive'}>{money.format(diferenciaPayway)} de diferencia</small></div></div>
              <div className="compare-row"><div><span>RETI Sigma</span><strong>{money.format(snapshot.retiros)}</strong></div><div className="compare-arrow">→</div><div><span>Efectivo rendido</span><strong>{money.format(efectivoRendido)}</strong><small className={Math.abs(diferenciaRetiros) > 0.01 ? 'negative' : 'positive'}>{money.format(diferenciaRetiros)} de diferencia</small></div></div>
              <div className="compare-row"><div><span>Cuenta corriente Sigma</span><strong>{money.format(snapshot.cuentaCorriente)}</strong></div><div className="compare-arrow">→</div><div><span>Documentación recibida</span><strong>{money.format(totalCuentaCorrienteFisica)}</strong><small className={Math.abs(diferenciaCuentaCorriente) > 0.01 ? 'negative' : 'positive'}>{money.format(diferenciaCuentaCorriente)} de diferencia</small></div></div>
            </div>
            <div className="cash-result"><div><p className="eyebrow">ARQUEO CORREGIDO</p><h3>Efectivo esperado</h3><strong>{money.format(efectivoEsperadoCorregido)}</strong></div><div className={Math.abs(diferenciaEfectivo) <= 0.01 ? 'result-ok' : diferenciaEfectivo > 0 ? 'result-surplus' : 'result-shortage'}><span>{Math.abs(diferenciaEfectivo) <= 0.01 ? 'Caja exacta' : diferenciaEfectivo > 0 ? 'Sobrante' : 'Faltante'}</span><strong>{money.format(Math.abs(diferenciaEfectivo))}</strong></div></div>
            {reclasificacionCloverAEfectivo > 0 ? <div className="finding-card"><AlertTriangle size={20} /><div><strong>Posible imputación de medio incorrecta</strong><p>Clover presenta {money.format(reclasificacionCloverAEfectivo)} más en Sigma que en el cierre físico. El sistema lo propone como candidato de reclasificación hacia efectivo antes de determinar faltante/sobrante.</p></div></div> : null}
          </section> : null}
        </div>

        {blindClosed && snapshot ? <section className="panel approval-panel reveal-animation">
          <div className="panel-heading"><div><p className="eyebrow">3 · RESOLUCIÓN</p><h2>{hasDifferences ? 'Diferencias a validar' : 'Cierre sin diferencias'}</h2></div><ShieldCheck size={22} /></div>
          {!hasDifferences ? <div className="success-box"><CheckCircle2 /><div><strong>La declaración física coincide con Sigma</strong><p>La jornada puede quedar cerrada sin asientos de ajuste.</p></div></div> : <>
            <div className="adjustment-list">
              {Math.abs(diferenciaClover) > 0.01 ? <div className="adjustment"><span>Diferencia Clover</span><strong>{money.format(Math.abs(diferenciaClover))}</strong><p>{reclasificacionCloverAEfectivo > 0 ? 'Candidato a reclasificación Clover → Efectivo' : 'Revisar medio de pago'}</p></div> : null}
              {Math.abs(diferenciaRetiros) > 0.01 ? <div className="adjustment"><span>Diferencia RETI</span><strong>{money.format(Math.abs(diferenciaRetiros))}</strong><p>Documentación física no coincide con RETI de Sigma</p></div> : null}
              {Math.abs(diferenciaEfectivo) > 0.01 ? <div className="adjustment"><span>{diferenciaEfectivo > 0 ? 'Sobrante de caja' : 'Faltante de caja'}</span><strong>{money.format(Math.abs(diferenciaEfectivo))}</strong><p>Resultado después de considerar la reclasificación propuesta</p></div> : null}
            </div>
            {closure.correccion_estado === 'PENDIENTE' ? <div className="waiting-box">Corrección solicitada al Encargado Donato: {closure.correccion_motivo}</div> : isSupervisor ? <div className="correction-box"><label><span>¿Cargaste mal un valor físico?</span><textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Explicá qué dato necesita corregirse. La carga original queda auditada." /></label><button className="secondary-button" disabled={!correctionReason.trim() || busy} onClick={() => void requestCorrection()}>Solicitar corrección de carga</button></div> : null}
            {isApprover && closure.estado === 'PENDIENTE_VALIDACION' ? <button className="primary-button approve-button" onClick={() => void approveAdjustments()} disabled={busy}><CheckCircle2 size={18} /> Validar y autorizar ajustes</button> : null}
            {!isApprover && closure.estado === 'PENDIENTE_VALIDACION' ? <div className="waiting-box">Pendiente de validación por Encargado Donato. El Supervisor no puede generar asientos.</div> : null}
            {closure.estado === 'AJUSTES_AUTORIZADOS' ? <div className="authorized-box"><CheckCircle2 /><div><strong>Ajustes autorizados</strong><p>Recién en este estado se habilitará la ejecución de asientos en Sigma.</p><button className="secondary-button" disabled>Ejecutar asientos en Sigma · próxima etapa</button></div></div> : null}
          </>}
        </section> : null}
      </main>
    </div>
  );
}
