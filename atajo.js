// ══════════════════════════════════════════════════════════════
//  📲 ACCESOS DIRECTOS EN EL CELU (atajo-*.html y atajos.html)
// ══════════════════════════════════════════════════════════════
//  Alan (22/11): "me gustaría tener accesos directos en el celu, por ejemplo
//  a la caja, a la toma de un equipo por reparación, al escáner de venta de
//  artículos".
//
//  En Android eso ya existe en el manifest (`shortcuts`): se mantiene
//  apretado el ícono de TechPoint y salen. En iPhone NO existe: la única
//  forma es un ícono aparte en la pantalla de inicio. Por eso cada atajo es
//  una página propia (con su nombre, su ícono y su manifest):
//    · abierta DESDE EL ÍCONO (modo app, sin página anterior) → va directo a
//      la pantalla (`data-destino`);
//    · abierta en Safari/Chrome → explica cómo agregarla a la pantalla de
//      inicio;
//    · abierta desde adentro de la app (hay página anterior) → no se puede
//      agregar desde ahí: se explica que hay que abrir el link en Safari.
//
//  Ojo iPhone: cada ícono de la pantalla de inicio guarda su propia sesión,
//  así que la primera vez puede pedir usuario y contraseña. El login después
//  vuelve al atajo (auth.js recuerda la dirección con ?action=).
'use strict';

// `corto` = el nombre que queda abajo del ícono: el mismo que
// apple-mobile-web-app-title y short_name de cada atajo-*.html (lo vigila el test)
const ATAJOS = [
  { id: 'caja',       corto: 'Caja',       nombre: 'Caja',             sub: 'La caja del día, para cobrar y ver movimientos', icono: 'atajo-caja-180.png' },
  { id: 'reparacion', corto: 'Reparación', nombre: 'Nueva reparación', sub: 'Abre directo la toma de un equipo',              icono: 'atajo-reparacion-180.png' },
  { id: 'escanear',   corto: 'Escanear',   nombre: 'Escanear venta',   sub: 'La venta abierta con la cámara lista para leer el código', icono: 'atajo-escanear-180.png' },
];

function atajoEsApp(win) {
  const w = win || window;
  try {
    return w.matchMedia('(display-mode: standalone)').matches || w.navigator.standalone === true;
  } catch { return false; }
}
// Abierto desde el ícono: en modo app y sin página anterior (desde adentro de
// la app, el referrer es la página de donde se tocó el link)
function atajoAbiertoDesdeIcono(win) {
  const w = win || window;
  const ref = String(w.document.referrer || '');
  return atajoEsApp(w) && (!ref || ref.startsWith('android-app://'));
}
function atajoEsIphone(win) {
  const n = (win || window).navigator;
  return /iphone|ipad|ipod/i.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
}

const _atEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function _atPasos(iphone, nombre) {
  return iphone
    ? `<ol class="at-pasos">
        <li>Tocá <b>Compartir</b> <span class="at-ico-comp" aria-hidden="true">⬆︎</span> (el cuadradito con la flecha, abajo o arriba a la derecha).</li>
        <li>Bajá y elegí <b>"Agregar a inicio"</b>.</li>
        <li>Dejá el nombre <b>"${_atEsc(nombre)}"</b> y tocá <b>Agregar</b>.</li>
      </ol>`
    : `<ol class="at-pasos">
        <li>Tocá el menú <b>⋮</b> de Chrome (arriba a la derecha).</li>
        <li>Elegí <b>"Agregar a la pantalla principal"</b> (o "Instalar").</li>
        <li>Confirmá con <b>Agregar</b>.</li>
      </ol>
      <p class="at-nota">En Android también podés mantener apretado el ícono de TechPoint: ahí ya salen Caja, Nueva reparación y Escanear venta.</p>`;
}

function _atAdentro(url) {
  return `<div class="at-aviso">
    <b>Estás adentro de la app.</b> Desde acá el celu no deja agregar íconos:
    copiá el link y abrilo en <b>Safari</b> (en Android, en <b>Chrome</b>).
    <button type="button" class="at-btn" onclick="atajoCopiar('${_atEsc(url)}', this)">📋 Copiar el link</button>
  </div>`;
}

function atajoCopiar(url, btn) {
  const listo = () => { if (btn) btn.textContent = '✅ Copiado: pegalo en Safari'; };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(listo, () => prompt('Copiá este link:', url)); return; }
  } catch {}
  prompt('Copiá este link:', url);
}

