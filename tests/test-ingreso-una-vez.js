// 🖨️ Un ingreso imprime UNA etiqueta y UNA hoja. Alan (24/11): "cuando tomo
// un equipo de reparación se me imprime etiqueta y hoja A5 por duplicado".
// Se prueba que un segundo guardado mientras corre el primero no hace nada,
// que la impresión automática de la misma orden no sale dos veces seguidas, y
// la causa real: dos ventanas de la compu de la caja tomando el mismo pedido.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
  console.log('\n1) Un guardado a la vez');
  const rep = leer('repairs.js');
  let corridas = 0, soltar;
  const ctx = { console, Promise, _saveRepairAhora: () => { corridas++; return new Promise(r => { soltar = r; }); } };
  vm.createContext(ctx);
  vm.runInContext(rep.slice(rep.indexOf('let _repGuardando'), rep.indexOf('async function _saveRepairAhora')), ctx);
  const a = ctx.saveRepair(), b = ctx.saveRepair();
  await new Promise(r => setTimeout(r, 5));
  ok(corridas === 1, 'dos toques seguidos: guarda una sola vez', corridas);
  soltar(); await a; await b;
  const c = ctx.saveRepair(); await new Promise(r => setTimeout(r, 5));
  ok(corridas === 2, 'cuando terminó, el siguiente ingreso guarda normal', corridas);
  soltar(); await c;

  console.log('\n2) La impresión automática de la misma orden sale una vez');
  const pr = leer('print.js');
  const SALIDAS = [];
  const p = { console, Promise, Date, Object,
    _puedeImprimirAca: () => true, _buildA5: r => 'hoja-' + r.nOrden, _hojaEtiquetas: rs => 'etq-' + rs[0].nOrden,
    _etiquetaRepHtml: () => '', _imprimirDirecto: (t, h) => { SALIDAS.push(h); return Promise.resolve(true); }, _imprimirEnIframe: h => { SALIDAS.push('iframe:' + h); return Promise.resolve(); } };
  vm.createContext(p);
  vm.runInContext(pr.slice(pr.indexOf('const _INGRESO_YA_MS'), pr.indexOf('//  BOLETA DE LA REPARACIÓN')), p);
  await p.imprimirIngresoReparacion({ id: 'x', nOrden: 8700 });
  ok(SALIDAS.join() === 'hoja-8700,etq-8700', 'sale una hoja y una etiqueta', SALIDAS);
  await p.imprimirIngresoReparacion({ id: 'x', nOrden: 8700 });
  ok(SALIDAS.length === 2, 'si se vuelve a pedir enseguida, no sale de nuevo', SALIDAS);
  await p.imprimirIngresoReparacion({ id: 'y', nOrden: 8701 });
  ok(SALIDAS.length === 4, 'la orden siguiente imprime normal', SALIDAS);
  await p.imprimirEtiquetaIngreso({ id: 'z', nOrden: 8702 }); await p.imprimirEtiquetaIngreso({ id: 'z', nOrden: 8702 });
  ok(SALIDAS.filter(s => s === 'etq-8702').length === 1, 'lo mismo con la etiqueta de gremio');
  ok(/function reimprimirBoleta[\s\S]{0,200}printRepair\('A5'\)/.test(rep), 'reimprimir a mano (la barra, la ficha) no pasa por esta traba');

  console.log('\n3) Dos ventanas de la compu de la caja: el pedido del celu sale una vez');
  // La causa real (24/11): la compu que imprime lo de los celus tenía la app
  // abierta en dos ventanas; las dos tomaban el mismo pedido. Firestore repite
  // la transacción de la que perdió, y esa repetición imprimía igual.
  const qz = leer('qz-print.js');
  const ini = qz.indexOf('async function qzServidorImprimir');
  const fin = qz.indexOf('\n}\n', ini) + 3;
  const IMPRESOS = [];
  const pedido = { estado: 'pendiente', tipo: 'etiqueta', creado: Date.now(), pag: {}, pngs: ['png'], altos: [30] };
  let version = 0;
  const tick = () => new Promise(r => setTimeout(r, 1));
  const q = { console, Date, Number, String, Error, Object, Promise, QZ_REMOTA_VENCE_MIN: 30,
    qzImpresoras: () => ({ etiqueta: 'XPrinter' }),
    _qzMandarPngs: async () => { IMPRESOS.push(1); },
    db: { runTransaction: async fn => {
      // Como Firestore: si otro guardó entre que leí y que guardo, repite la función
      for (let intento = 0; intento < 5; intento++) {
        const v0 = version; let cambio = null;
        await fn({ get: async () => { const copia = { ...pedido }; await tick(); return { exists: true, data: () => copia }; },
                   update: (r, d) => { cambio = d; } });
        if (version !== v0) continue;
        if (cambio) { Object.assign(pedido, cambio); version++; }
        return;
      }
    } } };
  vm.createContext(q);
  vm.runInContext(qz.slice(ini, fin), q, { filename: 'qz-print.js' });
  const ref = { delete: async () => {}, update: async () => {} };
  await Promise.all([q.qzServidorImprimir(ref), q.qzServidorImprimir(ref)]);
  ok(IMPRESOS.length === 1, 'las dos ventanas lo intentan a la vez y sale UNA sola etiqueta', IMPRESOS.length);
  ok(/runTransaction\(async t => \{\s*job = null;/.test(qz), 'cada intento de la transacción arranca de cero');

  console.log('\n4) Alan (25/11): "se siguen imprimiendo dos veces si tengo dos ventanas" (las etiquetas)');
  // La etiqueta del celu va por la cola a la compu (la hoja queda en la barra
  // para imprimir a mano): por eso se repetía la etiqueta. Ahora atiende la
  // cola UNA sola ventana por compu.
  const candados = {};   // como navigator.locks: el primero lo tiene, el resto espera
  const locks = { request: (nombre, fn) => new Promise((ok2, mal) => {
    const c = candados[nombre] = candados[nombre] || { tomado: false, fila: [] };
    const correr = () => { c.tomado = true; Promise.resolve(fn()).then(v => { c.tomado = false; ok2(v); const sig = c.fila.shift(); if (sig) sig(); }, mal); };
    if (c.tomado) c.fila.push(correr); else correr();
  }) };
  const LS = { qzServidor: '1' };
  const ventana = nombre => {
    const w = { nombre, escuchas: 0, IMPR: [] };
    const cx = { console, Date, Number, String, Error, Object, Promise, JSON, Array, Math, setTimeout, clearTimeout,
      navigator: { locks },
      localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } },
      toast: () => {},
      db: { collection: () => ({ where: () => ({ onSnapshot: () => { w.escuchas++; return () => { w.escuchas--; }; } }),
                                 doc: () => ({ set: async () => {} }) }) } };
    vm.createContext(cx);
    vm.runInContext(qz, cx, { filename: 'qz-print.js' });
    w.cx = cx;
    return w;
  };
  const A = ventana('A'), B = ventana('B');
  ok(vm.runInContext('qzEsServidor()', A.cx) === true, '(las dos ventanas son "la compu que imprime")');
  vm.runInContext('qzServidorIniciar()', A.cx);
  vm.runInContext('qzServidorIniciar()', B.cx);
  await tick(); await tick();
  ok(A.escuchas === 1 && B.escuchas === 0, 'con dos ventanas abiertas, solo UNA escucha la cola', [A.escuchas, B.escuchas]);
  vm.runInContext('qzServidorIniciar()', B.cx);
  await tick();
  ok(B.escuchas === 0, 'la otra queda esperando (aunque se vuelva a pedir)');
  // Se apaga en la primera (o se cierra): toma la posta la segunda
  vm.runInContext('localStorage.setItem("qzServidor","0"); qzServidorConfigurar(false)', A.cx);
  LS.qzServidor = '1';
  await tick(); await tick(); await tick();
  ok(A.escuchas === 0 && B.escuchas === 1, 'si la primera deja de atender, la segunda toma la posta', [A.escuchas, B.escuchas]);

  // Segunda red: el mismo pedido, ya tomado por otra ventana de esta compu, no sale
  const IMP2 = [];
  const LS2 = {};
  const q2 = { console, Date, Number, String, Error, Object, Promise, JSON, Array, QZ_REMOTA_VENCE_MIN: 30,
    localStorage: { getItem: k => (k in LS2 ? LS2[k] : null), setItem: (k, v) => { LS2[k] = String(v); } },
    qzImpresoras: () => ({ etiqueta: 'XPrinter' }),
    _qzMandarPngs: async () => { IMP2.push(1); },
    // Una base que (mal) deja tomar el pedido a las dos
    db: { runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => ({ estado: 'pendiente', tipo: 'etiqueta', creado: Date.now() }) }), update() {} }) } };
  vm.createContext(q2);
  const ini2 = qz.indexOf("const _QZ_HECHOS_KEY"), fin2 = qz.indexOf('\n}\n', qz.indexOf('async function qzServidorImprimir')) + 3;
  vm.runInContext(qz.slice(ini2, fin2), q2, { filename: 'qz-print.js' });
  const ref2 = { id: 'job1', delete: async () => {}, update: async () => {} };
  await q2.qzServidorImprimir(ref2);
  await q2.qzServidorImprimir(ref2);
  ok(IMP2.length === 1, 'aunque la base dejara pasar a las dos, el pedido ya tomado en esta compu no sale otra vez', IMP2.length);

  console.log('\n5) Registro de impresiones (para ver de dónde sale la repetida)');
  vm.runInContext('qzQueSeImprime("ingreso N°8700"); qzRegistrar("qz", "etiqueta", { pags: 1 })', A.cx);
  vm.runInContext('qzRegistrar("cola", "etiqueta", { de: "Celu de Nacho" })', B.cx);
  const reg = JSON.parse(LS.qzRegistro || '[]');
  ok(reg.length === 2 && reg[0].que === 'ingreso N°8700' && reg[0].v !== reg[1].v && reg[1].de === 'Celu de Nacho', 'cada ventana anota qué imprimió, de qué orden y quién lo mandó, en la misma lista', reg);
  ok(/_qzMandarPngs\(impresora, job\.tipo, job\.pag, job\.pngs, job\.altos, \{ de: job\.de/.test(qz) && /que: _qzQue \|\| null/.test(qz), 'el pedido del celu viaja con el N° de orden');
  ok(/label: 'Registro de impresiones'/.test(leer('app.js')), 'en el menú: "Registro de impresiones"');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
