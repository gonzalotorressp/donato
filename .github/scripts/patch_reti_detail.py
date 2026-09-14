from pathlib import Path

# server/sigma.js
p = Path('server/sigma.js')
s = p.read_text()

s = s.replace(
"    cajaCodigo: cashAccount ? cashAccount - 1259 : null,\n    ventasDocumentos: [],\n    cuentaCorrienteDocumentos: [],",
"    cajaCodigo: cashAccount ? cashAccount - 1259 : null,\n    ventasDocumentos: [],\n    cuentaCorrienteDocumentos: [],\n    retirosDocumentos: [],",
1,
)

old = """  if (cashAccount) {\n    for (const row of accounting) {\n      if (row.fecha !== fecha) continue;\n      if (String(row.comprobanteCodigo || '').trim().toUpperCase() !== 'RETI') continue;\n      if (Number(row.cuentaCodigo) !== cashAccount) continue;\n      snapshot.retiros += Math.abs(number(row.monto || row.haber || row.debe));\n    }\n  }\n"""
new = """  if (cashAccount) {\n    for (const row of accounting) {\n      if (row.fecha !== fecha) continue;\n      if (String(row.comprobanteCodigo || '').trim().toUpperCase() !== 'RETI') continue;\n      if (Number(row.cuentaCodigo) !== cashAccount) continue;\n      const retiroImporte = Math.abs(number(row.monto || row.haber || row.debe));\n      snapshot.retiros += retiroImporte;\n      snapshot.retirosDocumentos.push({\n        key: [\n          Number(row.cuentaCodigo) || '',\n          Number(row.usuarioCodigo) || '',\n          retiroImporte,\n          String(row.concepto || '').trim(),\n          String(row.observacion || '').trim(),\n        ].join('|'),\n        cuentaCodigo: Number(row.cuentaCodigo) || null,\n        usuarioCodigo: Number(row.usuarioCodigo) || null,\n        usuarioNombre: String(row.usuarioNombre || '').trim(),\n        importe: round2(retiroImporte),\n        concepto: String(row.concepto || '').trim(),\n        observacion: String(row.observacion || '').trim(),\n      });\n    }\n  }\n"""
if old not in s:
    raise SystemExit('RETI collection block not found')
s = s.replace(old, new, 1)

s = s.replace(
"  snapshot.cuentaCorrienteDocumentos.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.key).localeCompare(String(b.key)));\n  return snapshot;",
"  snapshot.cuentaCorrienteDocumentos.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.key).localeCompare(String(b.key)));\n  snapshot.retirosDocumentos.sort((a, b) => Number(b.importe || 0) - Number(a.importe || 0) || String(a.usuarioNombre || '').localeCompare(String(b.usuarioNombre || '')));\n  return snapshot;",
1,
)

old = """    retiros: 0,\n    ventasDocumentos: documentDifference(current.ventasDocumentos, baseline.ventasDocumentos),\n    cuentaCorrienteDocumentos: documentDifference(current.cuentaCorrienteDocumentos, baseline.cuentaCorrienteDocumentos),\n  };\n"""
new = """    retiros: 0,\n    cajaCodigo: current.cajaCodigo ?? baseline.cajaCodigo ?? null,\n    ventasDocumentos: documentDifference(current.ventasDocumentos, baseline.ventasDocumentos),\n    cuentaCorrienteDocumentos: documentDifference(current.cuentaCorrienteDocumentos, baseline.cuentaCorrienteDocumentos),\n    retirosDocumentos: documentDifference(current.retirosDocumentos, baseline.retirosDocumentos),\n  };\n"""
if old not in s:
    raise SystemExit('snapshot diff block not found')
s = s.replace(old, new, 1)
p.write_text(s)

# src/App.tsx
p = Path('src/App.tsx')
s = p.read_text()

