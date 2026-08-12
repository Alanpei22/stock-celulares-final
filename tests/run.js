#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  Corre todas las pruebas de la app.  →  npm test
// ══════════════════════════════════════════════════════════════
//  La app maneja plata y está detrás de un login, así que no se puede probar
//  desde el navegador de forma automática. En su lugar cada prueba carga los
//  archivos de verdad (caja.js, repairs.js, print.js…) dentro de una sandbox
//  de node, con un Firestore y un DOM falsos, y revisa lo que hacen.
//
//  Si una falla, NO pushear: producción se deploya sola con el push.
// ══════════════════════════════════════════════════════════════
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const QUE_CUBRE = {
  'test-carrito.js':          'Caja: cobrar reparación y productos juntos, montos separados',
  'test-fases.js':            'Tablero de fases, SLA, avisos push y seguimiento del QR',
  'test-cupo.js':             'Cupo de Firebase: qué colecciones lee la app al abrirse',
  'test-qr.js':               'Generador de QR (incluye un lector que lo decodifica)',
  'test-fase3.js':            'Página pública del cliente y datos que expone',
  'test-venta-a5.js':         'Comprobantes A5: recepción y venta (original + copia)',
  'test-barra.js':            'Barra de pasos en la app y en la página del cliente',
  'test-push-sw.js':          'Notificaciones: cómo las muestra el service worker',
  'test-sync.js':             'Indicador de sincronización',
  'test-repuesto-nombre.js':  'Repuestos en caja: que se vea y se guarde el modelo',
  'test-retiro-dueno.js':     'Retiro dueño: no es gasto, no baja el total del mes',
  'test-mp-mail.js':          'Filtro de mails de MercadoPago (script de Gmail)',
};

const archivos = fs.readdirSync(__dirname)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'))
  .sort();

let fallaron = [];
const t0 = Date.now();

for (const f of archivos) {
  const desc = QUE_CUBRE[f] || '';
  process.stdout.write(`\n── ${f}${desc ? '  ·  ' + desc : ''}\n`);
  try {
    const salida = execFileSync(process.execPath, [path.join(__dirname, f)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const oks = (salida.match(/^ {2}OK/gm) || []).length;
    console.log(`   ✅ ${oks} chequeos`);
  } catch (e) {
    fallaron.push(f);
    const salida = (e.stdout || '') + (e.stderr || '');
    // Mostrar solo lo que falló, no las 40 líneas que pasaron
    const malas = salida.split('\n').filter(l => /FAIL|Error|error:/.test(l));
    console.log('   ❌ FALLÓ');
    malas.slice(0, 12).forEach(l => console.log('      ' + l.trim()));
  }
}

const seg = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n' + '─'.repeat(60));
if (fallaron.length) {
  console.log(`❌ ${fallaron.length} de ${archivos.length} fallaron: ${fallaron.join(', ')}`);
  console.log('   NO pushear hasta arreglarlo (el push deploya a producción).');
  process.exit(1);
}
console.log(`✅ Las ${archivos.length} pruebas pasaron  ·  ${seg}s`);
