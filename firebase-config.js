// ══════════════════════════════════════════
//  firebase-config.js — TechPoint
//  ÚNICA fuente de verdad para credenciales Firebase.
//  Cargar en todos los HTML después del SDK de Firebase
//  y ANTES de cualquier módulo de la app.
// ══════════════════════════════════════════
'use strict';

const FB_CONFIG = {
  apiKey:            'AIzaSyAMRkrADBxRF6rST8rNwO5IqdWneXocBsE',
  authDomain:        'stockcelustech.firebaseapp.com',
  projectId:         'stockcelustech',
  storageBucket:     'stockcelustech.firebasestorage.app',
  messagingSenderId: '140592485004',
  appId:             '1:140592485004:web:29f6b0aa0f02fdf99ba1a9'
};

// Inicializa Firebase y devuelve la instancia de Firestore.
function _fbInit() {
  if (!firebase.apps.length) {
    firebase.initializeApp(FB_CONFIG);
    // QUOTA: persistencia offline (IndexedDB). Los docs quedan cacheados en el
    // dispositivo y al recargar solo se facturan las lecturas de docs que
    // cambiaron — sin esto cada recarga re-lee TODAS las colecciones y agota
    // el cupo diario gratis ("quota exceeded" al guardar).
    // Debe ejecutarse antes de cualquier otra operación de Firestore.
    try {
      firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => {});
    } catch (e) { /* navegador sin soporte: la app sigue igual, sin caché */ }
  }
  return firebase.firestore();
}

// Devuelve la instancia de Auth (requiere firebase-auth-compat.js en HTML).
function _fbAuth() {
  if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
  return firebase.auth();
}
