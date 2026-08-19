# Prompt para arrancar un chat nuevo

Sirve para empezar de cero en cualquier lado: la PC, la tablet o claude.ai/code.
Conviene arrancar chat nuevo por cada tarea grande: el chat largo se vuelve caro
porque todo lo hablado se relee en cada paso.

Copiá y pegá esto como primer mensaje. Si ya estás dentro del repo, alcanza con:
**"Leé `tools/prompt-tablet.md` y seguimos."**

---

Trabajo en el sistema de gestión de mi taller de celulares (TechPoint, Caseros,
Buenos Aires). Este repo ES la app en producción.

## Reglas que no se negocian

1. **Producción es Vercel y se deploya sola con cada `git push` a `main`.** No hay
   staging. Si pusheás algo roto, se rompe el local. (NO es Firebase Hosting.)
2. **`npm test` antes de cada push.** Son 23 suites, ~800 chequeos, 3 segundos.
   Si algo falla, no pushees. Ver `tests/README.md`.
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
- `avisos.js` — campanita de novedades de reparaciones. Vive en las DOS
  páginas y es autosuficiente a propósito (caja.html no carga repairs.js)
- `api/` — funciones serverless de Vercel (push, crons, bot de Telegram).
  `api/_auth.js` y `api/_auth-edge.js` son el guardia: todos los endpoints
  exigen el ID token de Firebase de una cuenta de la allowlist


## Lo último que se hizo (2026-08-19)

Un día largo: 18 commits. Todo pusheado y en producción, pero **casi nada
probado en el mostrador todavía**. Si algo molesta, cada cosa se revierte por
separado (`git log --oneline` y `git revert <hash>`).

**Seguridad**
- `/api/ai`, `/api/send-push` y `/api/telegram-notify` estaban ABIERTOS a
  internet. Ahora exigen el ID token de Firebase contra la misma allowlist de
  `firestore.rules`. `apiFetch()` en utils.js engancha el token solo.

**Reparaciones**
- **Varias reparaciones por equipo**, cada una con su precio. `arreglos[]` es la
  lista; `arreglo` sigue existiendo como resumen ("Módulo + Batería") para que
  las ~110 lecturas que ya había no se rompan. En la ficha se tildan a medida
  que se hacen.
- Campo **`falla`**: lo que cuenta el cliente. Va a la boleta antes del trabajo.
- **`motivoCierre`**: al marcar "No va" pide una categoría (rechazó presupuesto /
  no tiene arreglo / no se consigue / no apareció). Hay desglose en estadísticas.
- Cargar el **costo ya no es obligatorio** para entregar.
- El **ingreso pasó de 5 pasos a 3**, con pasos numerados arriba.
- Las **cards** tienen dos niveles de botones: sólidos lo del día (estado,
  cobrar, avisar por WhatsApp), fantasma el resto (llamar, boleta, garantía,
  nota). Garantía ahora sale solo en equipos ya entregados.
- **Estadísticas con período a medida** (botón "Elegir"), con atajos.

**Otros**
- **Campanita de novedades** en las dos páginas, agrupada por equipo, con
  globito y barrita de color por estado.
- El **comprobante de venta** ahora lleva los datos del comprador.
- La **clave y el patrón ya NO se imprimen** en la boleta.
- `print.js` bajó de 1256 a 679 líneas (se borraron A4, 80mm y térmica).

**Bugs que aparecieron y se arreglaron**
- No se podía **cobrar una reparación** desde la pantalla de Reparaciones:
  `_todayAR()` y `fmt()` vivían en `caja.js`, que `index.html` no carga.
  Se mudaron a `utils.js`. Lo vigila `tests/test-cross-pagina.js`.
- El **retiro dueño** se contaba como gasto y bajaba el total del mes.
- Las estadísticas filtraban las canceladas por `'no_van'`, un estado que la
  app nunca escribe: ese contador daba casi siempre 0.
- Las fechas de las estadísticas salían de `toISOString()` (UTC): después de
  las 21:00 el rango se iba un día para adelante.

## Pendientes

**Para mí (no los podés hacer vos):**
- Deployar `firestore.rules` (cierra el listado de la colección pública del QR).
  Se puede desde la consola de Firebase en el navegador. **Sigue sin hacerse.**
- Mirar el uso de Firebase y pasar cuántos documentos tiene cada colección
  (con la app abierta, F12 → Console):
  `console.table({stock:STOCK.length, reparaciones:REPAIRS.length})`
  Ahora importa más: la campanita es lo primero que lee al abrir, sin entrar a
  ninguna sección. Calculado ~330 lecturas/día, pero es una cuenta, no una
  medición. Si sube de más, bajar `AVISOS_LIMITE` de 60 a 30 es una línea.
- **Facturación con ARCA**: hace falta el certificado digital. El análisis
  completo, los riesgos y los pasos están en `tools/factura-arca.md`.

**Para charlar:**
- El listener de `stock` todavía trae todos los equipos, incluidos los vendidos
  hace meses. Falta acotarlo, pero antes quiero ver los números.
- Aviso de transferencias de MercadoPago: hay que elegir entre cobrar con QR
  (webhook oficial, instantáneo) o reenviar la notificación del celu con
  MacroDroid. Ver `tools/gmail-aviso-mp.gs`.
- Las plantillas de WhatsApp de las fases nuevas funcionan pero todavía no se
  editan desde Configuración.
- Las fotos de reparaciones se guardan en base64 dentro del documento de
  Firestore. Es lo que más va a comer el cupo. Las del stock ya usan Firebase
  Storage, que es como debería ser.
- Falta el backup JSON descargable.
- `comprobante-venta.html` pesa 389 KB (una imagen en base64 adentro) y duplica
  lo que hace `print.js`. Falta decidir cuál se usa y borrar el otro.
- `rep-fi-presupuesto` lo lee `saveRepair` pero el campo nunca existió en el
  formulario: ese dato siempre se guarda en 0.
- El alta de stock no tiene campos para accesorios incluidos ni IMEI 2, así que
  no pueden salir en el comprobante de venta.
