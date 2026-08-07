// ══════════════════════════════════════════════════════════
//  placas.js — TechPoint · DIAGNÓSTICO DE PLACA (microsoldadura)
//
//  Un "caso" = una placa que entra al banco. El flujo es siempre el mismo:
//    1) Equipo y síntoma   → qué es y qué le pasa
//    2) Mediciones          → qué medí, qué esperaba, qué me dio
//    3) Pasos               → bitácora de lo que fui haciendo
//    4) Resultado           → causa, solución, plata y tiempo
//
//  Lo que se guarda alimenta la BASE DE CONOCIMIENTO: la próxima vez que
//  entre un "iPhone 11 que no enciende", la app te dice qué encontraste las
//  veces anteriores y con qué valores.
//
//  Firestore:
//    placas/{id}            → el caso completo (sin fotos, para que pese poco)
//    placas/{id}/fotos/{f}  → fotos en subcolección, se leen solo al abrir
// ══════════════════════════════════════════════════════════
'use strict';

let db = null;
let PLACAS = [];
let _placasListener = null;

let _cur      = null;   // caso abierto (objeto en memoria, se guarda con debounce)
let _curId    = null;   // id en Firestore (null = todavía no guardado)
let _step     = 1;      // paso visible del flujo (1..4)
let _dirty    = false;
let _fotos    = [];     // fotos del caso abierto

let _filtro   = { q: '', estado: '', modelo: '', sintoma: '' };

// Cleanup para auth.js (logout)
window._placasCleanup = function () {
  if (_placasListener) { _placasListener(); _placasListener = null; }
  PLACAS = []; _cur = null; _curId = null; _fotos = [];
};

// ══════════════════════════════════════════════════════════
//  CATÁLOGOS
// ══════════════════════════════════════════════════════════

const PL_MODELOS = [
  'iPhone 6', 'iPhone 6 Plus', 'iPhone 6s', 'iPhone 6s Plus', 'iPhone SE (2016)',
  'iPhone 7', 'iPhone 7 Plus', 'iPhone 8', 'iPhone 8 Plus', 'iPhone X',
  'iPhone XR', 'iPhone XS', 'iPhone XS Max', 'iPhone 11', 'iPhone 11 Pro',
  'iPhone 11 Pro Max', 'iPhone SE (2020)', 'iPhone 12 mini', 'iPhone 12',
  'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 13 mini', 'iPhone 13',
  'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone SE (2022)', 'iPhone 14',
  'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 15',
  'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16',
  'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max',
];

const PL_SINTOMAS = [
  { id: 'no-enciende',  ico: '⚫', label: 'No enciende' },
  { id: 'no-carga',     ico: '🔌', label: 'No carga' },
  { id: 'bootloop',     ico: '🔁', label: 'Bootloop / se reinicia' },
  { id: 'sin-imagen',   ico: '🌑', label: 'Sin imagen (backlight)' },
  { id: 'sin-tactil',   ico: '👆', label: 'Sin táctil' },
  { id: 'sin-senal',    ico: '📶', label: 'Sin señal / sin servicio' },
  { id: 'sin-wifi',     ico: '📡', label: 'WiFi / Bluetooth gris' },
  { id: 'consumo',      ico: '🔥', label: 'Consumo alto / se calienta' },
  { id: 'mojado',       ico: '💧', label: 'Mojado / corrosión' },
  { id: 'sin-audio',    ico: '🔇', label: 'Sin audio / micrófono' },
  { id: 'no-faceid',    ico: '🙈', label: 'Face ID no funciona' },
  { id: 'sin-camara',   ico: '📷', label: 'Cámara negra / no abre' },
  { id: 'error-itunes', ico: '💻', label: 'Error en iTunes (4013/9/14)' },
  { id: 'no-bateria',   ico: '🔋', label: 'No reconoce batería' },
  { id: 'otro',         ico: '❓', label: 'Otro' },
];

const PL_ANTECEDENTES = [
  'Sin causa aparente', 'Mojado', 'Golpe / caída', 'Cargador no original',
  'Reparado antes (otro taller)', 'Cambio de pantalla previo',
  'Actualización de iOS', 'Se apagó y no volvió',
];

const PL_ESTADOS = [
  { id: 'diagnostico', ico: '🔬', label: 'En diagnóstico', color: 'work' },
  { id: 'espera',      ico: '⏳', label: 'Esperando repuesto', color: 'wait' },
  { id: 'reparado',    ico: '✅', label: 'Reparado', color: 'ok' },
  { id: 'sin-solucion',ico: '❌', label: 'Sin solución', color: 'bad' },
  { id: 'derivado',    ico: '📦', label: 'Derivado a otro técnico', color: 'wait' },
];

const PL_CAUSAS = [
  'U2 / Tristar (carga)', 'PMIC principal', 'PMIC de pantalla', 'Baseband / PMU baseband',
  'CPU (reball)', 'NAND / memoria', 'Audio IC', 'Backlight IC / filtro / bobina',
  'Touch IC (Meson / Chestnut)', 'Charging IC (Tigris)', 'Face ID (dot projector)',
  'Cámara / driver de cámara', 'WiFi / BT IC', 'Corto en línea de alimentación',
  'Capacitor en corto', 'Bobina / filtro abierto', 'Pista cortada',
  'Corrosión por líquido', 'Conector de batería', 'Conector de pantalla (FPC)',
  'Conector de carga', 'Soldadura fría / falso contacto', 'Otro',
];

const PL_ACCIONES = [
  'Limpieza ultrasonido', 'Limpieza con alcohol + flux', 'Cambio de IC',
  'Reball', 'Reflow', 'Jumper / puente', 'Cambio de capacitor',
  'Cambio de bobina / filtro', 'Cambio de conector', 'Reparación de pista',
  'Cambio de flex', 'Reprogramación / software', 'Transplante de NAND',
];

const PL_MODOS = [
  { id: 'dcv',   label: 'DCV (tensión)' },
  { id: 'diodo', label: 'Modo diodo' },
  { id: 'ohm',   label: 'Resistencia (Ω)' },
  { id: 'cont',  label: 'Continuidad' },
  { id: 'amp',   label: 'Consumo (A)' },
  { id: 'senal', label: 'Señal / osciloscopio' },
];

const PL_RESULTADOS = [
  { id: '',         ico: '·',  label: 'Sin medir' },
  { id: 'ok',       ico: '✅', label: 'OK' },
  { id: 'bajo',     ico: '🔻', label: 'Bajo' },
  { id: 'alto',     ico: '🔺', label: 'Alto' },
  { id: 'cero',     ico: '⭕', label: 'En 0' },
  { id: 'corto',    ico: '⚠️', label: 'Corto a masa' },
  { id: 'abierto',  ico: '🚫', label: 'Abierto' },
  { id: 'inestable',ico: '〰️', label: 'Inestable' },
];

// ══════════════════════════════════════════════════════════
//  RUTINAS DE MEDICIÓN POR SÍNTOMA
//  Son el "por dónde empiezo". Los valores son de REFERENCIA GENERAL
//  (valen para la mayoría de los modelos); editalos con lo que midas vos
//  en una placa buena — el sistema después te los sugiere solo.
// ══════════════════════════════════════════════════════════