// Página de UN atajo
function atajoPintar(win) {
  const w = win || window;
  const d = w.document;
  const html = d.documentElement;
  const destino = html.getAttribute('data-destino') || 'index.html';
  if (atajoAbiertoDesdeIcono(w)) { w.location.replace(destino); return 'fue'; }
  const at = ATAJOS.find(a => a.id === html.getAttribute('data-atajo')) || ATAJOS[0];
  const main = d.getElementById('atajo');
  if (!main) return 'sin-lugar';
  _atEstilos(d);
  const url = w.location.origin + w.location.pathname;
  main.innerHTML = `
    <img class="at-icono" src="${_atEsc(at.icono)}" alt="" width="120" height="120">
    <h1>${_atEsc(at.nombre)}</h1>
    <p class="at-sub">${_atEsc(at.sub)}</p>
    ${atajoEsApp(w) ? _atAdentro(url) : `<h2>Agregalo a la pantalla de inicio</h2>${_atPasos(atajoEsIphone(w), at.corto)}`}
    <p class="at-nota">La primera vez puede pedirte el usuario y la contraseña. Después abre directo.</p>
    <p class="at-links"><a href="${_atEsc(destino)}">Ir ahora →</a> · <a href="atajos.html">Ver todos los accesos</a></p>`;
  return 'explica';
}

// Página con los tres (atajos.html)
function atajosPintarTodos(win) {
  const w = win || window;
  const d = w.document;
  const main = d.getElementById('atajo');
  if (!main) return;
  _atEstilos(d);
  const adentro = atajoEsApp(w);
  main.innerHTML = `
    <h1>📲 Accesos directos</h1>
    <p class="at-sub">Un ícono en la pantalla del celu para cada cosa: lo tocás y abre directo.</p>
    ${adentro ? _atAdentro(w.location.origin + '/atajos.html') : `<p class="at-sub">Tocá el que quieras y seguí los pasos (son 3 toques).</p>`}
    <div class="at-lista">${ATAJOS.map(a => `
      <a class="at-card" href="atajo-${a.id}.html">
        <img src="${_atEsc(a.icono)}" alt="" width="56" height="56">
        <span><b>${_atEsc(a.nombre)}</b><small>${_atEsc(a.sub)}</small></span>
        <span class="at-flecha" aria-hidden="true">›</span>
      </a>`).join('')}
    </div>
    <p class="at-links"><a href="index.html">← Volver a la app</a></p>`;
}

function _atEstilos(d) {
  if (d.getElementById('at-css')) return;
  const st = d.createElement('style');
  st.id = 'at-css';
  st.textContent = `
  :root { --at-bg: #0f172a; --at-card: #1e293b; --at-borde: rgba(148,163,184,.22); --at-txt: #f1f5f9; --at-t2: #94a3b8; --at-azul: #3b82f6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--at-bg); color: var(--at-txt); font: 16px/1.5 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; }
  #atajo { max-width: 460px; margin: 0 auto; padding: max(28px, env(safe-area-inset-top)) 16px 40px; text-align: center; }
  .at-icono { border-radius: 28px; box-shadow: 0 12px 30px rgba(0,0,0,.4); margin-top: 8px; }
  h1 { font-size: 26px; margin: 16px 0 4px; }
  h2 { font-size: 17px; margin: 26px 0 8px; }
  .at-sub { color: var(--at-t2); margin: 4px 0; }
  .at-pasos { text-align: left; background: var(--at-card); border: 1px solid var(--at-borde); border-radius: 16px; padding: 14px 16px 14px 36px; margin: 0; }
  .at-pasos li { margin: 6px 0; }
  .at-ico-comp { display: inline-block; padding: 0 6px; border: 1.5px solid var(--at-azul); border-radius: 6px; color: var(--at-azul); font-weight: 700; }
  .at-nota { color: var(--at-t2); font-size: 13.5px; margin: 14px 0 0; }
  .at-aviso { text-align: left; background: rgba(59,130,246,.12); border: 1px solid rgba(59,130,246,.45); border-radius: 16px; padding: 14px 16px; margin: 18px 0 0; }
  .at-btn { display: block; width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 12px; background: var(--at-azul); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
  .at-links { margin-top: 22px; font-size: 14px; color: var(--at-t2); }
  .at-links a { color: var(--at-azul); text-decoration: none; font-weight: 600; }
  .at-lista { display: grid; gap: 10px; margin-top: 18px; }
  .at-card { display: flex; align-items: center; gap: 14px; text-align: left; padding: 12px 14px; border-radius: 16px; background: var(--at-card); border: 1px solid var(--at-borde); color: inherit; text-decoration: none; }
  .at-card img { border-radius: 14px; flex: none; }
  .at-card span { flex: 1; min-width: 0; }
  .at-card small { display: block; color: var(--at-t2); font-size: 13px; }
  .at-card .at-flecha { flex: none; font-size: 26px; color: var(--at-t2); }`;
  d.head.appendChild(st);
}

if (typeof document !== 'undefined' && document.documentElement && !(typeof module !== 'undefined' && module.exports)) {
  if (document.documentElement.hasAttribute('data-atajos')) atajosPintarTodos();
  else atajoPintar();
}
