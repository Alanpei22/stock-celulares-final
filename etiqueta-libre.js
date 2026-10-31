// ══════════════════════════════════════════════════════════════
//  🏷️ ETIQUETA EN BLANCO — la que dice lo que vos quieras
// ══════════════════════════════════════════════════════════════
//  Las otras etiquetas salen de algo cargado: un equipo, un repuesto, una
//  reparación. Esta no: escribís los renglones y sale. Para rotular un cajón,
//  una caja, el equipo de un cliente, una góndola, lo que haga falta.
//
//  Usa la MISMA etiquetadora y el mismo tamaño que el resto (el que esté
//  elegido en "Sentido de la etiqueta"), así no hay que cambiar el rollo ni
//  la configuración para imprimir una.
//
//  Si escribís un código, abajo sale su código de barras: sirve para rotular
//  algo que después se escanea. Si no, el lugar se lo quedan los renglones.
'use strict';

const ETQL_KEY = 'etqLibre';          // lo último que se imprimió, en este aparato
const ETQL_MAX = 4;                   // renglones: más no entran en 40×30

let ETQL = { titulo: '', lineas: ['', '', ''], codigo: '', copias: 1 };

function _etqlCargar() {
  try {
    const d = JSON.parse(localStorage.getItem(ETQL_KEY) || 'null');
    if (d && typeof d === 'object') {
      ETQL = { titulo: d.titulo || '', lineas: Array.isArray(d.lineas) ? d.lineas.slice(0, ETQL_MAX - 1) : ['', '', ''],
               codigo: d.codigo || '', copias: Math.max(1, Math.min(20, Number(d.copias) || 1)) };
      while (ETQL.lineas.length < 3) ETQL.lineas.push('');
    }
  } catch {}
  return ETQL;
}

function _etqlGuardar() {
  try { localStorage.setItem(ETQL_KEY, JSON.stringify(ETQL)); } catch {}
}

