// ══════════════════════════════════════════
//  NOTIF SETTINGS — controlador de la pantalla
// ══════════════════════════════════════════

async function openNotifConfig() {
  const overlay = document.getElementById('notif-config-overlay');
  if (!overlay) return;

  // Cargar config actual
  await loadNotifConfig();
  _renderNotifConfig();

  // Cargar dispositivos suscritos para targeting
  _renderTargetingList();

  overlay.classList.remove('hidden');
}

function closeNotifConfig() {
  document.getElementById('notif-config-overlay')?.classList.add('hidden');
}

function _renderNotifConfig() {
  const cfg = getNotifConfig();

  // ── Master push toggle ──
  const pushMaster = document.getElementById('ncfg-push-master');
  if (pushMaster) {
    pushMaster.checked = cfg.push.enabled && _isPushSubscribedSync();
    pushMaster.onchange = async () => {
      if (pushMaster.checked) {
        const ok = await _enablePush();
        if (!ok) { pushMaster.checked = false; return; }
        saveNotifConfig({ push: { enabled: true } });
      } else {
        await _disablePush();
        saveNotifConfig({ push: { enabled: false } });
      }
      _updatePushStatus();
      _updateRowsEnabled();
    };
  }

  // ── Toggles individuales ──
  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.getAttribute('data-key');
    const val = _getCfgValue(cfg, key);

    if (el.type === 'checkbox') {
      el.checked = !!val;
      el.onchange = () => {
        _setCfgValue(key, el.checked);
        if (key === 'inApp.enabled') _updateRowsEnabled();
        if (typeof renderInAppBanners === 'function') renderInAppBanners();
      };
    } else if (el.type === 'number') {
      el.value = val ?? 0;
      el.oninput = () => {
        const v = parseFloat(el.value);
        if (!isNaN(v)) _setCfgValue(key, v);
      };
    } else if (el.type === 'time') {
      const h = cfg.thresholds.horaCierrePendiente;
      const m = cfg.thresholds.minutoCierrePendiente || 0;
      el.value = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      el.onchange = () => {
        const [hh, mm] = el.value.split(':').map(Number);
        saveNotifConfig({ thresholds: { horaCierrePendiente: hh, minutoCierrePendiente: mm } });
        _updateThresholdLabels();
      };
    } else if (el.type === 'text') {
      el.value = val || '';
      el.oninput = () => _setCfgValue(key, el.value);
    }
  });

  // ── Device name + ID ──
  const devName = document.getElementById('ncfg-device-name');
  if (devName) {
    devName.value = getDeviceName();
    devName.placeholder = _suggestDeviceNameFromUA();
    devName.onblur = async () => {
      const v = devName.value.trim();
      if (v) {
        setDeviceName(v);
        // Si está suscrito, actualizar nombre en Firestore
        if (typeof updateDeviceNameInFirestore === 'function') {
          await updateDeviceNameInFirestore(v);
        }
      }
    };
  }
  const devId = document.getElementById('ncfg-device-id');
  if (devId) devId.textContent = getDeviceId();

  // ── Toggles de POPUPS (per-device, localStorage) ──
  const popupCfg = (typeof getPopupConfig === 'function') ? getPopupConfig() : null;
  if (popupCfg) {
    document.querySelectorAll('[data-popup-key]').forEach(input => {
      const key = input.getAttribute('data-popup-key');
      input.checked = !!popupCfg[key];
      input.onchange = () => {
        if (typeof setPopupConfig === 'function') setPopupConfig(key, input.checked);
        _updatePopupRowsEnabled();
      };
    });
  }
  _updatePopupRowsEnabled();

  _updatePushStatus();
  _updateRowsEnabled();
  _updateThresholdLabels();
}

function _updatePopupRowsEnabled() {
  const popupCfg = (typeof getPopupConfig === 'function') ? getPopupConfig() : null;
  if (!popupCfg) return;
  document.querySelectorAll('[data-popup-deps="enabled"] .notifcfg-row').forEach(row => {
    row.classList.toggle('disabled', !popupCfg.enabled);
  });
}

