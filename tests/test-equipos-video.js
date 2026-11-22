// 🎬 El video del local arriba de todo en /equipos. Alan (22/11): "poné el
// video que sirve en el inicio de la página de venta de equipos". Va el 4:5
// (el 9:16 del reel quedaba demasiado alto), comprimido, mudo y en loop.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

console.log('\n1) La página');
const html = leer('equipos.html');
const tag = (/<video id="hero-video"[^>]*>/.exec(html) || [''])[0];
ok(/ muted/.test(tag) && / loop/.test(tag) && / playsinline/.test(tag), 'mudo, en loop y sin pantalla completa (así el celu lo deja arrancar solo)', tag);
ok(/poster="equipos-video\.jpg"/.test(tag) && /src="equipos-video\.mp4"/.test(html), 'con portada mientras carga');
ok(!/class="cel"/.test(html), 'el celular dibujado ya no está');
const mb = fs.statSync(DIR + 'equipos-video.mp4').size / 1048576;
ok(mb < 6, `el video pesa ${mb.toFixed(1)} MB (el original eran 26): se puede mirar con datos`);
ok(fs.statSync(DIR + 'equipos-video.jpg').size < 150 * 1024, 'la portada es liviana');
ok(/\.hero-video \{[^}]*aspect-ratio: 4 \/ 5/.test(leer('equipos.css')), 'el recuadro respeta el 4:5 (no lo recorta ni deforma)');

console.log('\n2) Arranca solo cuando se ve; con ahorro de datos, no');
const src = leer('equipos.js');
const fn = (/function heroVideo\(v\) \{[\s\S]*?\n  \}/.exec(src) || [''])[0];
function probar({ reducir = false, ahorro = false } = {}) {
  const v = { plays: 0, pausas: 0, controls: false, muted: false, play() { this.plays++; return Promise.resolve(); }, pause() { this.pausas++; } };
  let obs = null;
  const ctx = {
    window: { matchMedia: () => ({ matches: reducir }) },
    navigator: { connection: { saveData: ahorro } },
    IntersectionObserver: function (cb) { obs = cb; this.observe = () => {}; },
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  const r = ctx.heroVideo(v);
  return { v, r, ver: si => obs && obs([{ isIntersecting: si }]) };
}
let p = probar();
ok(p.r === 'anda' && p.v.plays === 0, 'no arranca hasta que se ve');
p.ver(true);
ok(p.v.plays === 1 && p.v.muted, 'al verse: play (mudo)');
p.ver(false);
ok(p.v.pausas === 1, 'scrolleado fuera de la pantalla: se frena (batería y datos)');
p = probar({ ahorro: true });
ok(p.r === 'quieto' && p.v.controls && p.v.plays === 0, 'con "ahorro de datos": no arranca, queda la portada con play');
p = probar({ reducir: true });
ok(p.r === 'quieto' && p.v.controls, 'con "reducir movimiento" tampoco');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