const PL_RUTINAS = {
  'no-enciende': [
    { punto: 'Consumo en fuente (3,8 V)', modo: 'amp',   esperado: '0 A en reposo; sube al dar boot', nota: 'Si arranca en 0,00 A: no hay boot. Si queda fijo en un valor alto: corto.' },
    { punto: 'PP_BATT_VCC',   modo: 'dcv',   esperado: '3,6 – 4,2 V', nota: 'Tensión de batería sobre la placa' },
    { punto: 'PP_VCC_MAIN',   modo: 'dcv',   esperado: '≈ igual a batería', nota: 'Si está en 0 hay corto o el PMIC no larga' },
    { punto: 'PP_BATT_VCC',   modo: 'diodo', esperado: 'anotá el valor de una placa buena', nota: 'Cerca de 0 = corto a masa' },
    { punto: 'PP1V8_ALWAYS',  modo: 'dcv',   esperado: '1,8 V', nota: 'Línea siempre presente del PMIC' },
    { punto: 'PP3V0_NAND',    modo: 'dcv',   esperado: '≈ 3,0 V', nota: 'Alimentación de memoria' },
    { punto: 'Oscilador 24 MHz', modo: 'senal', esperado: 'señal presente', nota: 'Sin reloj principal no arranca la CPU' },
    { punto: 'Línea de botón Power', modo: 'cont', esperado: 'continuidad al conector', nota: 'Descartar el flex antes que la placa' },
  ],
  'no-carga': [
    { punto: 'PP5V0_USB / VBUS', modo: 'dcv',   esperado: '≈ 5 V con cargador', nota: 'Medir en la placa, no en el conector suelto' },
    { punto: 'PP5V0_USB',        modo: 'diodo', esperado: 'anotá el valor de una placa buena', nota: 'Cerca de 0 = corto en la línea de carga' },
    { punto: 'Líneas de datos (D+/D– o CC1/CC2)', modo: 'diodo', esperado: 'valores parejos entre sí', nota: 'Type-C: CC1 y CC2. Lightning: D+/D–' },
    { punto: 'PP_BATT_VCC (con cargador)', modo: 'dcv', esperado: 'sube de a poco', nota: 'Si no sube, no está cargando' },
    { punto: 'Termistor de batería', modo: 'ohm', esperado: 'unos kΩ', nota: 'Abierto = el equipo no acepta carga' },
    { punto: 'Conector de carga (flex)', modo: 'cont', esperado: 'continuidad', nota: 'Probar primero con un flex conocido bueno' },
  ],
  'bootloop': [
    { punto: 'Consumo en fuente', modo: 'amp', esperado: 'debe estabilizarse', nota: 'Anotá en qué mA se corta el ciclo' },
    { punto: 'PP_VCC_MAIN', modo: 'dcv', esperado: '≈ batería, estable', nota: 'Caídas = alguna línea se cae' },
    { punto: 'PP1V8_SDRAM / PP1V1', modo: 'dcv', esperado: '1,8 V / 1,1 V', nota: 'Inestables = CPU o NAND' },
    { punto: 'Error en 3uTools / iTunes', modo: 'senal', esperado: 'anotar código', nota: '4013/4014 → NAND o CPU. -9 → conexión' },
    { punto: 'Zona de CPU (temperatura)', modo: 'senal', esperado: 'temperatura pareja', nota: 'Punto caliente = corto debajo' },
  ],
  'sin-imagen': [
    { punto: 'PP_VOUT_BL (backlight)', modo: 'dcv', esperado: '≈ 18 – 20 V con pantalla conectada', nota: 'Sin pantalla no hay tensión: medir siempre con módulo puesto' },
    { punto: 'BL_ANODE / BL_CATHODE', modo: 'diodo', esperado: 'valores parejos', nota: 'Uno en 0 = filtro o diodo en corto' },
    { punto: 'Bobina de backlight', modo: 'ohm', esperado: 'baja resistencia', nota: 'Abierta = clásico de golpe' },
    { punto: 'PP5V7_LCM / PPVDD_LCM', modo: 'dcv', esperado: '≈ 5,7 V / 1,8 V', nota: 'Alimentación del display' },
    { punto: 'Conector FPC de pantalla', modo: 'senal', esperado: 'pines sanos', nota: 'Revisar con lupa: pines doblados o corrosión' },
  ],
  'sin-tactil': [
    { punto: 'PP5V7_TOUCH', modo: 'dcv', esperado: '≈ 5,7 V', nota: 'Positiva del táctil' },
    { punto: 'PPNEG5V7_TOUCH', modo: 'dcv', esperado: '≈ –5,7 V', nota: 'Negativa: acordate de invertir las puntas' },
    { punto: 'Líneas del Touch IC', modo: 'diodo', esperado: 'anotá valores de placa buena', nota: 'Clásico en 6/6 Plus y en placas golpeadas' },
    { punto: 'Probar con otro módulo', modo: 'senal', esperado: 'táctil responde', nota: 'Descartar pantalla antes de tocar la placa' },
  ],
  'sin-senal': [
    { punto: 'PP1V8_RF / PP_VCC_RF', modo: 'dcv', esperado: '1,8 V / según modelo', nota: 'Alimentación de la sección RF' },
    { punto: 'Baseband PMU', modo: 'dcv', esperado: 'líneas presentes', nota: 'Si no hay ninguna, mirá el PMU de baseband' },
    { punto: 'Conector de antena', modo: 'cont', esperado: 'continuidad', nota: 'Antenas flojas o cable pisado' },
    { punto: 'IMEI en ajustes', modo: 'senal', esperado: 'IMEI visible', nota: 'Sin IMEI = baseband. Con IMEI = RF o antena' },
    { punto: 'Zona de baseband (temperatura)', modo: 'senal', esperado: 'sin punto caliente', nota: 'Buscar corrosión bajo blindaje' },
  ],
  'sin-wifi': [
    { punto: 'Alimentación del WiFi IC', modo: 'dcv', esperado: 'según modelo', nota: 'Anotá lo que midas en una placa buena' },
    { punto: 'Líneas del WiFi IC', modo: 'diodo', esperado: 'valores parejos', nota: 'WiFi gris clásico: IC despegado por golpe' },
    { punto: 'Zona bajo blindaje', modo: 'senal', esperado: 'sin corrosión', nota: 'Sacar blindaje y mirar con lupa' },
  ],
  'consumo': [
    { punto: 'Consumo en fuente (3,8 V)', modo: 'amp', esperado: 'anotar valor exacto', nota: 'El número te dice qué tan grande es el corto' },
    { punto: 'PP_VCC_MAIN', modo: 'diodo', esperado: 'cerca de 0 = corto', nota: 'Arrancá siempre por la línea principal' },
    { punto: 'Cada línea del PMIC', modo: 'diodo', esperado: 'ir descartando una por una', nota: 'Anotá TODAS, la que dé raro es la del problema' },
    { punto: 'Cámara térmica / alcohol', modo: 'senal', esperado: 'localizar punto caliente', nota: 'Inyectar tensión limitada y buscar el calor' },
    { punto: 'Desconectar cámaras / pantalla / flex', modo: 'amp', esperado: '¿baja el consumo?', nota: 'Descartar periféricos antes de tocar la placa' },
  ],
  'mojado': [
    { punto: 'Inspección con lupa', modo: 'senal', esperado: 'mapear zonas con corrosión', nota: 'Antes de medir nada: limpieza en ultrasonido' },
    { punto: 'Consumo en fuente', modo: 'amp', esperado: 'anotar', nota: 'Post limpieza, comparar con antes' },
    { punto: 'PP_VCC_MAIN', modo: 'diodo', esperado: 'buscar corto', nota: 'El líquido deja cortos entre líneas vecinas' },
    { punto: 'Líneas bajo blindajes', modo: 'diodo', esperado: 'revisar todas', nota: 'La corrosión avanza abajo de los blindajes' },
    { punto: 'Conectores (batería, pantalla, carga)', modo: 'senal', esperado: 'pines sanos', nota: 'Los conectores son lo primero que se come el líquido' },
  ],
  'sin-audio': [
    { punto: 'Alimentación del Audio IC', modo: 'dcv', esperado: 'según modelo', nota: 'Anotá lo de una placa buena' },
    { punto: 'Líneas del Audio IC', modo: 'diodo', esperado: 'valores parejos', nota: 'Audio IC despegado: clásico del 7/7 Plus' },
    { punto: 'Probar auricular / parlante nuevo', modo: 'senal', esperado: 'suena', nota: 'Descartar el componente antes que la placa' },
  ],
  'no-faceid': [
    { punto: 'Flex del dot projector', modo: 'senal', esperado: 'sin cortes', nota: 'Face ID está pareado a la placa: no se cambia y listo' },
    { punto: 'Alimentación del módulo', modo: 'dcv', esperado: 'según modelo', nota: '' },
    { punto: 'Mensaje en ajustes', modo: 'senal', esperado: 'anotar el error exacto', nota: '"Face ID no disponible" vs "Mueva más despacio"' },
  ],
  'sin-camara': [
    { punto: 'Alimentación de cámara', modo: 'dcv', esperado: 'según modelo', nota: '' },
    { punto: 'Conector de cámara', modo: 'senal', esperado: 'pines sanos', nota: '' },
    { punto: 'Probar con otra cámara', modo: 'senal', esperado: 'abre', nota: 'Descartar el módulo primero' },
  ],
  'error-itunes': [
    { punto: 'Código de error exacto', modo: 'senal', esperado: 'anotar', nota: '4013/4014 → NAND o CPU · -1 → PMIC · 9 → conexión' },
    { punto: 'Consumo durante la restauración', modo: 'amp', esperado: 'anotar en qué % corta', nota: '' },
    { punto: 'Líneas de NAND', modo: 'diodo', esperado: 'valores parejos', nota: '' },
  ],
  'no-bateria': [
    { punto: 'Termistor de batería', modo: 'ohm', esperado: 'unos kΩ', nota: 'Abierto = "batería desconocida"' },
    { punto: 'Líneas del conector de batería', modo: 'diodo', esperado: 'valores parejos', nota: '' },
    { punto: 'Probar con otra batería', modo: 'senal', esperado: 'reconoce', nota: 'Descartar la batería antes que la placa' },
  ],
  'otro': [
    { punto: '', modo: 'dcv', esperado: '', nota: '' },
  ],
};

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════

