// ══════════════════════════════════════════════════════════════
//  pistola.js — Escanear un producto desde CUALQUIER pantalla → caja
// ══════════════════════════════════════════════════════════════
//  Alan: "si escaneo producto, ¿se puede acceder a la caja desde cualquier
//  lado?". Antes la pistola lectora solo servía con el cursor puesto en el
//  buscador de la caja; en Stock, Reparaciones o el Dashboard el código se
//  perdía (o escribía letras sueltas en la página).
//
//  Ahora, si se escanea con el cursor fuera de un campo de texto:
//   · en index.html (Stock, Reparaciones, Dashboard…) → abre la caja con
//     "Nueva venta" y el producto ya cargado (caja.html?action=venta&scan=…);
//   · en la caja → abre "Nueva venta" si no estaba abierta y lo agrega.
//
//  Cómo se distingue la pistola de una persona: la pistola "tipea" el código
//  entero en milisegundos y termina con Enter. Una persona tarda bastante más
//  entre tecla y tecla. Y tiene que parecer un código de verdad (EAN/UPC de 8
//  a 14 cifras, o los nuestros TP00041), igual que en el buscador de la caja.
//
//  Si el cursor está en un campo (un buscador, un formulario), no se toca
//  nada: la pistola escribe ahí, como siempre.
// ══════════════════════════════════════════════════════════════
'use strict';

const PIS_MAX_ENTRE_TECLAS_MS = 50;   // la pistola: ~5-20 ms; una persona: 100+

let _pisBuf = '';
let _pisUlt = 0;

function _pisEditable(el) {
  if (!el || !el.tagName) return false;
  const t = el.tagName.toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || !!el.isContentEditable;
}

// Lo mismo que _pareceCodigo de la caja: de fábrica o nuestro
// 15 cifras = el IMEI de la caja de un celular (para buscarlo en el Stock)
function pistolaEsCodigo(s) {
  const t = String(s || '').trim();
  return /^\d{8,15}$/.test(t) || /^TP\d{3,}$/i.test(t);
}

// Recibe cada tecla. Devuelve el código cuando se completó uno, o null.
function pistolaTecla(e, ahora) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey) { _pisBuf = ''; return null; }
  if (_pisEditable(e.target)) { _pisBuf = ''; return null; }
  if (ahora - _pisUlt > PIS_MAX_ENTRE_TECLAS_MS) _pisBuf = '';
  _pisUlt = ahora;
  if (e.key === 'Enter') {
    const cod = _pisBuf;
    _pisBuf = '';
    return pistolaEsCodigo(cod) ? cod : null;
  }
  if (typeof e.key === 'string' && e.key.length === 1) _pisBuf += e.key;
  else _pisBuf = '';
  return null;
}

// En el Stock de celulares, si el código es de un celular se busca ahí (Alan,
// 14/11: "escanear el código y que lo busque"). Si no es de ningún celular
// (un accesorio), sigue a la caja como siempre.
function pistolaEnStock(cod) {
  const sec = document.getElementById('stock-section');
  if (!sec || typeof stockEscaneado !== 'function') return false;
  if (!sec.classList.contains('section-hidden')) return stockEscaneado(cod);
  // Un IMEI (15 cifras) solo puede ser de un celular: desde otra pantalla
  // también se va al Stock a mostrarlo
  if (/^\d{15}$/.test(String(cod).trim()) && typeof stockPorCodigo === 'function' &&
      stockPorCodigo(cod, typeof STOCK !== 'undefined' ? STOCK : [])) {
    if (typeof switchSection === 'function') switchSection('stock');
    return stockEscaneado(cod);
  }
  return false;
}

// El código va a la caja
function pistolaACaja(cod) {
  const enCaja = typeof _movEnterBuscador === 'function' && !!document.getElementById('mov-fi-desc');
  if (!enCaja) {
    location.href = 'caja.html?action=venta&scan=' + encodeURIComponent(cod);
    return;
  }
  const modal = document.getElementById('mov-modal');
  const abierta = modal && !modal.classList.contains('hidden');
  if (!abierta && typeof openMovFormType === 'function') openMovFormType('ingreso');
  // Recién abierta, el formulario tarda un instante en quedar listo
  setTimeout(() => _movEnterBuscador(cod), abierta ? 0 : 350);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', e => {
    const cod = pistolaTecla(e, (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    if (!cod) return;
    e.preventDefault();
    if (pistolaEnStock(cod)) return;
    // Un IMEI que no es de ningún celular del stock: a la caja no va (allá se
    // cargaría como un artículo llamado "3567…")
    if (/^\d{15}$/.test(cod)) { if (typeof toast === 'function') toast(`No hay ningún celular con el IMEI ${cod}`, 'error'); return; }
    pistolaACaja(cod);
  }, true);
}
