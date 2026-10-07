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

// ── Antes de nada: los finales de línea ──
// Varias pruebas buscan trozos de código con saltos adentro. Si el checkout
// dejó CRLF (Windows con autocrlf), no matchean y salen 4 fallas que no tienen
// nada que ver con el código. Pasó: media hora buscando un bug inexistente.
(function avisarCRLF() {
  try {
    const muestra = fs.readFileSync(path.join(__dirname, '..', 'escaner.js'), 'utf8');
    if (!muestra.includes('\r\n')) return;
    console.log('\n⚠️  Los archivos están con fin de línea CRLF y varias pruebas no van a matchear.');
    console.log('   Se arregla una vez:  git config core.autocrlf false && git rm --cached -r . && git reset --hard\n');
  } catch {}
})();

const QUE_CUBRE = {
  'test-boleta-wa.js':        'Boleta de reparación: imprimir, descargar o mandar por WhatsApp como imagen',
  'test-wa-app.js':          'WhatsApp: abrir la app de escritorio directo, sin la página de wa.me',
  'test-comprobante-venta.js': 'Comprobante de venta 58mm: número propio, "no válido como factura", imprimir o WhatsApp',
  'test-inv-seleccion.js':    'Accesorios: seleccionar varios para modificar o eliminar en masa',
  'test-orden.js':            'N° de orden: corregirlo al editar y arreglar el contador',
  'test-costos-usd.js':       'Costo de accesorios en dólares y carga de costos en lista',
  'test-qz.js':              'Impresión directa con QZ Tray: cada cosa a su impresora, y el diálogo si falla',
  'test-carga-inventario.js':'Cargar accesorios: costo en $ o u$, alta en cadena y etiquetas de hoy',
  'test-css-orden.js':       'Que el desorden del CSS no crezca: selectores repetidos y reglas tapadas',
  'test-estilo-pantallas.js':'Que las pantallas se vean como el resto de la app (buscadores, colores)',
  'test-pagina-arranca.js':  'Que cada pagina arranque: sus scripts leidos juntos, como el navegador',
  'test-una-sola-copia.js':  'Una sola copia de toast, menu y modo oscuro (y lo borrado sigue borrado)',
  'test-etiquetas-barcode.js': 'Etiquetas con codigo de barras: equipo, articulo y reparacion',
  'test-resumen-telegram.js': 'Resumen de las 19:15 por Telegram: taller, equipos vendidos y plata',
  'test-chequeo.js':         'Chequeo de caja obligatorio: horarios, traba la app y conteo a ciegas',
  'test-roles.js':           'Roles: qué ve un empleado y qué no (pantalla + reglas de Firestore)',
  'test-modo-oscuro.js':     'Modo oscuro: una sola paleta y contraste medido de los textos',
  'test-cobro-escaneo.js':   'Cobrar escaneando: accesorio, repuesto, equipo o boleta',
  'test-mov-form.js':        'Formulario de la caja: categoría obligatoria y sin pasos numerados',
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
  'test-api-auth.js':         'Que ninguna función de /api quede abierta a internet',
  'test-costo-opcional.js':   'Entregar una reparación sin que el costo sea obligatorio',
  'test-falla.js':            'La falla que declara el cliente: se guarda y va a la boleta',
  'test-arreglos.js':         'Varias reparaciones por equipo, con precio y tilde de hecha',
  'test-motivo-nova.js':      'Por qué no va: la categoría del cierre y su desglose',
  'test-cross-pagina.js':     'Que una pantalla no llame a algo que su página no carga',
  'test-repwiz.js':           'Los 3 pasos del ingreso: que no se pierda ningún campo',
  'test-venta-comprador.js':  'Datos del comprador en el comprobante de venta de equipos',
  'test-card-chips.js':       'Botones de la card: cuáles salen en cada estado',
  'test-avisos.js':           'Campanita de novedades: agrupado, globito y cupo',
  'test-stats-periodo.js':    'Estadisticas por periodo a medida (y su costo de cupo)',
  'test-arca.js':             'Conexion con ARCA: firma, entornos y que la fase 1 no emita',
  'test-mp-mail.js':          'Filtro de mails de MercadoPago (script de Gmail)',
  'test-wa-plantillas.js':    'Mensajes de WhatsApp por fase y su editor en la ficha',
  'test-venta-articulos.js':'Sumar un articulo a la venta de un equipo o al cobro de una reparacion',
  'test-venta-caja.js':       'Vender un equipo desde la caja y su comprobante A5',
  'test-entrega.js':          '"¿Se lleva el equipo?": el cartel al cobrar y al pasar a Listo',
  'test-dolar-bar.js':        'Barra del dólar en la caja: compra, venta y con qué convierte',
  'test-imei.js':             'Validación de IMEI: 15 dígitos y verificador Luhn',
  'test-lista-equipos.js':    'Lista de equipos para WhatsApp desde el stock filtrado',
  'test-buscar-ventas.js':    'Buscador de ventas: acentos, monto, fecha y filtro por tipo',
  'test-buscar-orden.js':     'Buscar una reparación por número de orden al cobrar',
  'test-caja-auditoria.js':   'Auditoría de la caja: desglose del día y borrado de movimientos',
  'test-reparaciones-estados.js': 'Reparaciones: card = ficha, cobro del saldo, garantía y equipos viejos abiertos',
  'test-demorados.js':       'Demorados: una sola cuenta en lista, card, inicio y estadísticas',
  'test-escaner-lectura.js': 'Que el lector LEA un código de barras de verdad (ZXing real)',
  'test-etiquetas.js':       'Etiquetas de equipos: hoja A4 con precio y QR del IMEI',
  'test-lote.js':            'Ingreso por lote: escanear varios, borrador y guardado en bloque',
  'test-modelo-imei.js':     'Qué equipo es, a partir del IMEI (historial propio + tabla TAC)',
  'test-imei-camara.js':     'Leer el IMEI con la cámara sin cargar el código equivocado',
  'test-escaner.js':         'Leer códigos de barras con la cámara y cargar al inventario',
  'test-sin-cupo.js':        'Ingresar un equipo aunque Firebase no conteste (cupo agotado)',
  'test-stock-vendidos.js':  'Stock en dos partes: lo del local en vivo, lo vendido on-demand',
  'test-planes.js':           'Planes de ahorro, reservas y que la seña no se cuente dos veces',
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