function _uid() { return 'x' + Math.random().toString(36).slice(2, 10); }

// Texto que va DENTRO de una string JS que a su vez va dentro de un atributo
// HTML (onclick="fn('...')"). Primero escapo para JS, después para HTML.
function _js(s) {
  return esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2800);
}

function _sintoma(id)  { return PL_SINTOMAS.find(s => s.id === id) || PL_SINTOMAS[PL_SINTOMAS.length - 1]; }
function _estado(id)   { return PL_ESTADOS.find(e => e.id === id)  || PL_ESTADOS[0]; }
function _resultado(id){ return PL_RESULTADOS.find(r => r.id === (id || '')) || PL_RESULTADOS[0]; }
function _modoLbl(id)  { return (PL_MODOS.find(m => m.id === id) || PL_MODOS[0]).label; }

function _fechaLarga(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function _horaCorta(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════
//  DARK MODE + BOOT
// ══════════════════════════════════════════════════════════

function initDarkMode() {
  if (localStorage.getItem('darkMode') === '1') document.body.classList.add('dark');
  else document.body.classList.remove('dark');
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.remove('app-hidden');
  initPlacas();
}

function initPlacas() {
  initDarkMode();
  db = _fbInit();

  // Datalist de modelos (input libre del paso 1)
  document.getElementById('pl-modelos-list').innerHTML =
    PL_MODELOS.map(m => `<option value="${esc(m)}">`).join('');

  // Selects de filtro
  const fMod = document.getElementById('pl-f-modelo');
  fMod.innerHTML = '<option value="">Todos los modelos</option>' +
    PL_MODELOS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  const fSin = document.getElementById('pl-f-sintoma');
  fSin.innerHTML = '<option value="">Todos los síntomas</option>' +
    PL_SINTOMAS.map(s => `<option value="${esc(s.id)}">${s.ico} ${esc(s.label)}</option>`).join('');
  const fEst = document.getElementById('pl-f-estado');
  fEst.innerHTML = '<option value="">Todos los estados</option>' +
    PL_ESTADOS.map(e => `<option value="${esc(e.id)}">${e.ico} ${esc(e.label)}</option>`).join('');

  // Búsqueda
  document.getElementById('pl-search').addEventListener('input', debounce(e => {
    _filtro.q = e.target.value; renderList();
  }, 200));
  fMod.addEventListener('change', e => { _filtro.modelo  = e.target.value; renderList(); });
  fSin.addEventListener('change', e => { _filtro.sintoma = e.target.value; renderList(); });
  fEst.addEventListener('change', e => { _filtro.estado  = e.target.value; renderList(); });

  // Cerrar modales con Escape
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('pl-lightbox').classList.contains('hidden')) return cerrarFoto();
    if (!document.getElementById('pl-kb').classList.contains('hidden')) return closeKB();
    if (!document.getElementById('pl-detail').classList.contains('hidden')) return closeDetalle();
  });

  listenPlacas();
}

// ══════════════════════════════════════════════════════════
//  FIRESTORE
// ══════════════════════════════════════════════════════════

function listenPlacas() {
  if (_placasListener) _placasListener();
  // CUPO: tope de 300 casos. Alcanza de sobra para la base de conocimiento
  // y no crece sin control con los años.
  _placasListener = db.collection('placas')
    .orderBy('createdAt', 'desc').limit(300)
    .onSnapshot(snap => {
      PLACAS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStats();
      renderList();
      // Si tengo un caso abierto y llegó una versión nueva del server, no piso
      // lo que el usuario está escribiendo: solo refresco la lista de atrás.
    }, err => {
      console.error('[placas] listener:', err);
      toast('No pude leer los casos', 'error');
    });
}

const _saveDebounced = debounce(() => _saveCur(), 1200);

async function _saveCur() {
  if (!_cur) return;
  _cur.updatedAt = new Date().toISOString();
  _cur.searchBlob = [
    _cur.modelo, _cur.nOrden, _cur.cliente, _sintoma(_cur.sintoma).label,
    _cur.causa, _cur.descripcion, _cur.solucion, (_cur.tags || []).join(' '),
  ].filter(Boolean).join(' ');

  const data = { ..._cur };
  delete data.id;

  _setSaveState('saving');
  try {
    if (_curId) {
      await db.collection('placas').doc(_curId).set(data, { merge: true });
    } else {
      const ref = await db.collection('placas').add(data);
      _curId = ref.id;
      _cur.id = ref.id;
    }
    _dirty = false;
    _setSaveState('saved');
  } catch (e) {
    console.error('[placas] save:', e);
    _setSaveState('error');
    toast('No pude guardar', 'error');
  }
}

function _touch() {
  _dirty = true;
  _setSaveState('dirty');
  _saveDebounced();
}

function _setSaveState(state) {
  const el = document.getElementById('pl-save-state');
  if (!el) return;
  const map = {
    dirty:  { txt: 'Sin guardar…', cls: 'pl-save--dirty' },
    saving: { txt: 'Guardando…',   cls: 'pl-save--saving' },
    saved:  { txt: 'Guardado ✓',   cls: 'pl-save--ok' },
    error:  { txt: 'Error al guardar', cls: 'pl-save--err' },
  };
  const s = map[state] || map.saved;
  el.textContent = s.txt;
  el.className = 'pl-save-state ' + s.cls;
}

