/**
 * Generador de informe_flota.xlsx + informe_flota.md
 * Fuente: archivo JSON exportado desde la app (botón "Exportar datos" en ajustes)
 *
 * Uso: node extract_report.mjs [ruta_archivo.json]
 * Si no se especifica archivo, busca GlobalSolutions_datos_*.json en el directorio actual.
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { glob } from 'fs';

// ── BUSCAR ARCHIVO JSON ──────────────────────────────────────────────────────
let jsonPath = process.argv[2];

if (!jsonPath) {
  // Buscar el más reciente en el directorio
  const files = fs.readdirSync('.')
    .filter(f => f.endsWith('.json') && (f.includes('GlobalSolutions') || f.includes('datos')))
    .sort()
    .reverse();
  if (files.length) { jsonPath = files[0]; console.log(`Usando archivo: ${jsonPath}`); }
}

if (!jsonPath || !fs.existsSync(jsonPath)) {
  console.error('\n❌ No se encontró archivo de datos.\n');
  console.error('Para generarlo:');
  console.error('  1. Abre la app en el navegador');
  console.error('  2. Ve a Ajustes (⚙️) → "Exportar datos"');
  console.error('  3. Copia el archivo descargado a este directorio');
  console.error('  4. Ejecuta: node extract_report.mjs <nombre_archivo.json>\n');
  process.exit(1);
}

// ── CARGAR DATOS ─────────────────────────────────────────────────────────────
let appData;
try {
  appData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`✅ Datos cargados desde: ${jsonPath}`);
} catch (e) {
  console.error('❌ Error al leer el archivo JSON:', e.message);
  process.exit(1);
}

function fmtNum(n) {
  if (n == null || n === '' || isNaN(Number(n))) return 0;
  return Number(n);
}

// ── 1. TABLA servicios ───────────────────────────────────────────────────────
const servicios = (appData.servicios || []).map(s => ({
  id:                 s.id || '',
  fecha:              s.fecha || '',
  patente:            s.patente || '',
  cliente:            s.cliente || '',
  precio:             fmtNum(s.precio),
  petroleo:           fmtNum(s.petroleo),
  peajes:             fmtNum(s.peajes),
  viaticos:           fmtNum(s.viaticos),
  comisionConductor:  fmtNum(s.comisionConductor),
  cfProrrateado:      fmtNum(s.cfProrrateado),
  adicional:          fmtNum(s.adicional),
  litros:             fmtNum(s.litros),
  km:                 fmtNum(s.km),
  cerrado:            s.cerrado ? 'Sí' : 'No',
  mes:                s.mes || '',
  anio:               s.anio || '',
  conductor:          s.conductor || '',
  tag:                s.tag || '',
}));
console.log(`  → Servicios: ${servicios.length} registros`);

// ── 2. TABLA disponibilidad ──────────────────────────────────────────────────
// En la app la disponibilidad está en appData.disponibilidad como:
// { "YYYY-MM-DD": { "WR9192": { estado: "En servicio", ... }, ... }, ... }
const disponibilidad = [];
const dispRaw = appData.disponibilidad || {};
Object.entries(dispRaw).forEach(([fecha, equipos]) => {
  if (typeof equipos !== 'object') return;
  Object.entries(equipos).forEach(([patente, reg]) => {
    disponibilidad.push({
      fecha,
      patente,
      estado: (reg && reg.estado) ? reg.estado : (typeof reg === 'string' ? reg : 'Disponible'),
      observacion: (reg && reg.obs) ? reg.obs : '',
    });
  });
});
console.log(`  → Disponibilidad: ${disponibilidad.length} registros`);

// ── 3. RENDIMIENTO COMBUSTIBLE ───────────────────────────────────────────────
const rendimientoComb = (appData.rendimientoComb || []).map(r => ({
  id:          r.id || '',
  fecha:       r.fecha || '',
  patente:     r.patente || '',
  conductor:   r.conductor || '',
  litros:      fmtNum(r.litros),
  monto:       fmtNum(r.monto),
  km:          fmtNum(r.km),
  rendimiento: fmtNum(r.rendimiento),
  estado:      r.estado || '',
  mes:         r.mes || '',
  anio:        r.anio || '',
}));
console.log(`  → Rendimiento Combustible: ${rendimientoComb.length} registros`);

// ── 4. COPEC / COMBUSTIBLE IMPORTADO ────────────────────────────────────────
const combustible = (appData.combustible || []).map(c => ({
  n:          c.n || '',
  fecha:      c.fecha || '',
  patente:    c.patente || '',
  tipo:       c.tipo || '',
  direccion:  c.direccion || '',
  litros:     fmtNum(c.litros),
  monto:      fmtNum(c.monto),
  precioLt:   fmtNum(c.precioLt),
  mes:        c.mes || '',
  anio:       c.anio || '',
}));
console.log(`  → Combustible (Copec): ${combustible.length} registros`);

// ── 5. KM FLOTA ──────────────────────────────────────────────────────────────
const kmFlota = (appData.kmFlota || []).map(k => ({
  id:      k.id || '',
  patente: k.patente || '',
  km:      fmtNum(k.km),
  label:   k.label || '',
  mes:     k.mes || '',
  anio:    k.anio || '',
}));
console.log(`  → KM Flota: ${kmFlota.length} registros`);

// ── 6. RESUMEN POR PATENTE ───────────────────────────────────────────────────
const patentes = [...new Set([
  ...servicios.map(s => s.patente),
  ...disponibilidad.map(d => d.patente),
  ...rendimientoComb.map(r => r.patente),
  ...combustible.map(c => c.patente),
].filter(Boolean))].sort();

const resumen = patentes.map(pat => {
  const svcs = servicios.filter(s => s.patente === pat);
  const ingresoBruto   = svcs.reduce((a,s)=>a+s.precio, 0);
  const costoVariable  = svcs.reduce((a,s)=>a+s.petroleo+s.peajes+s.viaticos, 0);
  const margen         = ingresoBruto - costoVariable;
  const totalKm        = svcs.reduce((a,s)=>a+s.km, 0);
  const totalLitros    = svcs.reduce((a,s)=>a+s.litros, 0);
  const svcsCerrados   = svcs.filter(s=>s.cerrado==='Sí').length;

  // Combustible Copec
  const combPat        = combustible.filter(c=>c.patente===pat);
  const litrosCopec    = combPat.reduce((a,c)=>a+c.litros,0);
  const montoCopec     = combPat.reduce((a,c)=>a+c.monto,0);

  // Disponibilidad
  const dispPat        = disponibilidad.filter(d=>d.patente===pat);
  const diasServicio   = dispPat.filter(d=>d.estado==='En servicio').length;
  const diasDisponible = dispPat.filter(d=>d.estado==='Disponible').length;
  const diasMantencion = dispPat.filter(d=>d.estado==='Mantención').length;

  // Rendimiento: primero desde rendimientoComb, luego calculado
  const rendCerrados = rendimientoComb.filter(r=>r.patente===pat && r.estado==='cerrado' && r.rendimiento>0);
  let rendPromedio;
  if (rendCerrados.length) {
    rendPromedio = (rendCerrados.reduce((a,r)=>a+r.rendimiento,0)/rendCerrados.length).toFixed(2)+' km/L';
  } else if (litrosCopec>0 && totalKm>0) {
    rendPromedio = (totalKm/litrosCopec).toFixed(2)+' km/L*';
  } else {
    rendPromedio = '—';
  }

  return {
    'Patente':                  pat,
    'Servicios Realizados':     svcs.length,
    'Servicios Cerrados':       svcsCerrados,
    'Ingreso Bruto ($)':        ingresoBruto,
    'Costo Variable ($)':       costoVariable,
    'Margen ($)':               margen,
    'Margen %':                 ingresoBruto>0 ? Math.round(margen/ingresoBruto*100)+'%' : '—',
    'KM Total':                 totalKm,
    'Litros (servicios)':       parseFloat(totalLitros.toFixed(1)),
    'Litros Copec ($)':         parseFloat(litrosCopec.toFixed(1)),
    'Monto Combustible ($)':    montoCopec,
    'Días En Servicio':         diasServicio,
    'Días Disponible':          diasDisponible,
    'Días Mantención':          diasMantencion,
    'Rendimiento Prom (km/L)':  rendPromedio,
  };
});

// ── 7. RESUMEN POR MES ───────────────────────────────────────────────────────
const meses = [...new Set(servicios.map(s=>`${s.anio}-${String(s.mes).padStart(2,'0')}`).filter(m=>m&&!m.includes('undefined')))].sort();
const MNOMBRES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const resumenMes = meses.map(m => {
  const [anio, mes] = m.split('-');
  const svcs = servicios.filter(s=>s.anio===anio && String(s.mes).padStart(2,'0')===mes);
  const ingreso  = svcs.reduce((a,s)=>a+s.precio,0);
  const costo    = svcs.reduce((a,s)=>a+s.petroleo+s.peajes+s.viaticos,0);
  const comb     = combustible.filter(c=>c.anio===anio && String(c.mes).padStart(2,'0')===mes);
  const litCopec = comb.reduce((a,c)=>a+c.litros,0);
  const monCopec = comb.reduce((a,c)=>a+c.monto,0);
  return {
    'Mes': `${MNOMBRES[parseInt(mes)]||mes} ${anio}`,
    'Servicios': svcs.length,
    'Ingreso ($)': ingreso,
    'Costo Variable ($)': costo,
    'Margen ($)': ingreso-costo,
    'Margen %': ingreso>0?Math.round((ingreso-costo)/ingreso*100)+'%':'—',
    'Litros Copec': parseFloat(litCopec.toFixed(1)),
    'Monto Combustible ($)': monCopec,
  };
});

// ── GENERAR EXCEL ────────────────────────────────────────────────────────────
console.log('\nGenerando informe_flota.xlsx...');
const wb = XLSX.utils.book_new();

const colW = n => Array(n).fill({wch:16});

// Hoja 1: Servicios
if (servicios.length) {
  const ws = XLSX.utils.json_to_sheet(servicios);
  ws['!cols'] = colW(18);
  XLSX.utils.book_append_sheet(wb, ws, 'Servicios');
}

// Hoja 2: Resumen por Patente
if (resumen.length) {
  const ws = XLSX.utils.json_to_sheet(resumen);
  ws['!cols'] = colW(15);
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen por Patente');
}

// Hoja 3: Resumen por Mes
if (resumenMes.length) {
  const ws = XLSX.utils.json_to_sheet(resumenMes);
  ws['!cols'] = colW(8);
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen por Mes');
}

// Hoja 4: Disponibilidad
if (disponibilidad.length) {
  const ws = XLSX.utils.json_to_sheet(disponibilidad);
  ws['!cols'] = [{wch:14},{wch:10},{wch:18},{wch:30}];
  XLSX.utils.book_append_sheet(wb, ws, 'Disponibilidad');
}

// Hoja 5: Rendimiento Combustible
if (rendimientoComb.length) {
  const ws = XLSX.utils.json_to_sheet(rendimientoComb);
  ws['!cols'] = colW(11);
  XLSX.utils.book_append_sheet(wb, ws, 'Rendimiento Comb');
}

// Hoja 6: Combustible Copec
if (combustible.length) {
  const ws = XLSX.utils.json_to_sheet(combustible);
  ws['!cols'] = colW(10);
  XLSX.utils.book_append_sheet(wb, ws, 'Combustible Copec');
}

// Hoja 7: KM Flota
if (kmFlota.length) {
  const ws = XLSX.utils.json_to_sheet(kmFlota);
  ws['!cols'] = colW(6);
  XLSX.utils.book_append_sheet(wb, ws, 'KM Flota');
}

const sheetCount = wb.SheetNames.length;
if (!sheetCount) {
  console.error('❌ No hay datos para exportar. El archivo JSON puede estar vacío.');
  process.exit(1);
}

const outXlsx = '/home/user/global-solutions/informe_flota.xlsx';
XLSX.writeFile(wb, outXlsx);
console.log(`✅ Excel generado: ${outXlsx}  (${sheetCount} hojas)`);

// ── GENERAR MARKDOWN ─────────────────────────────────────────────────────────
const hoy = new Date().toLocaleDateString('es-CL');
const cl = n => Number(n).toLocaleString('es-CL');

let md = `# Informe Flota — Global Solutions\n**Generado:** ${hoy}  |  **Fuente:** ${path.basename(jsonPath)}\n\n`;

// Resumen ejecutivo
const totIng  = servicios.reduce((a,s)=>a+s.precio,0);
const totCost = servicios.reduce((a,s)=>a+s.petroleo+s.peajes+s.viaticos,0);
const totLit  = combustible.reduce((a,c)=>a+c.litros,0);
const totMont = combustible.reduce((a,c)=>a+c.monto,0);

md += `## Resumen Ejecutivo\n\n`;
md += `| Métrica | Valor |\n|---|---|\n`;
md += `| Total servicios | ${servicios.length} |\n`;
md += `| Servicios cerrados | ${servicios.filter(s=>s.cerrado==='Sí').length} |\n`;
md += `| Ingreso bruto total | $${cl(totIng)} |\n`;
md += `| Costo variable total | $${cl(totCost)} |\n`;
md += `| Margen bruto total | $${cl(totIng-totCost)} |\n`;
md += `| Margen % | ${totIng>0?Math.round((totIng-totCost)/totIng*100)+'%':'—'} |\n`;
md += `| Registros disponibilidad | ${disponibilidad.length} |\n`;
md += `| Litros Copec total | ${cl(Math.round(totLit))} L |\n`;
md += `| Monto combustible total | $${cl(totMont)} |\n`;
md += `| Registros rendimiento | ${rendimientoComb.length} |\n\n`;

// Resumen por mes
if (resumenMes.length) {
  md += `## Resumen por Mes\n\n`;
  md += `| Mes | Servicios | Ingreso $ | Costo Var $ | Margen $ | Margen% | Litros Copec |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  resumenMes.forEach(r => {
    md += `| ${r['Mes']} | ${r['Servicios']} | ${cl(r['Ingreso ($)'])} | ${cl(r['Costo Variable ($)'])} | ${cl(r['Margen ($)'])} | ${r['Margen %']} | ${r['Litros Copec']} |\n`;
  });
  md += '\n';
}

// Resumen por patente
md += `## Resumen por Patente\n\n`;
md += `| Patente | Servicios | Ingreso $ | Costo Var $ | Margen $ | Margen% | KM | Días Serv | Días Mant | Rend km/L |\n`;
md += `|---|---|---|---|---|---|---|---|---|---|\n`;
resumen.forEach(r => {
  md += `| ${r['Patente']} | ${r['Servicios Realizados']} | ${cl(r['Ingreso Bruto ($)'])} | ${cl(r['Costo Variable ($)'])} | ${cl(r['Margen ($)'])} | ${r['Margen %']} | ${cl(r['KM Total'])} | ${r['Días En Servicio']} | ${r['Días Mantención']} | ${r['Rendimiento Prom (km/L)']} |\n`;
});

md += `\n---\n*Datos exportados desde la app Global Solutions el ${hoy}*\n`;
md += `*\\* Rendimiento calculado con km de servicios ÷ litros Copec cuando no hay registros de combustible individuales*\n`;

const outMd = '/home/user/global-solutions/informe_flota.md';
fs.writeFileSync(outMd, md, 'utf8');
console.log(`✅ Markdown generado: ${outMd}`);

// Imprimir resumen en consola
console.log('\n' + '═'.repeat(65));
console.log(md);
