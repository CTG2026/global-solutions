#!/usr/bin/env node
/**
 * ingreso-guias.js — Ingreso de servicios desde fotos de guías de despacho
 *
 * Uso:    node scripts/ingreso-guias.js foto1.jpg [foto2.jpg ...]
 * Require: ANTHROPIC_API_KEY en el entorno (disponible en Claude Code automáticamente)
 *
 * Flujo:
 *  1. Lee las fotos y extrae datos con Claude Vision (claude-opus-4-7)
 *  2. Muestra tabla resumen con campos faltantes marcados en rojo
 *  3. Permite corregir/completar datos interactivamente
 *  4. Sube las fotos a Supabase Storage bucket "guias"
 *  5. Inserta el servicio en la tabla servicios de Supabase
 */

import Anthropic        from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import fs               from 'fs';
import path             from 'path';
import { createInterface } from 'readline/promises';

// ── Credenciales ──────────────────────────────────────────────────────────────
const SUPA_URL = 'https://qjbelwogpacknivdaows.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqYmVsd29ncGFja25pdmRhb3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNDg3MTUsImV4cCI6MjA4ODcyNDcxNX0.PaN5ol4v5TPDBLWeB4MSTu3SM-ezUjTRFk3jRm3Kv-M';

const MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

// ── Terminal helpers ──────────────────────────────────────────────────────────
const R = '\x1b[0m';
const bold  = s => `\x1b[1m${s}${R}`;
const dim   = s => `\x1b[2m${s}${R}`;
const red   = s => `\x1b[31m${s}${R}`;
const green = s => `\x1b[32m${s}${R}`;
const yellow= s => `\x1b[33m${s}${R}`;
const cyan  = s => `\x1b[36m${s}${R}`;
const blue  = s => `\x1b[34m${s}${R}`;
const hr    = (n=62) => '─'.repeat(n);
const pad   = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

// ── Campos del formulario ─────────────────────────────────────────────────────
const CAMPOS = [
  { key: 'num_guia',   label: 'N° Guía',              required: true  },
  { key: 'fecha',      label: 'Fecha (DD-MM-YYYY)',    required: true  },
  { key: 'patente',    label: 'Patente',               required: true  },
  { key: 'conductor',  label: 'Conductor',             required: true  },
  { key: 'cliente',    label: 'Cliente',               required: true  },
  { key: 'origen',     label: 'Origen',                required: false },
  { key: 'destino',    label: 'Destino',               required: false },
  { key: 'kg',         label: 'KG',                    required: false },
  { key: 'obs',        label: 'Observaciones',         required: false },
];

// ── Vision: extraer datos de imágenes ────────────────────────────────────────
async function extractFromImages(imagePaths) {
  const anthropic = new Anthropic();

  process.stdout.write(cyan('\n🔍 Analizando con Claude Vision'));

  const imageBlocks = imagePaths.map(p => {
    const ext = path.extname(p).slice(1).toLowerCase();
    const mt  = ext === 'png' ? 'image/png'
              : ext === 'webp' ? 'image/webp'
              : ext === 'gif'  ? 'image/gif'
              : 'image/jpeg';
    const data = fs.readFileSync(p).toString('base64');
    return { type: 'image', source: { type: 'base64', media_type: mt, data } };
  });

  const n = imagePaths.length;
  const prompt = `Analiza ${n === 1 ? 'esta guía de despacho' : `estas ${n} imágenes de guías de despacho`} y extrae los datos de CADA guía encontrada.

Devuelve un array JSON. Cada objeto representa UNA guía con estos campos:
- num_guia   : número de guía o folio (string, ej: "12345")
- fecha      : fecha en formato DD-MM-YYYY (ej: "15-04-2026")
- patente    : patente del vehículo, solo letras y números sin guión (ej: "WR9192")
- conductor  : nombre completo del conductor o chofer
- cliente    : nombre del cliente, empresa destinataria o receptor
- origen     : ciudad o dirección de origen / despacho
- destino    : ciudad o dirección de destino / entrega
- kg         : kilogramos como número entero (ej: 15000), o null si no aparece
- obs        : observaciones o datos adicionales relevantes (string o "")

Reglas:
- Si un campo no es legible o no aparece en la guía, usa null
- La patente puede aparecer como "WR-9192" → normalizar a "WR9192"
- La fecha puede estar en cualquier formato → convertir siempre a DD-MM-YYYY
- Responde ÚNICAMENTE con el array JSON, sin texto ni markdown

Ejemplo de respuesta válida:
[{"num_guia":"54321","fecha":"20-04-2026","patente":"GKFD84","conductor":"Felipe Vidal","cliente":"Comercial XYZ","origen":"Santiago","destino":"Rancagua","kg":8500,"obs":""}]`;

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [...imageBlocks, { type: 'text', text: prompt }],
    }],
  });

  console.log(green(' ✓'));

  const raw = resp.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.error(red('\n⚠ Respuesta inesperada de Vision:'), raw.slice(0, 200));
    throw new Error('No se pudo parsear la respuesta de Claude Vision');
  }
}

