// ══════════════════════════════════════════════════════════
//  ANCLAR LA APP AL CELULAR
// ══════════════════════════════════════════════════════════
// Al empleado se le pasa un link. Si lo deja como link, cada vez tiene que
// buscarlo en el WhatsApp. Anclada queda como una app más: ícono en la
// pantalla, sin la barra del navegador y abriendo de una.
//
// El ofrecimiento vivía solo en index.html, o sea DESPUÉS de entrar. Pero el
// momento en que alguien abre el link por primera vez es el login, que es
// justo donde no estaba.
//
// Cada navegador lo hace distinto:
//   · Chrome (Android y compu) avisa que se puede instalar (`beforeinstallprompt`)
//     y ahí sale el botón que abre el cartel del sistema.
//   · En iPhone no existe ese aviso: la única forma es Compartir → Agregar a
//     inicio, así que se explica con palabras.
//   · Si no pasa ninguna de las dos (Firefox, o Chrome que decidió no avisar),
//     en el login igual se explica dónde está en el menú del navegador.

const _INST_KEY = 'instalarOculto';
const _INST_DIAS = 30;          // "ahora no" dura un mes, no para siempre
let _instEvento = null;         // el aviso de Chrome, guardado para el botón

// Ya está anclada: no hay nada que ofrecer.
function tpYaInstalada() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.startsWith('android-app://');
  } catch { return false; }
}

function _instEsIOS() {
  const ua = navigator.userAgent || '';
  // El iPad nuevo se hace pasar por Mac: se lo reconoce porque tiene pantalla táctil.
  return /iphone|ipad|ipod/i.test(ua) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function _instSilenciada() {
  try {
    const t = Number(localStorage.getItem(_INST_KEY)) || 0;
    return t > 0 && (Date.now() - t) < _INST_DIAS * 24 * 60 * 60 * 1000;
  } catch { return false; }
}
function _instSilenciar() {
  try { localStorage.setItem(_INST_KEY, String(Date.now())); } catch {}
}

// La barra. Se arma sola para no tener que copiar el mismo HTML en cada página.
function _instBarra() {
  let b = document.getElementById('tp-instalar');
  if (b) return b;
  b = document.createElement('div');
  b.id = 'tp-instalar';
  b.className = 'tp-inst';
  document.body.appendChild(b);
  return b;
}

function _instMostrar(texto, conBoton) {
  const b = _instBarra();
  b.innerHTML = `<span class="tp-inst-txt">${texto}</span>` +
    (conBoton ? '<button type="button" class="tp-inst-btn" id="tp-inst-btn">Instalar</button>' : '') +
    '<button type="button" class="tp-inst-x" id="tp-inst-x" title="Ahora no">✕</button>';
  document.getElementById('tp-inst-x').onclick = () => { _instSilenciar(); b.classList.remove('tp-inst--ver'); };
  const btn = document.getElementById('tp-inst-btn');
  if (btn) btn.onclick = tpInstalarAhora;
  b.classList.add('tp-inst--ver');
}

// El botón: abre el cartel del sistema. Solo se puede una vez por aviso.
async function tpInstalarAhora() {
  if (!_instEvento) return;
  const ev = _instEvento;
  _instEvento = null;
  document.getElementById('tp-instalar')?.classList.remove('tp-inst--ver');
  try {
    ev.prompt();
    const r = await ev.userChoice;
    if (r && r.outcome !== 'accepted') _instSilenciar();
  } catch (e) { console.warn('[instalar]', e); }
}

// `insistir`: en el login se explica igual aunque el navegador no avise, que
// es donde el empleado abre el link por primera vez.
function tpOfrecerInstalar(opts = {}) {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (tpYaInstalada() || _instSilenciada()) return;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();          // el cartel sale cuando lo pide el botón, no solo
    _instEvento = e;
    _instMostrar('📲 Tenela a mano: agregala a la pantalla del celu', true);
  });
  window.addEventListener('appinstalled', () => {
    document.getElementById('tp-instalar')?.classList.remove('tp-inst--ver');
  });

  if (_instEsIOS()) {
    _instMostrar('📲 Tocá <b>Compartir</b> ↑ y después <b>“Agregar a inicio”</b>', false);
    return;
  }
  if (opts.insistir) {
    // Chrome avisa cuando quiere. Si en un rato no avisó, se explica a mano.
    setTimeout(() => {
      if (_instEvento || tpYaInstalada() || _instSilenciada()) return;
      if (document.getElementById('tp-instalar')?.classList.contains('tp-inst--ver')) return;
      _instMostrar('📲 Para tenerla a mano: menú <b>⋮</b> del navegador → <b>Instalar app</b>', false);
    }, 2500);
  }
}
