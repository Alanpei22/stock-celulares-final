// Harness sin navegador para el asistente de ingreso de equipos.
//
// Eran 5 pasos y ahora son 3: en el mostrador, con el cliente esperando,
// cinco pantallas es mucho. Se agruparon por lo que hacés, no por tipo de
// dato: el aparato que tenés en la mano → qué le vas a hacer y cuánto sale →
// quién es y cuándo lo busca.
//
// Lo que esta prueba cuida de verdad: que al mover bloques de un paso a otro
// NO se haya perdido ningún campo. saveRepair() los lee por id; si uno queda
// fuera del formulario, se guarda vacío sin avisar. Eso es plata y datos del
// cliente perdidos en silencio.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

const html = leer('index.html');
const repairs = leer('repairs.js');
const css = leer('style.css');

// Solo el formulario de alta, no el resto de index.html
const form = html.slice(html.indexOf('id="rep-form-modal"'), html.indexOf('id="rep-detail-modal"'));

console.log('\n1) Tres pasos, no cinco');
const pasos = [...form.matchAll(/data-rstep="(\d)"/g)].map(m => Number(m[1]));
ok(pasos.length === 3, 'quedaron 3 pasos', pasos);
ok(JSON.stringify(pasos) === '[1,2,3]', 'numerados 1, 2, 3 sin huecos', pasos);
const titulos = repairs.match(/const _REPWIZ_TITLES = \[([^\]]+)\]/);
ok(titulos && titulos[1].split(',').length === 3,
   'los títulos también son 3 (si no, el paso 4 quedaría inalcanzable)', titulos && titulos[1]);

console.log('\n2) No se perdió ningún campo al reacomodar');
// Todo lo que saveRepair lee tiene que existir en el formulario.
const cuerpoSave = repairs.slice(repairs.indexOf('async function saveRepair'),
                                 repairs.indexOf('async function saveRepair') + 4500);
// Solo los que lee SIN guarda: `(getElementById('x') || {}).value` es el
// patrón que usa el código para campos opcionales que pueden no existir.
// (rep-fi-presupuesto es uno de esos: se lee con guarda y nunca se agregó al
//  formulario, así que siempre guarda 0. Viene de antes, no rompe nada.)
const leidos = [];
cuerpoSave.split('\n').forEach(linea => {
  const conGuarda = /\|\|\s*\{\s*\}/.test(linea);   // `(getElementById(x) || {})`
  if (conGuarda) return;
  for (const m of linea.matchAll(/getElementById\('(rep-fi-[a-z-]+|acc-[a-z]+)'\)/g)) {
    leidos.push(m[1]);
  }
});
const unicos = [...new Set(leidos)];
ok(unicos.length > 12, 'saveRepair lee un montón de campos', unicos.length);
const perdidos = unicos.filter(id => !form.includes(`id="${id}"`));
ok(perdidos.length === 0,
   'todos los que guarda sin guarda están en el formulario', perdidos);