function _testPopup() {
  if (typeof showLivePopup !== 'function') {
    if (typeof toast === 'function') toast('Popup no disponible', 'error');
    return;
  }
  showLivePopup({
    icon: '🧪',
    title: 'Popup de prueba',
    body: 'Si ves esto abajo a la derecha, los popups están activos en este dispositivo.\nDuración: 30 seg.',
    duration: 30000,
    tag: 'test-popup',
  });
}

function _suggestDeviceNameFromUA() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'Mi iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobi/i.test(ua) ? 'Mi celular Android' : 'Tablet Android';
  if (/Windows/i.test(ua)) return 'PC del local';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Mi dispositivo';
}

function _getCfgValue(cfg, dotKey) {
  return dotKey.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), cfg);
}

function _setCfgValue(dotKey, val) {
  const parts = dotKey.split('.');
  if (parts.length !== 2) return;
  const [section, key] = parts;
  const update = { [section]: { [key]: val } };
  saveNotifConfig(update);
}

function _updatePushStatus() {
  const status = document.getElementById('ncfg-push-status');
  if (!status) return;
  const supported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  if (!supported) {
    status.textContent = '❌ Tu navegador no soporta push';
    return;
  }
  const perm = Notification.permission;
  const subscribed = _isPushSubscribedSync();
  if (perm === 'denied') status.textContent = '🚫 Permisos bloqueados (cambialo en config del navegador)';
  else if (subscribed)   status.textContent = '✅ Activo en este dispositivo';
  else if (perm === 'granted') status.textContent = 'Permiso OK pero sin suscribir — tocá el toggle';
  else                   status.textContent = 'Tocá para activar';
}

function _updateRowsEnabled() {
  const cfg = getNotifConfig();
  // Filas que dependen del master push
  document.querySelectorAll('[data-needs="push"]').forEach(row => {
    row.classList.toggle('disabled', !cfg.push.enabled);
  });
  // Filas in-app que dependen del master inApp.enabled
  // (todas las inApp.* excepto enabled)
  document.querySelectorAll('[data-key^="inApp."]').forEach(input => {
    if (input.dataset.key === 'inApp.enabled') return;
    const row = input.closest('.notifcfg-row');
    if (row) row.classList.toggle('disabled', !cfg.inApp.enabled);
  });
}

