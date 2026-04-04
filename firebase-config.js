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
// Nombre con prefijo _fb para no colisionar con initFirebase() de cada módulo.
function _fbInit() {
  if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
  return firebase.firestore();
}
