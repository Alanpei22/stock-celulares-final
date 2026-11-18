// ══════════════════════════════════════════════════════════════
//  📷 Cargar un equipo escaneando su etiqueta (desde el celular)
// ══════════════════════════════════════════════════════════════
//  Alan (18/11): "cuando agregue equipos desde el celular, poder escanear el
//  código de barras". Mandó la etiqueta que traen los equipos del proveedor:
//
//      ║║║║║║║║║║║║║║║║║║║║║║║║║║║
//      352472591721837            ← el código de barras es SOLO el IMEI
//      iPhone 13  128GB
//      RED                  AA    ← color y grado
//      76%                  0     ← salud de batería
//
//  Así que hay dos botones en "Agregar equipo":
//   · 📷 al lado del IMEI: escanea el código de barras → el IMEI.
//   · 📸 "Leer la etiqueta": una foto de la etiqueta y la IA (api/ai.js,
//     la misma que lee los tickets de gastos) completa modelo, capacidad,
//     color, batería, grado e IMEI.
//  Nunca pisa lo que ya escribiste: completa solo lo vacío.

// Los colores de las etiquetas vienen en inglés; en la app van en castellano
const ETQ_COLORES = {
  red: 'Rojo', black: 'Negro', midnight: 'Negro', white: 'Blanco', starlight: 'Blanco',
  blue: 'Azul', 'sierra blue': 'Azul', 'pacific blue': 'Azul', green: 'Verde', 'alpine green': 'Verde',
  pink: 'Rosa', purple: 'Violeta', 'deep purple': 'Violeta', yellow: 'Amarillo', gold: 'Dorado',
  silver: 'Plateado', gray: 'Gris', grey: 'Gris', graphite: 'Grafito', 'space gray': 'Gris espacial',
  'space black': 'Negro', 'natural titanium': 'Titanio natural', 'blue titanium': 'Titanio azul',
  'white titanium': 'Titanio blanco', 'black titanium': 'Titanio negro', 'desert titanium': 'Titanio desierto',
  coral: 'Coral', orange: 'Naranja', 'cosmic orange': 'Naranja', teal: 'Verde azulado', ultramarine: 'Azul',
};

