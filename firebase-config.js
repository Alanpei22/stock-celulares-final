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
  if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
  return firebase.firestore();
}

// Devuelve la instancia de Auth (requiere firebase-auth-compat.js en HTML).
function _fbAuth() {
  if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
  return firebase.auth();
}
