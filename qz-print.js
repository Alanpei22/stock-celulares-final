// ══════════════════════════════════════════════════════════════
//  qz-print.js — Impresión directa con QZ Tray
//  ─────────────────────────────────────────────────────────────
//  Chrome no deja que una página imprima sola ni que elija la impresora:
//  siempre abre el diálogo, y propone la última impresora usada. Con dos
//  impresoras (la de hojas y la XPrinter) había que cambiarla a mano en cada
//  impresión.
//
//  QZ Tray es un programa gratuito que se instala en la PC del local y escucha
//  en localhost. La app le manda la impresión con el nombre de la impresora y
//  sale directo, sin diálogo. Se configura por dispositivo (🖨️ Impresión
//  directa, en el menú): en la tablet o el celular no hay QZ Tray y todo
//  sigue con el diálogo de siempre.
//
//  Lo que se manda es una IMAGEN de cada página, no el HTML: QZ Tray dibuja el
//  HTML con su propio navegador (viejo, a 96 dpi) y el código de barras de un
//  IMEI necesita barras de 0,25mm. Acá se dibuja con el Chrome de la PC a la
//  resolución de la impresora, así sale igual que en la vista previa.
//
//  Si QZ Tray no está abierto o algo falla, se cae al diálogo de siempre:
//  nunca se queda un ingreso sin hoja.
// ══════════════════════════════════════════════════════════════
'use strict';

const _QZ_KEY = 'qzImpresoras';

function qzImpresoras() {
  try {
    const c = JSON.parse(localStorage.getItem(_QZ_KEY) || '{}');
    return { hoja: c.hoja || '', etiqueta: c.etiqueta || '' };
  } catch { return { hoja: '', etiqueta: '' }; }
}
function _qzGuardar(c) {
  try { localStorage.setItem(_QZ_KEY, JSON.stringify({ hoja: c.hoja || '', etiqueta: c.etiqueta || '' })); } catch {}
}
function qzActivo(tipo) { return !!qzImpresoras()[tipo]; }

// ── Conexión ────────────────────────────────────────────────
// qz-tray.js se carga recién cuando hace falta: en los dispositivos sin QZ
// Tray no se baja nunca.
let _qzLib = null;
function _qzCargarLib() {
  if (window.qz) return Promise.resolve();
  if (_qzLib) return _qzLib;
  _qzLib = new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'vendor/qz-tray.js';
    s.onload = ok;
    s.onerror = () => { _qzLib = null; mal(new Error('no cargó qz-tray.js')); };
    document.head.appendChild(s);
  });
  return _qzLib;
}

