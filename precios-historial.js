// ══════════════════════════════════════════════════════════════
//  📊 PRECIOS SACADOS DEL HISTORIAL
// ══════════════════════════════════════════════════════════════
//  La lista de precios se cargaba a mano. Pero los precios de verdad ya están
//  en las reparaciones hechas: cada orden dice qué arreglo fue y cuánto se
//  cobró. Esto los junta y propone la lista.
//
//  Tres cosas que no son obvias y definen el resultado:
//
//   · SE AGRUPA POR ARREGLO, NO POR ORDEN. Una reparación con pantalla y
//     batería son dos renglones con su propio precio (`arreglos[]`). Usar el
//     total de la orden mezclaría los dos en un precio que no existe.
//
//   · EL TEXTO ES LIBRE. "Pantalla", "modulo", "Módulo + Templado" y "display"
//     son lo mismo. Se normaliza contra las categorías que ya usa la lista de
//     precios (PRECIO_TIPOS), así lo que sale entra derecho.
//
//   · POR DEFECTO PROPONE EL ÚLTIMO PRECIO, no el promedio. Con la inflación
//     de acá, el promedio de seis meses propone precios de hace tres. El
//     promedio y la mediana están para mirar, no para cobrar.
//
//  Lee el historial UNA vez, cuando se lo pedís (cupo de Firebase): no hay
//  ningún listener nuevo.
'use strict';

const PH_MESES_DEF = 6;

// Texto libre del arreglo → una de las categorías de la lista de precios.
// El orden importa: "ficha de carga" tiene que caer en Pin de carga antes de
// que "carga" lo mande a otro lado.
const PH_REGLAS = [
  [/placa|bga|reball|corto|mojad|humedad|sulfat/, 'Placa'],
  [/pantalla|modulo|display|lcd|oled|glass|templad|vidrio/, 'Pantalla / Módulo'],
  [/bateri|pila/, 'Batería'],
  [/pin|ficha|puerto|conector|carga/, 'Pin de carga'],
  [/flex/, 'Flex'],
  [/camara|lente/, 'Cámara'],
  [/parlante|altavoz|auricular|audio|sonido|buzzer/, 'Parlante / Auricular'],
  [/microfono|\bmic\b/, 'Micrófono'],
  [/tapa|carcasa|chasis|marco|back/, 'Tapa / Carcasa'],
  [/boton|power|volumen|home|encendido/, 'Botones'],
  [/software|sistema|liberac|desbloque|frp|icloud|formate|actualiz|flasheo/, 'Software / Liberación'],
];

function phNorm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function phTipoDe(texto) {
  const t = phNorm(texto);
  if (!t) return 'Otro';
  for (const [re, tipo] of PH_REGLAS) if (re.test(t)) return tipo;
  return 'Otro';
}

