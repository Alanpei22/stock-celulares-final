// Página pública de accesorios (/accesorios). Sin login, sin Firebase: lee
// /api/accesorios, que ya viene filtrado (sin costos ni stock exacto).
//
// Lo central es "¿Qué celu tenés?": escribís "A54" y aparecen las fundas y
// vidrios que dicen "Para: A54" (campo "Para qué celu" del inventario) y,
// aparte, lo que sirve para cualquier celu (cargadores, cables…). La regla
// para comparar modelos es la misma que usa la app con los repuestos:
// palabras enteras ("A54" no es "A5") y sin variantes de más ("13" no es
// "13 Pro"). Si lo escrito no es un modelo ("funda negra"), busca por texto.
(function () {
  'use strict';

  const WA = '5491172392511';
  const S = { lista: [], cat: '', q: '', cargado: false };
  const $ = id => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const waLink = txt => `https://wa.me/${WA}?text=${encodeURIComponent(txt)}`;
  const plata = n => '$ ' + Math.round(n).toLocaleString('es-AR');

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Marcas y palabras de relleno: "Samsung Galaxy A54 5G" y "A54" son lo mismo
  const SACAR = new Set(['samsung', 'galaxy', 'motorola', 'moto', 'apple', 'iphone', 'xiaomi', '5g', '4g', 'lte', 'celu', 'celular', 'para', 'de', 'el', 'mi']);
  const VARIANTES = ['pro', 'max', 'plus', 'mini', 'ultra', 'lite', 'fe', 'neo', 'prime', 'power', 'play', 'edge'];
  const toks = s => norm(s).split(' ').filter(t => t && !SACAR.has(t));

  // ¿Esta entrada de "Para qué celu" ("iPhone 13", "A54") es del modelo escrito?
  // `prefijo`: la última palabra puede estar a medio escribir ("a5" → A54).
  function coincide(entrada, qt, prefijo) {
    const et = toks(entrada);
    if (!qt.length || !et.length) return false;
    const ok = qt.every((t, i) => et.includes(t) || (prefijo && i === qt.length - 1 && et.some(w => w.startsWith(t))));
    return ok && !VARIANTES.some(v => et.includes(v) && !qt.includes(v));
  }

  // → { modo: 'todo' | 'modelo' | 'texto', grupos: [{ titulo, sub, items }] }
  function buscar(lista, q, cat) {
    const base = cat ? lista.filter(a => a.categoria === cat) : lista;
    const qn = norm(q);
    if (!qn) return { modo: 'todo', grupos: [{ items: base }] };
    const qt = toks(q);
    if (qt.length) {
      const deModelo = pre => base.filter(a => a.compat.length && a.compat.some(e => coincide(e, qt, pre)));
      let comp = deModelo(false);
      if (!comp.length) comp = deModelo(true);
      if (comp.length) {
        const univ = base.filter(a => !a.compat.length);
        return { modo: 'modelo', grupos: [
          { titulo: `Para tu ${String(q).trim()}`, items: comp },
          univ.length ? { titulo: 'Sirven para cualquier celu', sub: 'Cargadores, cables, auriculares y más', items: univ } : null,
        ].filter(Boolean) };
      }
    }
    const pal = qn.split(' ');
    const items = base.filter(a => {
      const h = norm([a.nombre, a.categoria, a.compat.join(' '), a.detalle].join(' '));
      return pal.every(p => h.includes(p));
    });
    return { modo: 'texto', grupos: [{ items }] };
  }

  // Categoría del inventario → nombre corto y emoji para la página
  const CATS = [
    [/funda|cover/i, '🛡️', 'Fundas'], [/vidrio|templad|hidrogel/i, '📱', 'Vidrios y hidrogel'],
    [/cargador|cabezal/i, '🔌', 'Cargadores'], [/cable/i, '🔗', 'Cables'], [/auricular/i, '🎧', 'Auriculares'],
    [/parlante/i, '🔊', 'Parlantes'], [/joystick|gamer/i, '🎮', 'Joysticks'], [/reloj|watch/i, '⌚', 'Relojes'],
    [/soporte|holder/i, '🚗', 'Soportes'], [/power ?bank|bateria externa/i, '🔋', 'Power banks'],
  ];
  function catInfo(c) {
    const x = CATS.find(([re]) => re.test(c || ''));
    return x ? { ico: x[1], nom: x[2] } : { ico: '✨', nom: c || 'Otros' };
  }

  function ficha(a, qModelo) {
    const ci = catInfo(a.categoria);
    const foto = a.fotos.length
      ? `<button type="button" class="acc-foto" data-ver="${esc(a.id)}" aria-label="Ver fotos de ${esc(a.nombre)}">
          <img src="${esc(a.fotos[0])}" alt="${esc(a.nombre)}" loading="lazy">${a.fotos.length > 1 ? `<span class="acc-n">1/${a.fotos.length}</span>` : ''}</button>`
      : `<div class="acc-sin-foto" aria-hidden="true">${ci.ico}</div>`;
    const para = a.compat.length ? `Para: <b>${a.compat.map(esc).join(' · ')}</b>` : 'Sirve para cualquier celu';
    const precio = a.precio ? `<span class="acc-precio">${plata(a.precio)}</span>` : '<span class="acc-precio consultar">Consultá el precio</span>';
    const disp = a.disponibilidad === 'ultimas' ? '<span class="acc-disp ultimas">Últimas unidades</span>' : '<span class="acc-disp">Hay stock</span>';
    const msg = `Hola TechPoint! Quiero: ${a.nombre}${a.precio ? ` (${plata(a.precio)})` : ''}.`
      + (qModelo ? ` Mi celu es ${qModelo}.` : '') + ' ¿Me lo reservan para pasar a buscarlo?';
    return `<article class="acc-ficha">${foto}
      <div class="acc-cuerpo">
        <span class="acc-cat">${ci.ico} ${esc(ci.nom)}</span>
        <h3 class="acc-nom">${esc(a.nombre)}</h3>
        <span class="acc-para">${para}</span>
        ${a.detalle ? `<span class="acc-para">${esc(a.detalle)}</span>` : ''}
        <div class="acc-precio-fila">${precio}${disp}</div>
        <a class="acc-quiero" href="${waLink(msg)}" target="_blank" rel="noopener">Lo quiero</a>
      </div>
    </article>`;
  }

  // ── Pintar ────────────────────────────────────────────────
  function pintarCats() {
    const box = $('f-cats');
    if (!box) return;
    const cuenta = {};
    S.lista.forEach(a => { cuenta[a.categoria] = (cuenta[a.categoria] || 0) + 1; });
    const cats = Object.keys(cuenta).sort((x, y) => cuenta[y] - cuenta[x]);
    box.innerHTML = cats.length < 2 ? '' : [`<button type="button" data-c="" class="${S.cat ? '' : 'on'}">Todo</button>`]
      .concat(cats.map(c => { const ci = catInfo(c); return `<button type="button" data-c="${esc(c)}" class="${S.cat === c ? 'on' : ''}">${ci.ico} ${esc(ci.nom)}</button>`; }))
      .join('');
  }

  function pintar() {
    const g = $('grilla');
    if (!g) return;
    if (!S.cargado) return;
    if (!S.lista.length) {
      g.innerHTML = `<div class="vacio"><b>Muy pronto, acá.</b>Estamos cargando los accesorios con sus fotos. Mientras, preguntanos lo que buscás.
        <a class="btn-wa" href="${waLink('Hola TechPoint! Quería consultar por un accesorio.')}" target="_blank" rel="noopener">Preguntar por WhatsApp</a></div>`;
      return;
    }
    const r = buscar(S.lista, S.q, S.cat);
    const total = r.grupos.reduce((n, x) => n + x.items.length, 0);
    if (!total) {
      const q = String(S.q || '').trim();
      g.innerHTML = `<div class="vacio"><b>No lo encontramos${q ? ` para "${esc(q)}"` : ''}.</b>Puede que lo tengamos y todavía no esté en la página: preguntanos.
        <a class="btn-wa" href="${waLink(`Hola TechPoint! ¿Tienen accesorios para ${q || 'mi celu'}?`)}" target="_blank" rel="noopener">Preguntar por WhatsApp</a>
        <button type="button" class="limpiar" data-limpiar>Ver todos los accesorios</button></div>`;
      return;
    }
    const qModelo = r.modo === 'modelo' ? String(S.q).trim() : '';
    g.innerHTML = r.grupos.map(gr =>
      (gr.titulo ? `<h3 class="acc-sub">${esc(gr.titulo)}${gr.sub ? `<small>${esc(gr.sub)}</small>` : ''}</h3>` : '')
      + gr.items.map(a => ficha(a, qModelo)).join('')).join('');
  }

  // ── Visor de fotos ────────────────────────────────────────
  function abrirVisor(id) {
    const a = S.lista.find(x => x.id === id);
    if (!a || !a.fotos.length) return;
    $('visor-pista').innerHTML = a.fotos.map(u => `<img src="${esc(u)}" alt="${esc(a.nombre)}">`).join('');
    $('visor').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function cerrarVisor() {
    const v = $('visor');
    if (!v || v.classList.contains('hidden')) return;
    v.classList.add('hidden');
    $('visor-pista').innerHTML = '';
    document.body.style.overflow = '';
  }

  // El video de arriba: igual que en /equipos (arranca solo al verse; con
  // "reducir movimiento" o "ahorro de datos", queda la portada con play)
  function heroVideo(v) {
    let quieto = false;
    try { quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !!(navigator.connection && navigator.connection.saveData); } catch (e) {}
    if (quieto) { v.controls = true; return; }
    v.muted = true;
    const play = () => { const p = v.play(); if (p && p.catch) p.catch(() => { v.controls = true; }); };
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? play() : v.pause())), { threshold: 0.25 }).observe(v);
    } else play();
  }

  // La búsqueda queda en el link (?q=A54): se puede compartir, y la página de
  // equipos puede mandar directo a los accesorios de un modelo
  function ponerQ(q, desdeHero) {
    S.q = String(q || '').slice(0, 60);
    const h = $('h-buscar'), f = $('f-buscar');
    if (h && document.activeElement !== h) h.value = S.q;
    if (f && document.activeElement !== f) f.value = S.q;
    try {
      const u = new URL(location.href);
      if (S.q.trim()) u.searchParams.set('q', S.q.trim()); else u.searchParams.delete('q');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    pintar();
    if (desdeHero) { const c = $('catalogo'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth' }); }
  }

  function enganchar() {
    const vid = $('hero-video');
    if (vid && typeof vid.play === 'function') heroVideo(vid);
    $('cab-wa').href = waLink('Hola TechPoint! Quería consultar por un accesorio.');
    document.querySelectorAll('[data-wa]').forEach(a => { a.href = waLink(a.getAttribute('data-wa')); });
    const flot = $('wa-flotante');
    if (flot) {
      const ver = () => flot.classList.toggle('oculto', (window.scrollY || 0) < 420);
      window.addEventListener('scroll', ver, { passive: true }); ver();
    }
    $('h-form').addEventListener('submit', ev => { ev.preventDefault(); ponerQ($('h-buscar').value, true); });
    let t;
    $('f-buscar').addEventListener('input', ev => { clearTimeout(t); t = setTimeout(() => ponerQ(ev.target.value), 150); });
    $('f-cats').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      S.cat = b.dataset.c || ''; pintarCats(); pintar();
    });
    $('grilla').addEventListener('click', ev => {
      const v = ev.target.closest('[data-ver]');
      if (v) { abrirVisor(v.getAttribute('data-ver')); return; }
      if (ev.target.closest('[data-limpiar]')) { S.cat = ''; ponerQ(''); pintarCats(); }
    });
    $('visor-x').addEventListener('click', cerrarVisor);
    $('visor').addEventListener('click', ev => { if (ev.target.id === 'visor') cerrarVisor(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarVisor(); });
  }

  function cargar() {
    fetch('/api/accesorios', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        S.lista = (Array.isArray(j.accesorios) ? j.accesorios : []).map(a => ({
          ...a, compat: Array.isArray(a.compat) ? a.compat : [], fotos: Array.isArray(a.fotos) ? a.fotos : [],
        }));
        S.cargado = true;
        const act = $('actualizado');
        if (act) act.textContent = S.lista.length ? `${S.lista.length} accesorios · precios de hoy` : '';
        pintarCats();
        pintar();
      })
      .catch(e => {
        console.error(e);
        const g = $('grilla');
        if (g) g.innerHTML = `<div class="vacio"><b>No pudimos cargar los accesorios.</b>Probá de nuevo en un rato o escribinos.
          <a class="btn-wa" href="${waLink('Hola TechPoint! Quería consultar por un accesorio.')}" target="_blank" rel="noopener">Escribinos por WhatsApp</a></div>`;
      });
  }

  // Para los tests (tests/test-accesorios.js)
  if (typeof globalThis !== 'undefined') globalThis.ACC = { norm, toks, coincide, buscar, ficha, catInfo, S, pintar };

  if (typeof document !== 'undefined' && $('grilla') && typeof fetch === 'function') {
    enganchar();
    try { const q = new URLSearchParams(location.search).get('q'); if (q) ponerQ(q); } catch (e) {}
    cargar();
  }
})();