function _etqlEsc(v) {
  return (typeof _escEtq === 'function') ? _escEtq(v)
    : String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ¿Hay algo para imprimir? Una etiqueta en blanco no sirve a nadie.
function etqlVacia(d) {
  const x = d || ETQL;
  return !String(x.titulo || '').trim() && !(x.lineas || []).some(l => String(l || '').trim())
    && !String(x.codigo || '').trim();
}

// El dibujo. Reusa las clases de las otras etiquetas (print.js), así entra en
// cualquiera de los tamaños sin tocar nada más.
function etiquetaLibreHtml(d) {
  const x = d || ETQL;
  const titulo = String(x.titulo || '').trim();
  const lineas = (x.lineas || []).map(l => String(l || '').trim()).filter(Boolean);
  const cod = String(x.codigo || '').trim();
  // Las barras solo si el código entra en el ancho del rollo. Si no entra,
  // igual se imprime el código escrito: es mejor que no imprimir nada.
  const entra = cod && (typeof etqCodigoEntra !== 'function' || etqCodigoEntra(cod, _etqlAncho()));
  return `<div class="etq">
    ${titulo ? `<div class="etq-eq">${_etqlEsc(titulo)}</div>` : ''}
    ${lineas.map(l => `<div class="etq-libre-l">${_etqlEsc(l)}</div>`).join('')}
    ${cod && !entra ? `<div class="etq-cod">${_etqlEsc(cod)}</div>` : ''}
    ${entra && typeof _barrasEtq === 'function' ? _barrasEtq(cod, _etqlAncho(), 9, false) : ''}
  </div>`;
}

function _etqlAncho() {
  return (typeof _etqAncho === 'function') ? _etqAncho() : 38.4;
}

// El renglón suelto no existe en el CSS de las etiquetas: se agrega acá, en
// el mismo documento que se imprime.
const _ETQL_CSS = `
.etq-libre-l{font-size:7pt;line-height:1.25;margin-top:.4mm;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hoja .etq-libre-l{font-size:8.5pt}`;

function etiquetaLibreDoc(d) {
  if (typeof _hojaEtiquetas !== 'function') return '';
  const copias = Math.max(1, Math.min(20, Number((d || ETQL).copias) || 1));
  const items = [];
  for (let i = 0; i < copias; i++) items.push(d || ETQL);
  const html = _hojaEtiquetas(items, etiquetaLibreHtml);
  // El estilo del renglón entra en el mismo <style> que ya trae la hoja.
  return html.replace('</style>', _ETQL_CSS + '</style>');
}

function etiquetaLibreImprimir() {
  if (etqlVacia()) { toast('Escribí algo para la etiqueta', 'info'); return; }
  _etqlGuardar();
  const html = etiquetaLibreDoc();
  if (!html) { toast('No se puede imprimir desde acá', 'error'); return; }
  if (typeof _imprimirTocando === 'function') _imprimirTocando('etiqueta', html, 'Etiqueta');
  else if (typeof _openPrint === 'function') _openPrint(html, 'Etiqueta');
}

// ══════════════════════════════════════════════════════════
//  EL CUADRO
// ══════════════════════════════════════════════════════════
function etiquetaLibreAbrir() {
  const modal = document.getElementById('etql-modal');
  if (!modal) return;
  _etqlCargar();
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v == null ? '' : v; };
  set('etql-titulo', ETQL.titulo);
  set('etql-l1', ETQL.lineas[0]);
  set('etql-l2', ETQL.lineas[1]);
  set('etql-l3', ETQL.lineas[2]);
  set('etql-codigo', ETQL.codigo);
  set('etql-copias', ETQL.copias);
  etqlPintar();
  document.getElementById('etql-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('etql-titulo')?.focus(), 150);
}

function etiquetaLibreCerrar() {
  document.getElementById('etql-overlay')?.classList.add('hidden');
  document.getElementById('etql-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function etqlCampo() {
  const v = id => (document.getElementById(id)?.value || '');
  ETQL.titulo = v('etql-titulo');
  ETQL.lineas = [v('etql-l1'), v('etql-l2'), v('etql-l3')];
  ETQL.codigo = v('etql-codigo').trim();
  ETQL.copias = Math.max(1, Math.min(20, parseInt(v('etql-copias'), 10) || 1));
  etqlPintar();
}

function etqlLimpiar() {
  ETQL = { titulo: '', lineas: ['', '', ''], codigo: '', copias: 1 };
  _etqlGuardar();
  etiquetaLibreAbrir();
}

// La vista previa es UNA etiqueta del documento de verdad, achicada. Lo que se
// ve es lo que sale: mismo HTML, mismo CSS, mismo tamaño.
function etqlPintar() {
  const marco = document.getElementById('etql-prev');
  const wrap = document.getElementById('etql-prev-wrap');
  const btn = document.getElementById('etql-imprimir');
  if (btn) btn.disabled = etqlVacia();
  const nota = document.getElementById('etql-nota');
  if (nota) {
    const fmt = (typeof etqFormato === 'function' && typeof ETQ_FORMATO_NOMBRE === 'object')
      ? ETQ_FORMATO_NOMBRE[etqFormato()] : '';
    const cod = String(ETQL.codigo || '').trim();
    const entra = !cod || typeof etqCodigoEntra !== 'function' || etqCodigoEntra(cod, _etqlAncho());
    nota.textContent = (fmt ? 'Sale en: ' + fmt + '. ' : '')
      + (cod && !entra ? 'Ese código es muy largo para las barras: va escrito.' : '');
  }
  if (!marco || !wrap) return;
  if (etqlVacia()) { marco.removeAttribute('srcdoc'); return; }
  _etqlAcomodarPrev(marco, wrap);
  marco.srcdoc = etiquetaLibreDoc({ ...ETQL, copias: 1 });
}

// La etiqueta sale GIRADA en el papel: el rollo de 30×40 entra parado y la
// etiqueta se imprime de costado. En pantalla eso se lee dado vuelta, así que
// el marco se gira al revés. Se mira el documento de verdad, derecho.
function _etqlAcomodarPrev(marco, wrap) {
  const f = (typeof etqFormato === 'function') ? etqFormato() : '40x30';
  if (f === 'a4') {
    // En A4 la hoja entera no sirve de vista previa: se achica para que entre.
    marco.style.width = '794px'; marco.style.height = '420px';
    marco.style.transform = 'scale(' + Math.min(1, (wrap.clientWidth || 300) / 794).toFixed(3) + ')';
    marco.style.transformOrigin = 'top left';
    wrap.style.height = Math.round(420 * Math.min(1, (wrap.clientWidth || 300) / 794)) + 'px';
    return;
  }
  const PX = 96 / 25.4;                       // milímetros a pixeles
  const parada = f === '30x40';
  const w = Math.round((parada ? 30 : 40) * PX);
  const h = Math.round((parada ? 40 : 30) * PX);
  const giro = parada ? -90 : (f === '40x30r' ? 180 : 0);
  marco.style.width = w + 'px';
  marco.style.height = h + 'px';
  marco.style.transformOrigin = 'center center';
  marco.style.transform = `scale(2) rotate(${giro}deg)`;
  wrap.style.height = Math.round((parada ? w : h) * 2) + 20 + 'px';
}