// "Samsung A54". Sin el texto no se puede agrupar nada.
function phEquipoDe(r) {
  return [String(r.marca || '').trim(), String(r.modelo || '').trim()]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// Una reparación → un renglón por arreglo, con SU precio.
// Las viejas no tienen `arreglos`: ahí el arreglo es uno solo y vale el monto.
function phFilas(reps) {
  const out = [];
  (reps || []).forEach(r => {
    const equipo = phEquipoDe(r);
    const fecha = String(r.fechaIngreso || r.fecha || '').slice(0, 10);
    const lista = (Array.isArray(r.arreglos) && r.arreglos.length)
      ? r.arreglos.map(a => ({ texto: a.texto, precio: Number(a.precio) || 0 }))
      : (r.arreglo ? [{ texto: r.arreglo, precio: Number(r.monto) || 0 }] : []);
    lista.forEach(a => {
      const precio = Number(a.precio) || 0;
      // Sin precio no sirve para una lista de precios; sin equipo tampoco.
      if (!(precio > 0) || !equipo || !String(a.texto || '').trim()) return;
      out.push({ tipo: phTipoDe(a.texto), equipo, texto: String(a.texto).trim(), precio, fecha });
    });
  });
  return out;
}

function phMediana(nums) {
  const a = (nums || []).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

// El precio que más se repite. Empate: el más alto (es el más nuevo en la
// práctica, los precios suben).
function phModa(nums) {
  const c = {};
  (nums || []).forEach(n => { c[n] = (c[n] || 0) + 1; });
  let mejor = 0, veces = 0;
  Object.keys(c).forEach(k => {
    const n = Number(k);
    if (c[k] > veces || (c[k] === veces && n > mejor)) { mejor = n; veces = c[k]; }
  });
  return mejor;
}

// Agrupa por arreglo + equipo. `criterio`: 'ultimo' | 'mediana' | 'moda'.
function phAgrupar(filas, criterio) {
  const g = {};
  (filas || []).forEach(f => {
    const k = f.tipo + '|' + f.equipo.toLowerCase();
    const x = g[k] = g[k] || { tipo: f.tipo, equipo: f.equipo, precios: [], veces: 0,
                               ultimo: 0, ultimaFecha: '', min: Infinity, max: 0 };
    x.precios.push(f.precio);
    x.veces++;
    x.min = Math.min(x.min, f.precio);
    x.max = Math.max(x.max, f.precio);
    if (f.fecha >= x.ultimaFecha) { x.ultimaFecha = f.fecha; x.ultimo = f.precio; }
  });
  return Object.values(g).map(x => {
    const mediana = phMediana(x.precios);
    const moda = phModa(x.precios);
    const sug = criterio === 'mediana' ? mediana : criterio === 'moda' ? moda : x.ultimo;
    return { ...x, mediana, moda, sugerido: sug, min: x.min === Infinity ? 0 : x.min };
  }).sort((a, b) => b.veces - a.veces || a.equipo.localeCompare(b.equipo, 'es'));
}

// ── El historial ──────────────────────────────────────────
// Una sola lectura, cuando se la pide. Por defecto los últimos 6 meses: un
// precio de hace dos años no sirve para cobrar hoy, y además se pagan las
// lecturas de todas esas órdenes.
function phDesde(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - (Number(meses) || PH_MESES_DEF));
  return d.toISOString().slice(0, 10);
}

async function phLeerHistorial(meses) {
  if (typeof db === 'undefined' || !db) return [];
  let q = db.collection('repairs');
  if (Number(meses) > 0) q = q.where('fechaIngreso', '>=', phDesde(meses));
  const snap = await q.get();
  if (typeof cupoContar === 'function') cupoContar('repairs', snap.size);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ══════════════════════════════════════════════════════════
//  EL CUADRO
// ══════════════════════════════════════════════════════════
let PH_GRUPOS = [];
let PH_SEL = {};          // clave → true
let PH_EDIT = {};         // clave → precio tocado a mano
let PH_LEIDAS = 0;
let PH_CRIT = 'ultimo';
let PH_MESES = PH_MESES_DEF;

const phClave = g => g.tipo + '|' + g.equipo.toLowerCase();
const _phEsc = s => (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s);
const _phPlata = n => (typeof fmt === 'function') ? fmt(n) : '$' + Math.round(Number(n) || 0);

function phAbrir() {
  const modal = document.getElementById('ph-modal');
  if (!modal) return;
  document.getElementById('ph-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (!PH_GRUPOS.length) phBuscar();
  else phPintar();
}

function phCerrar() {
  document.getElementById('ph-overlay')?.classList.add('hidden');
  document.getElementById('ph-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

async function phBuscar() {
  const cont = document.getElementById('ph-lista');
  PH_MESES = Number(document.getElementById('ph-meses')?.value ?? PH_MESES_DEF);
  PH_CRIT = document.getElementById('ph-criterio')?.value || 'ultimo';
  if (cont) cont.innerHTML = '<p class="lwa-vacio">Leyendo el historial…</p>';
  try {
    const reps = await phLeerHistorial(PH_MESES);
    PH_LEIDAS = reps.length;
    PH_GRUPOS = phAgrupar(phFilas(reps), PH_CRIT);
    // Arrancan tildados los que se repitieron: un arreglo que hiciste una vez
    // no es un precio de lista, es una changa.
    PH_SEL = {}; PH_EDIT = {};
    PH_GRUPOS.forEach(g => { if (g.veces >= 2) PH_SEL[phClave(g)] = true; });
    phPintar();
  } catch (e) {
    console.error('[precios historial]', e);
    if (cont) cont.innerHTML = '<p class="lwa-vacio">No se pudo leer el historial.</p>';
  }
}

// Vuelve a calcular el sugerido sin leer de nuevo: el criterio cambia la
// cuenta, no los datos.
function phCriterio() {
  PH_CRIT = document.getElementById('ph-criterio')?.value || 'ultimo';
  PH_GRUPOS = PH_GRUPOS.map(g => ({ ...g,
    sugerido: PH_CRIT === 'mediana' ? g.mediana : PH_CRIT === 'moda' ? g.moda : g.ultimo }));
  PH_EDIT = {};
  phPintar();
}

function phTocar(k) { PH_SEL[k] = !PH_SEL[k]; phPintar(); }
function phTodos(v) { PH_GRUPOS.forEach(g => { PH_SEL[phClave(g)] = v; }); phPintar(); }
function phPrecio(k, v) {
  const n = Math.max(0, Math.round(Number(String(v).replace(/[^\d]/g, '')) || 0));
  PH_EDIT[k] = n;
  const btn = document.getElementById('ph-guardar');
  if (btn) btn.disabled = !phElegidos().length;
}

function phValor(g) {
  const k = phClave(g);
  return PH_EDIT[k] != null ? PH_EDIT[k] : g.sugerido;
}

function phElegidos() {
  return PH_GRUPOS.filter(g => PH_SEL[phClave(g)] && phValor(g) > 0);
}

// ¿Ya está en la lista de precios? Para avisar que se va a pisar.
function phYaEsta(g) {
  const lista = (typeof PRECIOS !== 'undefined' && Array.isArray(PRECIOS)) ? PRECIOS : [];
  return lista.find(p => String(p.tipo) === g.tipo
    && phNorm(p.equipo) === phNorm(g.equipo)) || null;
}

function phPintar() {
  const cont = document.getElementById('ph-lista');
  const nota = document.getElementById('ph-nota');
  if (nota) {
    nota.textContent = PH_LEIDAS
      ? `${PH_LEIDAS} reparaciones leídas · ${PH_GRUPOS.length} precios distintos`
      : 'Todavía no se leyó el historial.';
  }
  if (!cont) return;
  if (!PH_GRUPOS.length) {
    cont.innerHTML = '<p class="lwa-vacio">No hay reparaciones con precio en ese período.</p>';
    return;
  }
  cont.innerHTML = PH_GRUPOS.map(g => {
    const k = phClave(g);
    const on = !!PH_SEL[k];
    const ya = phYaEsta(g);
    const rango = g.min !== g.max ? `de ${_phPlata(g.min)} a ${_phPlata(g.max)}` : 'siempre igual';
    return `<div class="lwa-item ph-item${on ? ' lwa-item--on' : ''}" onclick="phTocar('${_phEsc(k)}')">
      <input type="checkbox" ${on ? 'checked' : ''} onclick="event.stopPropagation();phTocar('${_phEsc(k)}')">
      <span class="lwa-item-txt">
        <span class="lwa-item-nom">${_phEsc(g.tipo)} · ${_phEsc(g.equipo)}</span>
        <span class="lwa-item-meta">${g.veces} ${g.veces === 1 ? 'vez' : 'veces'} · ${rango}
          ${ya ? ' · <b class="ph-ya">en la lista: ' + _phEsc(_phPlata(ya.precio)) + '</b>' : ''}</span>
      </span>
      <input type="number" class="fi ph-precio" value="${phValor(g)}" inputmode="numeric"
             onclick="event.stopPropagation()" oninput="phPrecio('${_phEsc(k)}', this.value)">
    </div>`;
  }).join('');
  const btn = document.getElementById('ph-guardar');
  if (btn) {
    const n = phElegidos().length;
    btn.disabled = !n;
    btn.textContent = n ? `💾 Cargar ${n} a la lista` : '💾 Cargar a la lista';
  }
}

// Escribe en precios_reparaciones: actualiza el que ya está (mismo tipo y
// equipo) y agrega los que faltan. En tandas, que es como se escribe mucho.
async function phGuardar(btn) {
  const elegidos = phElegidos();
  if (!elegidos.length) return;
  const txt = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    let nuevos = 0, pisados = 0;
    for (let i = 0; i < elegidos.length; i += 400) {
      const batch = db.batch();
      elegidos.slice(i, i + 400).forEach(g => {
        const data = {
          tipo: g.tipo, equipo: g.equipo, precio: phValor(g),
          nota: `Del historial: ${g.veces} ${g.veces === 1 ? 'vez' : 'veces'}`,
          updatedAt: new Date().toISOString(),
        };
        const ya = phYaEsta(g);
        if (ya) { batch.set(db.collection('precios_reparaciones').doc(ya.id), data, { merge: true }); pisados++; }
        else { batch.set(db.collection('precios_reparaciones').doc(), data); nuevos++; }
      });
      await batch.commit();
    }
    toast(`✅ ${nuevos} nuevos y ${pisados} actualizados`, 'success');
    phCerrar();
  } catch (e) {
    console.error('[precios historial] guardar:', e);
    toast('No se pudo guardar: ' + (e.message || e), 'error');
  } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
}
