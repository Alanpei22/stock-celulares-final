// ══════════════════════════════════════════════════════════════
// 👥 Empleados — cuentas de cada empleado, desde la app
// ══════════════════════════════════════════════════════════════
// Solo el dueño (y con PIN). Crea la cuenta con usuario corto ("nacho") y
// contraseña; el empleado entra con eso en login.html. Todo pasa por
// /api/usuarios, que es el único que puede marcar una cuenta como empleado.
//
// Qué ve y qué no un empleado: EMPLEADOS.md / roles.js.

let _empLista = [];
let _empDominio = 'techpoint.local';

function _empEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }

async function _empApi(datos) {
  const r = await apiFetch('/api/usuarios', { method: 'POST', body: JSON.stringify(datos) });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
  return j;
}

// Contraseña provisoria fácil de dictar: 2 palabras + 2 números
function empClaveSugerida() {
  const p = ['sol', 'mate', 'luna', 'rio', 'pan', 'cafe', 'nube', 'tren', 'gato', 'faro', 'mar', 'pino'];
  const r = n => Math.floor(Math.random() * n);
  return p[r(p.length)] + p[r(p.length)] + (10 + r(90));
}

// "Nacho Pérez" → "nacho"
function empUsuarioSugerido(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0].toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]/g, '');
}

function abrirEmpleados() {
  if (typeof closeSheet === 'function') closeSheet();
  const abrir = () => {
    _empCerrar();
    const ov = document.createElement('div');
    ov.id = 'emp-modal';
    ov.className = 'emp-ov';
    ov.innerHTML = `<div class="emp-caja" role="dialog" aria-label="Empleados">
        <div class="emp-cab"><h3>👥 Empleados</h3><button type="button" class="emp-x" onclick="_empCerrar()">✕</button></div>
        <p class="emp-ayuda">Cada empleado entra con su usuario desde su celu. Con 🔐 elegís qué puede hacer cada uno.</p>
        <div id="emp-lista" class="emp-lista"><p class="emp-vacio">Cargando…</p></div>
        <form id="emp-form" class="emp-form" autocomplete="off" onsubmit="event.preventDefault(); empCrear()">
          <h4>＋ Nuevo empleado</h4>
          <label>Nombre <input id="emp-nombre" class="fi" maxlength="30" placeholder="Nacho" oninput="_empSugerirUsuario()"></label>
          <label>Usuario <span class="emp-usr"><input id="emp-usuario" class="fi" maxlength="40" placeholder="nacho" autocapitalize="none" spellcheck="false"></span></label>
          <label>Contraseña provisoria
            <span class="emp-clave"><input id="emp-clave" class="fi" maxlength="64"><button type="button" class="btn-secondary" onclick="document.getElementById('emp-clave').value = empClaveSugerida()" title="Otra">🎲</button></span>
          </label>
          <details class="emp-perm-det"><summary>🔐 Qué puede hacer</summary><div id="emp-perm-nuevo" class="emp-perms"></div></details>
          <button type="submit" class="btn-primary" id="emp-crear">Crear cuenta</button>
        </form>
        <div id="emp-listo" class="emp-listo hidden"></div>
      </div>`;
    ov.addEventListener('click', e => { if (e.target === ov) _empCerrar(); });
    document.body.appendChild(ov);
    document.getElementById('emp-clave').value = empClaveSugerida();
    _empPintarCasillas('emp-perm-nuevo', null);
    empCargar();
  };
  if (typeof requireOwnerPin === 'function') requireOwnerPin(abrir, 'PIN de dueño para administrar empleados');
  else abrir();
}

function _empCerrar() { document.getElementById('emp-modal')?.remove(); }

let _empUsuarioTocado = false;
function _empSugerirUsuario() {
  const u = document.getElementById('emp-usuario');
  if (!u) return;
  if (!u.dataset.escuchando) { u.dataset.escuchando = '1'; u.addEventListener('input', () => { _empUsuarioTocado = !!u.value; }); }
  if (!_empUsuarioTocado) u.value = empUsuarioSugerido(document.getElementById('emp-nombre').value);
}

async function empCargar() {
  const box = document.getElementById('emp-lista');
  if (!box) return;
  try {
    const j = await _empApi({ accion: 'listar' });
    _empLista = j.empleados || [];
    _empDominio = j.dominio || _empDominio;
    _empPintar();
  } catch (e) {
    box.innerHTML = `<p class="emp-vacio">No se pudo cargar la lista: ${_empEsc(e.message)}</p>`;
  }
}

