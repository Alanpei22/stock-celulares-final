// Boleta de la reparación: imprimir, descargar o mandar por WhatsApp.
// (Que la imagen se arme y se copie se probó en Chromium: acá, que cada botón
// lleve a su lugar y que el orden copiar → abrir WhatsApp no se dé vuelta.)
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');
const pr = leer('print.js'), rep = leer('repairs.js'), idx = leer('index.html');

console.log('\n1) Las tres opciones');
const menu = pr.slice(pr.indexOf('function opcionesBoletaReparacion'), pr.indexOf('function opcionesBoletaReparacion') + 900);
ok(/label: 'Imprimir'/.test(menu) && /label: 'Mandar por WhatsApp'/.test(menu) && /label: 'Descargar imagen'/.test(menu), 'imprimir, WhatsApp y descargar');
ok(/opcionesBoletaReparacion\('\$\{r\.id\}'\)/.test(rep), 'el botón 🖨 Boleta de la tarjeta abre las opciones');
ok(/onclick="whatsappBoletaReparacion\(window\._printRep\)"/.test(idx) && /onclick="descargarBoletaReparacion\(window\._printRep\)"/.test(idx), 'y están en la ficha');
ok(/onclick="printPromptBoletaWa\(\)"/.test(idx), 'y en la barra después del ingreso');

console.log('\n2) WhatsApp');
const wa = pr.slice(pr.indexOf('async function whatsappBoletaReparacion'), pr.indexOf('async function _imgAPng'));
ok(/_qzPaginasPng\(_buildA5\(rep\), '\.tk'/.test(pr), 'la imagen es la misma hoja A5 que se imprime');
ok(wa.indexOf('navigator.clipboard.write') < wa.indexOf('waAbrir(url)'), 'se copia ANTES de abrir WhatsApp (después Chrome no deja)');
ok(/if \(!copiada\) await descargarBoletaReparacion\(rep\)/.test(wa), 'si no se puede copiar, se descarga para adjuntarla');
ok(/navigator\.share\(\{ files: \[archivo\]/.test(wa), 'en el celular se comparte el archivo directo');
ok(/tpWaFono\(rep\.tlf\)/.test(wa), 'al teléfono del cliente, con 549');
ok(/upsertSeguimientoPublico/.test(pr.slice(pr.indexOf('async function _boletaImagen'), pr.indexOf('function _boletaNombre'))), 'y el QR de seguimiento queda andando');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
