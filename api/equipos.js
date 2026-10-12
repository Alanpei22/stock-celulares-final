// Vercel Function — GET /api/equipos
// La lista PÚBLICA de equipos en venta, para la página /equipos (sin login).
//
// Sale de la misma colección `stock` de la app: lo que se vende en la caja
// pasa solo a "Sin stock". Solo aparecen los equipos marcados con
// "Mostrar en la página" (`publicar: true`).
//
// OJO: `stock` tiene costo, IMEI, notas internas, datos del comprador… Nada
// de eso puede salir de acá. `equipoPublico()` arma la ficha campo por campo
// (lista blanca): si mañana se agrega un campo privado al stock, no se filtra.
//
// La respuesta queda en la caché de Vercel un minuto: la página abre al toque
// desde Instagram y no se gasta una lectura de Firestore por cada visita.

import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

// Vendidos: se muestran "Sin stock" un tiempo (sirve de muestra de lo que
// entra) y después se van solos, para que la página no se llene de grises.
export const DIAS_SIN_STOCK = 30;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = getAdmin().firestore();
    const snap = await db.collection('stock').where('publicar', '==', true).get();
    const ahora = Date.now();
    const equipos = ordenarEquipos(agruparEquipos(
      snap.docs.map(d => equipoPublico({ id: d.id, ...d.data() }, ahora)).filter(Boolean)
    ));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ equipos, actualizado: new Date(ahora).toISOString() });
  } catch (e) {
    console.error('api/equipos:', e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'No se pudo cargar la lista' });
  }
}

const txt = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);
const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };

// Un celular no vale menos que esto. Salió publicado un Realme nuevo a "$67":
// eran 67 dólares cargados en el campo de pesos. El cliente que ve eso no
// piensa "ganga", piensa que los precios de la página no son serios. Ante la
// duda, mejor "Consultar precio" que un número que no puede ser.
export const PRECIO_MIN_ARS = 10000;
export const PRECIO_MIN_USD = 10;
export function precioPublicable(p, usd) {
  const n = num(p);
  if (!n) return 0;
  return n < (usd ? PRECIO_MIN_USD : PRECIO_MIN_ARS) ? 0 : n;
}

// "128GB" → "128 GB"
function capacidad(s) {
  const t = txt(s, 20);
  const m = t.match(/^(\d+)\s*(GB|TB)$/i);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : t;
}

// Un doc de `stock` → la ficha que ve el cliente, o null si no va.
export function equipoPublico(p, ahora = Date.now()) {
  if (!p || p.publicar !== true || p.eliminado) return null;
  let estado = 'disponible';
  if (p.vendido) {
    const t = Date.parse(p.fecha_venta || '');
    // Vendido hace más de 30 días, o sin fecha de venta: ya no se muestra
    if (!t || ahora - t > DIAS_SIN_STOCK * 864e5) return null;
    estado = 'sinstock';
  } else if (p.reservado) {
    estado = 'reservado';
  }
  const usd = p.moneda === 'usd' && num(p.precioUSD) > 0;
  const precio = p.ocultarPrecio ? 0 : precioPublicable(usd ? p.precioUSD : p.precio, usd);
  const condicion = p.estado === 'Nuevo' ? 'nuevo' : 'usado';
  return {
    id: txt(p.id, 60),
    marca: txt(p.marca, 40),
    modelo: txt(p.modelo, 60),
    condicion,
    // "Reacondicionado" se filtra como usado pero se nombra como es
    condicionTexto: p.estado === 'Reacondicionado' ? 'Reacondicionado' : (condicion === 'nuevo' ? 'Nuevo' : 'Usado'),
    capacidad: capacidad(p.almacenamiento),
    color: txt(p.color, 30),
    bateria: Math.min(100, Math.round(num(p.bateria))) || null,
    garantiaMeses: Math.round(num(p.garantiaMeses)) || 0,
    precio,
    moneda: precio && usd ? 'usd' : 'ars',
    detalles: txt(p.detallesPublicos, 300),
    estado,
    fotos: (Array.isArray(p.fotos) ? p.fotos : [])
      .filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 30),
    fecha: txt(p.fecha, 30),
  };
}

// ── Varias unidades del mismo modelo ──────────────────────
// De los nuevos entran varios iguales: misma foto, mismo precio, distinto
// IMEI. Adentro de la app cada uno es su propio equipo (su garantía, su
// comprobante, su venta) y eso no se toca. Pero al cliente mostrarle la misma
// ficha cinco veces es ruido, y publicar uno solo le dice que hay uno cuando
// hay cinco.
//
// Se juntan SOLO las que el cliente vería idénticas: todo lo que sale en la
// ficha tiene que coincidir. El color no, porque ahí está la gracia — "lo
// tenemos en negro, azul y verde" es una ficha sola con tres colores.
// El precio entra en la clave a propósito: dos unidades a precios distintos
// no se pueden mostrar con un solo número.
function claveGrupo(e) {
  return [e.marca, e.modelo, e.capacidad, e.condicion, e.condicionTexto,
          e.precio, e.moneda, e.garantiaMeses, e.bateria, e.detalles, e.estado]
    .map(v => String(v == null ? '' : v).toLowerCase()).join('|');
}

export function agruparEquipos(lista) {
  // Un objeto pelado y no un Map: `grupos.set(...)` lo marcaría como
  // escritura el guardia de tests/test-api-auth.js, que revisa que este
  // endpoint publico no escriba NADA. Preferible eso a aflojar el guardia.
  const grupos = Object.create(null);
  const orden = [];
  for (const e of lista) {
    const k = claveGrupo(e);
    const g = grupos[k];
    if (!g) { grupos[k] = { ...e, unidades: 1, colores: e.color ? [e.color] : [] }; orden.push(k); continue; }
    g.unidades++;
    if (e.color && !g.colores.includes(e.color)) g.colores.push(e.color);
    // Las fotos: las de la primera unidad que tenga. Si la que abrió el grupo
    // vino sin fotos, se usan las de otra en vez de dejar la ficha pelada.
    if (!g.fotos.length && e.fotos.length) g.fotos = e.fotos;
    // Para ordenar vale la más nueva del grupo.
    if (String(e.fecha) > String(g.fecha)) g.fecha = e.fecha;
  }
  // El color de la ficha pasa a ser la lista, para no repetir el del primero.
  return orden.map(k => grupos[k]).map(g => ({ ...g, color: g.colores.join(', ') }));
}

// Primero los disponibles, después reservados, al final sin stock; dentro de
// cada grupo, los más nuevos arriba.
const ORDEN_ESTADO = { disponible: 0, reservado: 1, sinstock: 2 };
export function ordenarEquipos(lista) {
  return lista.slice().sort((a, b) =>
    (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) || String(b.fecha).localeCompare(String(a.fecha)));
}
