// ══════════════════════════════════════════════════════════════
// Foto del ticket en los gastos (egresos de caja)
// ══════════════════════════════════════════════════════════════
// En un egreso aparece "🧾 Foto del ticket": se saca la foto, la IA lee qué se
// compró y cuánto salió, y completa el gasto. Si no la puede leer (foto movida,
// ticket a mano, sin internet), no pasa nada: la foto queda adjunta igual.
//
// La foto NO va adentro del movimiento: los movimientos del día se bajan todos
// juntos cada vez que se abre la caja, y 200 KB de foto por gasto lo harían
// lento. Va en su propia colección `caja_tickets` y el movimiento guarda solo
// el id (`ticketFotoId`), más lo que se leyó (`ticketItems`, `ticketProveedor`).

let _tkFoto = null;        // dataURL JPEG comprimido, pendiente de guardar
let _tkLeido = null;       // { proveedor, items, total, rubro } si la IA lo leyó
let _tkFotoIdExistente = null;   // al editar un gasto que ya tenía ticket
let _tkLeyendo = 0;        // para descartar una lectura vieja si se cambió la foto

const TK_MAX_LADO = 1400;
const TK_MAX_BYTES = 700 * 1024;   // margen holgado bajo el 1 MB de Firestore

function _tkEl(id) { return document.getElementById(id); }