// ══════════════════════════════════════════════════════════
//  LISTA + ESTADÍSTICAS
// ══════════════════════════════════════════════════════════

function _placasFiltradas() {
  return PLACAS.filter(p => {
    if (_filtro.estado  && p.estado  !== _filtro.estado)  return false;
    if (_filtro.modelo  && p.modelo  !== _filtro.modelo)  return false;
    if (_filtro.sintoma && p.sintoma !== _filtro.sintoma) return false;
    if (_filtro.q && !searchMatch(
      [p.modelo, p.nOrden, p.cliente, _sintoma(p.sintoma).label, p.causa,
       p.descripcion, p.solucion, (p.tags || []).join(' ')], _filtro.q)) return false;
    return true;
  });
}

function renderStats() {
  const cuenta = id => PLACAS.filter(p => p.estado === id).length;
  const cerrados = PLACAS.filter(p => p.estado === 'reparado' || p.estado === 'sin-solucion').length;
  const ok = cuenta('reparado');
  document.getElementById('pl-st-diag').textContent   = cuenta('diagnostico');
  document.getElementById('pl-st-espera').textContent = cuenta('espera');
  document.getElementById('pl-st-ok').textContent     = ok;
  document.getElementById('pl-st-exito').textContent  = cerrados ? Math.round(ok * 100 / cerrados) + '%' : '—';
}

