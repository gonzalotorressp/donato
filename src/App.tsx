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
  XCircle,
} from 'lucide-react';
import type { UserProfile } from './auth/userProfile';
import { DonatoBrand } from './components/DonatoBrand';
import { supabase } from './lib/supabase';
import { downloadClosurePdf } from './lib/closurePdf';
import './blind.css';

type ClosureStatus =
  | 'BORRADOR'
  | 'REVISION_SUPERVISOR'
  | 'PENDIENTE_VALIDACION'
  | 'CERRADO'
  | 'AJUSTES_AUTORIZADOS'
  | 'AJUSTADO'
  | 'CANCELADO';

type Props = {
  profile: UserProfile;
  onSignOut: () => void;
};

type Journey = {
  fecha: string;
  usuarioCodigo: number;
  usuarioNombre: string;
  cajaCodigo: number | null;
  ultimaVentaHora?: string | null;
  cantidadVentas?: number;
  venta?: number;
  tieneActividadNueva?: boolean;
  proximoCierreNumero?: number;
  cierreEditableId?: string | null;
  cierreAnteriorId?: string | null;
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

type BlindComparison = {
  coincidencias: {
    clover: boolean;
    payway: boolean;
    retiros: boolean;
    cuentaCorriente: boolean;
  };
  conceptosOk: boolean;
  administrativoOk?: boolean;
  cajaOk: boolean;
  hayDiferencias: boolean;
  hayPendienteAdministrativo?: boolean;
  errorRegistroAdministrativo?: boolean;
  administrativoEstado?: 'CONCILIADO' | 'PENDIENTE' | 'ERROR_REGISTRO';
  avisos?: { comprobantePendiente?: boolean; pendienteAdministrativo?: boolean; errorRegistroAdministrativo?: boolean };
};

type ClosureRow = {
  id: string;
  fecha: string;
  usuario_sigma_codigo: number;
  usuario_sigma_nombre: string;
  caja_codigo: number;
  cierre_nro: number;
  estado: ClosureStatus;
  supervisor_user_id: string;
  declaracion_ciega?: BlindDeclaration | null;
  declaracion_ciega_inicial?: BlindDeclaration | null;
  carga_ciega_cerrada_at?: string | null;
  revision_supervisor_count?: number;
  revision_supervisor_at?: string | null;
  diferencias_supervisor?: BlindComparison | null;
  conceptos_ok?: boolean | null;
  caja_ok?: boolean | null;
  administrativo_ok?: boolean | null;
  fondo_inicial?: number;
  fondo_devuelto?: number;
  diferencia_fondo?: number;
  efectivo_entregado_cierre?: number;
  efectivo_esperado_cierre?: number;
  diferencia_efectivo?: number;
  reti_pendiente_entrada?: number;
  reti_pendiente_salida?: number;
  correccion_motivo?: string | null;
  cancelado_at?: string | null;
  cancelado_por?: string | null;
  cancelacion_motivo?: string | null;
  corte_desde_at?: string | null;
  corte_hasta_at?: string | null;
  sigma_snapshot_capturado_at?: string | null;
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
  retirosDocumentos?: Array<{
    key?: string;
    cuentaCodigo?: number | null;
    usuarioCodigo?: number | null;
    usuarioNombre?: string;
    importe: number;
    concepto?: string;
    observacion?: string;
  }>;
  cuentaCorrienteDocumentos: Array<{
    comprobante: string;
    clienteCodigo: string;
    clienteNombre: string;
    importe: number;
  }>;
};

type QuickControl = {
  fecha: string;
  usuarioCodigo: number;
  usuarioNombre: string;
  cajaCodigo: number | null;
  primeraVentaHora?: string | null;
  ultimaVentaHora?: string | null;
  cantidadVentas: number;
  venta: number;
  efectivoCodo: number;
  clover: number;
  payway: number;
  naranja: number;
  cuentaCorriente: number;
  pendienteContado: number;
  retirosAsignados: number;
  efectivoTeoricoRestante: number;
  diferenciaSigma: number;
  estadoDiferencia: 'OK' | 'FALTANTE' | 'SOBRANTE';
  retiros: Array<{ id: number; importe: number; horaAproximada?: string | null; confianza: string; registradoPorNombre?: string | null }>;
};

type FullComparison = {
  coincidencias: BlindComparison['coincidencias'];
  conceptosOk: boolean;
  administrativoOk?: boolean;
  cajaOk: boolean;
  hayDiferencias: boolean;
  hayPendienteAdministrativo?: boolean;
  errorRegistroAdministrativo?: boolean;
  administrativoEstado?: 'CONCILIADO' | 'PENDIENTE' | 'ERROR_REGISTRO';
  retirosDocumentados?: number;
  retirosPendienteEntrada?: number;
  retirosPendienteSalida?: number;
  retirosSigmaPendienteSalida?: number;
  retirosFisicoPendienteSalida?: number;
  retiConciliacion?: any;
  diferencias: {
    clover: number;
    payway: number;
    retiros: number;
    cuentaCorriente: number;
  };
  diferenciaCaja: number;
  totalFisicoControlado: number;
  totalSigmaControlado: number;
  toleranciaConceptos: number;
  toleranciaCaja: number;
};

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
});

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

function displayTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function NumberInput({
  label,
  value,
  onChange,
  hint,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`money-input ${disabled ? 'locked-input' : ''}`}>
        <span>$</span>
        <input
          disabled={disabled}
          type="number"
          step="0.01"
          value={value || ''}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
        />
      </div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
  note,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn';
  note?: string;
}) {
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

function comparisonMessage(result: BlindComparison) {
  if (result.errorRegistroAdministrativo) return 'La caja puede coincidir, pero RETI tiene un error de registración: ningún movimiento o combinación completa coincide con lo informado físicamente.';
  if (result.conceptosOk && result.cajaOk && result.hayPendienteAdministrativo) return 'La caja y los medios coinciden. Quedan movimientos completos pendientes para el próximo cierre de esta caja.';
  if (result.conceptosOk && result.cajaOk) return 'Los conceptos y el resultado de caja coinciden.';
  if (!result.conceptosOk && result.cajaOk) return 'La caja está dentro de tolerancia, pero hay conceptos que no coinciden.';
  if (result.conceptosOk && !result.cajaOk) return 'Los conceptos coinciden, pero la caja presenta una diferencia.';
  return 'Hay diferencias en los conceptos y también en el resultado de caja.';
}

export default function App({ profile, onSignOut }: Props) {
  const [today] = useState(todayArgentina());
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [dashboardMode, setDashboardMode] = useState<'today' | 'history'>('today');
  const [historyClosures, setHistoryClosures] = useState<ClosureRow[]>([]);
  const [historyJourneys, setHistoryJourneys] = useState<Journey[]>([]);
  const [historyDate, setHistoryDate] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [quickControls, setQuickControls] = useState<QuickControl[]>([]);
  const [quickControlUnassigned, setQuickControlUnassigned] = useState<Array<{ id: number; cajaCodigo: number; importe: number }>>([]);
  const [quickControlCriterion, setQuickControlCriterion] = useState('');
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [closure, setClosure] = useState<ClosureRow | null>(null);
  const [declaration, setDeclaration] = useState<BlindDeclaration>(blankDeclaration());
  const [blindComparison, setBlindComparison] = useState<BlindComparison | null>(null);
  const [snapshot, setSnapshot] = useState<SigmaSnapshot | null>(null);
  const [fullComparison, setFullComparison] = useState<FullComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  const [approverCash, setApproverCash] = useState({
    fondoInicial: 0,
    fondoDevuelto: 0,
    efectivoEntregadoCierre: 0,
  });
  const [approverCashDirty, setApproverCashDirty] = useState(false);

  const isSupervisor = profile.rol === 'supervisor_caja' || profile.rol === 'administrador';
  const isApprover = profile.rol === 'encargado_donato' || profile.rol === 'administrador';
  const roleLabel = profile.rol === 'supervisor_caja'
    ? 'Supervisor de Caja'
    : profile.rol === 'encargado_donato'
      ? 'Encargado Donato'
      : 'Administrador';

  const canEditDeclaration = Boolean(
    closure && isSupervisor && ['BORRADOR', 'REVISION_SUPERVISOR'].includes(closure.estado)
  );
  const canApproverEditCash = Boolean(
    closure && isApprover && closure.estado === 'PENDIENTE_VALIDACION'
  );
  const firstCloseDone = Boolean(closure?.carga_ciega_cerrada_at);

  const closureSelect = [
    'id',
    'fecha',
    'usuario_sigma_codigo',
    'usuario_sigma_nombre',
    'caja_codigo',
    'cierre_nro',
    'estado',
    'supervisor_user_id',
    'declaracion_ciega',
    'declaracion_ciega_inicial',
    'carga_ciega_cerrada_at',
    'revision_supervisor_count',
    'revision_supervisor_at',
    'diferencias_supervisor',
    'conceptos_ok',
    'caja_ok',
    'administrativo_ok',
    'fondo_inicial',
    'fondo_devuelto',
    'diferencia_fondo',
    'efectivo_entregado_cierre',
    'efectivo_esperado_cierre',
    'diferencia_efectivo',
    'reti_pendiente_entrada',
    'reti_pendiente_salida',
    'correccion_motivo',
    'cancelado_at',
    'cancelado_por',
    'cancelacion_motivo',
    'corte_desde_at',
    'corte_hasta_at',
    'sigma_snapshot_capturado_at',
  ].join(',');

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
      const [sigmaResponse, closureResponse, openResponse] = await Promise.all([
        fetch(`/api/sigma/jornadas?fecha=${today}`, { headers, cache: 'no-store' }),
        supabase
          .from('donato_cierres_caja')
          .select(closureSelect)
          .eq('fecha', today)
          .order('usuario_sigma_nombre', { ascending: true })
          .order('cierre_nro', { ascending: true }),
        supabase
          .from('donato_cierres_caja')
          .select(closureSelect)
          .in('estado', ['BORRADOR', 'REVISION_SUPERVISOR', 'PENDIENTE_VALIDACION'])
          .order('fecha', { ascending: false })
          .order('usuario_sigma_nombre', { ascending: true }),
      ]);

      if (!sigmaResponse.ok) {
        const body = await sigmaResponse.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudieron consultar las cajas de hoy');
      }
      if (closureResponse.error) throw new Error(closureResponse.error.message);
      if (openResponse.error) throw new Error(openResponse.error.message);

      const sigmaData = await sigmaResponse.json();
      setJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
      const merged = new Map<string, ClosureRow>();
      for (const row of [...(closureResponse.data ?? []), ...(openResponse.data ?? [])] as unknown as ClosureRow[]) {
        merged.set(row.id, row);
      }
      setClosures([...merged.values()]);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'No se pudo cargar la jornada');
    } finally {
      setLoadingDashboard(false);
    }
  }

  async function loadHistory() {
    if (!supabase) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const closureQuery = historyDate
        ? supabase
            .from('donato_cierres_caja')
            .select(closureSelect)
            .eq('fecha', historyDate)
            .order('created_at', { ascending: false })
        : supabase
            .from('donato_cierres_caja')
            .select(closureSelect)
            .order('fecha', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(200);

      const historyRequests: Promise<any>[] = [closureQuery as unknown as Promise<any>];
      if (historyDate) {
        const headers = await authHeaders();
        historyRequests.push(fetch(`/api/sigma/jornadas?fecha=${encodeURIComponent(historyDate)}`, {
          headers,
          cache: 'no-store',
        }));
        if (profile.rol === 'administrador') {
          historyRequests.push(fetch(`/api/sigma/control-rapido?fecha=${encodeURIComponent(historyDate)}`, {
            headers,
            cache: 'no-store',
          }));
        }
      }

      const [closureResult, sigmaResponse, quickResponse] = await Promise.all(historyRequests);
      if (closureResult.error) throw new Error(closureResult.error.message);
      setHistoryClosures((closureResult.data ?? []) as unknown as ClosureRow[]);

      if (historyDate && sigmaResponse) {
        if (!sigmaResponse.ok) {
          const body = await sigmaResponse.json().catch(() => ({}));
          throw new Error(body.error || 'No se pudo consultar la jornada histórica en Sigma');
        }
        const sigmaData = await sigmaResponse.json();
        setHistoryJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
        if (quickResponse) {
          if (!quickResponse.ok) {
            const body = await quickResponse.json().catch(() => ({}));
            throw new Error(body.error || 'No se pudo generar el control rápido de Sigma');
          }
          const quickData = await quickResponse.json();
          setQuickControls(Array.isArray(quickData.controles) ? quickData.controles : []);
          setQuickControlUnassigned(Array.isArray(quickData.retirosSinAsignar) ? quickData.retirosSinAsignar : []);
          setQuickControlCriterion(String(quickData.criterioReti || ''));
        } else {
          setQuickControls([]);
          setQuickControlUnassigned([]);
          setQuickControlCriterion('');
        }
      } else {
        setHistoryJourneys([]);
        setQuickControls([]);
        setQuickControlUnassigned([]);
        setQuickControlCriterion('');
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'No se pudo cargar el historial');
      setHistoryJourneys([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    if (dashboardMode === 'history') void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardMode, historyDate]);

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const activeClosures = useMemo(
    () => closures.filter((item) => item.estado !== 'CANCELADO'),
    [closures]
  );

  const editableByUser = useMemo(() => {
    const map = new Map<number, ClosureRow>();
    for (const item of activeClosures) {
      if (['BORRADOR', 'REVISION_SUPERVISOR'].includes(item.estado)) {
        map.set(item.usuario_sigma_codigo, item);
      }
    }
    return map;
  }, [activeClosures]);

  const pendingJourneys = useMemo(
    () => journeys.filter(
      (journey) => journey.tieneActividadNueva === true && !editableByUser.has(journey.usuarioCodigo)
    ),
    [journeys, editableByUser]
  );

  const inProgressClosures = useMemo(
    () => activeClosures.filter((item) => ['BORRADOR', 'REVISION_SUPERVISOR', 'PENDIENTE_VALIDACION'].includes(item.estado)),
    [activeClosures]
  );

  const completedClosures = useMemo(
    () => activeClosures.filter((item) => ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado)),
    [activeClosures]
  );

  const filteredHistoryClosures = useMemo(
    () => historyDate ? historyClosures.filter((item) => item.fecha === historyDate) : historyClosures,
    [historyClosures, historyDate]
  );

  const total = (rows: MoneyRow[]) => rows.reduce((sum, row) => sum + Number(row.importe || 0), 0);
  const totalDepositario = total(declaration.depositario);
  const totalSupervisor = total(declaration.retirosSupervisor);
  const totalCashback = total(declaration.cashbacks);
  const totalCuentaCorrienteFisica = declaration.cuentasCorrientes.reduce(
    (sum, row) => sum + Number(row.importe || 0),
    0
  );
  const efectivoRendido = totalDepositario + totalSupervisor + declaration.cierreEfectivo;

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
        .select(closureSelect)
        .single();
      if (error) throw new Error(error.message);

      setSelectedJourney({
        ...journey,
        proximoCierreNumero: Number((data as unknown as ClosureRow).cierre_nro || journey.proximoCierreNumero || 1),
      });
      setClosure(data as unknown as ClosureRow);
      setDeclaration(blankDeclaration());
      setBlindComparison(null);
      setSnapshot(null);
      setFullComparison(null);
      setRevisionNote('');
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
      tieneActividadNueva: false,
      proximoCierreNumero: item.cierre_nro,
    };

    setSelectedJourney(journey);
    setClosure(item);
    setDeclaration(
      item.declaracion_ciega && Object.keys(item.declaracion_ciega).length
        ? item.declaracion_ciega
        : blankDeclaration()
    );
    setApproverCash({
      fondoInicial: Number(item.fondo_inicial || 0),
      fondoDevuelto: Number(item.fondo_devuelto || 0),
      efectivoEntregadoCierre: Number(
        item.efectivo_entregado_cierre
          ?? item.declaracion_ciega?.cierreEfectivo
          ?? 0
      ),
    });
    setApproverCashDirty(false);
    setBlindComparison(item.diferencias_supervisor ?? null);
    setSnapshot(null);
    setFullComparison(null);
    setRevisionNote(item.correccion_motivo || '');
    setActionError(null);

    if (item.estado === 'REVISION_SUPERVISOR') {
      await loadBlindComparison(item.id);
    } else if (
      isApprover &&
      ['PENDIENTE_VALIDACION', 'AJUSTES_AUTORIZADOS', 'AJUSTADO', 'CERRADO'].includes(item.estado)
    ) {
      await loadFullSnapshot(item.id);
    }
  }

  async function loadBlindComparison(cierreId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/sigma/comparar?cierreId=${encodeURIComponent(cierreId)}`, {
        method: 'POST',
        headers,
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo controlar el cierre');
      const result = body.resultado as BlindComparison;
      setBlindComparison(result);
      return result;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo comparar el cierre');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadFullSnapshot(cierreId: string) {
    if (!isApprover) return null;
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/sigma/snapshot?cierreId=${encodeURIComponent(cierreId)}`, {
        headers,
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo consultar Sigma');
      setSnapshot(body.snapshot as SigmaSnapshot);
      setFullComparison(body.comparison as FullComparison);
      if (body.cashControl) {
        setClosure((current) => current ? { ...current, ...body.cashControl } : current);
      }
      return body as {
        snapshot: SigmaSnapshot;
        comparison: FullComparison;
        cashControl?: Partial<ClosureRow>;
      };
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo cargar la validación');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function updateMoneyRows(
    key: 'depositario' | 'retirosSupervisor' | 'cashbacks',
    id: string,
    patch: Partial<MoneyRow>
  ) {
    setDeclaration((current) => ({
      ...current,
      [key]: current[key].map((row) => row.id === id ? { ...row, ...patch } : row),
    }));
  }

  function addMoneyRow(key: 'depositario' | 'retirosSupervisor' | 'cashbacks') {
    setDeclaration((current) => ({
      ...current,
      [key]: [...current[key], { id: rowId(), referencia: '', importe: 0 }],
    }));
  }

  function removeMoneyRow(key: 'depositario' | 'retirosSupervisor' | 'cashbacks', id: string) {
    setDeclaration((current) => ({
      ...current,
      [key]: current[key].filter((row) => row.id !== id),
    }));
  }

  function addCurrentAccount() {
    setDeclaration((current) => ({
      ...current,
      cuentasCorrientes: [
        ...current.cuentasCorrientes,
        { id: rowId(), comprobante: '', cliente: '', importe: 0 },
      ],
    }));
  }

  function updateCurrentAccount(id: string, patch: Partial<CurrentAccountRow>) {
    setDeclaration((current) => ({
      ...current,
      cuentasCorrientes: current.cuentasCorrientes.map((row) => row.id === id ? { ...row, ...patch } : row),
    }));
  }

  async function replaceDeclarationDetails(cierreId: string) {
    if (!supabase) return;

    const deleteResults = await Promise.all([
      supabase.from('donato_cierre_retiros').delete().eq('cierre_id', cierreId),
      supabase.from('donato_cierre_cashback').delete().eq('cierre_id', cierreId),
      supabase.from('donato_cierre_cuentas_corrientes').delete().eq('cierre_id', cierreId),
    ]);
    for (const result of deleteResults) {
      if (result.error) throw new Error(result.error.message);
    }

    const retiroRows = [
      ...declaration.depositario
        .filter((row) => row.importe > 0)
        .map((row) => ({
          cierre_id: cierreId,
          tipo: 'depositario',
          importe: row.importe,
          ticket_referencia: row.referencia || null,
          created_by: profile.userId,
        })),
      ...declaration.retirosSupervisor
        .filter((row) => row.importe > 0)
        .map((row) => ({
          cierre_id: cierreId,
          tipo: 'supervisor',
          importe: row.importe,
          ticket_referencia: row.referencia || null,
          created_by: profile.userId,
        })),
      ...(declaration.cierreEfectivo > 0
        ? [{
            cierre_id: cierreId,
            tipo: 'cierre',
            importe: declaration.cierreEfectivo,
            ticket_referencia: 'Cierre de caja',
            created_by: profile.userId,
          }]
        : []),
    ];
    if (retiroRows.length) {
      const { error } = await supabase.from('donato_cierre_retiros').insert(retiroRows);
      if (error) throw new Error(error.message);
    }

    const cashbackRows = declaration.cashbacks
      .filter((row) => row.importe > 0)
      .map((row) => ({
        cierre_id: cierreId,
        importe: row.importe,
        referencia: row.referencia || null,
        created_by: profile.userId,
      }));
    if (cashbackRows.length) {
      const { error } = await supabase.from('donato_cierre_cashback').insert(cashbackRows);
      if (error) throw new Error(error.message);
    }

    const ccRows = declaration.cuentasCorrientes
      .filter((row) => row.importe > 0 || row.comprobante)
      .map((row) => ({
        cierre_id: cierreId,
        comprobante: row.comprobante || 'SIN NUMERO',
        cliente_nombre: row.cliente || null,
        importe: row.importe,
        documentacion_recibida: true,
      }));
    if (ccRows.length) {
      const { error } = await supabase.from('donato_cierre_cuentas_corrientes').insert(ccRows);
      if (error) throw new Error(error.message);
    }
  }

  async function writeAudit(accion: string, detalle: unknown) {
    if (!supabase || !closure) return;
    const { error } = await supabase.from('donato_cierre_auditoria').insert({
      cierre_id: closure.id,
      user_id: profile.userId,
      accion,
      detalle,
    });
    if (error) throw new Error(error.message);
  }

  async function persistComparison(
    result: BlindComparison,
    finalStatus: ClosureStatus,
    extra: Record<string, unknown> = {}
  ) {
    if (!supabase || !closure) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('donato_cierres_caja')
      .update({
        estado: finalStatus,
        diferencias_supervisor: result,
        conceptos_ok: result.conceptosOk,
        caja_ok: result.cajaOk,
        administrativo_ok: result.administrativoOk ?? null,
        closed_at: finalStatus === 'CERRADO' ? now : null,
        submitted_at: finalStatus === 'PENDIENTE_VALIDACION' ? now : null,
        ...extra,
      })
      .eq('id', closure.id);
    if (error) throw new Error(error.message);
  }

  async function firstClose() {
    if (!supabase || !closure) return;
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('donato_cierres_caja')
      .update({
        estado: 'REVISION_SUPERVISOR',
        clover_fisico: declaration.cloverFisico,
        payway_fisico: declaration.paywayFisico,
        cashback_fisico: totalCashback,
        efectivo_cierre: declaration.cierreEfectivo,
        efectivo_rendido: efectivoRendido,
        declaracion_ciega: declaration,
        declaracion_ciega_inicial: declaration,
        carga_ciega_cerrada_at: now,
        revision_supervisor_count: 0,
      })
      .eq('id', closure.id);
    if (error) throw new Error(error.message);

    await replaceDeclarationDetails(closure.id);
    await writeAudit('PRIMER_CIERRE_SUPERVISOR', {
      cierre_nro: closure.cierre_nro,
      declaracion: declaration,
    });

    setClosure((current) => current ? {
      ...current,
      estado: 'REVISION_SUPERVISOR',
      declaracion_ciega: declaration,
      declaracion_ciega_inicial: declaration,
      carga_ciega_cerrada_at: now,
      revision_supervisor_count: 0,
    } : current);

    const result = await loadBlindComparison(closure.id);
    if (!result) return;

    if (result.hayDiferencias) {
      await persistComparison(result, 'REVISION_SUPERVISOR');
      await writeAudit('PRIMER_CONTROL_CON_DIFERENCIAS', {
        cierre_nro: closure.cierre_nro,
        resultado: result,
      });
      setClosure((current) => current ? {
        ...current,
        estado: 'REVISION_SUPERVISOR',
        diferencias_supervisor: result,
        conceptos_ok: result.conceptosOk,
        caja_ok: result.cajaOk,
      } : current);
    } else {
      await persistComparison(result, 'CERRADO');
      await writeAudit(result.hayPendienteAdministrativo ? 'CIERRE_CON_PENDIENTE_ADMINISTRATIVO' : 'CIERRE_SIN_DIFERENCIAS', {
        cierre_nro: closure.cierre_nro,
        resultado: result,
      });
      setClosure((current) => current ? {
        ...current,
        estado: 'CERRADO',
        diferencias_supervisor: result,
        conceptos_ok: true,
        caja_ok: true,
      } : current);
      await loadDashboard();
    }
  }

  async function secondClose() {
    if (!supabase || !closure) return;
    const now = new Date().toISOString();
    const previousDeclaration = closure.declaracion_ciega ?? closure.declaracion_ciega_inicial ?? null;
    const revisionNumber = Number(closure.revision_supervisor_count || 0) + 1;

    const { error } = await supabase
      .from('donato_cierres_caja')
      .update({
        clover_fisico: declaration.cloverFisico,
        payway_fisico: declaration.paywayFisico,
        cashback_fisico: totalCashback,
        efectivo_cierre: declaration.cierreEfectivo,
        efectivo_rendido: efectivoRendido,
        declaracion_ciega: declaration,
        revision_supervisor_count: revisionNumber,
        revision_supervisor_at: now,
        correccion_motivo: revisionNote.trim() || null,
      })
      .eq('id', closure.id);
    if (error) throw new Error(error.message);

    await replaceDeclarationDetails(closure.id);
    await writeAudit('REVISION_SUPERVISOR', {
      cierre_nro: closure.cierre_nro,
      revision: revisionNumber,
      antes: previousDeclaration,
      despues: declaration,
      observacion: revisionNote.trim() || null,
    });

    setClosure((current) => current ? {
      ...current,
      declaracion_ciega: declaration,
      revision_supervisor_count: revisionNumber,
      revision_supervisor_at: now,
      correccion_motivo: revisionNote.trim() || null,
    } : current);

    const result = await loadBlindComparison(closure.id);
    if (!result) return;

    const finalStatus: ClosureStatus = result.hayDiferencias ? 'PENDIENTE_VALIDACION' : 'CERRADO';
    await persistComparison(result, finalStatus, {
      revision_supervisor_count: revisionNumber,
      revision_supervisor_at: now,
      correccion_motivo: revisionNote.trim() || null,
    });
    await writeAudit(
      result.hayDiferencias
        ? 'ENVIADO_A_VALIDACION'
        : result.hayPendienteAdministrativo
          ? 'CIERRE_CORREGIDO_CON_PENDIENTE_ADMINISTRATIVO'
          : 'CIERRE_CORREGIDO_SIN_DIFERENCIAS',
      { cierre_nro: closure.cierre_nro, resultado: result, revision: revisionNumber }
    );

    setClosure((current) => current ? {
      ...current,
      estado: finalStatus,
      diferencias_supervisor: result,
      conceptos_ok: result.conceptosOk,
      caja_ok: result.cajaOk,
    } : current);
    await loadDashboard();
  }

  async function closeCashBox() {
    if (!closure || !isSupervisor || !canEditDeclaration) return;
    setBusy(true);
    setActionError(null);
    try {
      if (closure.estado === 'BORRADOR') await firstClose();
      else if (closure.estado === 'REVISION_SUPERVISOR') await secondClose();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo cerrar la caja');
    } finally {
      setBusy(false);
    }
  }

  async function cancelClosure() {
    if (!supabase || !closure || !isSupervisor || !['BORRADOR', 'REVISION_SUPERVISOR'].includes(closure.estado)) return;
    const confirmed = window.confirm(
      `¿Cancelar el Cierre ${closure.cierre_nro}? El cajero volverá a aparecer como pendiente y este intento quedará guardado como cancelado.`
    );
    if (!confirmed) return;

    setBusy(true);
    setActionError(null);
    try {
      const now = new Date().toISOString();
      const motivo = closure.estado === 'BORRADOR'
        ? 'Cancelado durante la carga del Supervisor'
        : 'Cancelado durante la revisión del Supervisor';

      const { error } = await supabase
        .from('donato_cierres_caja')
        .update({
          estado: 'CANCELADO',
          declaracion_ciega: declaration,
          cancelado_at: now,
          cancelado_por: profile.userId,
          cancelacion_motivo: motivo,
        })
        .eq('id', closure.id);
      if (error) throw new Error(error.message);

      setSelectedJourney(null);
      setClosure(null);
      setBlindComparison(null);
      setSnapshot(null);
      setFullComparison(null);
      setRevisionNote('');
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo cancelar el cierre');
    } finally {
      setBusy(false);
    }
  }

  async function persistApproverCashChanges(reloadComparison = true) {
    if (!supabase || !closure || !canApproverEditCash) return null;

    const { data, error } = await supabase.rpc('encargado_modificar_cierre_donato', {
      p_cierre_id: closure.id,
      p_fondo_inicial: approverCash.fondoInicial,
      p_fondo_devuelto: approverCash.fondoDevuelto,
      p_efectivo_entregado_cierre: approverCash.efectivoEntregadoCierre,
    });
    if (error) throw new Error(error.message);

    const updated = (Array.isArray(data) ? data[0] : data) as ClosureRow | null;
    if (!updated) throw new Error('Supabase no devolvió el cierre actualizado');

    setClosure((current) => current ? { ...current, ...updated } : updated);
    setDeclaration((current) => ({
      ...current,
      cierreEfectivo: Number(updated.efectivo_entregado_cierre || 0),
    }));
    setApproverCashDirty(false);

    if (reloadComparison) {
      await loadFullSnapshot(closure.id);
    }
    return updated;
  }

  async function saveApproverCashChanges() {
    if (!canApproverEditCash) return;
    setBusy(true);
    setActionError(null);
    try {
      await persistApproverCashChanges(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudieron guardar las correcciones');
    } finally {
      setBusy(false);
    }
  }

  async function approveAdjustments() {
    if (!supabase || !closure || !isApprover) return;
    setBusy(true);
    setActionError(null);
    try {
      if (approverCashDirty) {
        await persistApproverCashChanges(false);
      }
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('donato_cierres_caja')
        .update({
          estado: 'AJUSTES_AUTORIZADOS',
          encargado_user_id: profile.userId,
          validated_at: now,
        })
        .eq('id', closure.id);
      if (error) throw new Error(error.message);

      await writeAudit('AJUSTES_AUTORIZADOS', {
        cierre_nro: closure.cierre_nro,
        validado_por: profile.userId,
      });
      setClosure((current) => current ? { ...current, estado: 'AJUSTES_AUTORIZADOS' } : current);
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudieron autorizar los ajustes');
    } finally {
      setBusy(false);
    }
  }

  function renderMoneyRows(
    key: 'depositario' | 'retirosSupervisor' | 'cashbacks',
    placeholder: string
  ) {
    const rows = declaration[key];
    if (!rows.length) return <p className="empty-detail">Sin registros cargados.</p>;
    return (
      <div className="detail-rows">
        {rows.map((row) => (
          <div className="detail-row" key={row.id}>
            <input
              disabled={!canEditDeclaration}
              className="text-input"
              placeholder={placeholder}
              value={row.referencia}
              onChange={(event) => updateMoneyRows(key, row.id, { referencia: event.target.value })}
            />
            <div className={`money-input compact ${!canEditDeclaration ? 'locked-input' : ''}`}>
              <span>$</span>
              <input
                disabled={!canEditDeclaration}
                type="number"
                step="0.01"
                value={row.importe || ''}
                onChange={(event) => updateMoneyRows(key, row.id, { importe: Number(event.target.value) || 0 })}
              />
            </div>
            {canEditDeclaration ? (
              <button className="icon-button" type="button" onClick={() => removeMoneyRow(key, row.id)}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  function reviewRows(result: BlindComparison) {
    const rows = [
      { label: 'Clover', ok: result.coincidencias.clover, detail: 'Cierre de lote Clover' },
      { label: 'Payway', ok: result.coincidencias.payway, detail: 'Cierre de lote Payway' },
      { label: 'Control administrativo RETI', ok: result.coincidencias.retiros, detail: result.errorRegistroAdministrativo ? 'Error de registración: no existe un movimiento o combinación completa que coincida con lo físico' : result.hayPendienteAdministrativo ? 'Hay movimientos completos pendientes para el próximo cierre de esta caja' : 'Documentación conciliada con Sigma' },
      { label: 'Cuenta corriente', ok: result.coincidencias.cuentaCorriente, detail: 'Documentación recibida' },
      { label: 'Resultado de caja', ok: result.cajaOk, detail: 'Faltante o sobrante neto' },
    ];
    return (
      <div className="blind-check-list">
        {rows.map((row) => (
          <div key={row.label} className={`blind-check-row ${row.ok ? 'ok' : 'review'}`}>
            {row.ok ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}
            <div>
              <strong>{row.label}</strong>
              <span>{row.ok ? 'Coincide' : 'Revisar: no coincide'}</span>
              <small>{row.detail}</small>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function statusLabel(item: ClosureRow) {
    if (item.estado === 'BORRADOR') return 'Carga iniciada';
    if (item.estado === 'REVISION_SUPERVISOR') return 'Revisar cierre';
    if (item.estado === 'PENDIENTE_VALIDACION') return 'Validación';
    if (item.estado === 'AJUSTES_AUTORIZADOS') return 'Ajustes autorizados';
    if (item.estado === 'AJUSTADO') return 'Ajustado';
    if (item.estado === 'CANCELADO') return 'Cancelado';
    return 'Cerrado';
  }

  function closureMeta(item: ClosureRow) {
    const cut = displayTime(item.corte_hasta_at || item.sigma_snapshot_capturado_at);
    const datePrefix = item.fecha !== today ? `${displayDate(item.fecha)} · ` : '';
    return `${datePrefix}Caja ${item.caja_codigo || '—'} · Cierre ${item.cierre_nro}${cut ? ` · ${cut}` : ''}`;
  }

  async function downloadCurrentClosurePdf() {
    if (!closure || !selectedJourney) return;
    setActionError(null);
    try {
      let reportSnapshot = snapshot;
      let reportComparison = fullComparison;
      if (isApprover && !reportSnapshot && ['PENDIENTE_VALIDACION', 'CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(closure.estado)) {
        const loaded = await loadFullSnapshot(closure.id);
        if (loaded) { reportSnapshot = loaded.snapshot; reportComparison = loaded.comparison; }
      }
      await downloadClosurePdf({
        closure: { fecha: closure.fecha, cierre_nro: closure.cierre_nro, estado: closure.estado, caja_codigo: closure.caja_codigo, usuario_sigma_codigo: closure.usuario_sigma_codigo, usuario_sigma_nombre: closure.usuario_sigma_nombre, corte_desde_at: closure.corte_desde_at, corte_hasta_at: closure.corte_hasta_at, sigma_snapshot_capturado_at: closure.sigma_snapshot_capturado_at },
        declaration, blindComparison: blindComparison ?? closure.diferencias_supervisor ?? null, snapshot: reportSnapshot, fullComparison: reportComparison, generatedBy: profile.nombre || profile.email,
      });
    } catch (error) { setActionError(error instanceof Error ? error.message : 'No se pudo generar el PDF'); }
  }

  if ((!selectedJourney || !closure) && dashboardMode === 'history') {
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand"><DonatoBrand /></div>
          <nav>
            <button className="nav-item" onClick={() => { setDashboardMode('today'); void loadDashboard(); }}><ClipboardCheck size={18} /> Cierre de caja</button>
            <button className="nav-item active"><Clock3 size={18} /> Historial</button>
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
            <div>
              <p className="eyebrow">HISTORIAL</p>
              <h1>Historial de cierres de caja</h1>
              <p>Consultá cierres anteriores, pendientes de validación y reportes históricos.</p>
            </div>
            <button className="refresh-button" onClick={() => void loadHistory()} disabled={loadingHistory}>
              <RefreshCw size={16} /> Actualizar
            </button>
          </header>

          <section className="panel dashboard-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">FILTRO</p><h2>Buscar por fecha</h2></div>
              <Clock3 size={22} />
            </div>
            <div className="section-title-row">
              <input className="text-input" type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
              {historyDate ? <button className="add-row-button" type="button" onClick={() => setHistoryDate('')}>Ver todos</button> : null}
            </div>
          </section>

          {historyError ? <div className="error-banner">{historyError}</div> : null}

          {historyDate && profile.rol === 'administrador' ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">CONTROL RÁPIDO · SÓLO SIGMA</p><h2>Cómo da la caja según registración</h2></div>
                <Banknote size={22} />
              </div>
              <p className="muted-copy">No compara contra documentación física. El control histórico reconstruye el cierre registrado en Sigma: Venta − RETI − Clover − Payway − Naranja − Cuenta corriente. Un resultado positivo es faltante; uno negativo es sobrante.</p>
              {quickControlCriterion ? <p className="muted-copy"><strong>Cruce RETI:</strong> {quickControlCriterion}.</p> : null}
              {loadingHistory ? (
                <div className="empty-state"><Clock3 /><div><strong>Reconstruyendo control…</strong><p>Cruzando secuencia contable y horarios de venta.</p></div></div>
              ) : quickControls.length ? (
                <div className="cashier-list">
                  {quickControls.map((item) => (
                    <div key={`quick-${item.usuarioCodigo}`} className="cashier-card">
                      <div className="cashier-avatar">{item.usuarioNombre.slice(0, 1)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{item.usuarioNombre}</strong>
                        <span>Caja {item.cajaCodigo || '—'} · {item.primeraVentaHora || '—'} a {item.ultimaVentaHora || '—'} · Venta {money.format(item.venta)}</span>
                        <span>Efectivo CODO {money.format(item.efectivoCodo)} · RETI {money.format(item.retirosAsignados)} · Clover {money.format(item.clover)} · Payway {money.format(item.payway)} · Naranja {money.format(item.naranja)} · Cta. Cte. {money.format(item.cuentaCorriente)}</span>
                        {item.retiros.length ? <small>{item.retiros.map((r) => `RETI ${r.id} ${money.format(r.importe)} ~${r.horaAproximada || 's/h'} (${r.confianza})`).join(' · ')}</small> : null}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div className="cashier-state done">Saldo efectivo {money.format(item.efectivoTeoricoRestante)}</div>
                        <div className={`cashier-state ${item.estadoDiferencia === 'OK' ? 'done' : 'review'}`}>
                          {item.estadoDiferencia === 'OK'
                            ? 'Sin diferencia'
                            : `${item.estadoDiferencia === 'FALTANTE' ? 'Faltante' : 'Sobrante'} ${money.format(Math.abs(item.diferenciaSigma))}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state"><Banknote /><div><strong>Sin datos para controlar</strong><p>No se pudo reconstruir actividad de caja para esa fecha.</p></div></div>
              )}
              {quickControlUnassigned.length ? (
                <div className="error-banner">Atención: {quickControlUnassigned.length} RETI no pudieron asignarse con seguridad a un cajero. No se incluyen en los saldos individuales.</div>
              ) : null}
            </section>
          ) : null}

          {historyDate ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">VENTA POR CAJERO</p><h2>Jornada del {displayDate(historyDate)}</h2></div>
                <ReceiptText size={22} />
              </div>
              {loadingHistory ? (
                <div className="empty-state"><Clock3 /><div><strong>Consultando Sigma…</strong><p>Reconstruyendo ventas y cierres pendientes de la fecha.</p></div></div>
              ) : historyJourneys.length ? (
                <div className="cashier-list">
                  {historyJourneys.map((journey) => {
                    const userClosures = historyClosures
                      .filter((item) => item.fecha === journey.fecha && Number(item.usuario_sigma_codigo) === Number(journey.usuarioCodigo) && item.estado !== 'CANCELADO')
                      .sort((a, b) => Number(b.cierre_nro || 0) - Number(a.cierre_nro || 0));
                    const editable = userClosures.find((item) => ['BORRADOR', 'REVISION_SUPERVISOR'].includes(item.estado));
                    const latest = userClosures[0] || null;
                    const pending = journey.tieneActividadNueva === true;
                    const stateLabel = editable ? statusLabel(editable) : pending ? 'Pendiente de cierre' : latest ? statusLabel(latest) : 'Sin pendiente';
                    const stateClass = pending || editable?.estado === 'BORRADOR' ? 'pending' : latest && ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(latest.estado) ? 'done' : 'review';
                    return (
                      <button
                        key={`history-${journey.fecha}-${journey.usuarioCodigo}`}
                        className={`cashier-card ${!pending && latest && ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(latest.estado) ? 'completed' : ''}`}
                        disabled={pending && !editable && !isSupervisor}
                        onClick={() => {
                          if (editable) void openExistingClosure(editable);
                          else if (pending) void startPendingJourney(journey);
                          else if (latest) void openExistingClosure(latest);
                        }}
                      >
                        <div className="cashier-avatar">{journey.usuarioNombre.slice(0, 1)}</div>
                        <div>
                          <strong>{journey.usuarioNombre}</strong>
                          <span>
                            {journey.cajaCodigo ? `Caja ${journey.cajaCodigo} · ` : ''}
                            Venta {money.format(Number(journey.venta || 0))}
                            {journey.cantidadVentas ? ` · ${journey.cantidadVentas} ventas` : ''}
                            {journey.ultimaVentaHora ? ` · última ${journey.ultimaVentaHora}` : ''}
                          </span>
                        </div>
                        <div className={`cashier-state ${stateClass}`}>{stateLabel}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state"><ReceiptText /><div><strong>Sin ventas para esa fecha</strong><p>Sigma no registra actividad de cajeros en el día seleccionado.</p></div></div>
              )}
            </section>
          ) : null}

          <section className="panel dashboard-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">CIERRES REGISTRADOS</p><h2>{historyDate ? `Cierres del ${displayDate(historyDate)}` : 'Últimos cierres'}</h2></div>
              <FileText size={22} />
            </div>
            {loadingHistory ? (
              <div className="empty-state"><Clock3 /><div><strong>Cargando historial…</strong><p>Consultando cierres guardados.</p></div></div>
            ) : filteredHistoryClosures.length ? (
              <div className="cashier-list">
                {filteredHistoryClosures.map((item) => (
                  <button key={item.id} className={`cashier-card ${['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado) ? 'completed' : ''}`} onClick={() => void openExistingClosure(item)}>
                    <div className="cashier-avatar">{item.usuario_sigma_nombre.slice(0, 1)}</div>
                    <div>
                      <strong>{item.usuario_sigma_nombre}</strong>
                      <span>{displayDate(item.fecha)} · Caja {item.caja_codigo || '—'} · Cierre {item.cierre_nro}</span>
                    </div>
                    <div className={`cashier-state ${['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado) ? 'done' : item.estado === 'BORRADOR' ? 'pending' : 'review'}`}>{statusLabel(item)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state"><FileText /><div><strong>No hay cierres para mostrar</strong><p>{historyDate ? 'No se registraron cierres en esa fecha.' : 'Todavía no hay cierres en el historial.'}</p></div></div>
            )}
          </section>
        </main>
      </div>
    );
  }

  if (!selectedJourney || !closure) {
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand"><DonatoBrand /></div>
          <nav>
            <button className={`nav-item ${dashboardMode === 'today' ? 'active' : ''}`} onClick={() => { setDashboardMode('today'); setSelectedJourney(null); setClosure(null); void loadDashboard(); }}><ClipboardCheck size={18} /> Cierre de caja</button>
            <button className={`nav-item ${dashboardMode === 'history' ? 'active' : ''}`} onClick={() => { setDashboardMode('history'); setSelectedJourney(null); setClosure(null); void loadHistory(); }}><Clock3 size={18} /> Historial</button>
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
            <div>
              <p className="eyebrow">CIERRES DE HOY</p>
              <h1>Cajas del {displayDate(today)}</h1>
              <p>Un cajero puede tener más de un cierre si su jornada se corta y luego vuelve a operar.</p>
            </div>
            <button className="refresh-button" onClick={() => void loadDashboard()} disabled={loadingDashboard}>
              <RefreshCw size={16} /> Actualizar
            </button>
          </header>

          <div className="blind-notice">
            <LockKeyhole size={22} />
            <div>
              <strong>Control ciego por tramo de jornada</strong>
              <p>Cada cierre congela Sigma en ese momento. Las ventas posteriores generan automáticamente un nuevo cierre pendiente para el mismo cajero.</p>
            </div>
          </div>

          {dashboardError ? <div className="error-banner">{dashboardError}</div> : null}

          <section className="panel dashboard-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">PENDIENTES</p><h2>Cajas pendientes de cierre</h2></div>
              <EyeOff size={22} />
            </div>

            {loadingDashboard ? (
              <div className="empty-state"><Clock3 /><div><strong>Consultando Sigma…</strong><p>Buscando ventas todavía no incluidas en un cierre.</p></div></div>
            ) : pendingJourneys.length ? (
              <div className="cashier-list">
                {pendingJourneys.map((journey) => (
                  <button
                    key={`${journey.usuarioCodigo}-${journey.proximoCierreNumero || 1}`}
                    className="cashier-card"
                    onClick={() => void startPendingJourney(journey)}
                    disabled={!isSupervisor || busy}
                  >
                    <div className="cashier-avatar">{journey.usuarioNombre.slice(0, 1)}</div>
                    <div>
                      <strong>{journey.usuarioNombre}</strong>
                      <span>
                        {journey.cajaCodigo ? `Caja ${journey.cajaCodigo} · ` : ''}
                        Cierre {journey.proximoCierreNumero || 1}
                        {journey.ultimaVentaHora ? ` · última venta ${journey.ultimaVentaHora}` : ''}
                      </span>
                    </div>
                    <div className="cashier-state pending">Pendiente</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="success-box"><CheckCircle2 /><div><strong>No hay cajas pendientes</strong><p>Todas las ventas registradas hasta ahora están incluidas en un cierre iniciado o sellado.</p></div></div>
            )}
          </section>

          {inProgressClosures.length ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading"><div><p className="eyebrow">EN CURSO</p><h2>Cierres iniciados o en validación</h2></div><Clock3 size={22} /></div>
              <div className="cashier-list">
                {inProgressClosures.map((item) => (
                  <button key={item.id} className="cashier-card" onClick={() => void openExistingClosure(item)}>
                    <div className="cashier-avatar">{item.usuario_sigma_nombre.slice(0, 1)}</div>
                    <div><strong>{item.usuario_sigma_nombre}</strong><span>{closureMeta(item)}</span></div>
                    <div className={`cashier-state ${item.estado !== 'BORRADOR' ? 'review' : ''}`}>{statusLabel(item)}</div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {completedClosures.length ? (
            <section className="panel dashboard-panel compact-panel">
              <div className="panel-heading"><div><p className="eyebrow">COMPLETADOS HOY</p><h2>Cierres sellados</h2></div><CheckCircle2 size={22} /></div>
              <div className="cashier-list">
                {completedClosures.map((item) => (
                  <button key={item.id} className="cashier-card completed" onClick={() => void openExistingClosure(item)}>
                    <div className="cashier-avatar">{item.usuario_sigma_nombre.slice(0, 1)}</div>
                    <div><strong>{item.usuario_sigma_nombre}</strong><span>{closureMeta(item)}</span></div>
                    <div className="cashier-state done">{statusLabel(item)}</div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    );
  }

  const visibleBlindResult = blindComparison ?? closure.diferencias_supervisor ?? null;
  const isSupervisorReview = closure.estado === 'REVISION_SUPERVISOR' && visibleBlindResult;
  const isWaitingValidation = closure.estado === 'PENDIENTE_VALIDACION';
  const cutFrom = displayTime(closure.corte_desde_at);
  const cutTo = displayTime(closure.corte_hasta_at || closure.sigma_snapshot_capturado_at);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><DonatoBrand /></div>
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
        <button
          className="back-button"
          onClick={() => {
            setSelectedJourney(null);
            setClosure(null);
            setBlindComparison(null);
            setSnapshot(null);
            setFullComparison(null);
            if (dashboardMode === 'history') void loadHistory();
            else void loadDashboard();
          }}
        >
          <ArrowLeft size={17} /> Volver a cajas
        </button>

        <header className="topbar">
          <div>
            <p className="eyebrow">CIERRE DE CAJA · CIERRE {closure.cierre_nro}</p>
            <h1>{selectedJourney.usuarioNombre} · {selectedJourney.cajaCodigo ? `Caja ${selectedJourney.cajaCodigo}` : 'Caja por detectar'}</h1>
            <p>
              {displayDate(selectedJourney.fecha)} · Usuario Sigma {selectedJourney.usuarioCodigo}
              {cutFrom || cutTo ? ` · tramo ${cutFrom || 'inicio'}–${cutTo || 'en curso'}` : ''}
            </p>
          </div>
          <div className="topbar-closure-actions">
  {canEditDeclaration ? (
    <button className="cancel-closure-button header-cancel-button" type="button" onClick={() => void cancelClosure()} disabled={busy}>
      <XCircle size={17} /> Cancelar cierre
    </button>
  ) : null}
  {['PENDIENTE_VALIDACION', 'CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(closure.estado) ? (
    <button className="refresh-button" type="button" onClick={() => void downloadCurrentClosurePdf()} disabled={busy}>
      <FileText size={16} /> Descargar PDF
    </button>
  ) : null}
  <div className={closure.estado === 'BORRADOR' ? 'blind-badge' : `status-pill status-${closure.estado.toLowerCase()}`}>
    {closure.estado === 'BORRADOR' ? <><EyeOff size={16} /> CONTROL CIEGO</> : statusLabel(closure)}
  </div>
</div>
        </header>

        {closure.estado === 'BORRADOR' ? (
          <div className="blind-notice"><EyeOff size={22} /><div><strong>Control ciego activo</strong><p>Cargá únicamente lo recibido para este tramo. No se muestran importes de Sigma.</p></div></div>
        ) : null}
        {isSupervisorReview ? (
          <div className="review-notice"><AlertTriangle size={22} /><div><strong>Revisá el cierre antes de confirmarlo</strong><p>El primer control detectó diferencias. El corte de Sigma ya quedó congelado, por lo que ventas posteriores no modificarán este cierre.</p></div></div>
        ) : null}
        {isWaitingValidation && !isApprover ? (
          <div className="waiting-box"><ShieldCheck size={20} /> El segundo control todavía presenta diferencias. Este cierre quedó sellado y fue enviado al Encargado; una jornada posterior puede abrir un nuevo cierre.</div>
        ) : null}
        {closure.estado === 'CERRADO' && !isApprover ? (
          <div className="success-box"><CheckCircle2 /><div><strong>Cierre {closure.cierre_nro} finalizado</strong><p>Las ventas posteriores, si las hubiera, aparecerán en un nuevo cierre pendiente.</p></div></div>
        ) : null}
        {actionError ? <div className="error-banner">{actionError}</div> : null}

        {isApprover && snapshot && ['PENDIENTE_VALIDACION', 'AJUSTES_AUTORIZADOS', 'AJUSTADO', 'CERRADO'].includes(closure.estado) ? (
          <section className="summary-strip reveal-animation">
            <Metric label={`Venta Sigma · Cierre ${closure.cierre_nro}`} value={snapshot.venta} />
            <Metric label="Efectivo Sigma" value={snapshot.efectivo} />
            <Metric label="Cuenta corriente Sigma" value={snapshot.cuentaCorriente} />
            <Metric label="Comprobantes pendientes" value={snapshot.pendienteContado} tone={snapshot.pendienteContado ? 'warn' : 'default'} />
          </section>
        ) : null}

        <div className={isApprover && snapshot && fullComparison ? 'content-grid' : 'blind-form-grid'}>
          <section className="panel physical-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">DATOS DEL CIERRE {closure.cierre_nro}</p>
                <h2>{closure.estado === 'BORRADOR' ? 'Cargá lo recibido del cajero' : canEditDeclaration ? 'Revisá y corregí si corresponde' : 'Datos informados por el Supervisor'}</h2>
              </div>
              {canEditDeclaration ? <ShieldCheck size={22} /> : <LockKeyhole size={22} />}
            </div>

            <div className="form-section">
              <h3><CreditCard size={18} /> Cierres de terminales</h3>
              <div className="two-cols">
                <NumberInput disabled={!canEditDeclaration} label="Clover" value={declaration.cloverFisico} onChange={(value) => setDeclaration((current) => ({ ...current, cloverFisico: value }))} hint="Importe del cierre de lote" />
                <NumberInput disabled={!canEditDeclaration} label="Payway" value={declaration.paywayFisico} onChange={(value) => setDeclaration((current) => ({ ...current, paywayFisico: value }))} hint="Importe del cierre de lote" />
              </div>
            </div>

            <div className="form-section">
              <div className="section-title-row">
                <h3><ReceiptText size={18} /> Tickets del depositario</h3>
                {canEditDeclaration ? <button className="add-row-button" type="button" onClick={() => addMoneyRow('depositario')}><Plus size={15} /> Agregar</button> : null}
              </div>
              {renderMoneyRows('depositario', 'Nº ticket / referencia')}
              <div className="inline-total"><span>Total entregado al depositario</span><strong>{money.format(totalDepositario)}</strong></div>
            </div>

            <div className="form-section">
              <div className="section-title-row">
                <h3><Banknote size={18} /> Retiros realizados por supervisores</h3>
                {canEditDeclaration ? <button className="add-row-button" type="button" onClick={() => addMoneyRow('retirosSupervisor')}><Plus size={15} /> Agregar</button> : null}
              </div>
              {renderMoneyRows('retirosSupervisor', 'Supervisor / referencia')}
            </div>

            <div className="form-section">
              <h3><Banknote size={18} /> Efectivo de cierre</h3>
              <NumberInput disabled={!canEditDeclaration} label="Efectivo recibido al cerrar la caja" value={declaration.cierreEfectivo} onChange={(value) => setDeclaration((current) => ({ ...current, cierreEfectivo: value }))} />
              <div className="inline-total"><span>Total efectivo rendido</span><strong>{money.format(efectivoRendido)}</strong></div>
            </div>

            <div className="form-section">
              <div className="section-title-row">
                <h3><WalletCards size={18} /> Cashback entregado</h3>
                {canEditDeclaration ? <button className="add-row-button" type="button" onClick={() => addMoneyRow('cashbacks')}><Plus size={15} /> Agregar</button> : null}
              </div>
              {renderMoneyRows('cashbacks', 'Ticket / terminal / referencia')}
              <div className="inline-total"><span>Total cashback informado</span><strong>{money.format(totalCashback)}</strong></div>
            </div>

            <div className="form-section">
              <div className="section-title-row">
                <h3><FileText size={18} /> Facturas en cuenta corriente recibidas</h3>
                {canEditDeclaration ? <button className="add-row-button" type="button" onClick={addCurrentAccount}><Plus size={15} /> Agregar</button> : null}
              </div>
              {declaration.cuentasCorrientes.length ? (
                <div className="cc-rows">
                  {declaration.cuentasCorrientes.map((row) => (
                    <div className="cc-row" key={row.id}>
                      <input disabled={!canEditDeclaration} className="text-input" placeholder="Comprobante" value={row.comprobante} onChange={(event) => updateCurrentAccount(row.id, { comprobante: event.target.value })} />
                      <input disabled={!canEditDeclaration} className="text-input" placeholder="Cliente" value={row.cliente} onChange={(event) => updateCurrentAccount(row.id, { cliente: event.target.value })} />
                      <div className={`money-input compact ${!canEditDeclaration ? 'locked-input' : ''}`}>
                        <span>$</span>
                        <input disabled={!canEditDeclaration} type="number" value={row.importe || ''} onChange={(event) => updateCurrentAccount(row.id, { importe: Number(event.target.value) || 0 })} />
                      </div>
                      {canEditDeclaration ? <button className="icon-button" onClick={() => setDeclaration((current) => ({ ...current, cuentasCorrientes: current.cuentasCorrientes.filter((item) => item.id !== row.id) }))}><Trash2 size={16} /></button> : null}
                    </div>
                  ))}
                </div>
              ) : <p className="empty-detail">Sin documentación de cuenta corriente cargada.</p>}
              <div className="inline-total"><span>Total cuenta corriente declarada</span><strong>{money.format(totalCuentaCorrienteFisica)}</strong></div>
            </div>

            {closure.estado === 'REVISION_SUPERVISOR' && canEditDeclaration ? (
              <div className="form-section">
                <label className="field">
                  <span>Observación de la revisión (opcional)</span>
                  <textarea className="review-textarea" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="Ej.: se corrigió un ticket cargado con importe incorrecto." />
                </label>
              </div>
            ) : null}

            {canEditDeclaration ? (
              <>
                {firstCloseDone
                  ? <p className="close-help">Este es el segundo control del Cierre {closure.cierre_nro}. Si siguen existiendo diferencias, pasa al Encargado Donato.</p>
                  : <p className="close-help">Al cerrar se congela el tramo de Sigma. Todo movimiento posterior quedará para el próximo cierre del cajero.</p>}
                <div className="closure-actions closure-actions-single">
                  <button className="primary-button close-blind-button" onClick={() => void closeCashBox()} disabled={busy}><ClipboardCheck size={18} /> {busy ? 'Cerrando…' : 'Cerrar caja'}</button>
                </div>
              </>
            ) : null}
          </section>

          {isApprover && snapshot && fullComparison ? (
            <section className="panel reconciliation-panel reveal-animation">
              <div className="panel-heading"><div><p className="eyebrow">VALIDACIÓN DEL ENCARGADO · CIERRE {closure.cierre_nro}</p><h2>Sigma vs. cierre informado</h2></div><ArrowRightLeft size={22} /></div>
              <div className="compare-list">
                <div className="compare-row"><div><span>Clover Sigma</span><strong>{money.format(snapshot.cloverDirecto + snapshot.naranja)}</strong><small>Clover/QR Clover + Naranja</small></div><div className="compare-arrow">→</div><div><span>Cierre informado</span><strong>{money.format(declaration.cloverFisico)}</strong><small className={fullComparison.coincidencias.clover ? 'positive' : 'negative'}>{money.format(fullComparison.diferencias.clover)} de diferencia</small></div></div>
                <div className="compare-row"><div><span>Payway Sigma</span><strong>{money.format(snapshot.payway)}</strong></div><div className="compare-arrow">→</div><div><span>Cierre informado</span><strong>{money.format(declaration.paywayFisico)}</strong><small className={fullComparison.coincidencias.payway ? 'positive' : 'negative'}>{money.format(fullComparison.diferencias.payway)} de diferencia</small></div></div>
                <div className="compare-row reti-compare-row"><div><span>Movimientos RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Se concilian movimientos completos; nunca se parte un RETI para hacer coincidir un saldo.</small>{snapshot.retirosDocumentos?.length ? <div className="reti-detail-list">{snapshot.retirosDocumentos.map((retiro: any, index) => <div className="reti-detail-item" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.esDeltaInferido ? <small>Incremento detectado desde el corte anterior</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className="reti-detail-empty">Sin detalle individual guardado para este corte.</small>}</div><div className="compare-arrow">→</div><div><span>Documentación física del cierre</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong>{fullComparison.errorRegistroAdministrativo ? <><small className="negative">Error de registración Sigma</small><small>No existe un movimiento o combinación completa que coincida con el importe físico. No se divide la diferencia.</small></> : fullComparison.hayPendienteAdministrativo ? <><small className="negative">Pendiente administrativo</small><small>{fullComparison.retirosSigmaPendienteSalida ? `${money.format(fullComparison.retirosSigmaPendienteSalida)} en movimientos Sigma completos quedan para el próximo cierre.` : `${money.format(fullComparison.retirosFisicoPendienteSalida || 0)} de documentación física espera su RETI en Sigma.`}</small></> : <small className="positive">Conciliado por movimientos completos</small>}</div></div>
                <div className="compare-row"><div><span>Cuenta corriente Sigma</span><strong>{money.format(snapshot.cuentaCorriente)}</strong></div><div className="compare-arrow">→</div><div><span>Documentación recibida</span><strong>{money.format(totalCuentaCorrienteFisica)}</strong><small className={fullComparison.coincidencias.cuentaCorriente ? 'positive' : 'negative'}>{money.format(fullComparison.diferencias.cuentaCorriente)} de diferencia</small></div></div>
              </div>
              <div className="cash-result">
                <div><p className="eyebrow">RESULTADO NETO DEL TRAMO</p><h3>{fullComparison.cajaOk ? 'Dentro de tolerancia' : 'Requiere ajuste'}</h3><strong>{fullComparison.diferenciaCaja >= 0 ? 'Sobrante' : 'Faltante'} {money.format(Math.abs(fullComparison.diferenciaCaja))}</strong></div>
                <div className={fullComparison.cajaOk ? 'result-ok' : fullComparison.diferenciaCaja > 0 ? 'result-surplus' : 'result-shortage'}><span>{fullComparison.cajaOk ? 'Caja OK' : fullComparison.diferenciaCaja > 0 ? 'Sobrante' : 'Faltante'}</span><strong>{money.format(Math.abs(fullComparison.diferenciaCaja))}</strong></div>
              </div>
              {!fullComparison.conceptosOk && fullComparison.cajaOk ? <div className="finding-card"><AlertTriangle size={20} /><div><strong>Posibles conceptos cruzados</strong><p>El total del tramo está dentro de tolerancia, pero uno o más conceptos no coinciden.</p></div></div> : null}
              {fullComparison.conceptosOk && !fullComparison.cajaOk ? <div className="finding-card"><AlertTriangle size={20} /><div><strong>Los conceptos coinciden, pero la caja no</strong><p>Queda analizar el faltante o sobrante real del tramo.</p></div></div> : null}
              {!fullComparison.conceptosOk && !fullComparison.cajaOk ? <div className="finding-card"><AlertTriangle size={20} /><div><strong>Hay diferencias de conceptos y de caja</strong><p>Primero revisá las imputaciones y luego el faltante o sobrante que permanezca.</p></div></div> : null}
            </section>
          ) : null}
        </div>

        {isSupervisorReview && visibleBlindResult ? (
          <section className="panel supervisor-review-panel">
            <div className="panel-heading"><div><p className="eyebrow">PRIMER CONTROL · CIERRE {closure.cierre_nro}</p><h2>Qué tenés que revisar</h2></div><EyeOff size={22} /></div>
            <div className={`review-summary ${visibleBlindResult.conceptosOk ? 'concepts-ok' : 'concepts-review'} ${visibleBlindResult.cajaOk ? 'cash-ok' : 'cash-review'}`}>
              <strong>{comparisonMessage(visibleBlindResult)}</strong>
              <p>No se muestran importes esperados ni montos de diferencia.</p>
            </div>
            {reviewRows(visibleBlindResult)}
            {visibleBlindResult.avisos?.comprobantePendiente ? <div className="info-box"><FileText size={18} /><span>Sigma informa al menos un comprobante pendiente dentro de este tramo. Revisá la documentación antes del segundo cierre.</span></div> : null}
          </section>
        ) : null}

        {isWaitingValidation && visibleBlindResult && !isApprover ? (
          <section className="panel supervisor-review-panel">
            <div className="panel-heading"><div><p className="eyebrow">SEGUNDO CONTROL · CIERRE {closure.cierre_nro}</p><h2>Cierre enviado a validación</h2></div><ShieldCheck size={22} /></div>
            <div className="review-summary"><strong>{comparisonMessage(visibleBlindResult)}</strong><p>Este tramo quedó congelado. El Encargado verá los importes y decidirá los ajustes.</p></div>
            {reviewRows(visibleBlindResult)}
          </section>
        ) : null}

        {isApprover && snapshot && fullComparison && ['PENDIENTE_VALIDACION', 'AJUSTES_AUTORIZADOS'].includes(closure.estado) ? (
          <section className="panel approval-panel reveal-animation">
            <div className="panel-heading"><div><p className="eyebrow">RESOLUCIÓN · CIERRE {closure.cierre_nro}</p><h2>Validación de diferencias</h2></div><ShieldCheck size={22} /></div>
            {closure.correccion_motivo ? <div className="info-box"><FileText size={18} /><span><strong>Observación del Supervisor:</strong> {closure.correccion_motivo}</span></div> : null}
            {closure.estado === 'PENDIENTE_VALIDACION' ? (
              <div className="approver-cash-editor">
                <div className="panel-heading compact-heading">
                  <div>
                    <p className="eyebrow">CORRECCIÓN PREVIA</p>
                    <h3>Fondo y efectivo recibido</h3>
                  </div>
                </div>
                <div className="two-cols">
                  <NumberInput
                    label="Fondo inicial entregado"
                    value={approverCash.fondoInicial}
                    onChange={(value) => {
                      setApproverCash((current) => ({ ...current, fondoInicial: value }));
                      setApproverCashDirty(true);
                    }}
                    hint="No integra la recaudación"
                  />
                  <NumberInput
                    label="Fondo devuelto"
                    value={approverCash.fondoDevuelto}
                    onChange={(value) => {
                      setApproverCash((current) => ({ ...current, fondoDevuelto: value }));
                      setApproverCashDirty(true);
                    }}
                    hint="Se controla separado del cierre"
                  />
                  <NumberInput
                    label="Efectivo entregado al cierre"
                    value={approverCash.efectivoEntregadoCierre}
                    onChange={(value) => {
                      setApproverCash((current) => ({ ...current, efectivoEntregadoCierre: value }));
                      setApproverCashDirty(true);
                    }}
                    hint="Sólo recaudación, sin fondo"
                  />
                </div>
                <div className="cash-edit-summary">
                  <span>Diferencia de fondo <strong>{money.format(approverCash.fondoDevuelto - approverCash.fondoInicial)}</strong></span>
                  <span>Efectivo esperado <strong>{money.format(Number(closure.efectivo_esperado_cierre || 0))}</strong></span>
                  <span>Diferencia de caja <strong>{money.format(approverCash.efectivoEntregadoCierre - Number(closure.efectivo_esperado_cierre || 0))}</strong></span>
                </div>
                <button className="secondary-button" type="button" onClick={() => void saveApproverCashChanges()} disabled={busy || !approverCashDirty}>
                  {busy ? 'Guardando…' : approverCashDirty ? 'Guardar correcciones' : 'Correcciones guardadas'}
                </button>
              </div>
            ) : null}
            {closure.estado === 'PENDIENTE_VALIDACION' ? <button className="primary-button approve-button" onClick={() => void approveAdjustments()} disabled={busy}><CheckCircle2 size={18} /> Validar y autorizar ajustes</button> : null}
            {closure.estado === 'AJUSTES_AUTORIZADOS' ? <div className="authorized-box"><CheckCircle2 /><div><strong>Ajustes autorizados</strong><p>Recién en este estado se habilitará la ejecución de asientos en Sigma.</p><button className="secondary-button" disabled>Ejecutar asientos en Sigma · próxima etapa</button></div></div> : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