// Y ninguno duplicado: dos inputs con el mismo id = getElementById agarra uno
// solo y el otro se ignora en silencio.
const ids = [...form.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
ok(dup.length === 0, 'ningún id repetido en el formulario', dup);

console.log('\n3) Cada cosa en el paso que le toca');
// Los tres pasos, recortados por sus marcadores
const trozo = n => {
  const i = form.indexOf(`data-rstep="${n}"`);
  const j = form.indexOf(`<!-- /paso ${n} -->`);
  return (i >= 0 && j > i) ? form.slice(i, j) : '';
};
const p1 = trozo(1), p2 = trozo(2), p3 = trozo(3);
ok(p1 && p2 && p3, 'los tres pasos tienen su bloque cerrado');

const en = (paso, id) => paso.includes(`id="${id}"`);
// Paso 1: el aparato que tenés en la mano
['rep-fi-marca', 'rep-fi-modelo', 'rep-fi-imei', 'rep-fi-codigo', 'acc-cargador']
  .forEach(id => ok(en(p1, id), `paso 1 (el equipo) tiene ${id}`));
// El código/patrón se mudó acá: es un dato del aparato, no del arreglo.
ok(!en(p2, 'rep-fi-codigo'), 'el código ya no está en el paso del trabajo');

// Paso 2: qué se le hace y cuánto sale
['rep-fi-falla', 'rep-fi-arreglo', 'rep-fi-monto', 'rep-fi-sena', 'rep-fi-condicion']
  .forEach(id => ok(en(p2, id), `paso 2 (el trabajo) tiene ${id}`));
ok(p2.includes('rep-arreglos-list'), 'y la lista de reparaciones');
// El precio va junto a la lista que lo suma, no en una pantalla aparte.
ok(p2.indexOf('rep-arreglos-list') < p2.indexOf('rep-fi-monto'),
   'el precio va justo después de la lista que lo calcula');

// Paso 3: quién es y cuándo lo busca
['rep-fi-nombre', 'rep-fi-tlf', 'rep-fi-dni', 'rep-fi-fecha-est', 'rep-fi-garantia', 'rep-fi-tecnico']
  .forEach(id => ok(en(p3, id), `paso 3 (cliente y entrega) tiene ${id}`));

console.log('\n4) Lo que casi nunca se toca, plegado');
ok(form.includes('id="rep-extras-body"'), 'existe el bloque "Más datos"');
ok(/id="rep-extras-body"[^>]*class="[^"]*hidden/.test(form),
   'arranca plegado');
['rep-fi-costo', 'rep-fi-obs', 'rep-fi-foto', 'rep-fi-seg-fecha'].forEach(id => {
  const i = form.indexOf('id="rep-extras-body"');
  ok(form.indexOf(`id="${id}"`) > i, `${id} quedó adentro de "Más datos"`);
});
ok(/function toggleRepExtras/.test(repairs), 'y el botón que lo abre funciona');

console.log('\n5) Los pasos numerados');
ok(form.includes('id="repwiz-steps"'), 'está el contenedor de los pasos');
ok(!form.includes('repwiz-progress-fill'), 'se fue la barrita de progreso vieja');
ok(!/repwiz-lbl/.test(form), 'y el "Paso 1 de 5" suelto');
ok(!/repwiz-progress-fill|repwiz-lbl/.test(repairs),
   'repairs.js ya no toca los elementos que se borraron (si no, tira null)');
ok(/repwiz-dot--actual/.test(css) && /repwiz-dot--hecho/.test(css),
   'el CSS de los pasos existe');
ok(/function _repwizIr/.test(repairs), 'se puede volver a un paso ya hecho');

// Ir hacia adelante salteando la validación no puede pasar.
const cuerpoIr = repairs.slice(repairs.indexOf('function _repwizIr'),
                               repairs.indexOf('function _repwizIr') + 300);
ok(/i > _repwizIdx\) return/.test(cuerpoIr),
   'pero solo hacia atrás: adelante hay que pasar por la validación');

console.log('\n6) La validación sigue en los pasos correctos');
const cuerpoVal = repairs.slice(repairs.indexOf('function _repwizValidarPaso'),
                                repairs.indexOf('function _repwizValidarPaso') + 600);
ok(/_repwizIdx === 0[\s\S]{0,200}rep-fi-marca/.test(cuerpoVal),
   'el paso 1 sigue exigiendo marca y modelo');
ok(/_repwizIdx === 1[\s\S]{0,150}_repArreglos\.length/.test(cuerpoVal),
   'el paso 2 sigue exigiendo al menos una reparación');

// El foco: no puede apuntar a un campo que ya no está en ese paso.
const focos = repairs.match(/const focos = \{([^}]+)\}/);
ok(focos, 'hay mapa de foco por paso');
const idsFoco = [...focos[1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
ok(idsFoco.length === 3, 'un campo por paso, tres pasos', idsFoco);
ok(idsFoco.every(id => form.includes(`id="${id}"`)),
   'y los tres existen en el formulario', idsFoco);
ok(en(p1, idsFoco[0]) && en(p2, idsFoco[1]) && en(p3, idsFoco[2]),
   'cada foco cae en su propio paso', idsFoco);

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