let _qzSeguridadLista = false;
function _qzSeguridad() {
  if (_qzSeguridadLista) return;
  _qzSeguridadLista = true;
  // El certificado es público (qz-cert.pem). La firma se hace en el server con
  // la clave privada (api/qz-sign.js). Si el server no tiene la clave, QZ
  // Tray igual imprime pero pregunta "¿Permitir?" una vez por sesión.
  qz.security.setCertificatePromise((ok, mal) => {
    fetch('qz-cert.pem', { cache: 'no-store' })
      .then(r => r.ok ? r.text() : '')
      .then(ok, () => ok(''));
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise(datos => (ok) => {
    apiFetch('/api/qz-sign', { method: 'POST', body: JSON.stringify({ data: datos }) })
      .then(r => r.ok ? r.json() : {})
      .then(j => ok((j && j.signature) || ''), () => ok(''));
  });
}

let _qzConectando = null;
async function qzConectar() {
  await _qzCargarLib();
  _qzSeguridad();
  if (qz.websocket.isActive()) return true;
  if (!_qzConectando) {
    _qzConectando = qz.websocket.connect({ retries: 1, delay: 1 })
      .finally(() => { _qzConectando = null; });
  }
  await _qzConectando;
  return true;
}

// ── HTML → imágenes, una por página ─────────────────────────
// Se arma el documento en un iframe escondido (así corre el auto-ajuste de la
// A5), y cada página (`selector`) se dibuja aparte sobre un canvas con un SVG
// <foreignObject>. `anchoMm`×`altoMm` es el área que ocupa en el papel.
async function _qzPaginasPng(html, selector, anchoMm, altoMm, dpi, byn) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${anchoMm + 20}mm;height:${altoMm + 20}mm;border:0;visibility:hidden`;
  document.body.appendChild(f);
  try {
    const w = f.contentWindow, d = w.document;
    d.open(); d.write(html); d.close();
    // Igual que al imprimir: el load se escucha después de escribir, porque
    // document.open() borra los listeners de antes.
    if (d.readyState !== 'complete') await new Promise(r => w.addEventListener('load', r, { once: true }));
    if (d.fonts && d.fonts.ready) await d.fonts.ready;

    const ser = new XMLSerializer();
    const estilos = [...d.querySelectorAll('style')].map(s => ser.serializeToString(s)).join('');
    const PX = 96 / 25.4;
    const wPx = Math.round(anchoMm * PX), hPx = Math.round(altoMm * PX);
    const escala = dpi / 96;
    const paginas = [];
    for (const el of d.querySelectorAll(selector)) {
      const xhtml = `<html xmlns="http://www.w3.org/1999/xhtml"><head>${estilos}</head>` +
        `<body style="margin:0;width:${anchoMm}mm">${ser.serializeToString(el)}</body></html>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}">` +
        `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.round(wPx * escala); c.height = Math.round(hPx * escala);
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.scale(escala, escala);
      x.drawImage(img, 0, 0);
      // Térmica: solo blanco o negro. Los bordes suavizados de las barras
      // salen como puntos sueltos y el lector se confunde.
      if (byn) {
        const px = x.getImageData(0, 0, c.width, c.height);
        const p = px.data;
        for (let i = 0; i < p.length; i += 4) {
          const v = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) < 160 ? 0 : 255;
          p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
        }
        x.putImageData(px, 0, 0);
      }
      paginas.push(c.toDataURL('image/png').split(',')[1]);
    }
    return paginas;
  } finally {
    f.remove();
  }
}

// ── Imprimir ────────────────────────────────────────────────
// tipo 'hoja': los comprobantes A5 (cada .tk es una hoja).
// tipo 'etiqueta': la etiquetadora (cada .pag es una etiqueta), en el sentido
// elegido en 📐 — el mismo tamaño de página que ya le funciona al driver.
// Devuelve true si salió por QZ Tray; false si hay que usar el diálogo.
let _qzUltimoError = '';
async function qzImprimir(tipo, html) {
  const impresora = qzImpresoras()[tipo];
  if (!impresora) return false;
  let pag;
  if (tipo === 'hoja') {
    pag = { selector: '.tk', ancho: 134, alto: 196, papelAncho: 148, papelAlto: 210, margen: 7, dpi: 200, byn: false };
  } else {
    if (typeof etqEsA4 === 'function' && etqEsA4()) return false;   // la hoja A4 va por el diálogo
    const parada = typeof etqFormato === 'function' && etqFormato() === '30x40';
    const a = parada ? 30 : 40, h = parada ? 40 : 30;
    pag = { selector: '.pag', ancho: a, alto: h, papelAncho: a, papelAlto: h, margen: 0, dpi: 203, byn: true };
  }
  try {
    await qzConectar();
    const pngs = await _qzPaginasPng(html, pag.selector, pag.ancho, pag.alto, pag.dpi, pag.byn);
    if (!pngs.length) throw new Error('no se armó ninguna página');
    const cfg = qz.configs.create(impresora, {
      units: 'mm',
      size: { width: pag.papelAncho, height: pag.papelAlto },
      margins: pag.margen,
      scaleContent: true,
      colorType: pag.byn ? 'blackwhite' : 'default',
      interpolation: 'nearest-neighbor',
      jobName: tipo === 'hoja' ? 'TechPoint · hoja' : 'TechPoint · etiqueta',
    });
    await qz.print(cfg, pngs.map(b64 => ({ type: 'pixel', format: 'image', flavor: 'base64', data: b64 })));
    return true;
  } catch (e) {
    console.error('QZ Tray:', e);
    _qzUltimoError = (e && e.message) || String(e);
    if (typeof toast === 'function') {
      toast('🖨️ ' + impresora + ': ' + _qzUltimoError + ' · sale el diálogo de siempre', 'error');
    }
    return false;
  }
}

// ── Configurar (menú → 🖨️ Impresión directa) ────────────────
async function configurarImpresoras() {
  if (typeof closeSheet === 'function') closeSheet();
  let lista;
  try {
    await qzConectar();
    lista = await qz.printers.find();
  } catch (e) {
    console.error('QZ Tray:', e);
    alert('No encontré QZ Tray en esta PC.\n\n' +
      '1. Bajalo gratis de qz.io/download e instalalo.\n' +
      '2. Abrilo (queda como ícono al lado del reloj).\n' +
      '3. Volvé a tocar 🖨️ Impresión directa.\n\n' +
      'Mientras tanto se sigue imprimiendo con el diálogo de siempre.');
    return;
  }
  lista = (Array.isArray(lista) ? lista : [lista]).filter(Boolean);
  if (!lista.length) { alert('QZ Tray no ve ninguna impresora en esta PC.'); return; }

  const actual = qzImpresoras();
  const menu = lista.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const elegir = (para, ahora) => {
    const pos = lista.indexOf(ahora);
    const r = prompt(`Impresora para ${para}:\n\n${menu}\n\n0. Ninguna (usar el diálogo de siempre)\n\nNúmero:`,
                     pos >= 0 ? String(pos + 1) : '');
    if (r === null) return null;
    const n = Number(String(r).trim());
    if (n === 0) return '';
    return lista[n - 1] !== undefined ? lista[n - 1] : null;
  };

  const hoja = elegir('las HOJAS (comprobante A5)', actual.hoja);
  if (hoja === null) return;
  const etiqueta = elegir('las ETIQUETAS (XPrinter)', actual.etiqueta);
  if (etiqueta === null) return;
  _qzGuardar({ hoja, etiqueta });
  if (typeof toast === 'function') {
    toast('🖨️ Hojas: ' + (hoja || 'diálogo') + ' · Etiquetas: ' + (etiqueta || 'diálogo'), 'success');
  }
  if ((hoja || etiqueta) && confirm('¿Imprimo una prueba en cada impresora elegida?')) qzPrueba();
}

// Prueba de punta a punta: lo mismo que sale al ingresar un equipo, con una
// reparación inventada. Si algo falla dice QUÉ, en vez de caer al diálogo
// callado y dejarte sin saber por qué no imprime solo.
async function qzPrueba() {
  const rep = { id: 'prueba', nOrden: 'PRUEBA', marca: 'Prueba', modelo: 'de impresión', nombre: 'TechPoint',
    falla: 'Si esto salió sin diálogo, la impresión directa anda.', arreglo: '', monto: 0, sena: 0,
    fechaIngreso: new Date().toISOString(), accesorios: '', observaciones: '', checklist: {} };
  const c = qzImpresoras(), res = [];
  if (c.hoja && typeof _buildA5 === 'function') {
    res.push('Hoja (' + c.hoja + '): ' + (await qzImprimir('hoja', _buildA5(rep)) ? 'OK' : 'FALLÓ — ' + _qzUltimoError));
  }
  if (c.etiqueta && typeof _hojaEtiquetas === 'function') {
    res.push('Etiqueta (' + c.etiqueta + '): ' +
      (await qzImprimir('etiqueta', _hojaEtiquetas([rep], _etiquetaRepHtml, 'hoja--rep')) ? 'OK' : 'FALLÓ — ' + _qzUltimoError));
  }
  alert('Prueba de impresión directa\n\n' + res.join('\n') + '\n\n' + await qzDiagnosticoConfianza());
}

function qzMenuSub() {
  const c = qzImpresoras();
  return (c.hoja || c.etiqueta) ? 'Con QZ Tray, sin diálogo' : 'Imprimir sin el diálogo (QZ Tray)';
}

// ¿Por qué QZ Tray pregunta "¿Permitir?"? Confía sin preguntar solo si la
// firma del server coincide con el certificado que tiene instalado. Esto
// revisa la parte que se puede ver desde la app: el certificado publicado y
// que el server firme (si no hay clave en Vercel, firma vacía = pregunta).
async function qzDiagnosticoConfianza() {
  const out = [];
  try {
    const r = await fetch('qz-cert.pem', { cache: 'no-store' });
    const t = r.ok ? await r.text() : '';
    out.push(/BEGIN CERTIFICATE/.test(t) ? '✔ Certificado publicado' : '✘ No se encuentra qz-cert.pem en la app');
  } catch { out.push('✘ No se pudo leer qz-cert.pem'); }
  try {
    const r = await apiFetch('/api/qz-sign', { method: 'POST', body: JSON.stringify({ data: 'prueba' }) });
    const j = r.ok ? await r.json() : {};
    if (r.status === 401) out.push('✘ Firma: la sesión no fue aceptada (cerrá sesión y volvé a entrar)');
    else if (j.signature) out.push('✔ Firma: el server firma bien');
    else if (j.skipped) out.push('✘ Firma: falta QZ_PRIVATE_KEY en Vercel (o no se hizo Redeploy después de cargarla)');
    else out.push('✘ Firma: el server respondió ' + r.status + (j.error ? ' (' + j.error + ')' : ''));
  } catch (e) { out.push('✘ Firma: no se pudo llamar al server'); }
  if (out.every(l => l.startsWith('✔'))) {
    out.push('Si igual pregunta: falta override.crt en C:\\Program Files\\QZ Tray\\ o reiniciar QZ Tray (clic derecho → Exit y abrirlo de nuevo).');
  }
  return 'Confianza:\n' + out.join('\n');
}

