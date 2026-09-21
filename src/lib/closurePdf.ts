import { jsPDF } from 'jspdf';
import donatoLogo from '../../logo donato.jpg?inline';

type MoneyRow = { referencia?: string; importe?: number };
type CurrentAccountRow = { comprobante?: string; cliente?: string; importe?: number };

export type ClosurePdfInput = {
  closure: {
    fecha: string; cierre_nro: number; estado: string; caja_codigo: number;
    usuario_sigma_codigo: number; usuario_sigma_nombre: string;
    jornada_inicio_hora?: string | null; jornada_fin_hora?: string | null;
    corte_desde_at?: string | null; corte_hasta_at?: string | null; sigma_snapshot_capturado_at?: string | null;
    fondo_inicial?: number | null; fondo_devuelto?: number | null; diferencia_fondo?: number | null;
    efectivo_entregado_cierre?: number | null; efectivo_esperado_cierre?: number | null; diferencia_efectivo?: number | null;
  };
  declaration: {
    cloverFisico: number; paywayFisico: number; cierreEfectivo: number;
    depositario: MoneyRow[]; retirosSupervisor: MoneyRow[]; cashbacks: MoneyRow[]; cuentasCorrientes: CurrentAccountRow[];
  };
  blindComparison?: any | null; snapshot?: any | null; fullComparison?: any | null; generatedBy: string;
};

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const num = (value: unknown) => Number(value || 0);
const total = (rows?: Array<{ importe?: number }>) => (rows || []).reduce((sum, row) => sum + num(row.importe), 0);
function dateAR(value: string) { const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; }
function timeAR(value?: string | null) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; return new Intl.DateTimeFormat('es-AR', { timeZone:'America/Argentina/Cordoba', hour:'2-digit', minute:'2-digit', hour12:false }).format(date); }
function statusText(status: string) { const labels: Record<string,string> = { BORRADOR:'Borrador', REVISION_SUPERVISOR:'Revision del Supervisor', PENDIENTE_VALIDACION:'Pendiente de validacion', CERRADO:'Cerrado', AJUSTES_AUTORIZADOS:'Ajustes autorizados', AJUSTADO:'Ajustado', CANCELADO:'Cancelado' }; return labels[status] || status; }