// ── Mostrar tabla resumen ─────────────────────────────────────────────────────
function mostrarTabla(guias) {
  console.log('\n' + bold('📋 DATOS EXTRAÍDOS') + '\n' + hr());
  guias.forEach((g, i) => {
    console.log(bold(cyan(`\n  Guía ${i + 1}${g.num_guia ? ' — N°' + g.num_guia : ''}`)));
    CAMPOS.forEach(({ key, label, required }) => {
      const val     = g[key];
      const missing = val === null || val === undefined || val === '';
      const mark    = missing ? (required ? red('⚠ FALTA') : dim('—')) : green(String(val));
      console.log(`    ${dim(pad(label + ':', 22))} ${mark}`);
    });
  });

  const faltantes = guias.reduce((a, g) =>
    a + CAMPOS.filter(c => c.required && (g[c.key] === null || g[c.key] === undefined || g[c.key] === '')).length, 0);

  console.log('\n' + hr());
  if (faltantes > 0)
    console.log(yellow(`  ⚠  ${faltantes} campo(s) requerido(s) sin valor`));
  else
    console.log(green('  ✓  Todos los campos requeridos están completos'));
}

// ── Corrección interactiva ────────────────────────────────────────────────────
async function corregirDatos(guias, rl) {
  for (let i = 0; i < guias.length; i++) {
    const g = guias[i];
    const faltantes = CAMPOS.filter(c => c.required &&
      (g[c.key] === null || g[c.key] === undefined || g[c.key] === ''));

    if (faltantes.length > 0) {
      console.log(yellow(`\n  ✏  Completar campos requeridos — Guía ${i + 1}:`));
      for (const campo of faltantes) {
        const val = await rl.question(`    ${pad(campo.label + ':', 24)} `);
        if (val.trim()) g[campo.key] = val.trim();
      }
    }

    const corr = await rl.question(dim(`\n  ¿Corregir algún campo de la Guía ${i + 1}? (s/N): `));
    if (corr.trim().toLowerCase() === 's') {
      const nombres = CAMPOS.map(c => c.key).join(', ');
      console.log(dim(`    Campos disponibles: ${nombres}`));
      while (true) {
        const campo = await rl.question('    Campo (o Enter para continuar): ');
        if (!campo.trim()) break;
        const def = CAMPOS.find(c => c.key === campo.trim());
        if (!def) { console.log(red('    Campo no reconocido')); continue; }
        const val = await rl.question(`    Nuevo valor para "${def.label}": `);
        if (val.trim()) g[def.key] = val.trim();
      }
    }
  }
  return guias;
}

// ── Subir foto a Supabase Storage ─────────────────────────────────────────────
async function subirFoto(supa, imgPath, numGuia) {
  const ext      = path.extname(imgPath).toLowerCase();
  const nombre   = `${Date.now()}_${numGuia || 'sin_num'}${ext}`;
  const buffer   = fs.readFileSync(imgPath);
  const ct       = ext === '.png' ? 'image/png' : 'image/jpeg';

  const { error } = await supa.storage.from('guias').upload(nombre, buffer, { contentType: ct, upsert: false });
  if (error) throw new Error(`Storage: ${error.message}`);

  const { data } = supa.storage.from('guias').getPublicUrl(nombre);
  return data.publicUrl;
}

// ── Generar ID estilo app ─────────────────────────────────────────────────────
function generarId(fecha) {
  try {
    const [d, m, y] = fecha.split('-').map(Number);
    const seq  = String(Math.floor(Math.random() * 89) + 10);
    const anio = String(y).slice(2);
    return `${seq}${anio}${MESES[m - 1]}`;
  } catch { return `GS${Date.now()}`; }
}

// ── Convertir fecha DD-MM-YYYY → YYYY-MM-DD para Supabase ────────────────────
function fechaISO(dmy) {
  if (!dmy) return null;
  const p = dmy.split('-');
  if (p.length === 3 && p[0].length === 2) return `${p[2]}-${p[1]}-${p[0]}`;
  return dmy;
}

