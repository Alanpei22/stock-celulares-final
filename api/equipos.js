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
    const equipos = ordenarEquipos(
      snap.docs.map(d => equipoPublico({ id: d.id, ...d.data() }, ahora)).filter(Boolean)
    );
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
  const precio = p.ocultarPrecio ? 0 : (usd ? num(p.precioUSD) : num(p.precio));
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

// Primero los disponibles, después reservados, al final sin stock; dentro de
// cada grupo, los más nuevos arriba.
const ORDEN_ESTADO = { disponible: 0, reservado: 1, sinstock: 2 };
export function ordenarEquipos(lista) {
  return lista.slice().sort((a, b) =>
    (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) || String(b.fecha).localeCompare(String(a.fecha)));
}
