// Vercel Function — POST /api/qz-sign
// Body: { data } → { signature } (SHA512 + RSA, en base64)
//
// QZ Tray es el programa de la PC del local que deja imprimir directo, sin el
// diálogo de Chrome. Antes de cada pedido de la página, QZ Tray quiere ver una
// firma hecha con NUESTRA clave privada: si coincide con el certificado que
// tiene instalado (override.crt), confía en la página y no pregunta nada.
//
// La clave privada vive SOLO en la env var QZ_PRIVATE_KEY de Vercel. No puede
// ir en el navegador: con ella, cualquier página podría imprimir en nuestras
// impresoras sin preguntar.
//
// Auth OBLIGATORIA (ver _auth.js): sin sesión de una cuenta del negocio, esto
// sería una máquina de firmar para cualquiera.

import crypto from 'crypto';
import { exigirSesion } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!await exigirSesion(req, res)) return;

  // En la env var los saltos de línea suelen quedar como "\n" escritos.
  const clave = String(process.env.QZ_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!clave) {
    // Sin clave QZ Tray igual imprime, pero pregunta "¿Permitir?" cada vez que
    // se abre la app. No es un error: es la instalación a medio hacer.
    return res.status(200).json({ skipped: 'sin configurar' });
  }

  const data = String((req.body || {}).data || '');
  if (!data || data.length > 20000) return res.status(400).json({ error: 'data required' });

  try {
    const firma = crypto.createSign('SHA512').update(data).sign(clave, 'base64');
    return res.status(200).json({ signature: firma });
  } catch (e) {
    console.error('qz-sign:', e);
    return res.status(500).json({ error: 'no se pudo firmar' });
  }
}