// ── Insertar servicio en Supabase ─────────────────────────────────────────────
async function insertarServicio(supa, guia, imageUrl) {
  const fecha  = guia.fecha || '';
  const [, mes = '', anio = ''] = fecha.split('-');
  const id     = generarId(fecha);

  const row = {
    id,
    fecha:          fechaISO(fecha),
    anio,
    mes,
    patente:        (guia.patente || '').toUpperCase(),
    conductor:      guia.conductor || '',
    cliente:        guia.cliente || '',
    origen:         guia.origen  || '',
    tipo_equipo:    '',
    precio:         0,
    km:             0,
    litros:         0,
    monto_comb:     0,
    petroleo:       0,
    peajes:         0,
    adicional:      0,
    viaticos:       0,
    cobro:          'pendiente',
    liquidado:      false,
    costo_total:    0,
    margen:         0,
    rendimiento:    0,
    tag:            '',
    liquidacion_id: '',
    guias: [{
      num:          guia.num_guia || '',
      guia:         guia.num_guia || '',
      destino:      guia.destino  || '',
      origen:       guia.origen   || '',
      fecha_guia:   fecha,
      fecha_descarga: '',
      kg:           guia.kg ? String(guia.kg) : '',
      imagen_url:   imageUrl || '',
    }],
  };

  const { data, error } = await supa.from('servicios').insert(row).select('id');
  if (error) throw new Error(`DB: ${error.message}`);
  return id;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + bold(blue('╔══════════════════════════════════════════╗')));
  console.log(bold(blue('║   INGRESO DE SERVICIOS — FOTOS DE GUÍAS  ║')));
  console.log(bold(blue('╚══════════════════════════════════════════╝')));

  // Validar argumentos
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');

  if (!args.length) {
    console.error(red('\n❌  Indica al menos una foto de guía de despacho.'));
    console.error(dim('    Uso: node scripts/ingreso-guias.js foto1.jpg [foto2.jpg ...]'));
    console.error(dim('         Agrega --dry-run para probar sin subir a Supabase.\n'));
    process.exit(1);
  }

  const imagePaths = args.map(a => path.resolve(a));
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) {
      console.error(red(`\n❌  Archivo no encontrado: ${p}\n`));
      process.exit(1);
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(red('\n❌  ANTHROPIC_API_KEY no configurada en el entorno.\n'));
    process.exit(1);
  }

  if (dryRun) console.log(yellow('\n  [DRY RUN] — No se subirá nada a Supabase\n'));

  const supa = createClient(SUPA_URL, SUPA_KEY);
  const rl   = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Paso 1: Extracción ──────────────────────────────────────────────────
    let guias = await extractFromImages(imagePaths);
    console.log(green(`  ✓ ${guias.length} guía(s) detectada(s) en ${imagePaths.length} imagen(es)`));

    // ── Paso 2: Tabla resumen ───────────────────────────────────────────────
    mostrarTabla(guias);

    // ── Paso 3: Corrección interactiva ──────────────────────────────────────
    guias = await corregirDatos(guias, rl);

    // Mostrar tabla final
    console.log('\n' + bold('📋 DATOS FINALES'));
    mostrarTabla(guias);

    // ── Paso 4: Confirmación ────────────────────────────────────────────────
    const conf = await rl.question(bold('\n¿Confirmar e ingresar a Supabase? (s/N): '));
    if (conf.trim().toLowerCase() !== 's') {
      console.log(yellow('\n  Operación cancelada.\n'));
      return;
    }

    if (dryRun) {
      console.log(yellow('\n  [DRY RUN] Los datos se habrían insertado:'));
      guias.forEach((g, i) => console.log(`  Guía ${i+1}:`, JSON.stringify(g, null, 2)));
      return;
    }

    // ── Pasos 5 & 6: Subir fotos e insertar servicios ──────────────────────
    console.log(cyan('\n⬆  Procesando...\n'));
    const resultados = [];

    for (let i = 0; i < guias.length; i++) {
      const guia    = guias[i];
      const imgPath = imagePaths[Math.min(i, imagePaths.length - 1)];
      const label   = `Guía ${i + 1}${guia.num_guia ? ' (N°' + guia.num_guia + ')' : ''}`;

      // Subir foto
      let imageUrl = '';
      process.stdout.write(`  ${dim(label)} — subiendo foto... `);
      try {
        imageUrl = await subirFoto(supa, imgPath, guia.num_guia);
        console.log(green('✓'));
      } catch (e) {
        console.log(yellow(`⚠ ${e.message} (continuando sin foto)`));
      }

      // Insertar servicio
      process.stdout.write(`  ${dim(label)} — insertando servicio... `);
      try {
        const id = await insertarServicio(supa, guia, imageUrl);
        console.log(green(`✓ ID: ${cyan(id)}`));
        resultados.push({ guia, id, imageUrl, ok: true });
      } catch (e) {
        console.log(red(`✗ ${e.message}`));
        resultados.push({ guia, ok: false, error: e.message });
      }
    }

    // ── Resumen final ───────────────────────────────────────────────────────
    const ok   = resultados.filter(r => r.ok).length;
    const fail = resultados.length - ok;

    console.log('\n' + hr());
    console.log(bold(`\n  Resultado: ${green(ok + ' ingresado(s)')}${fail ? '  ·  ' + red(fail + ' fallido(s)') : ''}`));

    resultados.filter(r => r.ok).forEach(r => {
      const g = r.guia;
      console.log(`  ${green('✓')}  N°${g.num_guia || '—'}  ·  ${g.cliente || '—'}  ·  ${g.fecha || '—'}  →  ID: ${cyan(r.id)}`);
      if (r.imageUrl) console.log(`     ${dim('Foto: ' + r.imageUrl)}`);
    });

    resultados.filter(r => !r.ok).forEach(r => {
      console.log(`  ${red('✗')}  N°${r.guia.num_guia || '—'}: ${r.error}`);
    });
    console.log();

  } finally {
    rl.close();
  }
}

main().catch(e => {
  console.error(red(`\n❌  Error fatal: ${e.message}\n`));
  process.exit(1);
});
