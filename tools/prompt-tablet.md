# Prompt para arrancar desde otro dispositivo

Copiá y pegá esto como primer mensaje. Si ya estás dentro del repo, alcanza con:
**"Leé `tools/prompt-tablet.md` y seguimos."**

---

Trabajo en el sistema de gestión de mi taller de celulares (TechPoint, Caseros,
Buenos Aires). Este repo ES la app en producción.

## Reglas que no se negocian

1. **Producción es Vercel y se deploya sola con cada `git push` a `main`.** No hay
   staging. Si pusheás algo roto, se rompe el local. (NO es Firebase Hosting.)
2. **`npm test` antes de cada push.** Son 11 suites, ~345 chequeos, 1 segundo. Si
   algo falla, no pushees. Ver `tests/README.md`.
3. **Subí `const CACHE` en `sw.js`** cada vez que toques un `.js`, `.css` o `.html`.
   Si no, los celulares siguen sirviendo la versión vieja desde el caché.
4. **La app maneja plata.** No rompas compatibilidad con los datos que ya están en
   Firestore: campos nuevos sí, renombrar o borrar campos existentes no.
5. **No se puede verificar en un navegador**: la app está detrás de login + Firebase.
   Se verifica con las pruebas de `tests/`, que cargan los archivos reales en una
   sandbox de node con Firestore y DOM falsos. Si tocás algo que no está cubierto,
   escribí la prueba.
6. **Cupo de Firebase (plan gratis).** Ya se agotó una vez y dejó de aceptar
   ingresos de equipos. Nunca enganches un listener a una colección entera al
   iniciar: se carga cuando el usuario entra a esa sección. Lo vigila
   `tests/test-cupo.js`.

## Cómo quiero que trabajes

Directo, sin explicarme de más. Al final: resumen corto de qué cambiaste y qué
tengo que probar yo a mano. Si algo que pido está mal pensado o hay una forma más
simple, decímelo antes de implementarlo.

## Cómo está armado

App web (HTML/JS/CSS sin framework) + Firebase/Firestore. Sin build.

- `index.html` + `app.js` — stock de equipos, dashboard, configuración
- `repairs.js` — reparaciones (el corazón del taller)
- `tp-fases.js` — tablero de fases: 11 fases con transiciones válidas y SLA.
  Doble nivel a propósito: `fase` es el detalle y `estado` (los 4 de siempre) se
  calcula desde la fase, así el resto de la app no se entera
- `caja.html` + `caja.js` — caja diaria, cobros, carrito de venta
- `print.js` — comprobantes A5 (recepción, que también sirve de entrega) y venta
  A5 con original + copia. Todo B/N, con auto-ajuste para que entre en una hoja
- `qr.js` — generador de QR propio, sin librerías ni internet
- `estado.html` + `seguimiento.js` — página pública que ve el cliente al escanear
  el QR del comprobante. Sin SDK: lee por REST
- `webpush.js` + `api/send-push.js` — avisos a todos los dispositivos
- `api/` — funciones serverless de Vercel (push, crons, bot de Telegram)

## Pendientes

**Para mí (no los podés hacer vos):**
- Deployar `firestore.rules` (cierra el listado de la colección pública del QR).
  Se puede desde la consola de Firebase en el navegador.
- Mirar el uso de Firebase y pasar cuántos documentos tiene cada colección.

**Para charlar:**
- El listener de `stock` todavía trae todos los equipos, incluidos los vendidos
  hace meses. Falta acotarlo, pero antes quiero ver los números.
- Aviso de transferencias de MercadoPago: hay que elegir entre cobrar con QR
  (webhook oficial, instantáneo) o reenviar la notificación del celu con
  MacroDroid. Ver `tools/gmail-aviso-mp.gs`.
- Las plantillas de WhatsApp de las fases nuevas funcionan pero todavía no se
  editan desde Configuración.
- `print.js` tiene ~400 líneas muertas (A4, 80mm y BT de recepción y entrega, que
  se sacaron de la interfaz). Decidir si se borran.
- `/api/send-push` no pide autenticación.
- Las fotos de reparaciones se guardan en base64 dentro del documento de
  Firestore. Hoy no es el problema, pero come el 1 GB y se descarga cada vez.
  Las del stock ya usan Firebase Storage, que es como debería ser.
- Falta el backup JSON descargable.