function _empFecha(iso) {
  if (!iso) return 'nunca entró';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const dias = Math.floor((Date.now() - d) / 864e5);
  return 'entró ' + (dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`);
}

function _empPintar() {
  const box = document.getElementById('emp-lista');
  if (!box) return;
  if (!_empLista.length) { box.innerHTML = '<p class="emp-vacio">Todavía no hay cuentas de empleado.</p>'; return; }
  box.innerHTML = _empLista.map(e => `<div class="emp-fila${e.activo ? '' : ' emp-off'}">
      <div class="emp-datos">
        <b>${_empEsc(e.nombre)}</b>${e.activo ? '' : ' <span class="emp-tag">Desactivado</span>'}
        <small>usuario <code>${_empEsc(e.usuario)}</code> · ${_empEsc(_empFecha(e.ultimoIngreso))}</small>
        <small class="emp-perm-res">${_empEsc(_empResumenPermisos(e.perms))}</small>
      </div>
      <div class="emp-perm-edit hidden" id="emp-perm-${_empEsc(e.uid)}"></div>
      <div class="emp-acc">
        <button type="button" class="btn-secondary" onclick="empPermisos('${_empEsc(e.uid)}')" title="Qué puede hacer">🔐</button>
        <button type="button" class="btn-secondary" onclick="empClave('${_empEsc(e.uid)}')" title="Cambiar contraseña">🔑</button>
        <button type="button" class="btn-secondary" onclick="empRenombrar('${_empEsc(e.uid)}')" title="Cambiar nombre">✏️</button>
        <button type="button" class="btn-secondary" onclick="empActivo('${_empEsc(e.uid)}', ${!e.activo})">${e.activo ? '⛔ Desactivar' : '✅ Activar'}</button>
      </div>
    </div>`).join('');
}

function _empMostrarDatos(titulo, nombre, usuario, clave) {
  const url = location.origin + '/login.html';
  const texto = `Hola ${nombre}! Ya tenés tu cuenta de TechPoint 📱\n\nEntrá en: ${url}\nUsuario: ${usuario}\nContraseña: ${clave}`;
  const box = document.getElementById('emp-listo');
  if (!box) return;
  box.innerHTML = `<h4>${_empEsc(titulo)}</h4>
    <p>Pasale estos datos a <b>${_empEsc(nombre)}</b>:</p>
    <pre>${_empEsc(texto)}</pre>
    <div class="emp-listo-btns">
      <button type="button" class="btn-secondary" id="emp-copiar">📋 Copiar</button>
      <button type="button" class="btn-primary" id="emp-wa">💬 Mandar por WhatsApp</button>
    </div>`;
  box.classList.remove('hidden');
  document.getElementById('emp-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(texto); toast('📋 Copiado', 'success'); } catch { toast('No se pudo copiar', 'error'); }
  };
  document.getElementById('emp-wa').onclick = () => {
    const link = 'https://wa.me/?text=' + encodeURIComponent(texto);
    if (typeof waAbrir === 'function') waAbrir(link); else window.open(link, '_blank');
  };
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function empCrear() {
  const nombre = document.getElementById('emp-nombre').value.trim();
  const usuario = document.getElementById('emp-usuario').value.trim().toLowerCase();
  const clave = document.getElementById('emp-clave').value;
  if (nombre.length < 2) { toast('Poné el nombre', 'error'); return; }
  if (!usuario) { toast('Poné el usuario', 'error'); return; }
  if (clave.length < 6) { toast('La contraseña tiene que tener al menos 6 caracteres', 'error'); return; }
  const btn = document.getElementById('emp-crear');
  btn.disabled = true; btn.textContent = 'Creando…';
  try {
    await _empApi({ accion: 'crear', nombre, usuario, clave, perms: _empLeerCasillas('emp-perm-nuevo') });
    toast(`✅ Cuenta de ${nombre} creada`, 'success');
    _empMostrarDatos('✅ Cuenta creada', nombre, usuario, clave);
    document.getElementById('emp-nombre').value = '';
    document.getElementById('emp-usuario').value = '';
    document.getElementById('emp-clave').value = empClaveSugerida();
    _empUsuarioTocado = false;
    empCargar();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Crear cuenta';
  }
}

async function empClave(uid) {
  const e = _empLista.find(x => x.uid === uid);
  if (!e) return;
  const clave = prompt(`Nueva contraseña para ${e.nombre} (mínimo 6):`, empClaveSugerida());
  if (clave === null) return;
  if (clave.length < 6) { toast('La contraseña tiene que tener al menos 6 caracteres', 'error'); return; }
  try {
    await _empApi({ accion: 'clave', uid, clave });
    toast('🔑 Contraseña cambiada', 'success');
    _empMostrarDatos('🔑 Contraseña nueva', e.nombre, e.usuario, clave);
  } catch (err) { toast(err.message, 'error'); }
}

async function empRenombrar(uid) {
  const e = _empLista.find(x => x.uid === uid);
  if (!e) return;
  const nombre = prompt('Nombre que aparece en las ventas y reparaciones:', e.nombre);
  if (nombre === null || nombre.trim() === e.nombre) return;
  try {
    await _empApi({ accion: 'nombre', uid, nombre: nombre.trim() });
    toast('✏️ Nombre cambiado (se ve la próxima vez que entre)', 'success');
    empCargar();
  } catch (err) { toast(err.message, 'error'); }
}

async function empActivo(uid, activo) {
  const e = _empLista.find(x => x.uid === uid);
  if (!e) return;
  if (!activo && !confirm(`¿Desactivar la cuenta de ${e.nombre}?\n\nNo va a poder entrar más: en menos de una hora se le corta también la sesión abierta. Lo que cargó queda igual y se puede volver a activar.`)) return;
  try {
    await _empApi({ accion: 'activo', uid, activo });
    toast(activo ? `✅ ${e.nombre} puede entrar de nuevo` : `⛔ ${e.nombre} desactivado`, 'success');
    empCargar();
  } catch (err) { toast(err.message, 'error'); }
}

// ── 🔐 Permisos ──────────────────────────────────────────────
// El catálogo está en roles.js (TP_PERMISOS). null = nunca se tocaron:
// tiene los de siempre (los `def`).
function _empPermsEfectivos(perms) {
  if (Array.isArray(perms)) return perms;
  return (typeof TP_PERMISOS_DEF !== 'undefined') ? TP_PERMISOS_DEF : [];
}

function _empResumenPermisos(perms) {
  if (typeof TP_PERMISOS === 'undefined') return '';
  const tiene = _empPermsEfectivos(perms);
  if (!tiene.length) return 'Sin permisos: solo puede mirar';
  return 'Puede: ' + TP_PERMISOS.filter(p => tiene.includes(p.k)).map(p => p.nombre.toLowerCase()).join(', ');
}

function _empPintarCasillas(idCaja, perms) {
  const box = document.getElementById(idCaja);
  if (!box || typeof TP_PERMISOS === 'undefined') return;
  const tiene = _empPermsEfectivos(perms);
  box.innerHTML = TP_PERMISOS.map(p => `<label class="emp-perm">
      <input type="checkbox" value="${p.k}" ${tiene.includes(p.k) ? 'checked' : ''}>
      <span><b>${_empEsc(p.nombre)}</b><small>${_empEsc(p.desc)}</small></span>
    </label>`).join('');
}

function _empLeerCasillas(idCaja) {
  const box = document.getElementById(idCaja);
  if (!box) return null;
  return [...box.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => c.value);
}

// Abre/cierra las casillas de ese empleado, con botón Guardar
function empPermisos(uid) {
  const e = _empLista.find(x => x.uid === uid);
  const box = document.getElementById('emp-perm-' + uid);
  if (!e || !box) return;
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  box.innerHTML = `<div id="emp-perm-c-${_empEsc(uid)}" class="emp-perms"></div>
    <div class="emp-perm-btns">
      <button type="button" class="btn-secondary" onclick="document.getElementById('emp-perm-${_empEsc(uid)}').classList.add('hidden')">Cancelar</button>
      <button type="button" class="btn-primary" onclick="empGuardarPermisos('${_empEsc(uid)}')">Guardar permisos</button>
    </div>
    <small class="emp-perm-nota">Le cambian la próxima vez que abra la app.</small>`;
  _empPintarCasillas('emp-perm-c-' + uid, e.perms);
  box.classList.remove('hidden');
}

async function empGuardarPermisos(uid) {
  const e = _empLista.find(x => x.uid === uid);
  const perms = _empLeerCasillas('emp-perm-c-' + uid);
  if (!e || !perms) return;
  try {
    await _empApi({ accion: 'permisos', uid, perms });
    e.perms = perms;
    toast(`🔐 Permisos de ${e.nombre} guardados`, 'success');
    _empPintar();
  } catch (err) { toast(err.message, 'error'); }
}