export async function downloadClosurePdf(input: ClosurePdfInput) {
  const previewWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  if (previewWindow) { previewWindow.document.title='Generando PDF Donato'; previewWindow.document.body.innerHTML='<div style="font-family:system-ui,sans-serif;padding:32px;color:#183f82"><strong>Generando resumen de cierre...</strong><p style="color:#667085">El PDF se abrirá en esta ventana.</p></div>'; }
  const { closure, declaration, blindComparison, snapshot, fullComparison } = input;
  const doc = new jsPDF({unit:'mm',format:'a4'}); const width=210, margin=12; let y=10;
  // El resumen operativo debe caber en una sola hoja A4. Los bloques se compactan
  // y el detalle RETI se resume antes de permitir un salto de página.
  const ensure=(_needed=12)=>{};
  const line=()=>{doc.setDrawColor(224,229,238);doc.line(margin,y,width-margin,y);y+=3.5;};
  const section=(title:string)=>{ensure(10);doc.setTextColor(24,63,130);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(title,margin,y);y+=3;line();};
  const pair=(label:string,value:string,rightLabel?:string,rightValue?:string)=>{ensure(9);doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(label,margin,y);doc.setFont('helvetica','bold');doc.setTextColor(23,35,61);doc.text(value,margin,y+4);if(rightLabel){doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(rightLabel,108,y);doc.setFont('helvetica','bold');doc.setTextColor(23,35,61);doc.text(rightValue||'',108,y+4);}y+=9;};
  const tableRow=(label:string,sigmaValue:string,physicalValue:string,difference:string)=>{ensure(8);doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(23,35,61);doc.text(label,margin,y);doc.text(sigmaValue,78,y,{align:'right'});doc.text(physicalValue,132,y,{align:'right'});doc.text(difference,width-margin,y,{align:'right'});y+=5.5;};
  try { doc.addImage(donatoLogo,'JPEG',margin,y,24,24); } catch {}
  doc.setTextColor(24,63,130);doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text('DONATO',45,y+7);doc.setFontSize(13);doc.text('Resumen de cierre de caja',45,y+15);doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(102,112,133);doc.text(`Generado por ${input.generatedBy}`,45,y+21);y+=27;
  section('Identificacion del cierre'); pair('Fecha',dateAR(closure.fecha),'Cajero',closure.usuario_sigma_nombre); pair('Caja',`Caja ${closure.caja_codigo}`,'Cierre',`Nro. ${closure.cierre_nro}`); pair('Usuario Sigma',String(closure.usuario_sigma_codigo),'Estado',statusText(closure.estado)); pair('Jornada',`${closure.jornada_inicio_hora || timeAR(closure.corte_desde_at) || 'sin inicio'} - ${closure.jornada_fin_hora || timeAR(closure.corte_hasta_at||closure.sigma_snapshot_capturado_at) || 'sin fin'}`,'Corte del cierre',`${timeAR(closure.corte_desde_at)||'00:00'} - ${timeAR(closure.corte_hasta_at||closure.sigma_snapshot_capturado_at)||'sin corte'}`);

  section('Fondo de caja (separado de la recaudacion)');
  pair('Fondo inicial entregado',pesos.format(num(closure.fondo_inicial)),'Fondo devuelto',pesos.format(num(closure.fondo_devuelto)));
  pair('Diferencia de fondo',pesos.format(num(closure.diferencia_fondo)));

  section('Declaracion fisica / recaudacion');
  pair('Clover',pesos.format(num(declaration.cloverFisico)),'Payway',pesos.format(num(declaration.paywayFisico)));
  pair('Tickets del depositario',pesos.format(total(declaration.depositario)),'Retiros de supervisores',pesos.format(total(declaration.retirosSupervisor)));
  const efectivoEntregado = closure.efectivo_entregado_cierre == null ? num(declaration.cierreEfectivo) : num(closure.efectivo_entregado_cierre);
  pair('Efectivo entregado al cierre',pesos.format(efectivoEntregado),'Cashback',pesos.format(total(declaration.cashbacks)));
  pair('Cuenta corriente recibida',pesos.format(total(declaration.cuentasCorrientes)));
  if (closure.efectivo_esperado_cierre != null) pair('Efectivo esperado de recaudacion',pesos.format(num(closure.efectivo_esperado_cierre)),'Diferencia de efectivo',pesos.format(num(closure.diferencia_efectivo)));

  if(declaration.depositario?.some(r=>num(r.importe)>0)){doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Detalle depositario',margin,y);y+=5;declaration.depositario.filter(r=>num(r.importe)>0).forEach(r=>tableRow(r.referencia||'Sin referencia','',pesos.format(num(r.importe)),''));}
  if(declaration.retirosSupervisor?.some(r=>num(r.importe)>0)){doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Detalle retiros de supervisores',margin,y);y+=5;declaration.retirosSupervisor.filter(r=>num(r.importe)>0).forEach(r=>tableRow(r.referencia||'Sin referencia','',pesos.format(num(r.importe)),''));}
  if(declaration.cuentasCorrientes?.length){ensure(12);doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Cuenta corriente',margin,y);y+=5;declaration.cuentasCorrientes.forEach(r=>tableRow(`${r.comprobante||'Sin numero'} ${r.cliente||''}`.trim(),'',pesos.format(num(r.importe)),''));}

  section('Resultado del control'); const conceptOk=fullComparison?.conceptosOk??blindComparison?.conceptosOk; const adminOk=fullComparison?.administrativoOk??blindComparison?.administrativoOk??blindComparison?.coincidencias?.retiros; const cashOk=fullComparison?.cajaOk??blindComparison?.cajaOk; pair('Medios / conceptos',conceptOk?'OK':'REVISAR','Resultado de caja',cashOk?'OK':'REVISAR'); const adminStatus=fullComparison?.errorRegistroAdministrativo?'ERROR DE REGISTRACION SIGMA':fullComparison?.hayPendienteAdministrativo?'PENDIENTE PARA PROXIMO CIERRE':adminOk?'OK':'REVISAR'; pair('Control administrativo RETI',adminStatus);
  if(snapshot&&fullComparison){ensure(16);doc.setFillColor(245,247,251);doc.rect(margin,y-2,width-margin*2,8,'F');doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Concepto',margin,y+3);doc.text('Sigma',78,y+3,{align:'right'});doc.text('Fisico',132,y+3,{align:'right'});doc.text('Diferencia',width-margin,y+3,{align:'right'});y+=9;const cloverSigma=num(snapshot.cloverDirecto)+num(snapshot.naranja);const efectivoFisico=total(declaration.depositario)+total(declaration.retirosSupervisor)+efectivoEntregado;const cuentaCorrienteFisica=total(declaration.cuentasCorrientes);const retirosDocumentados=total(declaration.depositario)+total(declaration.retirosSupervisor);tableRow('Clover',pesos.format(cloverSigma),pesos.format(num(declaration.cloverFisico)),pesos.format(num(fullComparison.diferencias?.clover)));tableRow('Payway',pesos.format(num(snapshot.payway)),pesos.format(num(declaration.paywayFisico)),pesos.format(num(fullComparison.diferencias?.payway)));tableRow('Efectivo recaudacion',pesos.format(num(snapshot.efectivo)),pesos.format(efectivoFisico),pesos.format(efectivoFisico-num(snapshot.efectivo)));tableRow('Cuenta corriente',pesos.format(num(snapshot.cuentaCorriente)),pesos.format(cuentaCorrienteFisica),pesos.format(num(fullComparison.diferencias?.cuentaCorriente)));tableRow('RETI administrativo',pesos.format(num(snapshot.retiros)),pesos.format(retirosDocumentados),pesos.format(num(fullComparison.diferencias?.retiros)));if(fullComparison.errorRegistroAdministrativo)pair('RETI','ERROR: no existe movimiento o combinacion completa que coincida con el fisico');else if(fullComparison.hayPendienteAdministrativo){if(num(fullComparison.retirosSigmaPendienteSalida))pair('Movimientos Sigma pendientes',pesos.format(num(fullComparison.retirosSigmaPendienteSalida)));if(num(fullComparison.retirosFisicoPendienteSalida))pair('Documentacion fisica pendiente',pesos.format(num(fullComparison.retirosFisicoPendienteSalida)));}if(Array.isArray(snapshot.retirosDocumentos)&&snapshot.retirosDocumentos.length){ensure(10);doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Detalle RETI Sigma',margin,y);y+=5;snapshot.retirosDocumentos.forEach((retiro:any)=>{const quien=retiro.usuarioNombre||(retiro.usuarioCodigo?`Usuario ${retiro.usuarioCodigo}`:'Usuario no informado');const detalle=[quien,retiro.concepto,retiro.observacion].filter(Boolean).join(' · ');tableRow(detalle||'RETI','',pesos.format(num(retiro.importe)),'');});}ensure(13);doc.setFillColor(238,244,255);doc.roundedRect(margin,y,width-margin*2,12,2,2,'F');doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(24,63,130);doc.text('Diferencia neta de caja',margin+4,y+5);doc.text(pesos.format(num(fullComparison.diferenciaCaja)),width-margin-4,y+5,{align:'right'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(`Tolerancia configurada: ${pesos.format(num(fullComparison.toleranciaCaja))}`,margin+4,y+9);y+=14;}else{ensure(12);doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(doc.splitTextToSize('Este reporte respeta el control ciego: no incluye importes de Sigma ni montos de diferencias para el Supervisor.',width-margin*2),margin,y);y+=10;}
  ensure(21);doc.setFillColor(255,249,207);doc.roundedRect(margin,y,width-margin*2,15,2,2,'F');doc.setFontSize(7.8);doc.setFont('helvetica','normal');doc.setTextColor(108,91,0);doc.text(doc.splitTextToSize('Nota: el fondo de caja se controla por separado y no integra la recaudacion. El control RETI compara tickets del depositario y retiros de supervisores con los RETI de la cuenta de caja en Sigma. El efectivo recibido al cierre tampoco se considera RETI.',width-margin*2-8),margin+4,y+5);
  doc.setFontSize(7);doc.setTextColor(152,162,179);doc.text(`Documento de control interno - Donato - ${new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Cordoba'}).format(new Date())}`,margin,292);
  const safeName=closure.usuario_sigma_nombre.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'');const filename=`Cierre_Donato_${closure.fecha}_${safeName}_Cierre-${closure.cierre_nro}.pdf`;const blob=doc.output('blob');const url=URL.createObjectURL(blob);if(previewWindow&&!previewWindow.closed)previewWindow.location.href=url;else{const link=document.createElement('a');link.href=url;link.download=filename;link.target='_blank';link.rel='noopener';document.body.appendChild(link);link.click();link.remove();}window.setTimeout(()=>URL.revokeObjectURL(url),120000);
}