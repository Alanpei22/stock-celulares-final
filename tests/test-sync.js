// Harness del indicador de sincronización
const fs = require('fs'), vm = require('vm');
const body = { _kids: [], appendChild(e){ this._kids.push(e); }, contains(e){ return this._kids.includes(e); } };
const timers = [];
const ctx = {
  console,
  setTimeout: (f, ms) => { timers.push(f); return timers.length; },
  clearTimeout: () => {},
  document: { body, createElement: () => ({ className:'', textContent:'', setAttribute(){} }) },
  window: { addEventListener: (ev, f) => { (ctx.__ev[ev] = ctx.__ev[ev] || []).push(f); } },
  navigator: { onLine: true },
  __ev: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'sync-status.js'),'utf8'), ctx, {filename:'sync-status.js'});
const run = c => vm.runInContext(c, ctx);
const pill = () => body._kids[0] || {};

let fails = 0;
const ok = (c, l, x) => { console.log((c?'  OK  ':'  FAIL')+' · '+l+(c?'':'  → '+JSON.stringify(x))); if(!c) fails++; };

run('initSyncStatus()');
ok(/hidden/.test(pill().className), 'arranca invisible (no molesta)', pill().className);

run(`syncReport('caja', true)`);
ok(/pending/.test(pill().className) && /Guardando/.test(pill().textContent), 'escritura pendiente → Guardando', pill());

run(`syncReport('reparaciones', true)`);
run(`syncReport('caja', false)`);
ok(/pending/.test(pill().className), 'sigue pendiente si otra fuente no terminó', pill().className);

run(`syncReport('reparaciones', false)`);
ok(/ok/.test(pill().className) && /Sincronizado/.test(pill().textContent), 'todo subido → Sincronizado', pill());
timers.pop()();   // corre el timer de ocultar
ok(/hidden/.test(pill().className), 'se esconde solo a los 2 s', pill().className);

ctx.navigator.onLine = false;
ctx.__ev.offline.forEach(f => f());
ok(/offline/.test(pill().className) && /Sin conexión/.test(pill().textContent), 'sin red → Sin conexión', pill());

run(`syncReport('caja', true)`);
ok(/offline/.test(pill().className), 'sin red manda el aviso de sin conexión', pill().className);

ctx.navigator.onLine = true;
ctx.__ev.online.forEach(f => f());
ok(/pending/.test(pill().className), 'vuelve la red y quedaba algo pendiente → Guardando', pill().className);

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails?1:0);
