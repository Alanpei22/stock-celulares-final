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
    return { hoja: c.hoja || '', etiqueta: c.etiqueta || '', ticket: c.ticket || '' };
  } catch { return { hoja: '', etiqueta: '', ticket: '' }; }
}
function _qzGuardar(c) {
  try { localStorage.setItem(_QZ_KEY, JSON.stringify({ hoja: c.hoja || '', etiqueta: c.etiqueta || '', ticket: c.ticket || '' })); } catch {}
}
// Activo = sale sin diálogo: por una impresora de ESTA compu, o mandándolo a
// la compu de la caja (imprimir desde otro equipo, más abajo).
function qzActivo(tipo) { return !!qzImpresoras()[tipo] || qzRemotaActiva(tipo); }

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
let _qzCert = null;
function _qzSeguridad() {
  if (_qzSeguridadLista) return;
  _qzSeguridadLista = true;
  // El certificado es público (qz-cert.pem). La firma se hace en el server con
  // la clave privada (api/qz-sign.js). Si el server no tiene la clave, QZ
  // Tray igual imprime pero pregunta "¿Permitir?" una vez por sesión.
  // El certificado se baja UNA vez por sesión: QZ Tray lo pide en cada
  // conexión y no cambia.
  qz.security.setCertificatePromise((ok) => {
    if (!_qzCert) {
      _qzCert = fetch('qz-cert.pem', { cache: 'no-store' })
        .then(r => r.ok ? r.text() : '')
        .catch(() => { _qzCert = null; return ''; });
    }
    _qzCert.then(ok);
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
    const wPx = Math.round(anchoMm * PX);
    const escala = dpi / 96;
    const paginas = [];
    paginas.altos = [];
    for (const el of d.querySelectorAll(selector)) {
      // alto 'auto': el ticket mide lo que mide su contenido (rollo continuo).
      const altoEsta = altoMm === 'auto' ? Math.ceil(el.getBoundingClientRect().height / PX) + 2 : altoMm;
      const hPx = Math.round(altoEsta * PX);
      paginas.altos.push(altoEsta);
      const xhtml = `<html xmlns="http://www.w3.org/1999/xhtml"><head>${estilos}</head>` +
        // Sin padding: el margen del papel lo pone QZ (config), y si el body
        // trae el suyo el contenido se corre y se corta del otro lado.
        `<body style="margin:0;padding:0;width:${anchoMm}mm">${ser.serializeToString(el)}</body></html>`;
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
      // La hoja va en JPEG: es una foto de la página para una impresora común,
      // y pesa la mitad que el PNG (menos para mandar y para que QZ la abra).
      // La térmica sigue en PNG: blanco y negro puro, sin manchas de JPEG.
      paginas.push(c.toDataURL(byn ? 'image/png' : 'image/jpeg', 0.9).split(',')[1]);
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
// Cómo es la página de cada tipo (null: ese tipo va por el diálogo)
function _qzPagina(tipo) {
  let pag;
  if (tipo === 'hoja') {
    pag = { selector: '.tk', ancho: 134, alto: 196, papelAncho: 148, papelAlto: 210, margen: 7, dpi: 200, byn: false };
  } else if (tipo === 'ticket') {
    // Rollo de 58mm: 48mm útiles y el largo que haga falta.
    pag = { selector: '.tkt', ancho: 48, alto: 'auto', papelAncho: 58, margen: 0, dpi: 203, byn: true };
  } else {
    if (typeof etqEsA4 === 'function' && etqEsA4()) return null;   // la hoja A4 va por el diálogo
    const parada = typeof etqFormato === 'function' && etqFormato() === '30x40';
    const a = parada ? 30 : 40, h = parada ? 40 : 30;
    pag = { selector: '.pag', ancho: a, alto: h, papelAncho: a, papelAlto: h, margen: 0, dpi: 203, byn: true };
  }
  return pag;
}

// Las imágenes ya armadas → a la impresora, por QZ Tray
async function _qzMandarPngs(impresora, tipo, pag, pngs, altos) {
  await qzConectar();
  const alto = pag.alto === 'auto' ? Math.max(...altos) : pag.papelAlto;
  const cfg = qz.configs.create(impresora, {
    units: 'mm',
    size: { width: pag.papelAncho, height: alto },
    // El ticket va centrado en el rollo: 5mm a cada lado de los 48 útiles.
    margins: tipo === 'ticket' ? { top: 0, right: 5, bottom: 0, left: 5 } : pag.margen,
    scaleContent: true,
    colorType: pag.byn ? 'blackwhite' : 'default',
    interpolation: 'nearest-neighbor',
    jobName: 'TechPoint · ' + tipo,
  });
  await qz.print(cfg, pngs.map(b64 => ({ type: 'pixel', format: 'image', flavor: 'base64', data: b64 })));
}

async function qzImprimir(tipo, html) {
  const impresora = qzImpresoras()[tipo];
  // Sin impresora acá: si la compu de la caja imprime lo de los demás, va allá
  if (!impresora) return qzRemotaActiva(tipo) ? qzMandarRemoto(tipo, html) : false;
  const pag = _qzPagina(tipo);
  if (!pag) return false;
  try {
    const pngs = await _qzPaginasPng(html, pag.selector, pag.ancho, pag.alto, pag.dpi, pag.byn);
    if (!pngs.length) throw new Error('no se armó ninguna página');
    await _qzMandarPngs(impresora, tipo, pag, pngs, pngs.altos);
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
    // En un equipo sin QZ (celu, tablet): ¿hay una compu que imprima por él?
    await qzRemotaLeer();
    const r = _qzRemota();
    if (r && r.tipos && (r.tipos.hoja || r.tipos.etiqueta || r.tipos.ticket)) {
      alert('🖨️ Este equipo no tiene impresoras: lo que imprimas sale en ' + (r.nombre || 'la caja') + '.\n\n' +
        'Hojas: ' + (r.tipos.hoja ? 'sí' : 'no') + ' · Etiquetas: ' + (r.tipos.etiqueta ? 'sí' : 'no') + ' · Tickets: ' + (r.tipos.ticket ? 'sí' : 'no') + '\n\n' +
        'Tiene que estar prendida con la app abierta.');
      return;
    }
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
  const ticket = elegir('los TICKETS de venta (58mm)', actual.ticket);
  if (ticket === null) return;
  _qzGuardar({ hoja, etiqueta, ticket });
  if (typeof toast === 'function') {
    toast('🖨️ Hojas: ' + (hoja || 'diálogo') + ' · Etiquetas: ' + (etiqueta || 'diálogo') +
          ' · Tickets: ' + (ticket || 'diálogo'), 'success');
  }
  if (hoja || etiqueta || ticket) {
    // ¿Esta es la compu de la caja, la que imprime lo de los celus y las otras compus?
    const serv = confirm('¿Esta compu imprime también lo que manden los OTROS equipos (celus, tablet, otras compus)?\n\n' +
      'Aceptar = sí (tiene que quedar prendida con la app abierta) · Cancelar = no');
    if (serv !== qzEsServidor() || serv) await qzServidorConfigurar(serv);
  }
  if ((hoja || etiqueta || ticket) && confirm('¿Imprimo una prueba en cada impresora elegida?')) qzPrueba();
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
  if (c.ticket && typeof ticketVentaHtml === 'function') {
    const mov = { descripcion: 'Prueba de impresión', monto: 1000, metodoPago: 'Efectivo', fecha: '',
      items: [{ nombre: 'Si esto salió sin diálogo, anda', qty: 1, precioUnit: 1000 }] };
    res.push('Ticket (' + c.ticket + '): ' +
      (await qzImprimir('ticket', ticketVentaHtml(mov, 'PRUEBA')) ? 'OK' : 'FALLÓ — ' + _qzUltimoError));
  }
  alert('Prueba de impresión directa\n\n' + res.join('\n') + '\n\n' + await qzDiagnosticoConfianza());
}

function qzMenuSub() {
  const c = qzImpresoras();
  if (c.hoja || c.etiqueta || c.ticket) return qzEsServidor() ? 'Con QZ Tray · imprime también lo de los otros equipos' : 'Con QZ Tray, sin diálogo';
  const r = _qzRemota();
  if (r && r.tipos && (r.tipos.hoja || r.tipos.etiqueta || r.tipos.ticket)) return 'Sale en la impresora de ' + (r.nombre || 'la caja');
  return 'Imprimir sin el diálogo (QZ Tray)';
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

// ── Dejar todo listo antes de la primera impresión ──
// La primera impresión del día era la lenta: conectar con QZ Tray, bajar el
// certificado y despertar al server que firma (en Vercel, la función que no
// se usó hace rato tarda 1–3 segundos en arrancar). Se hace al abrir la app,
// en segundo plano, solo en la PC que tiene impresoras configuradas: cuando
// llega el primer ingreso, la conexión ya está abierta.
function qzPrecalentar() {
  const c = qzImpresoras();
  if (!c.hoja && !c.etiqueta && !c.ticket) return;
  qzConectar().catch(() => {});   // si QZ Tray no está, ya avisará al imprimir
  // Despierta la función que firma, para que no arranque en frío con el
  // primer ingreso. La respuesta no se usa.
  if (typeof apiFetch === 'function') {
    apiFetch('/api/qz-sign', { method: 'POST', body: JSON.stringify({ data: 'calentar' }) }).catch(() => {});
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.addEventListener) {
  window.addEventListener('load', () => setTimeout(qzPrecalentar, 1500));
}


// ══════════════════════════════════════════════════════════════
//  Imprimir desde otro equipo (celu, tablet, otra compu)
// ══════════════════════════════════════════════════════════════
// Alan: "que desde otro equipo se imprima en el equipo que tiene programadas
// las impresoras". Las impresoras (y QZ Tray) están en UNA compu, la de la
// caja. Ahora esa compu puede quedar como "la que imprime lo de los demás":
//
//  · El otro equipo arma las IMÁGENES de lo que hay que imprimir (igual que
//    para QZ, con su Chrome) y las deja en Firestore, en `cola_impresion`.
//  · La compu de la caja, con la app abierta, escucha esa cola, las manda a
//    su impresora por QZ Tray y borra el pedido.
//
// Se mandan imágenes y no el HTML a propósito: así la compu de la caja (que
// suele tener la sesión del dueño) no ejecuta nada que venga de otro equipo,
// solo imprime fotos.
//
// Si la compu de la caja está apagada, el pedido espera. Uno de más de 30
// minutos no se imprime (sería un papel viejo saliendo de golpe a la mañana)
// y se avisa.
//
// Cupo: un documento por impresión, que se borra al imprimir. La compu de la
// caja escucha solo los pendientes; los demás leen la configuración una vez.
const _QZ_SERV_KEY = 'qzServidor';
const _QZ_REMOTA_KEY = 'qzRemota';
const QZ_REMOTA_VENCE_MIN = 30;
const QZ_REMOTA_MAX_BYTES = 700000;   // Firestore admite 1 MB por documento

function qzEsServidor() { try { return localStorage.getItem(_QZ_SERV_KEY) === '1'; } catch { return false; } }

// Lo que dijo la compu de la caja: { tipos: {hoja, etiqueta, ticket}, nombre }
function _qzRemota() {
  try { return JSON.parse(localStorage.getItem(_QZ_REMOTA_KEY) || 'null'); } catch { return null; }
}
function qzRemotaActiva(tipo) {
  if (qzEsServidor()) return false;
  const r = _qzRemota();
  return !!(r && r.tipos && r.tipos[tipo]);
}
// Se lee una vez por apertura de la app (1 lectura) y queda guardada para
// poder decidir en el momento del toque, sin esperar a Firestore.
async function qzRemotaLeer() {
  if (typeof db === 'undefined' || !db) return;
  try {
    const d = await db.collection('config').doc('impresoraRemota').get();
    const v = d.exists ? d.data() : null;
    localStorage.setItem(_QZ_REMOTA_KEY, JSON.stringify(v && v.activa ? { tipos: v.tipos || {}, nombre: v.nombre || 'la caja' } : null));
  } catch (e) { /* sin permiso o sin conexión: se queda con lo último que supo */ }
}

// Parte las páginas en pedidos que entren en un documento
function qzPartirPaginas(pngs, altos, max) {
  const lim = max || QZ_REMOTA_MAX_BYTES;
  const out = [];
  let cur = { pngs: [], altos: [], bytes: 0 };
  pngs.forEach((p, i) => {
    if (p.length > lim) throw new Error('una página es demasiado grande para mandarla');
    if (cur.pngs.length && cur.bytes + p.length > lim) { out.push(cur); cur = { pngs: [], altos: [], bytes: 0 }; }
    cur.pngs.push(p); cur.altos.push(altos ? altos[i] : null); cur.bytes += p.length;
  });
  if (cur.pngs.length) out.push(cur);
  return out;
}

// ── El equipo SIN impresora: manda el pedido ──
async function qzMandarRemoto(tipo, html) {
  const pag = _qzPagina(tipo);
  if (!pag || typeof db === 'undefined' || !db) return false;
  const r = _qzRemota() || {};
  try {
    const pngs = await _qzPaginasPng(html, pag.selector, pag.ancho, pag.alto, pag.dpi, pag.byn);
    if (!pngs.length) throw new Error('no se armó ninguna página');
    const partes = qzPartirPaginas(pngs, pngs.altos);
    const de = (typeof getDeviceName === 'function' && getDeviceName()) || 'otro equipo';
    const refs = [];
    for (const parte of partes) {
      refs.push(await db.collection('cola_impresion').add({
        tipo, pag: Object.assign({}, pag), pngs: parte.pngs, altos: parte.altos,
        de, estado: 'pendiente', creado: Date.now(),
      }));
    }
    if (typeof toast === 'function') toast(`🖨️ Mandado a la impresora de ${r.nombre || 'la caja'}`, 'success');
    _qzSeguirPedido(refs[0]);
    return true;
  } catch (e) {
    console.error('impresión remota:', e);
    if (typeof toast === 'function') toast('🖨️ No se pudo mandar a la caja (' + ((e && e.message) || e) + ') · sale el diálogo', 'error');
    return false;
  }
}

// Se mira el pedido un rato para avisar si salió o si falló
function _qzSeguirPedido(ref) {
  if (!ref || typeof ref.onSnapshot !== 'function') return;
  let fin = null;
  const corte = setTimeout(() => {
    if (fin) fin();
    if (typeof toast === 'function') toast('🖨️ La compu de la caja todavía no lo imprimió: ¿está prendida con la app abierta?', 'info');
  }, 60000);
  fin = ref.onSnapshot(d => {
    if (!d.exists) { clearTimeout(corte); fin(); if (typeof toast === 'function') toast('✅ Impreso en la caja', 'success'); return; }
    const j = d.data();
    if (j.estado === 'error' || j.estado === 'vencido') {
      clearTimeout(corte); fin();
      if (typeof toast === 'function') toast('🖨️ La caja no pudo imprimirlo: ' + (j.error || j.estado), 'error');
    }
  }, () => clearTimeout(corte));
}

// ── La compu de la CAJA: imprime lo que llega ──
let _qzServUnsub = null;
let _qzServCola = Promise.resolve();
function qzServidorIniciar() {
  if (_qzServUnsub || !qzEsServidor() || typeof db === 'undefined' || !db) return;
  _qzServUnsub = db.collection('cola_impresion').where('estado', '==', 'pendiente').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type !== 'added') return;
      const ref = ch.doc.ref;
      _qzServCola = _qzServCola.then(() => qzServidorImprimir(ref)).catch(e => console.error('cola de impresión:', e));
    });
  }, e => { console.error('cola de impresión:', e); _qzServUnsub = null; });
}
async function qzServidorImprimir(ref) {
  // Se lo "toma" en una transacción: si hubiera dos compus de caja, no sale dos veces
  let job = null;
  await db.runTransaction(async t => {
    const d = await t.get(ref);
    if (!d.exists || d.data().estado !== 'pendiente') return;
    job = d.data();
    const viejo = Date.now() - (Number(job.creado) || 0) > QZ_REMOTA_VENCE_MIN * 60e3;
    t.update(ref, viejo ? { estado: 'vencido' } : { estado: 'imprimiendo' });
    if (viejo) job = null;
  });
  if (!job) return;
  const impresora = qzImpresoras()[job.tipo];
  try {
    if (!impresora) throw new Error('esta compu no tiene impresora para ' + job.tipo);
    await _qzMandarPngs(impresora, job.tipo, job.pag, job.pngs, job.altos);
    await ref.delete();
  } catch (e) {
    console.error('cola de impresión:', e);
    await ref.update({ estado: 'error', error: String((e && e.message) || e).slice(0, 200) }).catch(() => {});
  }
}

// Prender / apagar "esta compu imprime lo de los demás"
async function qzServidorConfigurar(activar) {
  const c = qzImpresoras();
  const tipos = { hoja: !!c.hoja, etiqueta: !!c.etiqueta, ticket: !!c.ticket };
  try { localStorage.setItem(_QZ_SERV_KEY, activar ? '1' : '0'); } catch {}
  const nombre = (typeof getDeviceName === 'function' && getDeviceName()) || 'la caja';
  try {
    await db.collection('config').doc('impresoraRemota').set({ activa: !!activar, tipos, nombre, desde: new Date().toISOString() });
  } catch (e) {
    if (typeof toast === 'function') toast('No se pudo guardar (¿publicaste las reglas nuevas?)', 'error');
    return;
  }
  if (activar) qzServidorIniciar();
  else if (_qzServUnsub) { _qzServUnsub(); _qzServUnsub = null; }
  if (typeof toast === 'function') toast(activar ? `🖨️ Listo: ${nombre} imprime lo que manden los otros equipos` : '🖨️ Esta compu ya no imprime lo de los demás', 'success');
}

// Al abrir la app: la caja empieza a escuchar; los demás averiguan si hay
// una compu que imprima por ellos. Se espera a que haya sesión.
function _qzRemotaArrancar(intentos) {
  const u = (typeof _fbAuth === 'function') ? (() => { try { return _fbAuth().currentUser; } catch { return null; } })() : null;
  if (!u || typeof db === 'undefined' || !db) {
    if ((intentos || 0) < 30) setTimeout(() => _qzRemotaArrancar((intentos || 0) + 1), 2000);
    return;
  }
  if (qzEsServidor()) qzServidorIniciar();
  else qzRemotaLeer();
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('load', () => setTimeout(() => _qzRemotaArrancar(0), 2500));
}
