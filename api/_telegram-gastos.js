// ══════════════════════════════════════════════════════════════
//  💸 Cargar gastos desde el bot de Telegram
// ══════════════════════════════════════════════════════════════
//  Alan (08/11): "podemos cargar gastos desde el bot de Telegram". Y aclaró
//  (09/11): es para SU caja aparte (la caja dueño), no la del mostrador: lo
//  que se guarda del local y lo que se gasta de eso, con las cuentas de
//  efectivo, banco (transferencias) y MercadoPago. Escribís como hablás:
//    gasto 5000 nafta
//    gasto $25.000 pantalla a32 transferencia
//    pagué 80 mil de luz ayer
//    retiro 20000                → sale de tu caja (para vos)
//    guardé 50000 · ingreso 30000 mp   → entra a tu caja
//    saldo                       → cómo están las tres cuentas
//
//  Solo lo puede usar el dueño: el bot ya contesta únicamente a su chat
//  (telegram-webhook.js). Las funciones de acá no tocan Firestore (las usa el
//  webhook) para poder probarlas solas.

// OJO: en JS \b no sirve con tildes ("pagué" termina en é y \b no corta
// ahí), así que el final de palabra se escribe a mano.
const FIN = '(?=$|[^\\p{L}\\p{N}])';
const RE_VERBO = new RegExp('^\\s*(gasto|gast[eé]|pagu[eé]|compr[eé]|retiro|retir[eé]|guard[eé]|ingreso|ingres[eé]|entr[oó])' + FIN, 'iu');
const RE_INGRESO = /^(guard|ingres|entr)/i;

// Las cuentas de la caja dueño (las mismas de caja_extra.js) y cuál toca
// según cómo se pagó. La tarjeta se paga desde el banco.
export const CUENTAS = { efectivo: { lbl: 'Efectivo', ico: '💵' }, banco: { lbl: 'Banco', ico: '🏦' }, mp: { lbl: 'MercadoPago', ico: '📱' } };
export function cuentaDeMetodo(metodo) {
  if (metodo === 'MercadoPago') return 'mp';
  if (metodo === 'Transferencia' || metodo === 'Tarjeta débito' || metodo === 'Tarjeta crédito') return 'banco';
  return 'efectivo';
}

const CATEGORIAS = { repuesto: 'Compra repuesto', fijo: 'Gasto fijo', retiro: 'Retiro dueño', otro: 'Otro gasto' };

// Palabras que dicen de qué rubro es (las mismas cuatro de la caja)
const RE_REPUESTO = /\b(repuestos?|m[oó]dulos?|pantallas?|bater[ií]as?|pin(?:es)?|flex|placas?|vidrios?|glass|tapas?|c[aá]maras?|conectores?|display)\b/i;
const RE_FIJO = /\b(alquiler|luz|edenor|edesur|agua|aysa|gas|metrogas|internet|wifi|tel[eé]fono|celular del local|expensas|abl|municipal|monotributo|afip|arca|iibb|ingresos brutos|sueldos?|aguinaldo|seguro|contador|alarma|limpieza)\b/i;

// Con qué se pagó. Sin decir nada: efectivo (es lo más común en el mostrador)
const METODOS = [
  [new RegExp('(^|[^\\p{L}])(transf(?:erencia)?|transfer[ií])' + FIN, 'iu'), 'Transferencia'],
  [/\b(mp|mercado\s*pago|mercadopago)\b/i, 'MercadoPago'],
  [/\b(d[eé]bito)\b/i, 'Tarjeta débito'],
  [/\b(cr[eé]dito|tarjeta)\b/i, 'Tarjeta crédito'],
  [/\b(efectivo|cash|en mano)\b/i, 'Efectivo'],
];

// ¿Es un mensaje de gasto?
export function esGasto(texto) {
  return RE_VERBO.test(String(texto || ''));
}

// "25.000" → 25000 · "5k" → 5000 · "80 mil" → 80000 · "1,5 palos"/"1.5M" → 1500000
function _numero(s, sufijo) {
  let t = String(s).trim();
  // "25.000" o "25,000" = miles; "1,5" o "1.5" con sufijo = decimales
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else t = t.replace(',', '.');
  let n = parseFloat(t);
  if (!isFinite(n)) return 0;
  const suf = String(sufijo || '').toLowerCase();
  if (suf === 'k' || suf === 'mil') n *= 1000;
  else if (suf === 'm' || suf === 'palo' || suf === 'palos' || suf === 'millon' || suf === 'millón' || suf === 'millones') n *= 1e6;
  return Math.round(n);
}