function etqColor(c) {
  const k = String(c || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!k) return '';
  if (ETQ_COLORES[k]) return ETQ_COLORES[k];
  // "(PRODUCT)RED" y parecidos
  const suelto = Object.keys(ETQ_COLORES).find(x => !x.includes(' ') && new RegExp('\\b' + x + '\\b').test(k));
  if (suelto) return ETQ_COLORES[suelto];
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// "128 gb", "128G", "1 TB" → como las opciones del formulario ("128GB", "1TB")
function etqCapacidad(s) {
  const m = String(s || '').toUpperCase().replace(/\s+/g, '').match(/^(\d+)(GB|G|TB|T)?$/);
  if (!m) return '';
  const n = parseInt(m[1], 10);
  if (/^T/.test(m[2] || '') || n === 1 && !m[2]) return n + 'TB';
  return n + 'GB';
}

// Lo leído → los valores del formulario. iPhone va como marca "iPhone"
// (así está en la lista de marcas de la app).
function etqAFormulario(e) {
  if (!e) return {};
  let marca = String(e.marca || '').trim();
  const modelo = String(e.modelo || '').trim();
  if (/apple/i.test(marca) || (!marca && /iphone/i.test(modelo))) marca = 'iPhone';
  const imei = String(e.imei || '').replace(/\D/g, '');
  const bat = parseInt(e.bateria, 10);
  const grado = String(e.grado || '').trim().toUpperCase().slice(0, 4);
  return {
    marca, modelo,
    almacenamiento: etqCapacidad(e.almacenamiento),
    color: etqColor(e.color),
    bateria: bat >= 1 && bat <= 100 ? bat : null,
    imei: imei.length === 15 ? imei : '',
    grado,
    // Con grado o batería gastada, es un usado (no se pisa si ya elegiste)
    estado: grado || (bat >= 1 && bat < 100) ? 'Usado' : '',
  };
}

// Completa el formulario de "Agregar equipo" sin pisar lo escrito.
// Devuelve qué completó, para decírselo a la persona.
function etqCompletar(f) {
  const puestos = [];
  const set = (id, v, nombre) => {
    const el = document.getElementById(id);
    if (!el || v === '' || v === null || v === undefined) return;
    if (String(el.value || '').trim()) return;
    // En un <select>, solo si existe esa opción
    if (el.tagName === 'SELECT' && el.options && !Array.from(el.options).some(o => o.value === String(v))) return;
    el.value = String(v);
    puestos.push(nombre);
  };
  set('fi-marca', f.marca, 'marca');
  set('fi-modelo', f.modelo, 'modelo');
  set('fi-storage', f.almacenamiento, 'capacidad');
  set('fi-estado', f.estado, 'estado');
  set('fi-color', f.color, 'color');
  set('fi-imei', f.imei, 'IMEI');
  if (f.bateria) {
    if (typeof _updateBateriaVisibility === 'function') _updateBateriaVisibility(f.marca || document.getElementById('fi-marca')?.value || '');
    const w = document.getElementById('fi-bateria-wrap'); if (w) w.style.display = '';
    set('fi-bateria', f.bateria, 'batería');
  }
  // El grado (AA, A, B…) va a las notas, si todavía no está
  if (f.grado) {
    const n = document.getElementById('fi-notas');
    if (n && !/grado/i.test(n.value)) { n.value = (n.value ? n.value.trim() + ' · ' : '') + 'Grado ' + f.grado; puestos.push('grado'); }
  }
  return puestos;
}

// ¿Ya hay uno con ese IMEI en el stock? (cargarlo dos veces pasa seguido
// cuando llega una tanda)
function etqImeiRepetido(imei, stock) {
  const k = String(imei || '').replace(/\D/g, '');
  if (k.length !== 15) return null;
  return (Array.isArray(stock) ? stock : []).find(p => p && String(p.imei || '').replace(/\D/g, '') === k) || null;
}

function _etqAvisarRepetido(imei) {
  const p = etqImeiRepetido(imei, typeof STOCK !== 'undefined' ? STOCK : []);
  if (p) toast(`⚠️ Ese IMEI ya está cargado: ${[p.marca, p.modelo, p.almacenamiento].filter(Boolean).join(' ')}${p.vendido ? ' (vendido)' : ''}`, 'error');
}

// ── 📷 El código de barras → IMEI ───────────────────────────
async function etqEscanearImei() {
  if (typeof abrirEscaner !== 'function') { toast('El lector no está disponible acá', 'error'); return; }
  await abrirEscaner(cod => {
    const d = String(cod || '').replace(/\D/g, '');
    if (d.length !== 15) { toast(`Eso no parece un IMEI (leí ${cod}). Probá de nuevo o escribilo.`, 'error'); return; }
    const el = document.getElementById('fi-imei');
    if (el) el.value = d;
    toast('📷 IMEI cargado', 'success');
    _etqAvisarRepetido(d);
  }, { titulo: 'Escaneá el código de barras de la etiqueta (IMEI)' });
}

// ── 📸 Foto de la etiqueta → todos los datos ────────────────
function etqLeerEtiqueta() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';   // en el celu abre la cámara de atrás
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) _etqProcesarFoto(f); };
  inp.click();
}

async function _etqProcesarFoto(file) {
  const btn = document.getElementById('etq-leer-btn');
  const txt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Leyendo la etiqueta…'; }
  try {
    const dataUrl = await _etqAchicar(file, 1400);
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      body: JSON.stringify({ action: 'leerEtiquetaEquipo', data: { imageBase64: dataUrl.split(',')[1], imageMediaType: 'image/jpeg' } }),
    });
    const j = res.ok ? await res.json() : null;
    if (!j || !j.etiqueta) { toast('No pude leer la etiqueta: sacale otra foto más de cerca, con luz', 'error'); return; }
    const puestos = etqCompletar(etqAFormulario(j.etiqueta));
    if (!puestos.length) toast('Leí la etiqueta, pero esos datos ya estaban completos', 'info');
    else toast(`📸 Completé: ${puestos.join(', ')}. Revisalo antes de guardar.`, 'success');
    const imei = document.getElementById('fi-imei')?.value;
    if (imei) _etqAvisarRepetido(imei);
  } catch (e) {
    console.warn('[etiqueta] no se pudo leer:', e);
    toast('No pude leer la etiqueta (¿hay internet?)', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txt; }
  }
}

// La foto del celu pesa varios MB: se achica antes de mandarla (sube más
// rápido y la IA la lee igual)
function _etqAchicar(file, max) {
  return new Promise((ok, mal) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('foto')); };
    img.src = url;
  });
}