function renderList() {
  const cont  = document.getElementById('pl-list');
  const empty = document.getElementById('pl-empty');
  const lista = _placasFiltradas();

  if (!lista.length) {
    cont.innerHTML = '';
    empty.style.display = '';
    document.getElementById('pl-empty-txt').textContent = PLACAS.length
      ? 'Ningún caso coincide con el filtro'
      : 'Todavía no cargaste ninguna placa';
    return;
  }
  empty.style.display = 'none';

  cont.innerHTML = lista.map(p => {
    const s  = _sintoma(p.sintoma);
    const e  = _estado(p.estado);
    const nm = (p.mediciones || []).length;
    const np = (p.pasos || []).length;
    const alertas = (p.mediciones || []).filter(m => ['corto', 'cero', 'abierto'].includes(m.resultado)).length;
    return `
    <div class="pl-card" onclick="abrirDetalle('${esc(p.id)}')">
      <div class="pl-card-top">
        <span class="pl-card-sint">${s.ico}</span>
        <div class="pl-card-main">
          <div class="pl-card-title">${esc(p.modelo || 'Sin modelo')}</div>
          <div class="pl-card-sub">${esc(s.label)}${p.nOrden ? ` · N°${esc(p.nOrden)}` : ''}</div>
        </div>
        <span class="pl-chip pl-chip--${e.color}">${e.ico} ${esc(e.label)}</span>
      </div>
      ${p.causa ? `<div class="pl-card-causa">🎯 ${esc(p.causa)}</div>` : ''}
      <div class="pl-card-foot">
        <span>📅 ${esc(_fechaLarga(p.createdAt))}</span>
        <span>📊 ${nm} medic.</span>
        <span>📝 ${np} pasos</span>
        ${alertas ? `<span class="pl-card-alert">⚠️ ${alertas}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  ABRIR / CREAR CASO
// ══════════════════════════════════════════════════════════

function nuevoCaso() {
  _curId = null;
  _fotos = [];
  _cur = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fecha: todayAR(),
    modelo: '', nOrden: '', cliente: '',
    sintoma: '', antecedente: '', descripcion: '',
    fuenteV: '', consumoA: '',
    mediciones: [], pasos: [],
    causa: '', solucion: '', acciones: [], estado: 'diagnostico',
    tiempoMin: '', costoRepuesto: '', cobrado: '', tags: [],
  };
  _step = 1;
  _abrirModal();
  _setSaveState('saved');
}

function abrirDetalle(id) {
  const p = PLACAS.find(x => x.id === id);
  if (!p) return;
  _curId = id;
  _cur = JSON.parse(JSON.stringify(p));
  _cur.mediciones = _cur.mediciones || [];
  _cur.pasos      = _cur.pasos || [];
  _cur.acciones   = _cur.acciones || [];
  _cur.tags       = _cur.tags || [];
  _fotos = [];
  _step = 1;
  _abrirModal();
  _setSaveState('saved');
  _cargarFotos();
}

function _abrirModal() {
  document.getElementById('pl-detail').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderDetalle();
}

async function closeDetalle() {
  if (_dirty) await _saveCur();
  document.getElementById('pl-detail').classList.add('hidden');
  document.body.style.overflow = '';
  _cur = null; _curId = null; _fotos = [];
}

function _stepActual() { return _step; }

function irAPaso(n) {
  if (n < 1 || n > 4) return;
  _step = n;
  renderDetalle();
  document.querySelector('.pl-detail-body')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════
//  RENDER DEL DETALLE
// ══════════════════════════════════════════════════════════

const PL_PASOS_FLUJO = [
  { n: 1, ico: '📱', label: 'Equipo' },
  { n: 2, ico: '📊', label: 'Mediciones' },
  { n: 3, ico: '📝', label: 'Pasos' },
  { n: 4, ico: '🎯', label: 'Resultado' },
];

function renderDetalle() {
  if (!_cur) return;
  const s = _sintoma(_cur.sintoma);

  document.getElementById('pl-detail-title').innerHTML =
    `${s.ico} ${esc(_cur.modelo || 'Nuevo caso')}` +
    (_cur.sintoma ? `<span class="pl-detail-sub">${esc(s.label)}</span>` : '');

  // Stepper
  document.getElementById('pl-stepper').innerHTML = PL_PASOS_FLUJO.map(p => `
    <button class="pl-step ${p.n === _step ? 'pl-step--on' : ''} ${_pasoCompleto(p.n) ? 'pl-step--done' : ''}"
            onclick="irAPaso(${p.n})">
      <span class="pl-step-num">${_pasoCompleto(p.n) && p.n !== _step ? '✓' : p.n}</span>
      <span class="pl-step-lbl">${p.ico} ${p.label}</span>
    </button>`).join('');

  const body = document.getElementById('pl-detail-body');
  body.innerHTML =
    _step === 1 ? _renderPaso1() :
    _step === 2 ? _renderPaso2() :
    _step === 3 ? _renderPaso3() : _renderPaso4();

  // Navegación inferior
  document.getElementById('pl-nav-prev').style.visibility = _step > 1 ? '' : 'hidden';
  document.getElementById('pl-nav-next').style.visibility = _step < 4 ? '' : 'hidden';

  if (_step === 3) _renderTimeline();
  if (_step === 1) _renderKBHint();
}

function _pasoCompleto(n) {
  if (!_cur) return false;
  if (n === 1) return !!(_cur.modelo && _cur.sintoma);
  if (n === 2) return (_cur.mediciones || []).some(m => m.resultado);
  if (n === 3) return (_cur.pasos || []).length > 0;
  if (n === 4) return !!(_cur.causa || _cur.solucion);
  return false;
}

// ── PASO 1: equipo y síntoma ──────────────────────────────
function _renderPaso1() {
  return `
  <div class="pl-pane">
    <div class="pl-hint">Empezá por lo básico: qué equipo es y qué le pasa. Con eso el sistema te
    trae lo que hiciste en casos parecidos y te arma la rutina de medición.</div>

    <div class="pl-grid2">
      <label class="pl-field">
        <span>Modelo</span>
        <input list="pl-modelos-list" id="pl-f1-modelo" value="${esc(_cur.modelo)}"
               placeholder="iPhone 11 Pro" oninput="_set('modelo', this.value)">
      </label>
      <label class="pl-field">
        <span>N° de orden <em>(opcional)</em></span>
        <input id="pl-f1-orden" value="${esc(_cur.nOrden)}" placeholder="1234"
               oninput="_set('nOrden', this.value)">
      </label>
    </div>

    <label class="pl-field">
      <span>Cliente <em>(opcional)</em></span>
      <input value="${esc(_cur.cliente)}" placeholder="Nombre o teléfono"
             oninput="_set('cliente', this.value)">
    </label>

    <div class="pl-label">Síntoma principal</div>
    <div class="pl-sint-grid">
      ${PL_SINTOMAS.map(s => `
        <button class="pl-sint ${_cur.sintoma === s.id ? 'pl-sint--on' : ''}"
                onclick="elegirSintoma('${s.id}')">
          <span class="pl-sint-ico">${s.ico}</span>
          <span class="pl-sint-lbl">${esc(s.label)}</span>
        </button>`).join('')}
    </div>

    <div id="pl-kb-hint"></div>

    <div class="pl-label">¿Qué pasó antes?</div>
    <div class="pl-chips">
      ${PL_ANTECEDENTES.map(a => `
        <button class="pl-tag ${_cur.antecedente === a ? 'pl-tag--on' : ''}"
                onclick="_set('antecedente','${_js(a)}'); renderDetalle()">${esc(a)}</button>`).join('')}
    </div>

    <label class="pl-field">
      <span>Descripción / lo que dice el cliente</span>
      <textarea rows="3" placeholder="Ej: se mojó hace una semana, funcionó un día y se apagó"
                oninput="_set('descripcion', this.value)">${esc(_cur.descripcion)}</textarea>
    </label>

    <div class="pl-label">Estado inicial en el banco</div>
    <div class="pl-grid2">
      <label class="pl-field">
        <span>Tensión de fuente (V)</span>
        <input value="${esc(_cur.fuenteV)}" placeholder="3,8" oninput="_set('fuenteV', this.value)">
      </label>
      <label class="pl-field">
        <span>Consumo (A)</span>
        <input value="${esc(_cur.consumoA)}" placeholder="0,00" oninput="_set('consumoA', this.value)">
      </label>
    </div>
    <div class="pl-hint pl-hint--sm">El consumo en la fuente es el primer dato que ordena todo:
    0,00 A fijo = no arranca · sube y baja = está booteando · valor alto y fijo = corto.</div>
  </div>`;
}

function elegirSintoma(id) {
  const primeraVez = !_cur.sintoma;
  _cur.sintoma = id;
  _touch();
  // Si todavía no cargó mediciones, le ofrezco la rutina del síntoma
  if (primeraVez && !(_cur.mediciones || []).length) {
    const rutina = PL_RUTINAS[id] || [];
    if (rutina.length && rutina[0].punto) {
      _cur.mediciones = rutina.map(r => ({
        id: _uid(), punto: r.punto, modo: r.modo, esperado: r.esperado,
        medido: '', resultado: '', nota: r.nota,
      }));
    }
  }
  renderDetalle();
}

// ── Aviso de base de conocimiento en el paso 1 ────────────
function _renderKBHint() {
  const cont = document.getElementById('pl-kb-hint');
  if (!cont) return;
  if (!_cur.modelo || !_cur.sintoma) { cont.innerHTML = ''; return; }

  const previos = PLACAS.filter(p =>
    p.id !== _curId && p.modelo === _cur.modelo && p.sintoma === _cur.sintoma && p.causa);
  if (!previos.length) { cont.innerHTML = ''; return; }

  const conteo = {};
  previos.forEach(p => { conteo[p.causa] = (conteo[p.causa] || 0) + 1; });
  const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]);

  cont.innerHTML = `
    <div class="pl-kbhint">
      <div class="pl-kbhint-hdr">🧠 Ya viste esto ${previos.length} ${previos.length === 1 ? 'vez' : 'veces'}</div>
      <div class="pl-kbhint-list">
        ${ranking.map(([causa, n]) => `
          <div class="pl-kbhint-row">
            <span class="pl-kbhint-n">${n}×</span>
            <span>${esc(causa)}</span>
          </div>`).join('')}
      </div>
      <button class="pl-link" onclick="abrirKB('${_js(_cur.modelo)}','${_js(_cur.sintoma)}')">
        Ver los casos anteriores →
      </button>
    </div>`;
}

// ── PASO 2: mediciones ────────────────────────────────────
function _renderPaso2() {
  const meds = _cur.mediciones || [];
  const rutina = PL_RUTINAS[_cur.sintoma] || [];

  return `
  <div class="pl-pane">
    <div class="pl-hint">Cada fila es una medición. Cargá qué esperabas y qué te dio: lo que anotes
    hoy es lo que la app te va a sugerir la próxima vez que midas ese mismo punto en este modelo.</div>

    <div class="pl-med-actions">
      <button class="pl-btn pl-btn--pri" onclick="addMedicion()">＋ Medición</button>
      ${rutina.length && rutina[0].punto
        ? `<button class="pl-btn" onclick="cargarRutina()">🧭 Cargar rutina de "${esc(_sintoma(_cur.sintoma).label)}"</button>`
        : ''}
      ${meds.length ? `<button class="pl-btn pl-btn--ghost" onclick="copiarMediciones()">📋 Copiar tabla</button>` : ''}
    </div>

    ${meds.length ? `
    <div class="pl-med-list">
      ${meds.map((m, i) => _renderMedicion(m, i)).join('')}
    </div>` : `
    <div class="pl-empty-inline">
      <span>📊</span>
      <p>Sin mediciones todavía.</p>
      ${rutina.length && rutina[0].punto
        ? `<button class="pl-btn pl-btn--pri" onclick="cargarRutina()">Cargar la rutina del síntoma</button>`
        : `<button class="pl-btn pl-btn--pri" onclick="addMedicion()">Agregar la primera</button>`}
    </div>`}

    ${_renderResumenMediciones()}
    <datalist id="pl-puntos-list">${_puntosConocidos().map(p => `<option value="${esc(p)}">`).join('')}</datalist>
  </div>`;
}

function _renderMedicion(m, i) {
  const r = _resultado(m.resultado);
  return `
  <div class="pl-med pl-med--${m.resultado || 'none'}">
    <div class="pl-med-hdr">
      <span class="pl-med-idx">${i + 1}</span>
      <input class="pl-med-punto" list="pl-puntos-list" value="${esc(m.punto)}"
             placeholder="Punto / línea (ej: PP_VCC_MAIN)"
             oninput="_setMed('${m.id}','punto', this.value)"
             onchange="_sugerirEsperado('${m.id}')">
      <button class="pl-med-del" onclick="delMedicion('${m.id}')" title="Borrar">✕</button>
    </div>
    <div class="pl-med-row">
      <label class="pl-mini">
        <span>Modo</span>
        <select onchange="_setMed('${m.id}','modo', this.value)">
          ${PL_MODOS.map(o => `<option value="${o.id}" ${m.modo === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </label>
      <label class="pl-mini">
        <span>Esperado</span>
        <input value="${esc(m.esperado)}" placeholder="1,8 V" oninput="_setMed('${m.id}','esperado', this.value)">
      </label>
      <label class="pl-mini">
        <span>Medido</span>
        <input value="${esc(m.medido)}" placeholder="0,0 V" oninput="_setMed('${m.id}','medido', this.value)">
      </label>
      <label class="pl-mini">
        <span>Resultado</span>
        <select class="pl-med-res" onchange="_setMed('${m.id}','resultado', this.value); renderDetalle()">
          ${PL_RESULTADOS.map(o => `<option value="${o.id}" ${(m.resultado || '') === o.id ? 'selected' : ''}>${o.ico} ${esc(o.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    ${m.nota ? `<div class="pl-med-nota">💡 ${esc(m.nota)}</div>` : ''}
    <input class="pl-med-obs" value="${esc(m.obs || '')}" placeholder="Observación tuya…"
           oninput="_setMed('${m.id}','obs', this.value)">
  </div>`;
}

function _renderResumenMediciones() {
  const meds = (_cur.mediciones || []).filter(m => m.resultado);
  if (!meds.length) return '';
  const malas = meds.filter(m => ['corto', 'cero', 'abierto', 'bajo', 'alto', 'inestable'].includes(m.resultado));
  if (!malas.length) {
    return `<div class="pl-resumen pl-resumen--ok">✅ ${meds.length} mediciones y todas dieron bien.
      Si el equipo sigue fallando, el problema está en otra parte: revisá periféricos y flex.</div>`;
  }
  return `
  <div class="pl-resumen pl-resumen--bad">
    <div class="pl-resumen-hdr">⚠️ ${malas.length} ${malas.length === 1 ? 'medición fuera de rango' : 'mediciones fuera de rango'}</div>
    <ul>${malas.map(m => `<li><b>${esc(m.punto || 'sin nombre')}</b> — ${_resultado(m.resultado).label}
      ${m.medido ? `(medí ${esc(m.medido)}${m.esperado ? `, esperaba ${esc(m.esperado)}` : ''})` : ''}</li>`).join('')}</ul>
    <div class="pl-resumen-tip">Empezá por la de más arriba en la cadena de alimentación: si la línea
    principal está mal, todas las de abajo van a dar mal también.</div>
  </div>`;
}

// Puntos que ya usaste antes (para el autocompletado)
function _puntosConocidos() {
  const set = new Set();
  PLACAS.forEach(p => (p.mediciones || []).forEach(m => m.punto && set.add(m.punto)));
  Object.values(PL_RUTINAS).forEach(r => r.forEach(m => m.punto && set.add(m.punto)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Si ya mediste ese punto en este modelo, traigo el valor que anotaste
function _sugerirEsperado(id) {
  const m = (_cur.mediciones || []).find(x => x.id === id);
  if (!m || !m.punto || m.esperado) return;
  let hit = null;
  for (const p of PLACAS) {
    if (p.id === _curId) continue;
    if (_cur.modelo && p.modelo !== _cur.modelo) continue;
    const prev = (p.mediciones || []).find(x =>
      normalizeText(x.punto) === normalizeText(m.punto) && x.resultado === 'ok' && x.medido);
    if (prev) { hit = prev; break; }
  }
  if (hit) {
    m.esperado = hit.medido;
    m.nota = m.nota || `Valor tomado de un caso anterior de ${_cur.modelo} que dio OK`;
    _touch();
    renderDetalle();
    toast('Traje el valor que mediste antes');
  }
}

function addMedicion() {
  _cur.mediciones = _cur.mediciones || [];
  _cur.mediciones.push({ id: _uid(), punto: '', modo: 'dcv', esperado: '', medido: '', resultado: '', nota: '' });
  _touch();
  renderDetalle();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.pl-med-punto');
    inputs[inputs.length - 1]?.focus();
  }, 50);
}

function cargarRutina() {
  const rutina = PL_RUTINAS[_cur.sintoma] || [];
  if (!rutina.length) return;
  const yaHay = new Set((_cur.mediciones || []).map(m => normalizeText(m.punto)));
  const nuevas = rutina
    .filter(r => r.punto && !yaHay.has(normalizeText(r.punto)))
    .map(r => ({ id: _uid(), punto: r.punto, modo: r.modo, esperado: r.esperado, medido: '', resultado: '', nota: r.nota }));
  if (!nuevas.length) return toast('La rutina ya estaba cargada');
  _cur.mediciones = [...(_cur.mediciones || []), ...nuevas];
  _touch();
  renderDetalle();
  toast(`Sumé ${nuevas.length} puntos a medir`);
}

function delMedicion(id) {
  _cur.mediciones = (_cur.mediciones || []).filter(m => m.id !== id);
  _touch();
  renderDetalle();
}

function _setMed(id, campo, valor) {
  const m = (_cur.mediciones || []).find(x => x.id === id);
  if (!m) return;
  m[campo] = valor;
  _touch();
}

function copiarMediciones() {
  const txt = (_cur.mediciones || []).map(m =>
    `${m.punto || '—'} [${_modoLbl(m.modo)}] esperado: ${m.esperado || '—'} · medido: ${m.medido || '—'} · ${_resultado(m.resultado).label}`
  ).join('\n');
  navigator.clipboard?.writeText(txt).then(
    () => toast('Tabla copiada'),
    () => toast('No pude copiar', 'error'));
}

// ── PASO 3: bitácora de pasos ─────────────────────────────
function _renderPaso3() {
  return `
  <div class="pl-pane">
    <div class="pl-hint">Anotá lo que vas haciendo con la hora. Sirve para no repetir trabajo,
    para cobrar el tiempo real y para acordarte de qué probaste si la placa vuelve.</div>

    <div class="pl-paso-add">
      <input id="pl-paso-input" placeholder="Ej: limpié en ultrasonido 8 min y midió igual"
             onkeydown="if(event.key==='Enter') addPaso()">
      <button class="pl-btn pl-btn--pri" onclick="addPaso()">Agregar</button>
    </div>

    <div class="pl-quick">
      ${['Limpieza ultrasonido', 'Inspección con lupa', 'Cambié el flex y probé', 'Probé con batería nueva',
         'Inyecté tensión limitada', 'Saqué blindaje', 'Reflow', 'Cambié el IC', 'Probé con otro módulo']
        .map(t => `<button class="pl-quick-btn" onclick="addPaso('${_js(t)}')">+ ${esc(t)}</button>`).join('')}
    </div>

    <div id="pl-timeline"></div>

    <div class="pl-label">Fotos de la placa</div>
    <div class="pl-hint pl-hint--sm">Sacale foto a la zona antes y después. Se guardan aparte para que
    la app siga liviana.</div>
    <div class="pl-fotos" id="pl-fotos"></div>
    <label class="pl-btn pl-btn--ghost pl-foto-add">
      📷 Agregar foto
      <input type="file" accept="image/*" hidden onchange="addFoto(this)">
    </label>
  </div>`;
}

function _renderTimeline() {
  const cont = document.getElementById('pl-timeline');
  if (!cont) return;
  const pasos = _cur.pasos || [];
  if (!pasos.length) {
    cont.innerHTML = `<div class="pl-empty-inline"><span>📝</span><p>Sin pasos anotados todavía.</p></div>`;
    return;
  }
  cont.innerHTML = `<div class="pl-tl">${pasos.map((p, i) => `
    <div class="pl-tl-item pl-tl-item--${p.resultado || 'neutro'}">
      <div class="pl-tl-dot">${i + 1}</div>
      <div class="pl-tl-body">
        <div class="pl-tl-txt">${esc(p.texto)}</div>
        <div class="pl-tl-meta">
          <span>🕐 ${esc(_fechaLarga(p.ts))} ${esc(_horaCorta(p.ts))}</span>
          <button class="pl-tl-res ${p.resultado === 'ok' ? 'on' : ''}" onclick="_setPasoRes('${p.id}','ok')" title="Sirvió">✅</button>
          <button class="pl-tl-res ${p.resultado === 'no' ? 'on' : ''}" onclick="_setPasoRes('${p.id}','no')" title="No sirvió">❌</button>
          <button class="pl-tl-del" onclick="delPaso('${p.id}')">✕</button>
        </div>
      </div>
    </div>`).join('')}</div>`;
  _renderFotos();
}

function addPaso(texto) {
  const input = document.getElementById('pl-paso-input');
  const txt = (texto || input?.value || '').trim();
  if (!txt) return;
  _cur.pasos = _cur.pasos || [];
  _cur.pasos.push({ id: _uid(), ts: new Date().toISOString(), texto: txt, resultado: '' });
  if (input && !texto) input.value = '';
  _touch();
  _renderTimeline();
}

function delPaso(id) {
  _cur.pasos = (_cur.pasos || []).filter(p => p.id !== id);
  _touch();
  _renderTimeline();
}

function _setPasoRes(id, res) {
  const p = (_cur.pasos || []).find(x => x.id === id);
  if (!p) return;
  p.resultado = p.resultado === res ? '' : res;
  _touch();
  _renderTimeline();
}

// ── Fotos (subcolección) ──────────────────────────────────
async function _cargarFotos() {
  if (!_curId) { _fotos = []; return; }
  try {
    const snap = await db.collection('placas').doc(_curId).collection('fotos')
      .orderBy('createdAt', 'asc').get();
    _fotos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderFotos();
  } catch (e) { console.warn('[placas] fotos:', e); }
}

function _renderFotos() {
  const cont = document.getElementById('pl-fotos');
  if (!cont) return;
  cont.innerHTML = _fotos.map(f => `
    <div class="pl-foto">
      <img src="${esc(f.data)}" alt="" onclick="verFoto('${esc(f.id)}')">
      <button class="pl-foto-del" onclick="delFoto('${esc(f.id)}')">✕</button>
    </div>`).join('');
}

function verFoto(id) {
  const f = _fotos.find(x => x.id === id);
  if (!f) return;
  document.getElementById('pl-lightbox-img').src = f.data;
  document.getElementById('pl-lightbox').classList.remove('hidden');
}

function cerrarFoto() {
  document.getElementById('pl-lightbox').classList.add('hidden');
  document.getElementById('pl-lightbox-img').src = '';
}

function addFoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = async () => {
      const MAX = 900;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const data = canvas.toDataURL('image/jpeg', 0.6);
      // La foto va a la subcolección: necesito el caso guardado primero
      if (!_curId) await _saveCur();
      if (!_curId) return toast('Guardá el caso primero', 'error');
      try {
        const ref = await db.collection('placas').doc(_curId).collection('fotos')
          .add({ data, createdAt: new Date().toISOString() });
        _fotos.push({ id: ref.id, data });
        _renderFotos();
        toast('Foto guardada');
      } catch (err) {
        console.error('[placas] addFoto:', err);
        toast('No pude guardar la foto', 'error');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function delFoto(id) {
  if (!confirm('¿Borrar esta foto?')) return;
  try {
    await db.collection('placas').doc(_curId).collection('fotos').doc(id).delete();
    _fotos = _fotos.filter(f => f.id !== id);
    _renderFotos();
  } catch (e) { toast('No pude borrarla', 'error'); }
}

// ── PASO 4: resultado ─────────────────────────────────────
function _renderPaso4() {
  return `
  <div class="pl-pane">
    <div class="pl-hint">Cerrá el caso. Esto es lo que después te va a aparecer cuando entre
    otra placa igual, así que sé concreto con la causa.</div>

    <div class="pl-label">Estado del caso</div>
    <div class="pl-chips">
      ${PL_ESTADOS.map(e => `
        <button class="pl-tag pl-tag--${e.color} ${_cur.estado === e.id ? 'pl-tag--on' : ''}"
                onclick="_set('estado','${e.id}'); renderDetalle()">${e.ico} ${esc(e.label)}</button>`).join('')}
    </div>

    <label class="pl-field">
      <span>Causa encontrada</span>
      <input list="pl-causas-list" value="${esc(_cur.causa)}" placeholder="Ej: U2 / Tristar (carga)"
             oninput="_set('causa', this.value)">
    </label>
    <datalist id="pl-causas-list">${PL_CAUSAS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>

    <div class="pl-label">¿Qué hiciste?</div>
    <div class="pl-chips">
      ${PL_ACCIONES.map(a => `
        <button class="pl-tag ${(_cur.acciones || []).includes(a) ? 'pl-tag--on' : ''}"
                onclick="_toggleAccion('${_js(a)}')">${esc(a)}</button>`).join('')}
    </div>

    <label class="pl-field">
      <span>Solución / notas para vos del futuro</span>
      <textarea rows="4" placeholder="Ej: corto en C1234 al lado del PMIC. Lo saqué, consumo volvió a normal y arrancó."
                oninput="_set('solucion', this.value)">${esc(_cur.solucion)}</textarea>
    </label>

    <div class="pl-label">Números</div>
    <div class="pl-grid3">
      <label class="pl-field">
        <span>Tiempo (min)</span>
        <input value="${esc(_cur.tiempoMin)}" placeholder="90" inputmode="numeric"
               oninput="_set('tiempoMin', this.value)">
      </label>
      <label class="pl-field">
        <span>Costo repuesto</span>
        <input value="${esc(_cur.costoRepuesto)}" placeholder="0" inputmode="numeric"
               oninput="_set('costoRepuesto', this.value)">
      </label>
      <label class="pl-field">
        <span>Cobrado</span>
        <input value="${esc(_cur.cobrado)}" placeholder="0" inputmode="numeric"
               oninput="_set('cobrado', this.value)">
      </label>
    </div>
    ${_renderGanancia()}

    <div class="pl-final-actions">
      <button class="pl-btn" onclick="compartirCaso()">📲 Compartir resumen</button>
      <button class="pl-btn" onclick="duplicarCaso()">📄 Duplicar como nuevo caso</button>
      <button class="pl-btn pl-btn--danger" onclick="borrarCaso()">🗑️ Borrar caso</button>
    </div>
  </div>`;
}

function _renderGanancia() {
  const cobrado = Number(String(_cur.cobrado).replace(/\D/g, '')) || 0;
  const costo   = Number(String(_cur.costoRepuesto).replace(/\D/g, '')) || 0;
  if (!cobrado && !costo) return '';
  const gan = cobrado - costo;
  const min = Number(_cur.tiempoMin) || 0;
  const porHora = min > 0 ? Math.round(gan / (min / 60)) : null;
  return `<div class="pl-ganancia ${gan >= 0 ? '' : 'pl-ganancia--neg'}">
    Ganancia: <b>${fmtMoney(gan)}</b>${gan < 0 ? ' (perdiste plata)' : ''}
    ${porHora !== null ? ` · ${fmtMoney(porHora)} por hora de banco` : ''}
  </div>`;
}

function _toggleAccion(a) {
  _cur.acciones = _cur.acciones || [];
  _cur.acciones = _cur.acciones.includes(a)
    ? _cur.acciones.filter(x => x !== a)
    : [..._cur.acciones, a];
  _touch();
  renderDetalle();
}

function _set(campo, valor) {
  if (!_cur) return;
  _cur[campo] = valor;
  _touch();
  if (campo === 'modelo' || campo === 'sintoma') _renderKBHint();
}

// ══════════════════════════════════════════════════════════
//  ACCIONES DEL CASO
// ══════════════════════════════════════════════════════════

async function borrarCaso() {
  if (!_curId) { closeDetalle(); return; }
  if (!confirm('¿Borrar este caso? No se puede deshacer.')) return;
  try {
    await db.collection('placas').doc(_curId).delete();
    _dirty = false;
    toast('Caso borrado');
    document.getElementById('pl-detail').classList.add('hidden');
    document.body.style.overflow = '';
    _cur = null; _curId = null;
  } catch (e) { toast('No pude borrarlo', 'error'); }
}

function duplicarCaso() {
  const base = JSON.parse(JSON.stringify(_cur));
  _curId = null;
  _fotos = [];
  _cur = {
    ...base,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    fecha: todayAR(), nOrden: '', cliente: '',
    mediciones: (base.mediciones || []).map(m => ({ ...m, id: _uid(), medido: '', resultado: '' })),
    pasos: [], causa: '', solucion: '', acciones: [], estado: 'diagnostico',
    tiempoMin: '', costoRepuesto: '', cobrado: '',
  };
  delete _cur.id;
  _step = 1;
  _touch();
  renderDetalle();
  toast('Caso nuevo con la misma rutina de medición');
}

function _textoCaso(p) {
  const s = _sintoma(p.sintoma), e = _estado(p.estado);
  const lineas = [
    `🔬 DIAGNÓSTICO DE PLACA`,
    `${p.modelo || '—'}${p.nOrden ? ` · Orden N°${p.nOrden}` : ''}`,
    `Síntoma: ${s.ico} ${s.label}`,
    p.antecedente ? `Antecedente: ${p.antecedente}` : '',
    p.descripcion ? `Detalle: ${p.descripcion}` : '',
    (p.fuenteV || p.consumoA) ? `Fuente: ${p.fuenteV || '—'} V · Consumo: ${p.consumoA || '—'} A` : '',
    '',
  ];
  const meds = (p.mediciones || []).filter(m => m.resultado);
  if (meds.length) {
    lineas.push('📊 MEDICIONES');
    meds.forEach(m => lineas.push(
      `• ${m.punto} — esperado ${m.esperado || '—'} / medido ${m.medido || '—'} → ${_resultado(m.resultado).label}`));
    lineas.push('');
  }
  if ((p.pasos || []).length) {
    lineas.push('📝 PASOS');
    p.pasos.forEach((x, i) => lineas.push(`${i + 1}. ${x.texto}${x.resultado === 'ok' ? ' ✅' : x.resultado === 'no' ? ' ❌' : ''}`));
    lineas.push('');
  }
  lineas.push(`🎯 RESULTADO: ${e.ico} ${e.label}`);
  if (p.causa)    lineas.push(`Causa: ${p.causa}`);
  if ((p.acciones || []).length) lineas.push(`Trabajo: ${p.acciones.join(', ')}`);
  if (p.solucion) lineas.push(`Solución: ${p.solucion}`);
  return lineas.filter(l => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

async function compartirCaso() {
  const txt = _textoCaso(_cur);
  if (navigator.share) {
    try { await navigator.share({ text: txt }); return; } catch { /* canceló */ }
  }
  navigator.clipboard?.writeText(txt).then(
    () => toast('Resumen copiado'),
    () => toast('No pude copiar', 'error'));
}

// ══════════════════════════════════════════════════════════
//  BASE DE CONOCIMIENTO
// ══════════════════════════════════════════════════════════

let _kbFiltro = { modelo: '', sintoma: '' };

function abrirKB(modelo = '', sintoma = '') {
  _kbFiltro = { modelo, sintoma };
  document.getElementById('pl-kb').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderKB();
}

function closeKB() {
  document.getElementById('pl-kb').classList.add('hidden');
  if (document.getElementById('pl-detail').classList.contains('hidden')) document.body.style.overflow = '';
}

function renderKB() {
  const resueltos = PLACAS.filter(p => p.causa);

  // Ranking global de causas
  const conteo = {};
  resueltos.forEach(p => { conteo[p.causa] = (conteo[p.causa] || 0) + 1; });
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Filtro
  const filtrados = resueltos.filter(p =>
    (!_kbFiltro.modelo  || p.modelo  === _kbFiltro.modelo) &&
    (!_kbFiltro.sintoma || p.sintoma === _kbFiltro.sintoma));

  const modelos  = [...new Set(resueltos.map(p => p.modelo).filter(Boolean))].sort();
  const sintomas = [...new Set(resueltos.map(p => p.sintoma).filter(Boolean))];

  document.getElementById('pl-kb-body').innerHTML = `
    <div class="pl-hint">Todo lo que resolviste, ordenado. Filtrá por modelo y síntoma para ver
    qué encontraste las veces anteriores.</div>

    ${top.length ? `
    <div class="pl-label">Causas más frecuentes</div>
    <div class="pl-kb-top">
      ${top.map(([c, n]) => {
        const pct = Math.round(n * 100 / resueltos.length);
        return `<div class="pl-kb-bar">
          <div class="pl-kb-bar-lbl"><span>${esc(c)}</span><b>${n}</b></div>
          <div class="pl-kb-bar-track"><div class="pl-kb-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="pl-label">Buscar casos</div>
    <div class="pl-kb-filters">
      <select onchange="_kbFiltro.modelo=this.value; renderKB()">
        <option value="">Todos los modelos</option>
        ${modelos.map(m => `<option value="${esc(m)}" ${_kbFiltro.modelo === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
      <select onchange="_kbFiltro.sintoma=this.value; renderKB()">
        <option value="">Todos los síntomas</option>
        ${sintomas.map(s => `<option value="${esc(s)}" ${_kbFiltro.sintoma === s ? 'selected' : ''}>${_sintoma(s).ico} ${esc(_sintoma(s).label)}</option>`).join('')}
      </select>
    </div>

    ${filtrados.length ? filtrados.map(p => `
      <div class="pl-kb-case" onclick="closeKB(); abrirDetalle('${esc(p.id)}')">
        <div class="pl-kb-case-hdr">
          <b>${esc(p.modelo)}</b>
          <span class="pl-chip pl-chip--${_estado(p.estado).color}">${_estado(p.estado).ico}</span>
        </div>
        <div class="pl-kb-case-sint">${_sintoma(p.sintoma).ico} ${esc(_sintoma(p.sintoma).label)}</div>
        <div class="pl-kb-case-causa">🎯 ${esc(p.causa)}</div>
        ${p.solucion ? `<div class="pl-kb-case-sol">${esc(p.solucion)}</div>` : ''}
        <div class="pl-kb-case-foot">${esc(_fechaLarga(p.createdAt))}</div>
      </div>`).join('') : `
      <div class="pl-empty-inline"><span>🧠</span>
        <p>${resueltos.length ? 'Nada con ese filtro.' : 'Todavía no cerraste ningún caso con una causa cargada.'}</p>
      </div>`}
  `;
}

// ══════════════════════════════════════════════════════════
//  MENÚ
// ══════════════════════════════════════════════════════════

function togglePlacasMenu() {
  const d = document.getElementById('pl-menu');
  d.classList.toggle('hidden');
}

function exportarTodo() {
  const txt = PLACAS.map(p => _textoCaso(p)).join('\n\n' + '─'.repeat(30) + '\n\n');
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `diagnosticos-placa-${todayAR()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  togglePlacasMenu();
}

// ── Boot ──────────────────────────────────────────────────
requireAuth().then(u => { if (u) showApp(); });
