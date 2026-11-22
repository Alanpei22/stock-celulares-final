// Vercel Function — GET /api/accesorios
// La lista PÚBLICA de accesorios, para la página /accesorios (sin login).
//
// Sale del inventario de la caja (colección `productos`): lo que se vende en
// la caja baja el stock solo. Aparecen únicamente los marcados con "Mostrar en
// la página" (`publicar: true`) desde la app. Alan (22/11): "precio sí, stock
// hay / últimas unidades, sin publicar (después lo hacemos desde la app),
// primero sin envío".
//
// OJO: `productos` tiene costo en pesos y en dólares, stock exacto, stock
// mínimo, código… `accesorioPublico()` arma la ficha campo por campo (lista
// blanca): ni el costo ni la cantidad exacta salen de acá. Del stock solo sale
// "hay" o "últimas unidades"; sin stock no se muestra.
//
// La respuesta queda en la caché de Vercel un minuto, igual que /api/equipos:
// no se gasta una lectura de Firestore por visita.

import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = getAdmin().firestore();
    const snap = await db.collection('productos').where('publicar', '==', true).get();
    const accesorios = ordenarAccesorios(snap.docs.map(d => accesorioPublico({ id: d.id, ...d.data() })).filter(Boolean));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ accesorios, actualizado: new Date().toISOString() });
  } catch (e) {
    console.error('api/accesorios:', e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'No se pudo cargar la lista' });
  }
}

const txt = (v, max = 120) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };

// Un precio de accesorio por debajo de esto es un error de carga (un costo en
// dólares puesto en el campo de pesos, un cero de menos): mejor no mostrarlo.
export const PRECIO_MIN = 500;

// "Últimas unidades": quedan 2 o menos, o lo que se marcó como stock mínimo
export function disponibilidad(p) {
  const stock = Math.floor(Number(p && p.stock) || 0);
  if (stock <= 0) return '';
  return stock <= Math.max(2, Math.floor(Number(p.stockMin) || 0)) ? 'ultimas' : 'hay';
}

// "iPhone 13, iPhone 14 / 15" → ["iPhone 13", "iPhone 14", "15"]. Vacío = sirve para cualquiera.
export function compatLista(s) {
  return String(s || '').split(/[,;/\n]+/).map(x => txt(x, 40)).filter(Boolean).slice(0, 20);
}

// Un doc de `productos` → la ficha que ve el cliente, o null si no va.
export function accesorioPublico(p) {
  if (!p || p.publicar !== true || p.activo === false) return null;
  const disp = disponibilidad(p);
  if (!disp) return null;                    // sin stock: no se muestra
  const precio = num(p.precioVenta) >= PRECIO_MIN ? Math.round(num(p.precioVenta)) : 0;
  return {
    id: txt(p.id, 60),
    nombre: txt(p.nombre, 80),
    categoria: txt(p.categoria, 40) || 'Otro',
    precio,
    disponibilidad: disp,
    compat: compatLista(p.compat),
    detalle: txt(p.detallePublico, 200),
    fotos: (Array.isArray(p.fotos) ? p.fotos : [])
      .filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 6),
  };
}

// Con foto primero (se ven mejor), después por categoría y nombre
export function ordenarAccesorios(lista) {
  return lista.slice().sort((a, b) =>
    ((b.fotos.length > 0) - (a.fotos.length > 0))
    || a.categoria.localeCompare(b.categoria, 'es')
    || a.nombre.localeCompare(b.nombre, 'es'));
}