// Achica la foto hasta que entre cómoda en un documento de Firestore.
function _tkComprimir(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let lado = TK_MAX_LADO, q = 0.72, url = '';
        for (let i = 0; i < 6; i++) {
          let w = img.width, h = img.height;
          const k = Math.min(1, lado / Math.max(w, h));
          w = Math.round(w * k); h = Math.round(h * k);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          url = c.toDataURL('image/jpeg', q);
          if (url.length * 0.75 <= TK_MAX_BYTES) break;
          lado = Math.round(lado * 0.8); q = Math.max(0.5, q - 0.06);
        }
        resolve(url);
      };
      img.onerror = () => reject(new Error('No se pudo abrir la foto'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

// Se llama al abrir el formulario de movimiento (nuevo o editando).
function tkReset(mov) {
  _tkFoto = null;
  _tkLeido = null;
  _tkLeyendo++;
  _tkFotoIdExistente = mov?.ticketFotoId || null;
  const inp = _tkEl('mov-tk-input');
  if (inp) inp.value = '';
  _tkPintar(mov?.ticketItems ? { proveedor: mov.ticketProveedor || '', items: mov.ticketItems } : null);
}

// Solo en egresos.
function tkMostrarSegunTipo(tipo) {
  const w = _tkEl('mov-tk-wrap');
  if (w) w.style.display = tipo === 'egreso' ? '' : 'none';
  if (tipo !== 'egreso' && _tkFoto) { _tkFoto = null; _tkLeido = null; _tkLeyendo++; _tkPintar(null); }
}

function tkSacarFoto() { _tkEl('mov-tk-input')?.click(); }

async function tkFotoElegida(input) {
  const file = input?.files?.[0];
  if (!file) return;
  let url;
  try { url = await _tkComprimir(file); }
  catch (e) { toast(e.message, 'error'); return; }
  _tkFoto = url;
  _tkLeido = null;
  _tkPintar(null, 'leyendo');
  const turno = ++_tkLeyendo;
  const ticket = await _tkLeerConIA(url);
  if (turno !== _tkLeyendo) return;   // cambiaron la foto mientras leía
  if (!ticket) {
    _tkPintar(null, 'sinleer');
    toast('No se pudo leer el ticket: queda la foto adjunta', 'info');
    return;
  }
  _tkLeido = ticket;
  _tkAplicar(ticket);
  _tkPintar(ticket);
  toast('🧾 Ticket leído: revisá el monto antes de guardar', 'success');
}

async function _tkLeerConIA(dataUrl) {
  try {
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'leerTicket',
        data: {
          imageBase64: dataUrl.split(',')[1],
          imageMediaType: 'image/jpeg',
          rubros: (typeof CATEGORIAS !== 'undefined' && CATEGORIAS.egreso) || [],
        },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.ticket || null;
  } catch (e) {
    console.warn('[ticket] no se pudo leer:', e);
    return null;
  }
}

// Completa el formulario con lo leído, sin pisar lo que ya escribió la persona.
function _tkAplicar(t) {
  const monto = _tkEl('mov-fi-monto');
  if (monto && !(parseFloat(monto.value) > 0) && t.total > 0) monto.value = t.total;
  const desc = _tkEl('mov-fi-desc');
  if (desc && !desc.value.trim()) desc.value = tkDescripcion(t);
  const cat = _tkEl('mov-hidden-cat');
  const rubros = (typeof CATEGORIAS !== 'undefined' && CATEGORIAS.egreso) || [];
  if (cat && !cat.value && t.rubro && rubros.includes(t.rubro) && typeof selectCat === 'function') selectCat(t.rubro);
  if (typeof _updateMovResumen === 'function') _updateMovResumen();
}

// "Proveedor: prod 1, 2× prod 2 +3 más" — corto, para la lista de la caja.
function tkDescripcion(t) {
  const items = (t.items || []).map(it => (it.cantidad > 1 ? it.cantidad + '× ' : '') + it.nombre);
  let txt = items.slice(0, 3).join(', ');
  if (items.length > 3) txt += ` +${items.length - 3} más`;
  if (t.proveedor) txt = txt ? `${t.proveedor}: ${txt}` : t.proveedor;
  return txt.slice(0, 140);
}

function _tkPintar(t, estado) {
  const box = _tkEl('mov-tk-info');
  const btn = _tkEl('mov-tk-btn');
  if (!box) return;
  const hayFoto = !!(_tkFoto || _tkFotoIdExistente);
  if (btn) btn.textContent = hayFoto ? '🧾 Cambiar foto' : '🧾 Foto del ticket';
  if (!hayFoto && !t) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  const fmtP = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const thumb = _tkFoto
    ? `<img src="${_tkFoto}" class="mov-tk-thumb" alt="ticket" onclick="tkVer()">`
    : (_tkFotoIdExistente ? `<button type="button" class="mov-tk-ver" onclick="tkVer()">👁️ Ver ticket</button>` : '');
  let cuerpo = '';
  if (estado === 'leyendo') cuerpo = '<span class="mov-tk-estado">⏳ Leyendo el ticket…</span>';
  else if (estado === 'sinleer') cuerpo = '<span class="mov-tk-estado">No se pudo leer — la foto queda adjunta</span>';
  else if (t && t.items?.length) {
    cuerpo = `${t.proveedor ? `<b>${esc(t.proveedor)}</b>` : ''}<ul class="mov-tk-items">${
      t.items.map(it => `<li><span>${it.cantidad > 1 ? it.cantidad + '× ' : ''}${esc(it.nombre)}</span>${it.precio ? `<span>${fmtP(it.precio)}</span>` : ''}</li>`).join('')
    }</ul>`;
  } else if (hayFoto) cuerpo = '<span class="mov-tk-estado">Foto adjunta</span>';
  const quitar = _tkFoto ? `<button type="button" class="mov-tk-x" onclick="tkQuitar()" title="Quitar foto">✕</button>` : '';
  box.innerHTML = `${thumb}<div class="mov-tk-cuerpo">${cuerpo}</div>${quitar}`;
  box.classList.remove('hidden');
}

function tkQuitar() {
  _tkFoto = null;
  _tkLeido = null;
  _tkLeyendo++;
  const inp = _tkEl('mov-tk-input');
  if (inp) inp.value = '';
  _tkPintar(null);
}

// Pantalla completa. Con un id baja la foto de Firestore.
async function tkVer(fotoId) {
  let src = !fotoId ? _tkFoto : null;
  const id = fotoId || _tkFotoIdExistente;
  if (!src && id) {
    try {
      const d = await db.collection('caja_tickets').doc(id).get();
      src = d.exists ? d.data().foto : null;
    } catch (e) { console.warn('[ticket]', e); }
  }
  if (!src) { toast('No se encontró la foto del ticket', 'error'); return; }
  const ov = document.createElement('div');
  ov.className = 'tk-visor';
  ov.innerHTML = `<img src="${src}" alt="ticket"><button type="button" class="tk-visor-x">✕</button>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

// Lo llama saveMov antes de escribir: guarda la foto y devuelve los campos del
// movimiento. Si la foto no se pudo subir, avisa pero el gasto se guarda igual.
async function tkCamposParaGuardar(tipo) {
  if (tipo !== 'egreso') return {};
  const campos = {};
  if (_tkFoto) {
    try {
      const ref = await db.collection('caja_tickets').add({
        foto: _tkFoto,
        createdAt: new Date().toISOString(),
        ...(typeof tpFirma === 'function' ? tpFirma() : {}),
      });
      campos.ticketFotoId = ref.id;
    } catch (e) {
      console.error('[ticket] no se pudo guardar la foto:', e);
      toast('No se pudo guardar la foto del ticket', 'error');
    }
  }
  if (_tkLeido) {
    campos.ticketItems = _tkLeido.items;
    if (_tkLeido.proveedor) campos.ticketProveedor = _tkLeido.proveedor;
  }
  return campos;
}
