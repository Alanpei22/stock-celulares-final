// Página pública de equipos (/equipos). Sin login, sin Firebase: solo lee
// /api/equipos, que ya viene filtrado (sin costos ni IMEI) y ordenado.
(function () {
  'use strict';

  const WA = '5491172392511';
  const S = { equipos: [], cond: '', marca: '', q: '' };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const waLink = txt => `https://wa.me/${WA}?text=${encodeURIComponent(txt)}`;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // "iPhone" + "iPhone 13" no tiene que quedar "iPhone iPhone 13"
  function nombreEquipo(e) {
    const repite = e.marca && norm(e.modelo).startsWith(norm(e.marca));
    return [repite ? '' : e.marca, e.modelo, e.capacidad].filter(Boolean).join(' ');
  }

  function mensajeInteres(e) {
    return `Hola TechPoint! Me interesa el ${nombreEquipo(e)} (${e.condicion === 'nuevo' ? 'nuevo' : 'usado'}) que vi en la página de equipos. ¿Sigue disponible?`;
  }
  function mensajeParecido(e) {
    return `Hola TechPoint! Vi en la página que el ${nombreEquipo(e)} (${e.condicion === 'nuevo' ? 'nuevo' : 'usado'}) ya no está. ¿Tienen uno parecido?`;
  }

  function precioHtml(e) {
    if (!e.precio) return '<span class="consultar">Consultar precio</span>';
    const n = Math.round(e.precio).toLocaleString('es-AR');
    return `<span class="precio mono"><small>${e.moneda === 'usd' ? 'U$S' : '$'}</small>${n}</span>`;
  }

  function fichaHtml(e, i) {
    const fotos = e.fotos || [];
    const tagEst = e.estado === 'reservado' ? '<span class="tag tag-est tag-res">Reservado</span>'
                 : e.estado === 'sinstock' ? '<span class="tag tag-est tag-sin">Sin stock</span>' : '';
    const pista = fotos.length
      ? fotos.map((u, k) => `<img src="${esc(u)}" alt="${esc(nombreEquipo(e))}, foto ${k + 1}" ${i > 1 || k ? 'loading="lazy"' : ''} decoding="async" data-k="${k}">`).join('')
      : '<div class="sin-foto">📱</div>';
    const flechas = fotos.length > 1
      ? '<button type="button" class="flecha izq" data-dir="-1" aria-label="Foto anterior">‹</button><button type="button" class="flecha der" data-dir="1" aria-label="Foto siguiente">›</button>' : '';
    const specs = [e.capacidad, e.color].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('');
    const bat = e.bateria
      ? `<div class="bat mono">🔋 ${e.bateria}% <div class="barra"><i class="${e.bateria < 75 ? 'baja' : e.bateria < 85 ? 'media' : ''}" style="width:${e.bateria}%"></i></div></div>` : '';
    const gar = e.garantiaMeses ? `<span class="garantia mono">Garantía<br>${e.garantiaMeses} ${e.garantiaMeses === 1 ? 'mes' : 'meses'}</span>` : '';
    const boton = e.estado === 'sinstock'
      ? `<a class="btn-wa btn-parecido" href="${esc(waLink(mensajeParecido(e)))}" target="_blank" rel="noopener">🔁 Pedir uno parecido</a>`
      : `<a class="btn-wa" href="${esc(waLink(mensajeInteres(e)))}" target="_blank" rel="noopener">💬 Me interesa</a>`;
    return `<article class="ficha ${e.estado}" data-id="${esc(e.id)}">
      <div class="fotos">
        <div class="pista">${pista}</div>
        <span class="tag tag-cond">${esc(e.condicionTexto || (e.condicion === 'nuevo' ? 'Nuevo' : 'Usado'))}</span>${tagEst}
        ${fotos.length > 1 ? `<span class="cont mono">1 / ${fotos.length}</span>` : ''}${flechas}
      </div>
      <div class="cuerpo">
        ${e.marca ? `<div class="marca">${esc(e.marca)}</div>` : ''}
        <h2 class="modelo">${esc(e.modelo)}</h2>
        ${specs ? `<div class="specs mono">${specs}</div>` : ''}
        ${bat}
        ${e.detalles ? `<p class="det">${esc(e.detalles)}</p>` : ''}
        <div class="precio-fila">${precioHtml(e)}${gar}</div>
        ${boton}
      </div>
    </article>`;
  }

  function filtrados() {
    const q = norm(S.q).split(/\s+/).filter(Boolean);
    return S.equipos.filter(e => {
      if (S.cond && e.condicion !== S.cond) return false;
      if (S.marca && e.marca !== S.marca) return false;
      if (q.length) {
        // "128gb" tiene que encontrar "128 GB": se compara también sin espacios
        const h = norm([e.marca, e.modelo, e.capacidad, e.color, e.detalles].join(' '));
        const junto = h.replace(/\s/g, '');
        return q.every(t => h.includes(t) || junto.includes(t));
      }
      return true;
    });
  }

  function pintar() {
    const g = $('grilla');
    if (!S.equipos.length) {
      g.innerHTML = `<div class="vacio"><b>Estamos cargando equipos nuevos</b>
        Escribinos y te contamos qué tenemos hoy.
        <a class="btn-wa" href="${esc(waLink('Hola TechPoint! ¿Qué equipos tienen disponibles?'))}" target="_blank" rel="noopener">💬 Consultar por WhatsApp</a></div>`;
      return;
    }
    const lista = filtrados();
    if (!lista.length) {
      g.innerHTML = `<div class="vacio"><b>No encontramos ese equipo</b>
        Capaz lo tenemos y todavía no está en la página.
        <a class="btn-wa" href="${esc(waLink(`Hola TechPoint! ¿Tienen ${S.q ? S.q : 'algún equipo'}${S.marca ? ' ' + S.marca : ''}?`))}" target="_blank" rel="noopener">💬 Preguntar por WhatsApp</a>
        <br><button type="button" class="limpiar" id="limpiar">Ver todos</button></div>`;
      $('limpiar').onclick = () => { S.cond = ''; S.marca = ''; S.q = ''; $('f-buscar').value = ''; pintarFiltros(); pintar(); };
      return;
    }
    g.innerHTML = lista.map(fichaHtml).join('');
  }

  function pintarFiltros() {
    document.querySelectorAll('#f-cond button').forEach(b => b.classList.toggle('on', b.dataset.c === S.cond));
    // Las marcas salen de lo que hay, las más cargadas primero
    const cuenta = {};
    S.equipos.forEach(e => { if (e.marca) cuenta[e.marca] = (cuenta[e.marca] || 0) + 1; });
    const marcas = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a] || a.localeCompare(b));
    const box = $('f-marcas');
    box.style.display = marcas.length > 1 ? '' : 'none';
    box.innerHTML = ['', ...marcas].map(m =>
      `<button type="button" data-m="${esc(m)}" class="${m === S.marca ? 'on' : ''}">${m ? esc(m) : 'Todas'}</button>`).join('');
  }

  // ── Carrusel: contador al deslizar, flechas en la compu, zoom al tocar ──
  function alDeslizar(pista) {
    const cont = pista.parentElement.querySelector('.cont');
    if (!cont) return;
    const n = pista.children.length;
    const k = Math.min(n - 1, Math.max(0, Math.round(pista.scrollLeft / pista.clientWidth)));
    cont.textContent = `${k + 1} / ${n}`;
  }

  function abrirVisor(id, k) {
    const e = S.equipos.find(x => x.id === id);
    if (!e || !e.fotos.length) return;
    const v = $('visor'), p = $('visor-pista');
    p.innerHTML = e.fotos.map(u => `<div><img src="${esc(u)}" alt=""></div>`).join('');
    v.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    p.scrollLeft = p.clientWidth * k;
    const cont = () => { $('visor-cont').textContent = e.fotos.length > 1 ? `${Math.round(p.scrollLeft / p.clientWidth) + 1} / ${e.fotos.length}` : ''; };
    p.onscroll = cont; cont();
    history.pushState({ visor: 1 }, '');
  }
  function cerrarVisor(desdeAtras) {
    const v = $('visor');
    if (v.classList.contains('hidden')) return;
    v.classList.add('hidden');
    $('visor-pista').innerHTML = '';
    document.body.style.overflow = '';
    if (!desdeAtras && history.state && history.state.visor) history.back();
  }

  function enganchar() {
    $('cab-wa').href = waLink('Hola TechPoint! Quería hacer una consulta.');
    $('f-cond').onclick = ev => {
      const b = ev.target.closest('button'); if (!b) return;
      S.cond = b.dataset.c; pintarFiltros(); pintar();
    };
    $('f-marcas').onclick = ev => {
      const b = ev.target.closest('button'); if (!b) return;
      S.marca = b.dataset.m; pintarFiltros(); pintar();
    };
    let t;
    $('f-buscar').oninput = ev => { clearTimeout(t); t = setTimeout(() => { S.q = ev.target.value; pintar(); }, 120); };
    const g = $('grilla');
    g.addEventListener('scroll', ev => { if (ev.target.classList && ev.target.classList.contains('pista')) alDeslizar(ev.target); }, true);
    g.addEventListener('click', ev => {
      const fl = ev.target.closest('.flecha');
      if (fl) {
        const pista = fl.parentElement.querySelector('.pista');
        pista.scrollBy({ left: pista.clientWidth * Number(fl.dataset.dir), behavior: 'smooth' });
        return;
      }
      const img = ev.target.closest('.pista img');
      if (img) abrirVisor(img.closest('.ficha').dataset.id, Number(img.dataset.k) || 0);
    });
    $('visor-x').onclick = () => cerrarVisor(false);
    window.addEventListener('popstate', () => cerrarVisor(true));
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarVisor(false); });
  }

  async function cargar() {
    try {
      const r = await fetch('/api/equipos');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      S.equipos = Array.isArray(j.equipos) ? j.equipos : [];
      pintarFiltros();
      pintar();
    } catch (e) {
      console.error('equipos:', e);
      $('grilla').innerHTML = `<div class="vacio"><b>No pudimos cargar los equipos</b>
        Probá de nuevo en un ratito, o escribinos directo.
        <a class="btn-wa" href="${esc(waLink('Hola TechPoint! ¿Qué equipos tienen disponibles?'))}" target="_blank" rel="noopener">💬 Consultar por WhatsApp</a></div>`;
    }
  }

  // Para los tests
  if (typeof window !== 'undefined') window._equipos = { S, fichaHtml, filtrados, mensajeInteres, mensajeParecido, pintar };

  enganchar();
  cargar();
})();
