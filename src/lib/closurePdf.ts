import { jsPDF } from 'jspdf';
import donatoLogo from '../../logo donato.jpg';

type MoneyRow = { referencia?: string; importe?: number };
type CurrentAccountRow = { comprobante?: string; cliente?: string; importe?: number };

export type ClosurePdfInput = {
  closure: {
    fecha: string; cierre_nro: number; estado: string; caja_codigo: number;
    usuario_sigma_codigo: number; usuario_sigma_nombre: string;
    corte_desde_at?: string | null; corte_hasta_at?: string | null; sigma_snapshot_capturado_at?: string | null;
  };
  declaration: {
    cloverFisico: number; paywayFisico: number; cierreEfectivo: number;
    depositario: MoneyRow[]; retirosSupervisor: MoneyRow[]; cashbacks: MoneyRow[]; cuentasCorrientes: CurrentAccountRow[];
  };
  blindComparison?: any | null; snapshot?: any | null; fullComparison?: any | null; generatedBy: string;
};

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const num = (v: unknown) => Number(v || 0);
const total = (rows?: Array<{ importe?: number }>) => (rows || []).reduce((sum, row) => sum + num(row.importe), 0);
const dateAR = (v: string) => { const [y,m,d] = v.split('-'); return `${d}/${m}/${y}`; };
function timeAR(value?: string | null) { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Cordoba',hour:'2-digit',minute:'2-digit',hour12:false}).format(d); }
function statusText(s: string) { return ({BORRADOR:'Borrador',REVISION_SUPERVISOR:'Revision del Supervisor',PENDIENTE_VALIDACION:'Pendiente de validacion',CERRADO:'Cerrado',AJUSTES_AUTORIZADOS:'Ajustes autorizados',AJUSTADO:'Ajustado',CANCELADO:'Cancelado'} as Record<string,string>)[s] || s; }
async function logoDataUrl() { try { const r=await fetch(donatoLogo); const b=await r.blob(); return await new Promise<string>((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(String(f.result||''));f.onerror=()=>reject(f.error);f.readAsDataURL(b);}); } catch { return ''; } }

export async function downloadClosurePdf(input: ClosurePdfInput) {
  const { closure, declaration, blindComparison, snapshot, fullComparison } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const W=210, margin=15; let y=15;
  const ensure=(n=12)=>{if(y+n>282){doc.addPage();y=15;}};
  const line=()=>{doc.setDrawColor(224,229,238);doc.line(margin,y,W-margin,y);y+=5;};
  const section=(t:string)=>{ensure(12);doc.setTextColor(24,63,130);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text(t,margin,y);y+=4;line();};
  const pair=(l:string,v:string,rl?:string,rv?:string)=>{ensure(9);doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(l,margin,y);doc.setFont('helvetica','bold');doc.setTextColor(23,35,61);doc.text(v,margin,y+4);if(rl){doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(rl,108,y);doc.setFont('helvetica','bold');doc.setTextColor(23,35,61);doc.text(rv||'',108,y+4);}y+=11;};
  const row=(l:string,s:string,p:string,d:string)=>{ensure(8);doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(23,35,61);doc.text(l,margin,y);doc.text(s,78,y,{align:'right'});doc.text(p,132,y,{align:'right'});doc.text(d,W-margin,y,{align:'right'});y+=7;};
  const logo=await logoDataUrl(); if(logo) doc.addImage(logo,'JPEG',margin,y,24,24);
  doc.setTextColor(24,63,130);doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text('DONATO',logo?45:margin,y+7);doc.setFontSize(13);doc.text('Resumen de cierre de caja',logo?45:margin,y+15);doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(102,112,133);doc.text(`Generado por ${input.generatedBy}`,logo?45:margin,y+21);y+=31;
  section('Identificacion del cierre'); pair('Fecha',dateAR(closure.fecha),'Cajero',closure.usuario_sigma_nombre);pair('Caja',`Caja ${closure.caja_codigo}`,'Cierre',`Nro. ${closure.cierre_nro}`);pair('Usuario Sigma',String(closure.usuario_sigma_codigo),'Estado',statusText(closure.estado));pair('Tramo',`${timeAR(closure.corte_desde_at)||'inicio'} - ${timeAR(closure.corte_hasta_at||closure.sigma_snapshot_capturado_at)||'sin corte'}`);
  section('Declaracion fisica del Supervisor');pair('Clover',pesos.format(num(declaration.cloverFisico)),'Payway',pesos.format(num(declaration.paywayFisico)));pair('Tickets del depositario',pesos.format(total(declaration.depositario)),'Retiros de supervisores',pesos.format(total(declaration.retirosSupervisor)));pair('Efectivo de cierre',pesos.format(num(declaration.cierreEfectivo)),'Cashback',pesos.format(total(declaration.cashbacks)));pair('Cuenta corriente recibida',pesos.format(total(declaration.cuentasCorrientes)));
  if(declaration.depositario?.some(r=>num(r.importe)>0)){doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Detalle depositario',margin,y);y+=5;declaration.depositario.filter(r=>num(r.importe)>0).forEach(r=>row(r.referencia||'Sin referencia','',pesos.format(num(r.importe)),''));}
  if(declaration.retirosSupervisor?.some(r=>num(r.importe)>0)){doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Detalle retiros de supervisores',margin,y);y+=5;declaration.retirosSupervisor.filter(r=>num(r.importe)>0).forEach(r=>row(r.referencia||'Sin referencia','',pesos.format(num(r.importe)),''));}
  if(declaration.cuentasCorrientes?.length){ensure(12);doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Cuenta corriente',margin,y);y+=5;declaration.cuentasCorrientes.forEach(r=>row(`${r.comprobante||'Sin numero'} ${r.cliente||''}`.trim(),'',pesos.format(num(r.importe)),''));}
  section('Resultado del control');const conceptOk=fullComparison?.conceptosOk??blindComparison?.conceptosOk;const adminOk=fullComparison?.administrativoOk??blindComparison?.administrativoOk??blindComparison?.coincidencias?.retiros;const cashOk=fullComparison?.cajaOk??blindComparison?.cajaOk;pair('Medios / conceptos',conceptOk?'OK':'REVISAR','Resultado de caja',cashOk?'OK':'REVISAR');pair('Control administrativo RETI',adminOk?'OK':'REVISAR');
  if(snapshot&&fullComparison){ensure(16);doc.setFillColor(245,247,251);doc.rect(margin,y-2,W-margin*2,8,'F');doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Concepto',margin,y+3);doc.text('Sigma',78,y+3,{align:'right'});doc.text('Fisico',132,y+3,{align:'right'});doc.text('Diferencia',W-margin,y+3,{align:'right'});y+=12;const cloverSigma=num(snapshot.cloverDirecto)+num(snapshot.naranja);const efectivoFisico=total(declaration.depositario)+total(declaration.retirosSupervisor)+num(declaration.cierreEfectivo);const cc=total(declaration.cuentasCorrientes);const retirosDoc=total(declaration.depositario)+total(declaration.retirosSupervisor);row('Clover',pesos.format(cloverSigma),pesos.format(num(declaration.cloverFisico)),pesos.format(num(fullComparison.diferencias?.clover)));row('Payway',pesos.format(num(snapshot.payway)),pesos.format(num(declaration.paywayFisico)),pesos.format(num(fullComparison.diferencias?.payway)));row('Efectivo',pesos.format(num(snapshot.efectivo)),pesos.format(efectivoFisico),pesos.format(efectivoFisico-num(snapshot.efectivo)));row('Cuenta corriente',pesos.format(num(snapshot.cuentaCorriente)),pesos.format(cc),pesos.format(num(fullComparison.diferencias?.cuentaCorriente)));row('RETI administrativo',pesos.format(num(snapshot.retiros)),pesos.format(retirosDoc),pesos.format(num(fullComparison.diferencias?.retiros)));ensure(13);doc.setFillColor(238,244,255);doc.roundedRect(margin,y,W-margin*2,12,2,2,'F');doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(24,63,130);doc.text('Diferencia neta de caja',margin+4,y+5);doc.text(pesos.format(num(fullComparison.diferenciaCaja)),W-margin-4,y+5,{align:'right'});doc.setFontSize(7.5);doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(`Tolerancia configurada: ${pesos.format(num(fullComparison.toleranciaCaja))}`,margin+4,y+9);y+=17;} else {ensure(12);doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(102,112,133);doc.text(doc.splitTextToSize('Este reporte respeta el control ciego: no incluye importes de Sigma ni montos de diferencias para el Supervisor.',W-margin*2),margin,y);y+=10;}
  ensure(18);doc.setFillColor(255,249,207);doc.roundedRect(margin,y,W-margin*2,15,2,2,'F');doc.setFontSize(7.8);doc.setFont('helvetica','normal');doc.setTextColor(108,91,0);doc.text(doc.splitTextToSize('Nota: el control administrativo RETI compara los tickets del depositario y los retiros de supervisores con los RETI de la cuenta de caja en Sigma. El efectivo recibido al cierre no se considera RETI.',W-margin*2-8),margin+4,y+5);
  doc.setFontSize(7);doc.setTextColor(152,162,179);doc.text(`Documento de control interno - Donato - ${new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Cordoba'}).format(new Date())}`,margin,290);
  const safe=closure.usuario_sigma_nombre.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'');doc.save(`Cierre_Donato_${closure.fecha}_${safe}_Cierre-${closure.cierre_nro}.pdf`);
}
