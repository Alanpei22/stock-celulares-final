// ══════════════════════════════════════════════════════════════
//  sync-status.js — Indicador de sincronización
// ══════════════════════════════════════════════════════════════
//  La app guarda primero en el dispositivo (Firestore tiene la persistencia
//  offline activada en firebase-config.js) y sube los cambios cuando hay
//  señal. Eso ya funcionaba, pero no se veía: con el cliente enfrente no
//  sabías si lo que cargaste quedó guardado de verdad.
//
//  Esta chapita aparece SOLO cuando hay algo que decir:
//    🟡 Guardando…      → hay cambios tuyos todavía sin subir
//    🔴 Sin conexión    → el celu no tiene red (se guarda igual, no pierdas nada)
//    🟢 Sincronizado    → aparece 2 segundos cuando termina de subir y se va
//
//  De dónde sale el dato: los listeners de Firestore avisan, en cada snapshot,
//  si quedan escrituras pendientes (`metadata.hasPendingWrites`). Se reportan
//  desde reparaciones y desde caja, que son las dos cosas que mueven plata.
// ══════════════════════════════════════════════════════════════
'use strict';

const _SYNC_PEND = {};        // { fuente: true/false }
let _syncEl = null;
let _syncHideTimer = null;
let _syncLastState = 'ok';

function _syncEnsureEl() {
  if (_syncEl && document.body.contains(_syncEl)) return _syncEl;
  _syncEl = document.createElement('div');
  _syncEl.className = 'sync-pill sync-pill--hidden';
  _syncEl.setAttribute('role', 'status');
  _syncEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(_syncEl);
  return _syncEl;
}

function _syncEstado() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return Object.values(_SYNC_PEND).some(Boolean) ? 'pending' : 'ok';
}

function _syncRender() {
  const st = _syncEstado();
  const el = _syncEnsureEl();
  if (_syncHideTimer) { clearTimeout(_syncHideTimer); _syncHideTimer = null; }

  if (st === 'offline') {
    el.className = 'sync-pill sync-pill--offline';
    el.textContent = '🔴 Sin conexión · se guarda en el celu';
  } else if (st === 'pending') {
    el.className = 'sync-pill sync-pill--pending';
    el.textContent = '🟡 Guardando…';
  } else {
    // Solo se muestra el "listo" si venía de un estado feo
    if (_syncLastState === 'ok') {
      el.className = 'sync-pill sync-pill--hidden';
      el.textContent = '';
    } else {
      el.className = 'sync-pill sync-pill--ok';
      el.textContent = '🟢 Sincronizado';
      _syncHideTimer = setTimeout(() => {
        el.className = 'sync-pill sync-pill--hidden';
      }, 2000);
    }
  }
  _syncLastState = st;
}

// Lo llaman los listeners de Firestore en cada snapshot.
function syncReport(fuente, hasPendingWrites) {
  _SYNC_PEND[fuente] = !!hasPendingWrites;
  _syncRender();
}

function initSyncStatus() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online',  _syncRender);
  window.addEventListener('offline', _syncRender);
  _syncRender();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initSyncStatus);
}
