// ══════════════════════════════════════════════════════════════
//  🛒 Carrito de la tienda online (/equipos y /accesorios)
// ══════════════════════════════════════════════════════════════
// Alan (26/11): carrito con celulares y accesorios y pago con Mercado Pago.
// Pagar todo o dejar una seña; retiro en el local o envío sin cargo hasta 2 km.
//
// El carrito vive en este navegador (localStorage). Al pagar se manda solo
// QUÉ se compra; el precio lo calcula el servidor (api/tienda.js) con el
// stock de ese momento, y devuelve el link de Mercado Pago. Si Mercado Pago
// todavía no está configurado (o falla), el pedido sale por WhatsApp.
(function () {
  'use strict';

  const WA = '5491172392511';
  const KEY = 'tpCarrito';
  const DEF = { senaPct: 20, senaMin: 10000, envioKm: 2, mp: true };
  const T = { items: [], cfg: Object.assign({}, DEF), modo: 'total', entrega: 'retiro', enviando: false };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plata = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const waLink = txt => `https://wa.me/${WA}?text=${encodeURIComponent(txt)}`;

  function leer() {
    try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l.filter(x => x && x.id && x.tipo) : []; } catch (e) { return []; }
  }
  function guardar() { try { localStorage.setItem(KEY, JSON.stringify(T.items)); } catch (e) {} pintarBoton(); }

  // ── Agregar / sacar ──
  function agregar(it) {
    const ya = T.items.find(x => x.tipo === it.tipo && x.id === it.id);
    if (ya) {
      if (it.tipo === 'equipo') { avisar('Ese celular ya está en el carrito'); abrir(); return false; }
      ya.qty = Math.min(10, (ya.qty || 1) + 1);
    } else {
      T.items.push({ tipo: it.tipo, id: it.id, qty: 1, nombre: String(it.nombre || '').slice(0, 80),
        precio: Number(it.precio) || 0, moneda: it.moneda === 'usd' ? 'usd' : 'ars', foto: it.foto || '' });
    }
    guardar();
    avisar('🛒 Agregado al carrito');
    return true;
  }
  function cantidad(tipo, id, d) {
    const it = T.items.find(x => x.tipo === tipo && x.id === id);
    if (!it) return;
    it.qty = (it.qty || 1) + d;
    if (it.qty < 1) T.items = T.items.filter(x => x !== it);
    else it.qty = Math.min(10, it.qty);
    guardar(); pintarCarrito();
  }
  function sacar(tipo, id) { T.items = T.items.filter(x => !(x.tipo === tipo && x.id === id)); guardar(); pintarCarrito(); }
  const unidades = () => T.items.reduce((n, x) => n + (x.qty || 1), 0);

  // Lo que se ve antes de pagar. Los equipos en dólares se cobran en pesos al
  // dólar del día: el número final lo da el servidor al tocar "Pagar".
  function totales() {
    const pesos = T.items.filter(x => x.moneda !== 'usd').reduce((s, x) => s + x.precio * (x.qty || 1), 0);
    const usd = T.items.filter(x => x.moneda === 'usd').reduce((s, x) => s + x.precio * (x.qty || 1), 0);
    return { pesos, usd };
  }
  function senaEstimada(total) {
    const c = T.cfg;
    if (!(total > 0)) return 0;
    return Math.min(total, Math.max(c.senaMin, Math.round(total * c.senaPct / 100 / 100) * 100));
  }

  // ── El texto de WhatsApp con el pedido (plan B, o si no hay Mercado Pago) ──
  function textoWhatsApp(d) {
    const lineas = T.items.map(x => `• ${x.qty > 1 ? x.qty + '× ' : ''}${x.nombre}${x.precio ? ' — ' + (x.moneda === 'usd' ? 'US$ ' + x.precio : plata(x.precio * (x.qty || 1))) : ''}`);
    return ['Hola TechPoint! Quiero hacer este pedido:', ...lineas,
      d.modo === 'sena' ? 'Quiero dejar una seña.' : 'Quiero pagarlo completo.',
      d.entrega === 'envio' ? `Envío a: ${d.direccion}` : 'Lo retiro en el local.',
      d.nombre ? `Soy ${d.nombre}.` : '', d.nota ? `Nota: ${d.nota}` : ''].filter(Boolean).join('\n');
  }

  // ── Pantallas ──
  function avisar(txt) {
    let a = $('tienda-aviso');
    if (!a) { a = document.createElement('div'); a.id = 'tienda-aviso'; a.className = 'aviso'; document.body.appendChild(a); }
    a.textContent = txt; a.classList.add('ver');
    clearTimeout(avisar._t); avisar._t = setTimeout(() => a.classList.remove('ver'), 2000);
  }

  function pintarBoton() {
    if (typeof document === 'undefined' || !document.body) return;
    let b = $('carrito-btn');
    const n = unidades();
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.id = 'carrito-btn'; b.className = 'carrito-btn';
      b.setAttribute('aria-label', 'Ver el carrito');
      b.addEventListener('click', abrir);
      document.body.appendChild(b);
    }
    b.innerHTML = `🛒<span>${n}</span>`;
    b.classList.toggle('oculto', !n);
  }

  function abrir() {
    let m = $('carrito');
    if (!m) {
      m = document.createElement('div');
      m.id = 'carrito'; m.className = 'carrito-fondo';
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Tu carrito');
      m.addEventListener('click', ev => { if (ev.target === m) cerrar(); });
      document.body.appendChild(m);
    }
    m.classList.remove('oculto');
    document.body.style.overflow = 'hidden';
    pintarCarrito();
    cargarCfg();
  }
  function cerrar() { const m = $('carrito'); if (m) m.classList.add('oculto'); document.body.style.overflow = ''; }

  function datosForm() {
    const v = id => (($(id) || {}).value || '').trim();
    return { nombre: v('ct-nombre'), tlf: v('ct-tlf'), direccion: v('ct-dir'), nota: v('ct-nota'), modo: T.modo, entrega: T.entrega };
  }

  function pintarCarrito() {
    const m = $('carrito');
    if (!m) return;
    const d = $('ct-nombre') ? datosForm() : { nombre: '', tlf: '', direccion: '', nota: '' };
    if (!T.items.length) {
      m.innerHTML = `<div class="carrito"><div class="ct-cab"><h2>Tu carrito</h2><button type="button" class="ct-x" data-ct="cerrar" aria-label="Cerrar">✕</button></div>
        <p class="ct-vacio">Todavía no agregaste nada.<br>Tocá <b>🛒 Agregar al carrito</b> en un celular o un accesorio.</p></div>`;
      enganchar(m); return;
    }
    const t = totales();
    const totalTxt = t.usd ? `${t.pesos ? plata(t.pesos) + ' + ' : ''}US$ ${t.usd.toLocaleString('es-AR')}` : plata(t.pesos);
    const sena = !t.usd ? senaEstimada(t.pesos) : 0;
    m.innerHTML = `<div class="carrito">
      <div class="ct-cab"><h2>Tu carrito <small>${unidades()} ${unidades() === 1 ? 'artículo' : 'artículos'}</small></h2>
        <button type="button" class="ct-x" data-ct="cerrar" aria-label="Cerrar">✕</button></div>
      <ul class="ct-lista">${T.items.map(x => `<li>
        ${x.foto ? `<img src="${esc(x.foto)}" alt="">` : `<span class="ct-ico">${x.tipo === 'equipo' ? '📱' : '🎧'}</span>`}
        <div class="ct-info"><b>${esc(x.nombre)}</b><span>${x.moneda === 'usd' ? 'US$ ' + x.precio.toLocaleString('es-AR') : plata(x.precio)}${x.qty > 1 ? ' c/u' : ''}</span></div>
        ${x.tipo === 'accesorio'
          ? `<div class="ct-cant"><button type="button" data-ct="menos" data-t="${x.tipo}" data-id="${esc(x.id)}" aria-label="Uno menos">−</button><span>${x.qty}</span><button type="button" data-ct="mas" data-t="${x.tipo}" data-id="${esc(x.id)}" aria-label="Uno más">+</button></div>`
          : `<button type="button" class="ct-sacar" data-ct="sacar" data-t="${x.tipo}" data-id="${esc(x.id)}">Sacar</button>`}
      </li>`).join('')}</ul>
      <div class="ct-total"><span>Total</span><b>${totalTxt}</b></div>
      ${t.usd ? '<p class="ct-nota">Los precios en dólares se cobran en pesos al dólar del día: el total exacto aparece al pagar.</p>' : ''}

      <fieldset class="ct-op"><legend>¿Cómo querés pagar?</legend>
        <label><input type="radio" name="ct-modo" value="total" ${T.modo === 'total' ? 'checked' : ''}><span><b>Pagar todo</b><small>Con Mercado Pago: tarjeta, débito o dinero en cuenta</small></span></label>
        <label><input type="radio" name="ct-modo" value="sena" ${T.modo === 'sena' ? 'checked' : ''}><span><b>Dejar una seña${sena ? ' de ' + plata(sena) : ''}</b><small>El ${T.cfg.senaPct}% (mínimo ${plata(T.cfg.senaMin)}). Te lo separamos y el resto lo pagás al retirar o recibir</small></span></label>
      </fieldset>
      <fieldset class="ct-op"><legend>¿Cómo lo recibís?</legend>
        <label><input type="radio" name="ct-entrega" value="retiro" ${T.entrega === 'retiro' ? 'checked' : ''}><span><b>Retiro en el local</b><small>Urquiza 4741, Local 22, Caseros</small></span></label>
        <label><input type="radio" name="ct-entrega" value="envio" ${T.entrega === 'envio' ? 'checked' : ''}><span><b>Envío sin cargo</b><small>Hasta ${T.cfg.envioKm} km del local. Si estás más lejos, te avisamos por WhatsApp</small></span></label>
      </fieldset>
      <div class="ct-campos">
        ${T.entrega === 'envio' ? `<input id="ct-dir" class="buscar" placeholder="Dirección (calle, número, localidad)" autocomplete="street-address" value="${esc(d.direccion)}">` : ''}
        <input id="ct-nombre" class="buscar" placeholder="Tu nombre" autocomplete="name" value="${esc(d.nombre)}">
        <input id="ct-tlf" class="buscar" placeholder="Tu WhatsApp (ej: 11 2345-6789)" inputmode="tel" autocomplete="tel" value="${esc(d.tlf)}">
        <input id="ct-nota" class="buscar" placeholder="Nota (opcional): color, horario…" value="${esc(d.nota)}">
      </div>
      <p class="ct-error" id="ct-error" role="alert"></p>
      <button type="button" class="ct-pagar" data-ct="pagar" ${T.enviando ? 'disabled' : ''}>${T.enviando ? 'Abriendo Mercado Pago…' : (T.modo === 'sena' ? 'Pagar la seña con Mercado Pago' : 'Pagar con Mercado Pago')}</button>
      <button type="button" class="ct-wa" data-ct="wa">O mandá el pedido por WhatsApp</button>
    </div>`;
    enganchar(m);
  }

  function enganchar(m) {
    m.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => {
      const a = b.dataset.ct;
      if (a === 'cerrar') cerrar();
      else if (a === 'mas') cantidad(b.dataset.t, b.dataset.id, 1);
      else if (a === 'menos') cantidad(b.dataset.t, b.dataset.id, -1);
      else if (a === 'sacar') sacar(b.dataset.t, b.dataset.id);
      else if (a === 'pagar') pagar();
      else if (a === 'wa') { const d = datosForm(); window.open(waLink(textoWhatsApp(d)), '_blank', 'noopener'); }
    });
    m.querySelectorAll('input[name="ct-modo"]').forEach(r => r.onchange = () => { T.modo = r.value; pintarCarrito(); });
    m.querySelectorAll('input[name="ct-entrega"]').forEach(r => r.onchange = () => { T.entrega = r.value; pintarCarrito(); });
  }

  function error(txt) { const e = $('ct-error'); if (e) e.textContent = txt || ''; }

  // Validación de la página (el servidor vuelve a validar todo)
  function validar(d) {
    if (d.entrega === 'envio' && d.direccion.length < 5) return 'Poné la dirección para el envío';
    if (d.nombre.length < 2) return 'Poné tu nombre';
    if (d.tlf.replace(/\D+/g, '').length < 8) return 'Poné tu WhatsApp (con característica)';
    return '';
  }

  async function pagar() {
    const d = datosForm();
    const mal = validar(d);
    if (mal) { error(mal); return; }
    T.enviando = true; pintarCarrito();
    try {
      const r = await fetch('/api/tienda?accion=pedido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...d, items: T.items.map(x => ({ tipo: x.tipo, id: x.id, qty: x.qty })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) { location.href = j.url; return; }
      T.enviando = false; pintarCarrito();
      if (j.error === 'sin_mp') {
        error('Por ahora el pago online no está disponible: mandanos el pedido por WhatsApp y te lo separamos.');
      } else error(j.error || 'No se pudo abrir el pago. Probá de nuevo o mandanos el pedido por WhatsApp.');
    } catch (e) {
      T.enviando = false; pintarCarrito();
      error('Sin conexión. Probá de nuevo o mandanos el pedido por WhatsApp.');
    }
  }

  async function cargarCfg() {
    if (cargarCfg.listo) return;
    cargarCfg.listo = true;
    try {
      const r = await fetch('/api/tienda?accion=config');
      if (r.ok) { Object.assign(T.cfg, await r.json()); pintarCarrito(); }
    } catch (e) {}
  }

  // ── La vuelta desde Mercado Pago (/equipos?pedido=ID&status=...) ──
  async function vuelta() {
    let id = '', st = '';
    try { const p = new URLSearchParams(location.search); id = p.get('pedido') || ''; st = p.get('status') || p.get('collection_status') || ''; } catch (e) {}
    if (!id) return;
    let est = null;
    for (let i = 0; i < 4; i++) {
      try { const r = await fetch('/api/tienda?accion=estado&id=' + encodeURIComponent(id)); if (r.ok) est = await r.json(); } catch (e) {}
      // El aviso de Mercado Pago puede llegar unos segundos después que el cliente
      if ((est && est.estado === 'pagado') || st !== 'approved') break;
      await new Promise(r => setTimeout(r, 2500));
    }
    const pagado = (est && est.estado === 'pagado');
    const aprobado = pagado || st === 'approved';
    if (aprobado) { T.items = []; guardar(); }
    const corto = id.slice(-6).toUpperCase();
    const msg = aprobado
      ? `<b>✅ ¡Listo! Recibimos tu pago.</b>Pedido #${corto}. ${est && est.entrega === 'envio' ? 'Te escribimos por WhatsApp para coordinar el envío.' : 'Te escribimos por WhatsApp cuando esté listo para retirar.'}${est && est.modo === 'sena' ? ' El resto lo pagás al retirar o recibir.' : ''}`
      : st === 'pending' || st === 'in_process'
      ? `<b>⏳ Tu pago está en proceso.</b>Pedido #${corto}. Apenas Mercado Pago lo apruebe, te avisamos por WhatsApp.`
      : `<b>El pago no se completó.</b>Tu carrito sigue guardado: podés intentar de nuevo o mandarnos el pedido por WhatsApp.`;
    let b = $('tienda-vuelta');
    if (!b) { b = document.createElement('div'); b.id = 'tienda-vuelta'; b.className = 'tienda-vuelta'; document.body.appendChild(b); }
    b.innerHTML = `<div>${msg}<button type="button" onclick="this.closest('.tienda-vuelta').remove()">Entendido</button></div>`;
    try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) {}
  }

  // Los botones "🛒 Agregar al carrito" de las fichas (equipos.js y accesorios.js)
  function engancharFichas() {
    document.addEventListener('click', ev => {
      const b = ev.target.closest && ev.target.closest('[data-carrito]');
      if (!b) return;
      ev.preventDefault();
      agregar({ tipo: b.dataset.carrito, id: b.dataset.id, nombre: b.dataset.nombre, precio: b.dataset.precio, moneda: b.dataset.moneda, foto: b.dataset.foto });
    });
  }

  if (typeof globalThis !== 'undefined') globalThis.TIENDA = { T, agregar, cantidad, sacar, totales, senaEstimada, textoWhatsApp, validar, leer, unidades };

  if (typeof document !== 'undefined' && document.body && typeof localStorage !== 'undefined') {
    T.items = leer();
    engancharFichas();
    pintarBoton();
    vuelta();
  }
})();
