// ══════════════════════════════════════════════════════════════
//  💸 Cargar gastos desde el bot de Telegram
// ══════════════════════════════════════════════════════════════
//  Alan (08/11): "podemos cargar gastos desde el bot de Telegram". Escribís
//  como hablás y queda en la caja como un egreso más:
//    gasto 5000 nafta
//    gasto $25.000 pantalla a32 transferencia
//    pagué 80 mil de luz ayer
//    retiro 20000
//
//  Solo lo puede usar el dueño: el bot ya contesta únicamente a su chat
//  (telegram-webhook.js). Las funciones de acá no tocan Firestore (las usa el
//  webhook) para poder probarlas solas.

// OJO: en JS \b no sirve con tildes ("pagué" termina en é y \b no corta
// ahí), así que el final de palabra se escribe a mano.
const FIN = '(?=$|[^\\p{L}\\p{N}])';
const RE_VERBO = new RegExp('^\\s*(gasto|gast[eé]|pagu[eé]|compr[eé]|retiro|retir[eé])' + FIN, 'iu');

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
  const categoria = retiro ? CATEGORIAS.retiro
    : RE_REPUESTO.test(desc) ? CATEGORIAS.repuesto
    : RE_FIJO.test(desc) ? CATEGORIAS.fijo
    : CATEGORIAS.otro;
  if (!desc) desc = categoria;
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  return { monto: elegido.n, categoria, metodoPago, descripcion: desc.slice(0, 120), ayer };
}

// El movimiento de caja, igual a uno cargado desde la app (caja.js saveMov)
export function armarMovimiento(g, fecha, ahoraIso) {
  return {
    tipo: 'egreso',
    categoria: g.categoria,
    descripcion: g.descripcion,
    monto: g.monto,
    metodoPago: g.metodoPago,
    fecha,
    createdAt: ahoraIso,
    origen: 'telegram',
    cargadoPor: 'Telegram (dueño)',
  };
}

const _fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _ICONOS = { 'Compra repuesto': '🛒', 'Gasto fijo': '📋', 'Retiro dueño': '🏧', 'Otro gasto': '💸' };

export function textoGastoCargado(g, fecha, { cajaCerrada } = {}) {
  const dia = g.ayer ? ` (de <b>ayer</b>, ${fecha.slice(8, 10)}/${fecha.slice(5, 7)})` : '';
  return `✅ <b>${g.categoria === CATEGORIAS.retiro ? 'Retiro' : 'Gasto'} cargado en la caja</b>${dia}\n` +
    `${_ICONOS[g.categoria] || '💸'} ${_esc(g.descripcion)} · <b>${_fmt(g.monto)}</b>\n` +
    `Rubro: ${g.categoria} · ${g.metodoPago}` +
    (cajaCerrada ? `\n⚠️ La caja de ese día ya estaba cerrada: quedó cargado igual, revisá el cierre.` : '') +
    `\n\n¿Te equivocaste? Mandá <b>deshacer</b> (hasta 30 minutos).`;
}

export const AYUDA_GASTOS = `💸 <b>Cargar gastos en la caja:</b>
· <b>gasto 5000 nafta</b> → egreso en efectivo
· <b>gasto $25.000 pantalla a32 transferencia</b> → con cómo lo pagaste (transferencia, mp, débito, crédito)
· <b>pagué 80 mil de luz ayer</b> → en la caja de ayer
· <b>retiro 20000</b> → retiro del dueño
· <b>deshacer</b> → borra el último que cargaste (hasta 30 min)`;