// El texto → { monto, categoria, metodoPago, descripcion, ayer } o { error }
export function parsearGasto(texto) {
  let t = String(texto || '').trim();
  const verbo = (t.match(RE_VERBO) || [])[1] || '';
  if (!verbo) return { error: 'no es un gasto' };
  t = t.slice(t.toLowerCase().indexOf(verbo.toLowerCase()) + verbo.length).trim();
  const retiro = /^retir/i.test(verbo);
  const ingreso = RE_INGRESO.test(verbo);

  // El monto: si alguno tiene $, ese. Si no, el número suelto más grande
  // (los números de un modelo, "a32" o "iphone 13", son chicos o van pegados
  // a letras, y no se confunden con la plata).
  const RE_NUM = /(^|[\s(])(\$\s*)?(\d[\d.,]*)\s*(k|mil|m|palos?|mill[oó]n|millones)?(?=$|[\s),.;:!?])/gi;
  const cand = [];
  let m;
  while ((m = RE_NUM.exec(t))) {
    const n = _numero(m[3], m[4]);
    if (n > 0) cand.push({ n, conPeso: !!m[2], txt: m[0], i: m.index });
  }
  if (!cand.length) return { error: 'sin monto' };
  const elegido = cand.find(c => c.conPeso) || cand.slice().sort((a, b) => b.n - a.n)[0];
  if (elegido.n < 10) return { error: 'sin monto' };
  if (elegido.n > 50e6) return { error: 'monto raro' };
  t = (t.slice(0, elegido.i) + ' ' + t.slice(elegido.i + elegido.txt.length)).trim();

  let metodoPago = 'Efectivo';
  for (const [re, nombre] of METODOS) {
    if (re.test(t)) { metodoPago = nombre; t = t.replace(re, ' '); break; }
  }
  const ayer = /\bayer\b/i.test(t);
  t = t.replace(/\bayer\b/i, ' ');

  // Lo que queda es la descripción ("de luz" → "Luz")
  let desc = t.replace(/\s+/g, ' ').replace(/^(de|en|por|con|para|del|la|el|un|una)\s+/i, '').replace(/^(de|en|por|con|para|del)\s+/i, '').trim();
  desc = desc.replace(/[\s,.;:]+$/, '');
  // "internet por" (de "por transferencia") → "internet"
  for (let i = 0; i < 2; i++) desc = desc.replace(/\s+(por|con|en|de|del|al|a|y|con la|con el)$/i, '').trim();
  const categoria = ingreso ? 'Ingreso' : retiro ? CATEGORIAS.retiro
    : RE_REPUESTO.test(desc) ? CATEGORIAS.repuesto
    : RE_FIJO.test(desc) ? CATEGORIAS.fijo
    : CATEGORIAS.otro;
  if (!desc) desc = categoria;
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  return { monto: elegido.n, categoria, metodoPago, descripcion: desc.slice(0, 120), ayer,
           tipo: ingreso ? 'ingreso' : 'egreso', cuenta: cuentaDeMetodo(metodoPago) };
}

// El movimiento de la caja dueño (como los de caja_extra.js)
export function armarMovDueno(g, fecha, ahoraIso) {
  return {
    fecha, tipo: g.tipo, monto: g.monto, cuenta: g.cuenta,
    desc: g.descripcion, rubro: g.categoria, metodoPago: g.metodoPago,
    ts: ahoraIso, origen: 'telegram',
  };
}

// Lo que mueve en el saldo (igual que cdEfecto de caja_extra.js). Con
// `quitar`, lo contrario (para "deshacer").
export function efectoSaldo(mov, quitar) {
  const s = quitar ? -1 : 1, m = s * (Number(mov.monto) || 0);
  const c = CUENTAS[mov.cuenta] ? mov.cuenta : 'efectivo';
  const eg = mov.tipo === 'egreso';
  const cuentas = { efectivo: 0, banco: 0, mp: 0 };
  cuentas[c] = eg ? -m : m;
  return { saldo: eg ? -m : m, ingresos: eg ? 0 : m, egresos: eg ? m : 0, cuentas };
}

// El saldo guardado → las tres cuentas (el de antes de las cuentas era todo efectivo)
export function textoSaldo(tot) {
  const t = tot || {};
  const c = (t.cuentas && typeof t.cuentas === 'object') ? t.cuentas : { efectivo: Number(t.saldo) || 0, banco: 0, mp: 0 };
  const total = (Number(c.efectivo) || 0) + (Number(c.banco) || 0) + (Number(c.mp) || 0);
  return `📦 <b>Tu caja</b>\n` + Object.entries(CUENTAS).map(([k, x]) => `${x.ico} ${x.lbl}: <b>${_fmt(c[k])}</b>`).join('\n') +
    `\n━━━━━━━━━━\nTotal: <b>${_fmt(total)}</b>`;
}

const _fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _ICONOS = { 'Compra repuesto': '🛒', 'Gasto fijo': '📋', 'Retiro dueño': '🏧', 'Otro gasto': '💸' };

export function textoGastoCargado(g, fecha, { saldoCuenta } = {}) {
  const dia = g.ayer ? ` (de <b>ayer</b>, ${fecha.slice(8, 10)}/${fecha.slice(5, 7)})` : '';
  const cta = CUENTAS[g.cuenta] || CUENTAS.efectivo;
  const que = g.tipo === 'ingreso' ? 'Ingreso' : g.categoria === CATEGORIAS.retiro ? 'Retiro' : 'Gasto';
  return `✅ <b>${que} en tu caja</b>${dia}\n` +
    `${g.tipo === 'ingreso' ? '📦' : (_ICONOS[g.categoria] || '💸')} ${_esc(g.descripcion)} · <b>${g.tipo === 'ingreso' ? '+' : '−'}${_fmt(g.monto)}</b>\n` +
    `${cta.ico} ${cta.lbl}${g.tipo === 'ingreso' ? '' : ' · ' + g.categoria}` +
    (typeof saldoCuenta === 'number' ? `\nQuedan en ${cta.lbl}: <b>${_fmt(saldoCuenta)}</b>` : '') +
    `\n\n¿Te equivocaste? Mandá <b>deshacer</b> (hasta 30 minutos).`;
}

export const AYUDA_GASTOS = `📦 <b>Tu caja (efectivo 💵, banco 🏦, MercadoPago 📱):</b>
· <b>gasto 5000 nafta</b> → sale del efectivo
· <b>gasto $25.000 pantalla a32 transferencia</b> → sale del banco (mp = MercadoPago)
· <b>pagué 80 mil de luz ayer</b> → con fecha de ayer
· <b>retiro 20000</b> → plata que sacás para vos
· <b>guardé 50000</b> / <b>ingreso 30000 mp</b> → entra a tu caja
· <b>saldo</b> → cómo están las cuentas
· <b>deshacer</b> → borra el último que cargaste (hasta 30 min)`;