s = s.replace(
"  retiros: number;\n  cuentaCorrienteDocumentos: Array<{",
"  retiros: number;\n  retirosDocumentos?: Array<{\n    key?: string;\n    cuentaCodigo?: number | null;\n    usuarioCodigo?: number | null;\n    usuarioNombre?: string;\n    importe: number;\n    concepto?: string;\n    observacion?: string;\n  }>;\n  cuentaCorrienteDocumentos: Array<{",
1,
)

old = """                <div className=\"compare-row\"><div><span>RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Control por cuenta de caja, sin importar qué usuario registró el RETI</small></div><div className=\"compare-arrow\">→</div><div><span>Retiros documentados</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong><small className={fullComparison.coincidencias.retiros ? 'positive' : 'negative'}>{money.format(fullComparison.diferencias.retiros)} de diferencia administrativa · no incluye efectivo de cierre</small></div></div>\n"""
new = """                <div className=\"compare-row reti-compare-row\"><div><span>RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Control por cuenta de caja, sin importar qué usuario registró el RETI</small>{snapshot.retirosDocumentos?.length ? <div className=\"reti-detail-list\">{snapshot.retirosDocumentos.map((retiro, index) => <div className=\"reti-detail-item\" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className=\"reti-detail-empty\">Sigma no devolvió detalle individual de los RETI en el snapshot guardado.</small>}</div><div className=\"compare-arrow\">→</div><div><span>Retiros documentados</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong><small className={fullComparison.coincidencias.retiros ? 'positive' : 'negative'}>{money.format(fullComparison.diferencias.retiros)} de diferencia administrativa · no incluye efectivo de cierre</small></div></div>\n"""
if old not in s:
    raise SystemExit('App RETI compare row not found')
s = s.replace(old, new, 1)
p.write_text(s)

# src/blind.css
p = Path('src/blind.css')
s = p.read_text()
s += """

.reti-compare-row > div:first-child { min-width: 0; }
.reti-detail-list { margin-top: 12px; display: grid; gap: 8px; }
.reti-detail-item { padding: 9px 10px; border: 1px solid #dfe6f0; border-radius: 10px; background: #f8fafc; }
.reti-detail-item > div { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.reti-detail-item b { color: #183f82; font-size: .92rem; }
.reti-detail-item span { color: #667085; font-size: .78rem; text-align: right; }
.reti-detail-item small { display: block; margin-top: 4px; color: #667085; line-height: 1.25; }
.reti-detail-empty { display: block; margin-top: 8px; color: #98a2b3; }
@media (max-width: 720px) { .reti-detail-item > div { align-items: flex-start; flex-direction: column; gap: 2px; } .reti-detail-item span { text-align: left; } }
"""
p.write_text(s)

# src/lib/closurePdf.ts
p = Path('src/lib/closurePdf.ts')
s = p.read_text()
old = "row('RETI administrativo',pesos.format(num(snapshot.retiros)),pesos.format(retirosDoc),pesos.format(num(fullComparison.diferencias?.retiros)));ensure(13);"
new = "row('RETI administrativo',pesos.format(num(snapshot.retiros)),pesos.format(retirosDoc),pesos.format(num(fullComparison.diferencias?.retiros)));if(Array.isArray(snapshot.retirosDocumentos)&&snapshot.retirosDocumentos.length){ensure(10);doc.setFontSize(7.5);doc.setFont('helvetica','bold');doc.setTextColor(71,84,103);doc.text('Detalle RETI Sigma',margin,y);y+=5;snapshot.retirosDocumentos.forEach((r:any)=>{const who=r.usuarioNombre|| (r.usuarioCodigo?`Usuario ${r.usuarioCodigo}`:'Usuario no informado');const detail=[who,r.concepto,r.observacion].filter(Boolean).join(' · ');row(detail||'RETI','',pesos.format(num(r.importe)),'');});}ensure(13);"
if old not in s:
    raise SystemExit('PDF RETI row not found')
s = s.replace(old, new, 1)
p.write_text(s)
