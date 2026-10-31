import { useEffect, useMemo, useRef, useState } from 'react';
import { readApiJson } from './lib/apiJson';
import { fetchPricePolicies } from './lib/pricePolicies';
import { PriceStatusButtons } from './components/PriceStatusButtons';
import { PolicyPriceControl } from './components/PolicyPriceControl';
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
  Camera,
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
import './stock.css';

type BarcodeDetectorLike = {detect:(source:HTMLVideoElement)=>Promise<Array<{rawValue:string}>>};
type BarcodeDetectorConstructor = new (options:{formats:string[]})=>BarcodeDetectorLike;
function PriceCameraScanner({videoRef,onDetected,onError}:{videoRef:React.RefObject<HTMLVideoElement|null>;onDetected:(ean:string)=>void;onError:(message:string)=>void}){
  const errorRef=useRef(onError);
  const detectedRef=useRef(onDetected);
  errorRef.current=onError;
  detectedRef.current=onDetected;
  useEffect(()=>{
    let cancelled=false;let stream:MediaStream|null=null;let timer:number|undefined;let busy=false;
    const start=async()=>{
      try{
        const Detector=(window as Window & {BarcodeDetector?:BarcodeDetectorConstructor}).BarcodeDetector;
        if(!Detector){errorRef.current('Este navegador no admite lectura directa de códigos con cámara. Probá Chrome en Android o un scanner Bluetooth.');return;}
        if(!navigator.mediaDevices?.getUserMedia){errorRef.current('La cámara requiere HTTPS y permiso del navegador.');return;}
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return;}
        const video=videoRef.current;
        if(!video)return;
        video.srcObject=stream;await video.play();
        const detector=new Detector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});
        timer=window.setInterval(async()=>{
          if(cancelled||busy||video.readyState<2)return;
          busy=true;
          try{
            const results=await detector.detect(video);
            const code=results.map(r=>r.rawValue).find(v=>/^[0-9]{8,14}$/.test(v));
            if(code&&!cancelled){cancelled=true;detectedRef.current(code);}
          }catch{/* Frame sin lectura válida */}
          finally{busy=false;}
        },300);
      }catch(error){if(!cancelled)errorRef.current('No se pudo abrir la cámara: '+(error instanceof Error?error.message:String(error)));}
    };
    void start();
    return()=>{cancelled=true;if(timer!==undefined)window.clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());if(videoRef.current)videoRef.current.srcObject=null;};
  },[videoRef]);
  return <small>Apuntá al código de barras. La lectura se realiza automáticamente.</small>;
}

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
  jornadaId?: string;
  jornadaNro?: number;
  usuarioCodigo: number;
  usuarioNombre: string;
  cajaCodigo: number | null;
  primeraVentaHora?: string | null;
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
  jornadaId?: string;
  jornadaNro?: number;
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
  sugerenciasCorreccion?: Array<{ retiroId: number; importe: number; cajaRegistrada: number; cajaSugerida: number; horaAproximada?: string | null; motivo: string; estado: string }>;
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
  const [stockMode,setStockMode] = useState(false);
  const [priceMode,setPriceMode] = useState(false);
  const [stockCounts,setStockCounts] = useState<any[]>([]);
  const [stockView,setStockView] = useState<'home'|'prepare'|'count'>('home');
  const [stockCanCount,setStockCanCount] = useState(false);
  const [stockTitle,setStockTitle] = useState('');
  const [stockError,setStockError] = useState('');
  const [stockBusy,setStockBusy] = useState(false);
  const [priceArticleId,setPriceArticleId] = useState('154');
  const [shelfPriceInput,setShelfPriceInput] = useState('');
  const [priceSaving,setPriceSaving] = useState(false);
  const [priceCameraOpen,setPriceCameraOpen] = useState(false);
  const [priceCameraError,setPriceCameraError] = useState('');
  const priceVideoRef=useRef<HTMLVideoElement|null>(null);
  const [priceSaveMessage,setPriceSaveMessage] = useState('');
  const [priceHistory,setPriceHistory] = useState<{id:string;creado_at:string;descripcion:string|null;articulo_id:string;estado:string;politica_id:string|null}[]>([]);
  const [priceCheckStatus,setPriceCheckStatus] = useState<'ok'|'error'|'missing'|null>(null);
  const [priceLookupBusy,setPriceLookupBusy] = useState(false);
  const [priceLookupResult,setPriceLookupResult] = useState<{id:string;precioSinIva:number;precioConIva:number|null;ivaPorcentual:number|null;descripcion?:string;aviso?:string;moneda?:string;contextoPoliticas?:string|null}|null>(null);
  const [priceLookupError,setPriceLookupError] = useState('');
  const [pricePolicies,setPricePolicies] = useState<{id:number;descuento:number|null;precio:number|null;ordenManual:number|null;cantidadMinima:number|null;cantidadMaxima:number|null;vigenciaDesde:string|null;vigenciaHasta:string|null;cantidadEnBultos:string|null;condicionVenta:string|null;evaluacion?:string;motivosEvaluacion?:string[];alcance?:string[]}[]>([]);
  const [pricePolicyNote,setPricePolicyNote] = useState('');
  const [stockSigmaTest,setStockSigmaTest] = useState<{stockFisico:number,deposito:string,capturadoAt:string}|null>(null);
  const [stockSigmaTesting,setStockSigmaTesting] = useState(false);
  async function stockTestSigma(){
    if(!supabase)return;
    setStockSigmaTesting(true);setStockError('');setStockSigmaTest(null);
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error('Iniciá sesión nuevamente para consultar Sigma.');
      const response=await fetch('/api/sigma/stock?codigo=2041&deposito=03',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error+(result.statusSigma?' (HTTP Sigma '+result.statusSigma+')':''));
      if(!Number.isFinite(result.stockFisico))throw new Error('La respuesta no contiene stock físico válido.');
      setStockSigmaTest(result);
    }catch(error){setStockError('Prueba de conexión Sigma: '+(error instanceof Error?error.message:String(error)));}
    finally{setStockSigmaTesting(false);}
  }

  const [stockSelected,setStockSelected] = useState<string | null>(null);
  const [stockItems,setStockItems] = useState<any[]>([]);
  const [stockCode,setStockCode] = useState('');
  const [stockQty,setStockQty] = useState('');
  const [stockBoxes,setStockBoxes] = useState('');
  const [stockPackInfo,setStockPackInfo] = useState<any[]>([]);
  const [stockScanning,setStockScanning] = useState(false);
  const stockVideoRef=useRef<HTMLVideoElement|null>(null);
  const stockStreamRef=useRef<MediaStream|null>(null);
  const stockScanFrameRef=useRef<number|null>(null);
  const stockScanActiveRef=useRef(false);
  const stockMatch=stockItems.find(x=>{
    const code=stockCode.trim();
    const pack=stockPackInfo.find(p=>p.articulo_codigo===x.articulo_codigo);
    return code!==''&&(x.articulo_codigo===code||x.ean===code||pack?.ean_unidad===code||pack?.ean_bulto===code);
  });
  const stockMatchPack=stockPackInfo.find(p=>p.articulo_codigo===stockMatch?.articulo_codigo);
  const stockPackSize=Number(stockMatchPack?.unidades_por_bulto)||0;
  const stockCalculated=(Number(stockBoxes||0)*stockPackSize)+Number(stockQty||0);
  function stockStopScan(){
    stockScanActiveRef.current=false;
    if(stockScanFrameRef.current!==null)cancelAnimationFrame(stockScanFrameRef.current);
    stockScanFrameRef.current=null;
    stockStreamRef.current?.getTracks().forEach(track=>track.stop());
    stockStreamRef.current=null;
    if(stockVideoRef.current)stockVideoRef.current.srcObject=null;
    setStockScanning(false);
  }
  async function stockStartScan(){
    const Detector=(window as any).BarcodeDetector;
    if(!Detector){setStockError('Este navegador no admite escaneo de códigos de barras. Podés ingresar el código manualmente.');return;}
    if(!navigator.mediaDevices?.getUserMedia){setStockError('No se puede acceder a la cámara desde este dispositivo o conexión.');return;}
    setStockError('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      stockStreamRef.current=stream;
      stockScanActiveRef.current=true;
      setStockScanning(true);
      const detector=new Detector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf']});
      const scan=async()=>{
        if(!stockScanActiveRef.current)return;
        const video=stockVideoRef.current;
        if(video&&video.readyState>=2){
          try{
            const codes=await detector.detect(video);
            if(codes.length&&codes[0].rawValue){setStockCode(codes[0].rawValue);stockStopScan();return;}
          }catch{/* continue scanning */}
        }
        if(stockScanActiveRef.current)stockScanFrameRef.current=requestAnimationFrame(scan);
      };
      requestAnimationFrame(async()=>{
        const video=stockVideoRef.current;
        if(!video){stockStopScan();return;}
        video.srcObject=stream;
        try{await video.play();stockScanFrameRef.current=requestAnimationFrame(scan);}
        catch{stockStopScan();setStockError('No se pudo iniciar la vista de la cámara.');}
      });
    }catch{stockStopScan();setStockError('No se pudo abrir la cámara. Revisá los permisos del navegador.');}
  }
  useEffect(()=>()=>{stockScanActiveRef.current=false;if(stockScanFrameRef.current!==null)cancelAnimationFrame(stockScanFrameRef.current);stockStreamRef.current?.getTracks().forEach(track=>track.stop());},[]);

  const [stockSector,setStockSector] = useState('ALMACEN');
  const [stockMeasurements,setStockMeasurements] = useState<any[]>([]);
  const [stockReviewRows,setStockReviewRows] = useState<any[]>([]);
  const [stockAssignee,setStockAssignee] = useState('');
  const [stockArticleCode,setStockArticleCode] = useState('');
  const [stockArticleName,setStockArticleName] = useState('');
  const [stockCatalog,setStockCatalog] = useState<any[]>([]);
  const [stockSearch,setStockSearch] = useState('');
  const [stockSearched,setStockSearched] = useState(false);
  const [stockFilters,setStockFilters] = useState({rubro:'',familia:'',linea:'',grupo:''});
  const [stockFilterOptions,setStockFilterOptions] = useState<{rubros:string[],familias:string[],lineas:string[],grupos:string[]}>({rubros:[],familias:[],lineas:[],grupos:[]});
  const [stockChecked,setStockChecked] = useState<string[]>([]);
  const [stockControllers,setStockControllers] = useState<Array<{id:string,nombre:string,email:string}>>([]);
  const stockCurrent=stockCounts.find(c=>c.id===stockSelected);
  const stockDraft=stockCurrent?.estado==='BORRADOR';
  const stockCanSearch=stockSearch.trim().length>=2||Object.values(stockFilters).some(Boolean);
  async function stockLoadOptions(){
    if(!supabase)return;
    const {data:canCount}=await supabase.rpc('has_capability',{capability_code:'donato.stock.controlar'});
    setStockCanCount(Boolean(canCount)||profile.rol==='administrador');
    if(profile.rol!=='administrador')return;
    const [filters,controllers]=await Promise.all([supabase.rpc('donato_stock_catalogo_filtros'),supabase.rpc('donato_stock_controladores')]);
    if(!filters.error&&filters.data)setStockFilterOptions(filters.data);
    if(!controllers.error)setStockControllers(controllers.data||[]);
  }
  async function stockBulkAdd(){
    if(!supabase||!stockSelected||!stockChecked.length)return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.rpc('donato_stock_agregar_articulos',{p_conteo:stockSelected,p_codigos:stockChecked});
    if(error)setStockError(error.message);else {setStockChecked([]);await stockOpen(stockSelected,false);}
    setStockBusy(false);
  }
  async function stockBulkRemove(codes:string[]){
    if(!supabase||!stockSelected||!codes.length)return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.rpc('donato_stock_quitar_articulos',{p_conteo:stockSelected,p_codigos:codes});
    if(error)setStockError(error.message);else {setStockChecked([]);await stockOpen(stockSelected,false);}
    setStockBusy(false);
  }
  async function stockTakePending(){
    if(!supabase)return;
    setStockBusy(true);setStockError('');
    const {data,error}=await supabase.rpc('donato_stock_tomar_pendiente');
    if(error)setStockError(error.message);
    else if(data){await stockRefresh();setStockView('count');await stockOpen(data);}
    else setStockError('No hay conteos pendientes disponibles.');
    setStockBusy(false);
  }
  async function stockSendReview(){
    if(!supabase||!stockSelected||!window.confirm('¿Finalizar el conteo? No podrás agregar ni modificar cantidades después de confirmarlo.'))return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.rpc('donato_stock_enviar_revision',{p_conteo:stockSelected});
    if(error)setStockError(error.message);else {await stockRefresh();setStockSelected(null);}
    setStockBusy(false);
  }
  async function stockSearchCatalog(){
    if(!supabase||!stockCanSearch)return;
    setStockError('');setStockBusy(true);setStockSearched(false);setStockCatalog([]);setStockChecked([]);
    const {data,error}=await supabase.rpc('donato_stock_buscar_articulos',{p_texto:stockSearch.trim(),p_limite:500,p_rubro:stockFilters.rubro||null,p_familia:stockFilters.familia||null,p_linea:stockFilters.linea||null,p_grupo:stockFilters.grupo||null});
    if(error)setStockError('No se pudo consultar el catálogo: '+error.message);else {setStockCatalog(data||[]);setStockSearched(true);}
    setStockBusy(false);
  }
  async function stockAddFromCatalog(code:string){
    if(!supabase||!stockSelected)return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.rpc('donato_stock_agregar_articulo',{p_conteo:stockSelected,p_codigo:code});
    if(error)setStockError(error.message);else await stockOpen(stockSelected,false);
    setStockBusy(false);
  }
  async function stockRefresh(){
    if(!supabase)return;
    const {data,error}=profile.rol==='administrador'
      ? await supabase.from('donato_stock_conteos').select('id,titulo,deposito,estado,creado_at,asignado_a,snapshot_at').order('creado_at',{ascending:false}).limit(100)
      : await supabase.rpc('donato_stock_mis_conteos');
    if(error)setStockError(error.message);else setStockCounts(data||[]);
  }
  async function stockOpen(id:string,resetSearch=true){
    if(!supabase)return;
    setStockSelected(id);setStockError('');if(resetSearch){setStockCatalog([]);setStockSearch('');setStockSearched(false);setStockChecked([]);}
    const {data,error}=profile.rol==='administrador'
      ? await supabase.from('donato_stock_conteo_items').select('*').eq('conteo_id',id)
      : await supabase.rpc('donato_stock_mis_items',{p_conteo:id});
    if(error)setStockError(error.message);else setStockItems(data||[]);
    const measurements=profile.rol==='administrador'
      ? await supabase.from('donato_stock_mediciones').select('*').in('item_id',(data||[]).length?(data||[]).map((x:any)=>x.id):['00000000-0000-0000-0000-000000000000'])
      : await supabase.rpc('donato_stock_mis_mediciones',{p_conteo:id});
    if(measurements.error)setStockError(measurements.error.message);else setStockMeasurements(measurements.data||[]);
    const packs=await supabase.rpc('donato_stock_presentaciones',{p_conteo:id});
    if(!packs.error)setStockPackInfo(packs.data||[]);
    if(profile.rol==='administrador'){
      const review=await supabase.rpc('donato_stock_revision',{p_conteo:id});
      setStockReviewRows(review.error?[]:(review.data||[]));
    }
  }
  async function stockCreate(){
    if(!supabase||profile.rol!=='administrador'||!stockTitle.trim())return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.from('donato_stock_conteos').insert({titulo:stockTitle.trim(),deposito:'03',creado_por:profile.userId});
    if(error)setStockError(error.message);else {setStockTitle('');await stockRefresh();}
    setStockBusy(false);
  }
  async function stockRegister(){
    if(!supabase||!stockSelected||!stockMatch||(!stockBoxes&&!stockQty))return;
    const boxes=Number(stockBoxes||0),loose=Number(stockQty||0);
    if(!Number.isInteger(boxes)||boxes<0||!Number.isFinite(loose)||loose<0||!Number.isFinite(stockCalculated)||stockCalculated<0){setStockError('Ingresá cantidades válidas y bultos enteros.');return;}
    if(boxes>0&&(!stockPackSize||stockPackSize<=0)){setStockError('Este artículo no tiene unidades por bulto configuradas en Sigma. Registrá las unidades sueltas o corregí su presentación.');return;}
    setStockBusy(true);setStockError('');
    const {error}=await supabase.rpc('donato_stock_registrar_sector',{p_item:stockMatch.id,p_sector:stockSector,p_cantidad:stockCalculated,p_metodo:stockCode.trim()===stockMatchPack?.ean_bulto||stockCode.trim()===stockMatchPack?.ean_unidad?'EAN':'MANUAL'});
    if(error)setStockError(error.message);else {setStockCode('');setStockQty('');setStockBoxes('');await stockOpen(stockSelected);}
    setStockBusy(false);
  }
  async function stockAddItem(){
    if(!supabase||!stockSelected||!stockArticleCode.trim()||!stockArticleName.trim())return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.from('donato_stock_conteo_items').insert({conteo_id:stockSelected,articulo_codigo:stockArticleCode.trim(),descripcion:stockArticleName.trim()});
    if(error)setStockError(error.message);else {setStockArticleCode('');setStockArticleName('');await stockOpen(stockSelected);}
    setStockBusy(false);
  }
  async function stockAssign(){
    if(!supabase||!stockSelected)return;
    setStockBusy(true);setStockError('');
    const {error}=await supabase.rpc('donato_stock_publicar',{p_conteo:stockSelected,p_controlador:stockAssignee||null});
    if(error)setStockError(error.message);else {await stockRefresh();setStockSelected(null);setStockAssignee('');}
    setStockBusy(false);
  }

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
  const [editingQuickControl, setEditingQuickControl] = useState(false);
  const [retiAssignment, setRetiAssignment] = useState<Record<number, string>>({});
  const [retiReassigning, setRetiReassigning] = useState<Record<number, boolean>>({});
  const [quickControlRetis, setQuickControlRetis] = useState<any[]>([]);
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

  const isSupervisor = profile.rol === 'supervisor_caja' || profile.rol === 'encargado_donato' || profile.rol === 'administrador';
  const isApprover = profile.rol === 'encargado_donato' || profile.rol === 'administrador';
  const roleLabel = profile.rol === 'supervisor_caja'
    ? 'Supervisor de Caja'
    : profile.rol === 'encargado_donato'
      ? 'Encargado Donato'
      : 'Administrador';

  const isAdmin = profile.rol === 'administrador';
  const canOperationalEdit = Boolean(
    closure && isSupervisor && ['BORRADOR', 'REVISION_SUPERVISOR'].includes(closure.estado)
  );
  const canEditDeclaration = Boolean(
    closure && (canOperationalEdit || (isAdmin && closure.estado !== 'CANCELADO'))
  );
  const isAdminHistoricalEdit = Boolean(
    closure && isAdmin && !['BORRADOR', 'REVISION_SUPERVISOR'].includes(closure.estado)
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

  async function confirmRetiCorrection(item: QuickControl, correction: NonNullable<QuickControl['sugerenciasCorreccion']>[number]) {
    if (!supabase || !historyDate) return;
    const { error } = await supabase.rpc('donato_reti_correccion_confirmar', {
      p_fecha: historyDate,
      p_retiro_id: correction.retiroId,
      p_importe: correction.importe,
      p_caja_original: correction.cajaRegistrada,
      p_caja_corregida: item.cajaCodigo || correction.cajaSugerida,
      p_usuario_sigma_codigo: item.usuarioCodigo,
      p_usuario_sigma_nombre: item.usuarioNombre,
      p_motivo: correction.motivo,
      p_jornada_id: item.jornadaId || null,
    });
    if (error) {
      setHistoryError(error.message);
      return;
    }
    setHistoryError(null);
    setRetiReassigning((prev) => ({ ...prev, [Number(correction.retiroId)]: false }));
    await loadHistory(true);
  }

  async function dismissRetiCorrection(retiro: any) {
    if (!supabase || !historyDate) return;
    const selected = retiAssignment[Number(retiro.id)] || '';
    const assigned = selected ? quickControls.find((x) => String(x.usuarioCodigo) === selected) : null;
    const { error } = await supabase.rpc('donato_reti_correccion_desestimar', {
      p_fecha: historyDate, p_retiro_id: retiro.id, p_importe: retiro.importe, p_caja_original: retiro.cajaCodigo,
      p_usuario_sigma_codigo: assigned?.usuarioCodigo || 0, p_usuario_sigma_nombre: assigned?.usuarioNombre || '',
      p_motivo: assigned ? 'Corrección desestimada; RETI asignado manualmente al cajero seleccionado' : 'Corrección desestimada; RETI pendiente de asignación',
    });
    if (error) { setHistoryError(error.message); return; }
    await loadHistory(true);
  }

  async function loadHistory(recalcular = false) {
    if (!supabase) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const closureQuery = historyDate
        ? supabase.from('donato_cierres_caja').select(closureSelect).eq('fecha', historyDate).order('created_at', { ascending: false })
        : supabase.from('donato_cierres_caja').select(closureSelect).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(200);

      const headers = historyDate ? await authHeaders() : null;
      const quickPromise = historyDate && profile.rol === 'administrador'
        ? fetch(`/api/sigma/control-rapido?fecha=${encodeURIComponent(historyDate)}${recalcular ? '&recalcular=1' : ''}`, { headers: headers!, cache: 'no-store' })
        : null;
      const sigmaPromise = historyDate && profile.rol !== 'administrador'
        ? fetch(`/api/sigma/jornadas?fecha=${encodeURIComponent(historyDate)}`, { headers: headers!, cache: 'no-store' })
        : null;

      const [closureResult, quickResponse, sigmaResponse] = await Promise.all([
        closureQuery as unknown as Promise<any>,
        quickPromise,
        sigmaPromise,
      ]);
      if (closureResult.error) throw new Error(closureResult.error.message);
      const closuresForDate = (closureResult.data ?? []) as unknown as ClosureRow[];
      setHistoryClosures(closuresForDate);

      if (!historyDate) {
        setHistoryJourneys([]);
        setQuickControls([]);
        setQuickControlUnassigned([]);
        setQuickControlCriterion('');
        return;
      }

      if (quickResponse) {
        if (!quickResponse.ok) {
          const body = await quickResponse.json().catch(() => ({}));
          throw new Error(body.error || 'No se pudo generar el control rápido');
        }
        const quickData = await quickResponse.json();
        const controls = Array.isArray(quickData.controles) ? quickData.controles : [];
        setQuickControls(controls);
        setQuickControlUnassigned(Array.isArray(quickData.retirosSinAsignar) ? quickData.retirosSinAsignar : []);
        setQuickControlCriterion(String(quickData.criterioReti || ''));
        setQuickControlRetis(Array.isArray(quickData.retirosRevision) ? quickData.retirosRevision : []);
        setHistoryJourneys(controls.map((item: QuickControl) => {
          const userClosures = closuresForDate.filter((c) => Number(c.usuario_sigma_codigo) === Number(item.usuarioCodigo) && c.estado !== 'CANCELADO');
          return {
            fecha: historyDate,
            usuarioCodigo: item.usuarioCodigo,
            usuarioNombre: item.usuarioNombre,
            cajaCodigo: item.cajaCodigo,
            ultimaVentaHora: item.ultimaVentaHora,
            cantidadVentas: item.cantidadVentas,
            venta: item.venta,
            tieneActividadNueva: userClosures.length === 0,
            proximoCierreNumero: userClosures.length + 1,
          } as Journey;
        }));
      } else if (sigmaResponse) {
        if (!sigmaResponse.ok) {
          const body = await sigmaResponse.json().catch(() => ({}));
          throw new Error(body.error || 'No se pudo consultar la jornada histórica en Sigma');
        }
        const sigmaData = await sigmaResponse.json();
        setHistoryJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
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
    // Reutilizar la jornada reconstruida para conservar primera/ultima venta al abrir
    // un cierre existente (incluido Historial). Si no esta cargada, se mantiene el fallback.
    const reconstructedJourney = journeys.find((journey) =>
      journey.fecha === item.fecha
      && Number(journey.usuarioCodigo) === Number(item.usuario_sigma_codigo)
      && Number(journey.cajaCodigo || 0) === Number(item.caja_codigo || 0)
    );
    const journey: Journey = {
      ...(reconstructedJourney || {}),
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

  async function saveAdminDeclarationChanges() {
    if (!supabase || !closure || !isAdminHistoricalEdit) return;
    const motivo = window.prompt('Motivo de la corrección administrativa:');
    if (!motivo?.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const { data, error } = await supabase.rpc('admin_modificar_declaracion_cierre_donato', {
        p_cierre_id: closure.id,
        p_declaracion: declaration,
        p_motivo: motivo.trim(),
      });
      if (error) throw new Error(error.message);
      const updated = (Array.isArray(data) ? data[0] : data) as ClosureRow | null;
      if (updated) setClosure((current) => current ? { ...current, ...updated } : updated);
      await loadFullSnapshot(closure.id);
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo guardar la corrección administrativa');
    } finally {
      setBusy(false);
    }
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
        closure: { fecha: closure.fecha, cierre_nro: closure.cierre_nro, estado: closure.estado, caja_codigo: closure.caja_codigo, usuario_sigma_codigo: closure.usuario_sigma_codigo, usuario_sigma_nombre: closure.usuario_sigma_nombre, jornada_inicio_hora: selectedJourney.primeraVentaHora, jornada_fin_hora: selectedJourney.ultimaVentaHora, corte_desde_at: closure.corte_desde_at, corte_hasta_at: closure.corte_hasta_at, sigma_snapshot_capturado_at: closure.sigma_snapshot_capturado_at },
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
          <button className={stockMode ? 'nav-item active' : 'nav-item'} onClick={() => {setPriceMode(false);setStockMode(true);setStockView('home');setStockSelected(null);void stockRefresh();void stockLoadOptions();}}><ClipboardCheck size={18}/> Control de stock</button>
            <button className={priceMode ? 'nav-item active' : 'nav-item'} onClick={() => {setStockMode(false);setPriceMode(true);}}><ReceiptText size={18}/> Control Precios</button>
            <button className="nav-item" onClick={() => { setPriceMode(false);setStockMode(false); setDashboardMode('today'); void loadDashboard(); }}><ClipboardCheck size={18} /> Cierre de caja</button>
            <button className={stockMode ? 'nav-item' : 'nav-item active'} onClick={() => { setPriceMode(false);setStockMode(false); void loadHistory(); }}><Clock3 size={18} /> Historial</button>
            <button className="nav-item" disabled><ArrowRightLeft size={18} /> Ajustes</button>
          </nav>
          <div className="sidebar-user">
            <span>{roleLabel}</span>
            <strong>{profile.nombre || profile.email}</strong>
            <button onClick={onSignOut}><LogOut size={16} /> Salir</button>
          </div>
        </aside>

        <main className="workspace">
        {stockMode ? <section className="panel stock-workspace" style={{padding:'clamp(16px, 4vw, 28px)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:16}}>
            <div><p className="eyebrow">DEPÓSITO 03 · DONATO</p><h1 style={{margin:'4px 0'}}>Control de stock</h1><p style={{margin:0}}>Conteos ciegos por artículo y sector</p></div>
            <button className="back-button" onClick={()=>{setStockMode(false);setDashboardMode('today');void loadDashboard();}}>Volver a cajas</button>
          </div>
          {stockError && <div className="info-box" role="alert" style={{marginBottom:16,color:'#b42318'}}>{stockError}</div>}
          {stockView==='home' ? <div className="stock-entry-grid">
            {profile.rol==='administrador' && <button className="stock-entry-card" onClick={()=>{setStockView('prepare');setStockSelected(null);void stockRefresh();void stockLoadOptions();}}><strong>Generar nuevo control</strong><span>Seleccionar artículos, preparar borradores y publicar conteos.</span><span className="stock-entry-link">Ir a preparación →</span></button>}
            {(stockCanCount||profile.rol==='administrador') && <button className="stock-entry-card" onClick={()=>{setStockView('count');setStockSelected(null);void stockRefresh();}}><strong>Iniciar control de stock</strong><span>Ver conteos publicados, tomar uno pendiente o continuar el asignado.</span><span className="stock-entry-link">Ir a conteos →</span></button>}
          </div> : !stockSelected ? <>
            <button className="back-button" style={{marginBottom:16}} onClick={()=>setStockView('home')}>← Control de stock</button>
            {stockView==='prepare' && profile.rol==='administrador' && <div style={{padding:16,border:'1px solid #dce3ec',borderRadius:14,marginBottom:20}}>
              <h2 style={{marginTop:0}}>Generar nuevo control</h2>
              <p>Creá un borrador, seleccioná artículos y publicalo para los controladores.</p>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <input aria-label="Nombre del conteo" style={{flex:'1 1 220px',minWidth:0}} placeholder="Ej.: Góndolas perfumería" value={stockTitle} onChange={e=>setStockTitle(e.target.value)}/>
                <button className="primary-button" disabled={stockBusy||!stockTitle.trim()} onClick={()=>void stockCreate()}>Crear conteo</button>
              </div>
            </div>}
            {stockView==='count' && <div style={{padding:16,border:'1px solid #dce3ec',borderRadius:14,marginBottom:20}}>
              <h2 style={{marginTop:0}}>Iniciar control de stock</h2>
              <p>Solamente se muestran los conteos publicados. Podés tener uno activo a la vez.</p>
              <button className="primary-button" disabled={stockBusy||stockCounts.some(c=>c.estado==='EN_CURSO'&&c.asignado_a===profile.userId)} onClick={()=>void stockTakePending()}>Tomar siguiente conteo pendiente</button>
            </div>}
            <h2>{stockView==='prepare'?'Conteos para administrar':'Mis conteos publicados'}</h2>
            <div style={{display:'grid',gap:10}}>
              {stockCounts.filter(c=>stockView==='prepare'||(c.estado!=='BORRADOR'&&c.estado!=='CANCELADO'&&(c.asignado_a===profile.userId||c.estado==='PENDIENTE'))).length===0 ? <p>No hay conteos disponibles todavía.</p> : stockCounts.filter(c=>stockView==='prepare'||(c.estado!=='BORRADOR'&&c.estado!=='CANCELADO'&&(c.asignado_a===profile.userId||c.estado==='PENDIENTE'))).map(c=><button key={c.id} className="back-button" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,textAlign:'left',padding:16,borderRadius:12}} onClick={()=>{if(stockView==='count'&&c.estado==='PENDIENTE'){void stockTakePending();}else void stockOpen(c.id);}}>
                <span><strong>{c.titulo}</strong><span style={{display:'block',fontSize:13,marginTop:5}}>Depósito {c.deposito} · {c.estado.replaceAll('_',' ').toLowerCase()}</span></span><span aria-hidden="true">›</span>
              </button>)}
            </div>
          </> : <>
            <button className="back-button" style={{marginBottom:16}} onClick={()=>{setStockSelected(null);void stockRefresh();void stockLoadOptions();}}>← Volver</button>
            <h2 style={{marginTop:0}}>{stockCounts.find(c=>c.id===stockSelected)?.titulo||'Detalle del conteo'}</h2>
            <p>{stockItems.length} artículos seleccionados · {stockMeasurements.length} registros de conteo</p>
            {profile.rol==='administrador' && <div className="stock-sigma-test" style={{margin:'14px 0',padding:14,border:'1px solid #dce3ec',borderRadius:12}}>
            <strong>Conexión con Sigma · Prueba</strong>
            <div style={{marginTop:10}}>
              <button type="button" onClick={async()=>{
                try {
                  if(!supabase)throw new Error('Supabase no disponible');
                  const {data:{session}}=await supabase.auth.getSession();
                  if(!session?.access_token)throw new Error('Iniciá sesión');
                  const response=await fetch('/api/sigma/test-precio',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
                  const result=await response.json();
                  window.alert('Prueba lista 4 · artículo 154\\n'+JSON.stringify(result,null,2).slice(0,2800));
                } catch(error) {window.alert('Error: '+String(error));}
              }}>Probar precio Sigma · lista 4</button>
            </div>
                          <div>
                <button type="button" disabled={stockSigmaTesting} onClick={()=>void stockTestSigma()}>{stockSigmaTesting?'Consultando Sigma…':'Probar conexión Sigma · artículo 154'}</button>
                {stockSigmaTest && <p><strong>Conexión correcta:</strong> {stockSigmaTest.stockFisico.toLocaleString('es-AR')} unidades en depósito {stockSigmaTest.deposito}. Consulta: {new Date(stockSigmaTest.capturadoAt).toLocaleString('es-AR')}. <strong>Solo prueba, no modifica la foto.</strong></p>}
              </div>
          </div>}
          {stockView==='prepare' && profile.rol==='administrador' && <div style={{display:'grid',gap:16}}>
              <div style={{padding:16,border:'1px solid #dce3ec',borderRadius:14}}>
                <h3 style={{marginTop:0}}>1. Seleccionar artículos</h3>
                <p>Buscá por descripción, código o EAN y agregá los productos que quieras controlar.</p>
                {stockDraft ? <>
                <div className="stock-filter-grid">
                  {([['rubro','Rubro','rubros'],['familia','Familia','familias'],['linea','Línea','lineas'],['grupo','Grupo','grupos']] as const).map(([key,label,options])=><label key={key}>{label}<select disabled={stockFilterOptions[options].length===0} value={stockFilters[key]} onChange={e=>setStockFilters(current=>({...current,[key]:e.target.value}))}><option value="">Todos</option>{stockFilterOptions[options].map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}
                </div>
                {stockFilterOptions.familias.length===0 && <p className="stock-helper">Rubro, línea y grupo se obtienen de Sigma. Familia todavía no está disponible en la fuente sincronizada.</p>}
                <div className="stock-search-bar">
                  <input aria-label="Buscar artículos" placeholder="Descripción, código o EAN (ej.: dove 400)" value={stockSearch} onChange={e=>{setStockSearch(e.target.value);setStockSearched(false);setStockCatalog([]);setStockChecked([]);}} onKeyDown={e=>{if(e.key==='Enter')void stockSearchCatalog();}}/>
                  <button className="primary-button" disabled={stockBusy||!stockCanSearch} onClick={()=>void stockSearchCatalog()}>{stockBusy?'Buscando…':'Buscar artículos'}</button>
                </div>
                <p className="stock-helper">Buscá por varias palabras y/o filtrá por clasificación. Marcá artículos individuales o todos los resultados.</p>
                {stockSearched && <p className="stock-results-heading">{stockCatalog.length ? stockCatalog.length+' resultados (máximo 500)' : 'No se encontraron artículos. Probá otra descripción o código.'}</p>}
                {stockCatalog.length>0 && <div className="stock-bulk-actions">
                  <label><input type="checkbox" checked={stockCatalog.every(a=>stockChecked.includes(a.articulo_codigo))} onChange={e=>setStockChecked(e.target.checked?stockCatalog.map(a=>a.articulo_codigo):[])}/> Seleccionar todos ({stockCatalog.length})</label>
                  <button type="button" onClick={()=>setStockChecked([])} disabled={!stockChecked.length}>Borrar selección</button>
                  <button className="primary-button" disabled={stockBusy||!stockChecked.length} onClick={()=>void stockBulkAdd()}>Agregar seleccionados ({stockChecked.length})</button>
                </div>}
                {stockCatalog.length>0 && <div className="stock-results-list">{stockCatalog.map(a=>{
                  const added=stockItems.some(i=>i.articulo_codigo===a.articulo_codigo);
                  return <label key={a.articulo_codigo} className="stock-result stock-select-row">
                    <input type="checkbox" checked={stockChecked.includes(a.articulo_codigo)} onChange={e=>setStockChecked(current=>e.target.checked?[...current,a.articulo_codigo]:current.filter(code=>code!==a.articulo_codigo))}/>
                    <span className="stock-result-info"><strong>{a.articulo_nombre}</strong><small>Código {a.articulo_codigo}{a.ean_unidad?' · EAN '+a.ean_unidad:''}</small></span>
                    {added && <span className="stock-added">✓ Incluido</span>}
                  </label>;
                })}</div>}
                </> : <p>Este conteo ya fue publicado. La selección de artículos está cerrada.</p>}
                {stockDraft && <details style={{marginTop:12}}><summary>Agregar un artículo manualmente</summary><div style={{display:'grid',gap:8,marginTop:10}}><input placeholder="Código Sigma" value={stockArticleCode} onChange={e=>setStockArticleCode(e.target.value)}/><input placeholder="Descripción" value={stockArticleName} onChange={e=>setStockArticleName(e.target.value)}/><button disabled={stockBusy} onClick={()=>void stockAddItem()}>Agregar artículo</button></div></details>}
              </div>
              <div style={{padding:16,border:'1px solid #dce3ec',borderRadius:14}}>
                <h3 style={{marginTop:0}}>2. Asignar e iniciar</h3>
                <p>El controlador verá los artículos, pero no el stock registrado en Sigma.</p>
                {stockDraft ? <>
                  <label style={{display:'grid',gap:6}}>Asignación<select value={stockAssignee} onChange={e=>setStockAssignee(e.target.value)}><option value="">Cola de pendientes (sin asignar)</option>{stockControllers.map(u=><option key={u.id} value={u.id}>{u.nombre} · {u.email}</option>)}</select></label>
                  <button className="primary-button" style={{marginTop:12}} disabled={stockBusy||stockItems.length===0} onClick={()=>void stockAssign()}>{stockAssignee?'Asignar e iniciar':'Publicar en cola de pendientes'}</button>
                </> : <p>Estado: {stockCurrent?.estado}. {stockCurrent?.asignado_a?'Controlador asignado.':'Sin controlador asignado.'}</p>}

              </div>
            </div>}
            {stockView==='count' && stockCurrent?.estado==='EN_CURSO' && <div style={{marginTop:20,padding:16,border:'1px solid #dce3ec',borderRadius:14}}>
              <h3 style={{marginTop:0}}>Registrar cantidades por sector</h3>
              {stockCurrent?.estado==='EN_CURSO' && <button disabled={stockBusy||stockMeasurements.length===0} onClick={()=>void stockSendReview()}>Finalizar conteo</button>}
              <p>Contá físicamente cada ubicación. Podés volver a contar el mismo artículo en otro sector.</p>
              <div style={{display:'grid',gap:10}}>
                <div className="stock-code-entry"><input placeholder="Escanear EAN o ingresar código" value={stockCode} onChange={e=>setStockCode(e.target.value)}/><button type="button" onClick={()=>stockScanning?stockStopScan():void stockStartScan()}>{stockScanning?'Cerrar cámara':'📷 Escanear'}</button></div>
                {stockScanning && <div className="stock-camera"><video ref={stockVideoRef} autoPlay muted playsInline aria-label="Cámara para escanear código de barras"/><p>Enfocá el código de barras del artículo.</p></div>}
                {stockMatch && <p className="stock-helper"><strong>{stockMatch.descripcion}</strong>{stockPackSize>0?' · '+stockPackSize+' unidades por bulto':' · Sin presentación por bulto configurada'}</p>}
                <label style={{display:'grid',gap:6}}>Sector<select value={stockSector} onChange={e=>setStockSector(e.target.value)}>{[['ALMACEN','Almacén'],['GONDOLA','Góndola'],['CAMARA','Cámara'],['PUNTERA','Puntera'],['EXHIBICION','Exhibición'],['OTRO','Otro']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
                <div className="stock-quantity-grid">
                  <label style={{display:'grid',gap:6}}>Bultos cerrados<input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={stockBoxes} onChange={e=>setStockBoxes(e.target.value)}/></label>
                  <label style={{display:'grid',gap:6}}>Unidades sueltas<input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={stockQty} onChange={e=>setStockQty(e.target.value)}/></label>
                </div>
                <p className="stock-total-preview">Total a registrar: <strong>{stockMatch&&Number.isFinite(stockCalculated)&&(!Number(stockBoxes)||stockPackSize>0)?stockCalculated.toLocaleString('es-AR'):'—'} unidades</strong></p>
                <button className="primary-button" disabled={stockBusy||stockCurrent?.estado!=='EN_CURSO'||!stockMatch||(!stockQty&&!stockBoxes)||(Number(stockBoxes)>0&&stockPackSize<=0)} onClick={()=>void stockRegister()}>Confirmar cantidad contada</button>
              </div>
            </div>}
            {stockView==='prepare' && profile.rol==='administrador' && stockCurrent?.estado==='EN_REVISION' && <div className="stock-review-panel">
              <h3>Revisión de diferencias</h3>

              {!stockCurrent?.snapshot_at && <p className="stock-review-warning">Todavía no hay foto del stock de Sigma para este conteo. Las diferencias no se pueden calcular correctamente hasta capturar y validar una referencia temporal.</p>}
              <div className="stock-review-table"><table><thead><tr><th>Artículo</th><th>Stock Sigma</th><th>Contado</th><th>Diferencia</th></tr></thead><tbody>
                {stockReviewRows.map(row=><tr key={row.articulo_codigo}><td>{row.descripcion}<small>{row.articulo_codigo}</small></td><td>{row.stock_sigma==null?'Sin foto':Number(row.stock_sigma).toLocaleString('es-AR')}</td><td>{Number(row.cantidad_contada).toLocaleString('es-AR')}</td><td>{row.diferencia==null?'—':Number(row.diferencia).toLocaleString('es-AR')}</td></tr>)}
              </tbody></table></div>
            </div>}
            <div style={{marginTop:20}}>
              <h3>Artículos incluidos ({stockItems.length})</h3>
              {stockView==='prepare' && stockDraft && stockItems.length>0 && <button type="button" className="stock-clear-action" disabled={stockBusy} onClick={()=>{if(window.confirm('¿Quitar todos los artículos de este borrador?'))void stockBulkRemove(stockItems.map(i=>i.articulo_codigo));}}>Quitar todos</button>}
              {stockItems.length===0?<p>Agregá artículos para comenzar.</p>:<div style={{display:'grid',gap:8}}>{stockItems.map(i=><div key={i.id} style={{padding:12,border:'1px solid #e5e7eb',borderRadius:10}}><strong>{i.descripcion}</strong><span style={{display:'block',fontSize:12}}>{i.articulo_codigo}</span>{stockMeasurements.filter(m=>m.item_id===i.id).map(m=><p key={m.id} style={{fontSize:13,margin:'6px 0 0'}}>{m.sector}: {m.cantidad} unidades · {new Date(m.confirmado_at).toLocaleString('es-AR')}</p>)}</div>)}</div>}
            </div>
          </>}
        </section> : null}
        {priceMode ? <section className="panel stock-workspace" style={{padding:'clamp(16px, 4vw, 28px)'}}>
          <p className="eyebrow">DONATO · EMPRESA 0001 · SUCURSAL 0004</p>
          <h1 style={{margin:'4px 0 12px'}}>Control Precios</h1>
          <p>Consultá el artículo, verificá su etiqueta con un toque y revisá las bonificaciones por cantidad.</p>
            <div style={{marginTop:14,display:'grid',gap:8}}>
              <label htmlFor="price-scan-input">Código de barras (scanner o cámara)</label>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <input id="price-scan-input" autoComplete="off" inputMode="numeric" placeholder="Escaneá el EAN y Enter" style={{flex:'1 1 180px',minWidth:0,maxWidth:360,padding:10,border:'1px solid #cbd5e1',borderRadius:8}} onKeyDown={async e=>{
                  if(e.key!=='Enter')return;
                  e.preventDefault();
                  const ean=e.currentTarget.value.trim();
                  if(!/^[0-9]{8,14}$/.test(ean)){setPriceLookupError('Código EAN inválido');return;}
                  if(!supabase){setPriceLookupError('Supabase no disponible');return;}
                  const {data,error}=await supabase.from('logistica_articulos').select('articulo_codigo').or('ean_unidad.eq.'+ean+',ean_bulto.eq.'+ean).limit(2);
                  if(error||!data?.length){setPriceLookupError('EAN no encontrado en maestro logístico');return;}
                  if(data.length!==1){setPriceLookupError('EAN asociado a varios artículos');return;}
                  setPriceArticleId(String(data[0].articulo_codigo));
                  setPriceLookupError('EAN encontrado: código interno '+data[0].articulo_codigo+'. La equivalencia con el ID de la API Sigma está pendiente de validar.');
                }}/>
                <button type="button" className="back-button" aria-label={priceCameraOpen?'Cerrar cámara':'Abrir cámara para leer código de barras'} title={priceCameraOpen?'Cerrar cámara':'Leer código con cámara'} onClick={()=>{setPriceCameraError('');setPriceCameraOpen(v=>!v);}} style={{display:'flex',alignItems:'center',gap:6,padding:10}}><Camera size={20}/>{priceCameraOpen?'Cerrar':'Cámara'}</button>
              </div>
              {priceCameraOpen&&<div style={{padding:12,border:'1px solid #cbd5e1',borderRadius:10}}>
                <video ref={priceVideoRef} playsInline muted autoPlay style={{width:'100%',maxWidth:460,background:'#0f172a',borderRadius:8}}/>
                <PriceCameraScanner videoRef={priceVideoRef} onDetected={ean=>{const input=document.getElementById('price-scan-input') as HTMLInputElement|null;if(input)input.value=ean;setPriceCameraOpen(false);void (async()=>{if(!supabase)return;const {data,error}=await supabase.from('logistica_articulos').select('articulo_codigo').or('ean_unidad.eq.'+ean+',ean_bulto.eq.'+ean).limit(2);if(error||!data?.length){setPriceLookupError('EAN no encontrado en el maestro logístico');return;}if(data.length!==1){setPriceLookupError('EAN ambiguo');return;}setPriceArticleId(String(data[0].articulo_codigo));setPriceLookupError('EAN leído: '+ean+' · Código interno '+data[0].articulo_codigo+'. Falta validar equivalencia con ID Sigma.');})();}} onError={setPriceCameraError}/>
                {priceCameraError&&<p role="status" style={{fontSize:13}}>{priceCameraError}</p>}
              </div>}
              <small>Compatible con lectores HID que envían Enter. Por seguridad, todavía no se consulta automáticamente el precio hasta verificar el mapeo EAN → ID Sigma.</small>
              <label htmlFor="sigma-price-article">Código de artículo Sigma</label>
              <input id="sigma-price-article" inputMode="numeric" pattern="[0-9]*" value={priceArticleId} onChange={event=>setPriceArticleId(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();document.getElementById("price-search-button")?.click();}}} placeholder="Ej.: 154" style={{maxWidth:240,padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/>
              <button id="price-search-button" type="button" disabled={priceLookupBusy||!/^[0-9]{1,12}$/.test(priceArticleId.trim())} onClick={async()=>{
                setPriceLookupBusy(true);setPriceLookupError('');setPriceLookupResult(null);setPricePolicies([]);setPricePolicyNote('');setPriceCheckStatus(null);
                try {
                  if(!supabase)throw new Error('Supabase no disponible');
                  const {data:{session}}=await supabase.auth.getSession();
                  if(!session?.access_token)throw new Error('Iniciá sesión nuevamente');
                  const response=await fetch('/api/sigma/precio?id='+encodeURIComponent(priceArticleId.trim()),{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
                  const result=await readApiJson(response,'No se pudo consultar el precio');
                  setPriceLookupResult(result);
                  try {
                    const policiesResult=await fetchPricePolicies(String(result.id),session.access_token,result.contextoPoliticas,false,setPricePolicyNote);
                    setPricePolicies(policiesResult.politicasEncontradas||policiesResult.politicasDirectas||[]);
                    setPricePolicyNote('Última actualización: '+new Date(policiesResult.cacheActualizada).toLocaleString('es-AR')+(policiesResult.desdeCache?' (caché). ':' (actualizada). ')+(policiesResult.nota||'')+(policiesResult.consultaCompleta?'':' Advertencia: consulta parcial, pueden faltar políticas.'));
                  } catch(policyError){setPricePolicyNote('No se pudieron consultar políticas: '+(policyError instanceof Error?policyError.message:String(policyError)));}

                } catch(error){setPriceLookupError(error instanceof Error?error.message:String(error));}
                finally {setPriceLookupBusy(false);}
              }}>{priceLookupBusy?'Consultando…':'Consultar precio de artículo · lista 4'}</button>
              {priceLookupResult&&<div style={{padding:16,border:'1px solid #dce3ec',borderRadius:12,background:'#fff'}}>
                <div style={{fontSize:13,color:'#64748b'}}>Artículo {priceLookupResult.id} · Lista 4 · Unidad</div>
                <h2 style={{fontSize:18,margin:'6px 0 14px'}}>{priceLookupResult.descripcion||'Artículo sin descripción'}</h2>
                <div style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'}}>
                  <div>
                    <div style={{fontSize:12,color:'#64748b'}}>Precio unitario sin políticas · con IVA</div>
                    <strong style={{fontSize:'clamp(26px, 5vw, 36px)',color:'#0f172a'}}>{priceLookupResult.precioConIva==null?'Sin precio':Number(priceLookupResult.precioConIva).toLocaleString('es-AR',{style:'currency',currency:'ARS'})}</strong>
                    <div style={{fontSize:12,color:'#64748b'}}>Neto: {Number(priceLookupResult.precioSinIva).toLocaleString('es-AR',{style:'currency',currency:'ARS'})} · IVA {priceLookupResult.ivaPorcentual==null?'no disponible':priceLookupResult.ivaPorcentual+'%'}</div>
                  </div>
                  <PriceStatusButtons label="Estado de la etiqueta de góndola" status={priceCheckStatus} onChange={setPriceCheckStatus} disabled={priceSaving}/>
                </div>
                {priceCheckStatus&&<div role="status" style={{marginTop:12,padding:'8px 10px',borderRadius:8,background:priceCheckStatus==='ok'?'#dcfce7':priceCheckStatus==='error'?'#fee2e2':'#fef3c7',color:priceCheckStatus==='ok'?'#166534':priceCheckStatus==='error'?'#991b1b':'#92400e',fontWeight:600}}>
                  {priceCheckStatus==='ok'?'✓ Precio OK':priceCheckStatus==='error'?'✕ Precio erróneo':'— Precio no presente'} · Selección visual, aún no guardada.
                </div>}
                {priceLookupResult.aviso&&<p style={{color:'#92400e'}}>{priceLookupResult.aviso}</p>}
              </div>}
              {priceLookupResult&&<div style={{padding:12,border:'1px solid #dce3ec',borderRadius:8}}>
                <strong>Bonificaciones y políticas relacionadas con el artículo</strong>
                <button type="button" disabled={priceLookupBusy} style={{marginTop:8,padding:'8px 12px'}} onClick={async()=>{
                  if(!supabase||!priceLookupResult)return;
                  setPriceLookupBusy(true);
                  try{
                    const {data:{session}}=await supabase.auth.getSession();
                    if(!session?.access_token)throw new Error('Iniciá sesión nuevamente');
                    const data=await fetchPricePolicies(String(priceLookupResult.id),session.access_token,priceLookupResult.contextoPoliticas,true,setPricePolicyNote);
                    setPricePolicies(data.politicasEncontradas||[]);
                    setPricePolicyNote('Actualizadas: '+new Date(data.cacheActualizada).toLocaleString('es-AR')+'. '+(data.nota||''));
                  }catch(error){setPricePolicyNote('No se pudieron consultar políticas: '+(error instanceof Error?error.message:String(error)));}
                  finally{setPriceLookupBusy(false);}
                }}>Forzar actualización de políticas</button>
                {priceLookupBusy?<p role="status">Actualizando políticas…</p>:pricePolicyNote.startsWith('No se pudieron consultar políticas:')?<p style={{color:'#92400e'}}>No fue posible verificar las políticas. El precio mostrado es únicamente de lista, sin descuentos.</p>:pricePolicies.length?pricePolicies.map(p=><div key={p.id} style={{marginTop:10,padding:10,background:'#f8fafc',borderRadius:6}}>
                  <strong>Política #{p.id}</strong> · {p.alcance?.join(' + ')||'Artículo'} · <span style={{color:p.evaluacion==='candidata'?'#166534':'#92400e'}}>{p.evaluacion==='candidata'?'Candidata (no confirmada)':'Requiere validación'}</span>{p.ordenManual!=null?' · Orden manual '+p.ordenManual:''}
                  <br/>{p.descuento!=null?'Descuento '+p.descuento+'%':''}
                  {p.precio!=null&&<div style={{marginTop:4}}>
                    <strong>Precio fijo con IVA: {priceLookupResult.ivaPorcentual==null?'IVA no disponible':(Math.round((Number(p.precio)*(1+priceLookupResult.ivaPorcentual/100)+Number.EPSILON)*100)/100).toLocaleString('es-AR',{style:'currency',currency:'ARS'})}</strong>
                    <div style={{fontSize:12,color:'#64748b'}}>Neto: {Number(p.precio).toLocaleString('es-AR',{style:'currency',currency:'ARS'})} · IVA {priceLookupResult.ivaPorcentual==null?'no disponible':priceLookupResult.ivaPorcentual+'%'}</div>
                  </div>}
                  <br/><strong style={{fontSize:13,color:'#334155'}}>{p.cantidadMinima!=null?'A partir de '+p.cantidadMinima+(p.cantidadEnBultos==='S'?' bultos':' unidades'):'Sin mínimo de cantidad informado'}</strong>
                  {p.motivosEvaluacion?.length?<div style={{fontSize:12,color:'#92400e',marginTop:5}}>{p.motivosEvaluacion.join(' · ')}</div>:null}
                  <br/><small>Vigencia: {p.vigenciaDesde||'sin inicio'} a {p.vigenciaHasta||'sin fin'}
                  {p.cantidadMinima!=null?' · Mínimo '+p.cantidadMinima:''}{p.cantidadMaxima!=null?' · Máximo '+p.cantidadMaxima:''}
                  {p.cantidadEnBultos==='S'?' bultos':''}{p.condicionVenta?' · Condición '+p.condicionVenta:''}</small>
                  <PolicyPriceControl key={priceLookupResult.id+':'+p.id} policyId={p.id} onSave={async (status,observedPrice)=>{
                    if(!supabase)throw new Error('Supabase no disponible');
                    const fixedPrice=p.precio==null?null:Number(p.precio);
                    const grossPrice=fixedPrice==null||priceLookupResult.ivaPorcentual==null?null:Math.round((fixedPrice*(1+priceLookupResult.ivaPorcentual/100)+Number.EPSILON)*100)/100;
                    const {error}=await supabase.from('donato_controles_precios').insert({
                      articulo_id:priceLookupResult.id,descripcion:priceLookupResult.descripcion||null,
                      precio_lista_con_iva:priceLookupResult.precioConIva,precio_observado:observedPrice,estado:status,
                      politica_id:String(p.id),politica_snapshot:{...p,ivaPorcentual:priceLookupResult.ivaPorcentual},
                      precio_politica_neto:fixedPrice,precio_politica_con_iva:grossPrice,
                    });
                    if(error)throw error;
                    const {data}=await supabase.from('donato_controles_precios').select('id,creado_at,descripcion,articulo_id,estado,politica_id').order('creado_at',{ascending:false}).limit(10);
                    setPriceHistory(data||[]);
                  }}/>
                </div>):<p>No se encontraron políticas por artículo, proveedor, rubro, grupo o división en la consulta.</p>}
                {pricePolicyNote&&<p style={{fontSize:12,color:'#92400e'}}>{pricePolicyNote}</p>}
              </div>}

              {priceLookupResult&&<div style={{display:'grid',gap:10,padding:14,border:'1px solid #dce3ec',borderRadius:10}}>
                {priceCheckStatus==='error'&&<label>Precio observado (opcional)<input value={shelfPriceInput} onChange={e=>setShelfPriceInput(e.target.value)} inputMode="decimal" placeholder="Ej.: 1950,00" style={{display:'block',padding:10,marginTop:5}}/></label>}
                <button type="button" className="primary-button" disabled={!priceCheckStatus||priceSaving} onClick={async()=>{
                  if(!supabase||!priceCheckStatus||!priceLookupResult)return;
                  setPriceSaving(true);setPriceSaveMessage('');
                  try {
                    const amount=shelfPriceInput.trim().replace(',','.');
                    if(amount&&!/^\d+(\.\d{1,2})?$/.test(amount))throw new Error('Precio observado inválido');
                    const {error}=await supabase.from('donato_controles_precios').insert({articulo_id:priceLookupResult.id,descripcion:priceLookupResult.descripcion||null,precio_lista_con_iva:priceLookupResult.precioConIva,precio_observado:amount?Number(amount):null,estado:priceCheckStatus});
                    if(error)throw error;
                    setPriceSaveMessage('Control guardado');
                    setPriceCheckStatus(null);setShelfPriceInput('');
                    const {data}=await supabase.from('donato_controles_precios').select('id,creado_at,descripcion,articulo_id,estado,politica_id').order('creado_at',{ascending:false}).limit(10);
                    setPriceHistory(data||[]);
                    document.getElementById('sigma-price-article')?.focus();
                  }catch(error){setPriceSaveMessage('Error al guardar: '+(error instanceof Error?error.message:String(error)));}
                  finally{setPriceSaving(false);}
                }}>{priceSaving?'Guardando…':'Guardar control del precio de lista'}</button>
                {priceSaveMessage&&<p role="status">{priceSaveMessage}</p>}
              </div>}
              <div style={{padding:12,border:'1px solid #dce3ec',borderRadius:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><strong>Mis últimos controles</strong><button type="button" onClick={async()=>{if(!supabase)return;const {data,error}=await supabase.from('donato_controles_precios').select('id,creado_at,descripcion,articulo_id,estado,politica_id').order('creado_at',{ascending:false}).limit(10);if(error)setPriceLookupError(error.message);else setPriceHistory(data||[]);}}>Actualizar</button></div>
                {priceHistory.map(h=><div key={h.id} style={{padding:'8px 0',fontSize:13,borderBottom:'1px solid #e2e8f0'}}>{new Date(h.creado_at).toLocaleString('es-AR')} · {h.descripcion||h.articulo_id} · {h.politica_id!=null?'Política #'+h.politica_id:'Precio de lista'} · {h.estado==='ok'?'Precio correcto':h.estado==='error'?'Precio incorrecto':'Precio no presente'}</div>)}
              </div>
              {priceLookupError&&<p role="alert" style={{color:'#b91c1c'}}>{priceLookupError}</p>}
            </div>
        </section> : null}
        <div style={{display:stockMode||priceMode?'none':undefined}}>
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
              {historyDate && profile.rol === 'administrador' ? <button className="add-row-button" type="button" disabled={loadingHistory} onClick={() => void loadHistory(true)}>Recalcular desde Sigma</button> : null}
              {historyDate ? <button className="add-row-button" type="button" onClick={() => setHistoryDate('')}>Ver todos</button> : null}
            </div>
          </section>

          {historyError ? <div className="error-banner">{historyError}</div> : null}

          {editingQuickControl && historyDate && profile.rol === 'administrador' ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading"><div><p className="eyebrow">EDICIÓN CONTROL RÁPIDO</p><h2>Retiros del {displayDate(historyDate)}</h2></div>
                <button className="secondary-button" type="button" onClick={() => setEditingQuickControl(false)}>Volver al control</button></div>
              <p className="muted-copy">Listado completo por caja de registración y orden cronológico.</p>
              {[1,2,3,4].map((caja)=>{const rows=quickControlRetis.filter((r)=>Number(r.cajaCodigo)===caja);if(!rows.length)return null;return <div key={caja} style={{marginBottom:18}}><h3>Caja {caja}</h3>{rows.map((r)=>{
                  const suggested=quickControls.find((x)=>Number(x.usuarioCodigo)===Number(r.usuarioSugeridoCodigo) && (!r.cajaSugerida || Number(x.cajaCodigo)===Number(r.cajaSugerida))) || quickControls.find((x)=>Number(x.usuarioCodigo)===Number(r.usuarioSugeridoCodigo));
                  const showChooser = retiReassigning[Number(r.id)] === true;
                  const selectedJourney = quickControls.find((x)=>String(x.jornadaId || `${x.usuarioCodigo}-${x.cajaCodigo}`) === (retiAssignment[Number(r.id)] || ''));
                  const applySelected = async () => {
                    if (!selectedJourney) { await dismissRetiCorrection(r); return; }
                    await confirmRetiCorrection(selectedJourney,{retiroId:r.id,importe:r.importe,cajaRegistrada:r.cajaOriginal || r.cajaCodigo,cajaSugerida:Number(selectedJourney.cajaCodigo || r.cajaSugerida || r.cajaCodigo || 0),horaAproximada:r.horaAproximada,motivo:'Asignación manual confirmada por administrador',estado:'SUGERIDA'});
                    setRetiReassigning((prev)=>({...prev,[Number(r.id)]:false}));
                  };
                  return <div key={r.id} className="reti-review-card"><div className="reti-review-info"><strong>RETI {r.id} · {money.format(r.importe)}</strong><span>~{r.horaAproximada||'s/h'} · Registrado por: {r.registradoPorNombre||(r.registradoPorCodigo?`Usuario ${r.registradoPorCodigo}`:'sin dato')}</span><span>Cajero sugerido: {r.usuarioSugeridoNombre||'sin sugerencia'} · Estado: {r.estadoRevision}</span></div><div className="reti-review-actions">
                    {r.estadoRevision==='SUGERIDA' && !showChooser ? <>
                      <button className="add-row-button" type="button" disabled={!suggested} onClick={()=>suggested&&void confirmRetiCorrection(suggested,{retiroId:r.id,importe:r.importe,cajaRegistrada:r.cajaCodigo,cajaSugerida:Number(suggested.cajaCodigo || r.cajaSugerida || r.cajaCodigo || 0),horaAproximada:r.horaAproximada,motivo:r.motivoRevision||'Posible RETI en caja incorrecta',estado:'SUGERIDA'})}>Aceptar corrección</button>
                      <button className="secondary-button" type="button" onClick={()=>setRetiReassigning((prev)=>({...prev,[Number(r.id)]:true}))}>Desestimar corrección</button>
                    </> : null}
                    {(showChooser || r.estadoRevision==='CONFIRMADA' || r.estadoRevision==='DESESTIMADA') ? <>
                      <select value={retiAssignment[Number(r.id)]||''} onChange={(e)=>setRetiAssignment((prev)=>({...prev,[Number(r.id)]:e.target.value}))}>
                        <option value="">Dejar pendiente de asignar</option>
                        {quickControls.map((x)=><option key={x.jornadaId || `${x.usuarioCodigo}-${x.cajaCodigo}`} value={String(x.jornadaId || `${x.usuarioCodigo}-${x.cajaCodigo}`)}>{x.usuarioNombre} · Caja {x.cajaCodigo||'—'}{x.jornadaNro&&x.jornadaNro>1?` · Jornada ${x.jornadaNro}`:''}</option>)}
                      </select>
                      <button className="add-row-button" type="button" onClick={()=>void applySelected()}>OK</button>
                    </> : null}
                  </div></div>;
                })}</div>;})}
            </section>
          ) : null}

          {!editingQuickControl && historyDate ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">JORNADA DIARIA</p><h2>Jornada del {displayDate(historyDate)}</h2></div>
                {profile.rol === 'administrador' ? <button className="secondary-button" type="button" onClick={() => setEditingQuickControl(true)}>Editar control rápido</button> : <ReceiptText size={22} />}
              </div>
              {loadingHistory ? (
                <div className="empty-state"><Clock3 /><div><strong>Cargando histórico…</strong><p>Leyendo la reconstrucción guardada del día.</p></div></div>
              ) : historyJourneys.length ? (
                <div className="cashier-list">
                  {historyJourneys.map((journey) => {
                    const userClosures = historyClosures
                      .filter((item) => item.fecha === journey.fecha && Number(item.usuario_sigma_codigo) === Number(journey.usuarioCodigo) && item.estado !== 'CANCELADO')
                      .sort((a, b) => Number(b.cierre_nro || 0) - Number(a.cierre_nro || 0));
                    const editable = userClosures.find((item) => ['BORRADOR', 'REVISION_SUPERVISOR'].includes(item.estado));
                    const latest = userClosures[0] || null;
                    const control = quickControls.find((x) => Number(x.usuarioCodigo) === Number(journey.usuarioCodigo));
                    const pending = journey.tieneActividadNueva === true;
                    const stateLabel = editable ? statusLabel(editable) : pending ? 'Pendiente de cierre' : latest ? statusLabel(latest) : 'Sin pendiente';
                    const stateClass = pending || editable?.estado === 'BORRADOR' ? 'pending' : latest && ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(latest.estado) ? 'done' : 'review';
                    return (
                      <button
                        key={`history-${journey.fecha}-${journey.jornadaId || journey.usuarioCodigo}`}
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
                          <strong>{journey.usuarioNombre}{journey.jornadaNro && journey.jornadaNro > 1 ? ` · Jornada ${journey.jornadaNro}` : ''}</strong>
                          <span>
                            {journey.cajaCodigo ? `Caja ${journey.cajaCodigo} · ` : ''}
                            Venta {money.format(Number(journey.venta || 0))}
                            {journey.cantidadVentas ? ` · ${journey.cantidadVentas} ventas` : ''}
                            {journey.primeraVentaHora ? ` · primera ${journey.primeraVentaHora}` : ''}
                            {journey.ultimaVentaHora ? ` · última ${journey.ultimaVentaHora}` : ''}
                          </span>
                          {control ? <span>Efectivo CODO {money.format(control.efectivoCodo)} · RETI {money.format(control.retirosAsignados)} · Clover {money.format(control.clover)} · Payway {money.format(control.payway)} · Naranja {money.format(control.naranja)} · Cta. Cte. {money.format(control.cuentaCorriente)}</span> : null}
                          {control ? <span><strong>{control.estadoDiferencia === 'OK' ? 'Sin diferencia' : `${control.estadoDiferencia === 'FALTANTE' ? 'Faltante' : 'Sobrante'} ${money.format(Math.abs(control.diferenciaSigma))}`}</strong> · Saldo efectivo {money.format(control.efectivoTeoricoRestante)}</span> : null}
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

          {!editingQuickControl ? <section className="panel dashboard-panel">
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
                    <div className="history-closure-result">
                      {item.diferencia_efectivo !== null && item.diferencia_efectivo !== undefined ? (
                        <strong className={Number(item.diferencia_efectivo) < -0.005 ? 'negative' : Number(item.diferencia_efectivo) > 0.005 ? 'positive' : ''}>
                          {Math.abs(Number(item.diferencia_efectivo)) < 0.005 ? 'Sin diferencia' : Number(item.diferencia_efectivo) < 0 ? 'Faltante' : 'Sobrante'}
                          {Math.abs(Number(item.diferencia_efectivo)) >= 0.005 ? ` ${money.format(Math.abs(Number(item.diferencia_efectivo)))}` : ''}
                        </strong>
                      ) : null}
                      <div className={`cashier-state ${['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado) ? 'done' : item.estado === 'BORRADOR' ? 'pending' : 'review'}`}>{statusLabel(item)}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state"><FileText /><div><strong>No hay cierres para mostrar</strong><p>{historyDate ? 'No se registraron cierres en esa fecha.' : 'Todavía no hay cierres en el historial.'}</p></div></div>
            )}
          </section> : null}
          </div>
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
            <button className="nav-item" onClick={() => { setStockMode(true); setStockView('home'); setDashboardMode('history'); setSelectedJourney(null); setClosure(null); setStockSelected(null); void stockRefresh(); void stockLoadOptions(); }}><ClipboardCheck size={18} /> Control de stock</button>
            <button className="nav-item" onClick={() => { setStockMode(false); setPriceMode(true); setDashboardMode('history'); setSelectedJourney(null); setClosure(null); }}> <ReceiptText size={18} /> Control Precios</button>
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
              {isAdminHistoricalEdit ? (
                <button className="primary-button" type="button" onClick={() => void saveAdminDeclarationChanges()} disabled={busy}>
                  <ShieldCheck size={17} /> {busy ? 'Guardando…' : 'Guardar cambios'}
                </button>
              ) : canEditDeclaration ? <ShieldCheck size={22} /> : <LockKeyhole size={22} />}
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

            {isAdminHistoricalEdit ? (
              <div className="closure-actions closure-actions-single">
                <button className="primary-button close-blind-button" type="button" onClick={() => void saveAdminDeclarationChanges()} disabled={busy}>
                  <ShieldCheck size={18} /> {busy ? 'Guardando…' : 'Guardar corrección administrativa'}
                </button>
              </div>
            ) : null}

            {canOperationalEdit ? (
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
                <div className="compare-row reti-compare-row"><div><span>Movimientos RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Se concilian movimientos completos; nunca se parte un RETI para hacer coincidir un saldo.</small>{snapshot.retirosDocumentos?.length ? <div className="reti-detail-list">{snapshot.retirosDocumentos.map((retiro: any, index) => <div className="reti-detail-item" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.esDeltaInferido ? <small>Incremento detectado desde el corte anterior</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className="reti-detail-empty">Sin detalle individual guardado para este corte.</small>}</div><div className="compare-arrow">→</div><div><span>Retiros físicos del cierre</span><strong>{money.format(totalDepositario + totalSupervisor + declaration.cierreEfectivo)}</strong><small>{money.format(totalDepositario + totalSupervisor)} documentado + {money.format(declaration.cierreEfectivo)} cierre de caja</small>{fullComparison.errorRegistroAdministrativo ? <><small className="negative">Error de registración Sigma</small><small>No existe un movimiento o combinación completa que coincida con el importe físico. No se divide la diferencia.</small></> : fullComparison.hayPendienteAdministrativo ? <><small className="negative">Pendiente administrativo</small><small>{fullComparison.retirosSigmaPendienteSalida ? `${money.format(fullComparison.retirosSigmaPendienteSalida)} en movimientos Sigma completos quedan para el próximo cierre.` : `${money.format(fullComparison.retirosFisicoPendienteSalida || 0)} de documentación física espera su RETI en Sigma.`}</small></> : <small className="positive">Conciliado por movimientos completos</small>}</div></div>
                <div className="compare-row"><div><span>Efectivo Sigma</span><strong>{money.format(snapshot.efectivo)}</strong><small>Recaudación en efectivo del tramo</small></div><div className="compare-arrow">→</div><div><span>Efectivo rendido</span><strong>{money.format(efectivoRendido)}</strong><small>{money.format(totalDepositario + totalSupervisor)} en retiros + {money.format(declaration.cierreEfectivo)} entregado al cierre</small></div></div>
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