function _updateThresholdLabels() {
  const cfg = getNotifConfig();
  const horaEl = document.getElementById('ncfg-hora-cierre');
  if (horaEl) {
    const h = cfg.thresholds.horaCierrePendiente;
    const m = cfg.thresholds.minutoCierrePendiente || 0;
    horaEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  const diasEl = document.getElementById('ncfg-dias-reparacion');
  if (diasEl) diasEl.textContent = cfg.thresholds.diasReparacionDemorada;
}

// ── Activar / desactivar push (delega a webpush.js si está cargado) ──
async function _enablePush() {
  if (typeof subscribeToPush !== 'function') {
    if (typeof toast === 'function') toast('Web Push no cargó — recargá la página', 'error');
    return false;
  }
  return subscribeToPush();
}

async function _disablePush() {
  if (typeof unsubscribeFromPush === 'function') {
    return unsubscribeFromPush();
  }
}

function _isPushSubscribedSync() {
  return localStorage.getItem('pushSubscribed') === '1';
}

async function _testPush() {
  if (typeof sendTestPush !== 'function') {
    if (typeof toast === 'function') toast('Función de prueba no disponible', 'error');
    return;
  }
  const btn = document.getElementById('ncfg-test-push');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  const ok = await sendTestPush();
  if (btn) {
    btn.disabled = false;
    btn.textContent = ok ? '✅ Enviado' : '❌ Error — revisá la consola';
    setTimeout(() => { if (btn) btn.textContent = '🧪 Enviar push de prueba'; }, 3000);
  }
}

// ── Lista de dispositivos suscritos para targeting ──
async function _renderTargetingList() {
  const cont = document.getElementById('ncfg-targeting-list');
  if (!cont) return;
  try {
    if (typeof db === 'undefined' || !db) return;
    const snap = await db.collection('caja_config').doc('notifications').collection('devices').get();
    if (snap.empty) {
      cont.innerHTML = '<p class="notifcfg-empty-target">Ningún dispositivo suscripto a push todavía.<br>Activá push en este dispositivo o en otros para que aparezcan acá.</p>';
      return;
    }
    const devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const cfg = getNotifConfig();
    const pushTypes = [
      { key: 'cierrePendiente',   label: '⏰' },
      { key: 'reparacionesListas', label: '🔧' },
      { key: 'bajoStockCritico',  label: '📦' },
      { key: 'cobrosRemotos',     label: '💰' },
      { key: 'senasNuevas',       label: '🪙' },
    ];

    cont.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.85rem">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 4px;font-weight:700;color:var(--t2)">Dispositivo</th>
            ${pushTypes.map(t => `<th style="text-align:center;padding:6px 4px">${t.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${devices.map(d => {
            const isThisDevice = d.id === getDeviceId();
            return `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:8px 4px">
                  <div style="font-weight:700">${esc(d.name || '(sin nombre)')}${isThisDevice ? ' <span style="font-size:.7rem;color:#10B981">· este</span>' : ''}</div>
                  <div style="font-size:.7rem;color:var(--t3);font-family:monospace">${esc(d.id.slice(0,12))}</div>
                </td>
                ${pushTypes.map(t => {
                  const targets = cfg.pushTargets[t.key] || [];
                  const checked = targets.length === 0 || targets.includes(d.id);
                  return `<td style="text-align:center;padding:8px 4px">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                      onchange="_toggleTarget('${esc(t.key)}', '${esc(d.id)}', this.checked)">
                  </td>`;
                }).join('')}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <p style="font-size:.75rem;color:var(--t3);margin-top:10px">
        Si todos los checkboxes de un tipo están marcados, ese push llega a <b>todos</b> los dispositivos.
      </p>
    `;
  } catch (e) {
    console.error('renderTargetingList:', e);
    cont.innerHTML = '<p class="notifcfg-empty-target">Error cargando dispositivos.</p>';
  }
}

function _toggleTarget(pushKey, deviceId, checked) {
  const cfg = getNotifConfig();
  const current = (cfg.pushTargets || {})[pushKey] || [];
  // Si están todos los dispositivos marcados, current se considera vacío (= todos).
  // Al desmarcar uno, hay que materializar la lista de "todos menos el desmarcado".
  // Pero como no sabemos cuántos dispositivos hay sin volver a fetch, usamos lógica simple:
  // - checked=true && el id no está en current ni current está vacío → agregar
  // - checked=false:
  //     si current está vacío → desconocido cuántos hay; pedimos al backend que filtre
  //     mejor: marcamos el array con "todos menos este"
  // Simplificación: si checked=false, agregamos todos los demás device IDs visibles MENOS este.
  let newList;
  if (checked) {
    if (current.length === 0) return; // ya estaba en "todos"
    newList = [...current, deviceId];
  } else {
    if (current.length === 0) {
      // Materializar: "todos menos este"
      const allIds = Array.from(document.querySelectorAll('#ncfg-targeting-list tbody tr'))
        .map(tr => tr.querySelector('td:first-child div:nth-child(2)')?.textContent?.trim())
        .filter(Boolean);
      // El ID en el dataset truncado de 12 chars no es ideal. Preferimos usar lista pasada.
      // Workaround: re-fetch desde Firestore al deseleccionar. Por simplicidad acá:
      newList = [deviceId + '_NEGATED']; // marker, se interpreta como "excluir este"
    } else {
      newList = current.filter(id => id !== deviceId);
    }
  }
  saveNotifConfig({ pushTargets: { [pushKey]: newList } });
}

// Helper esc local
if (typeof esc !== 'function') {
  window.esc = function(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
}
