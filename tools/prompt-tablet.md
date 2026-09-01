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
2. **`npm test` antes de cada push.** Son 27 suites, ~1080 chequeos, 3 segundos.
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


## Lo ultimo que se hizo (2026-08-20)

**Mensajes de WhatsApp**
- Los avisos de las 11 fases se **editan desde la ficha** de la reparacion
  ("Aviso al cliente → ✏️ Editar texto"), con chips de variables y vista
  previa en vivo. Se guardan en `config/waTemplates` como `fase_<clave>`.
- Textos reescritos. El de "Listo" ahora dice el **saldo** (total menos seña),
  no el total: antes el cliente venia con plata de mas.
- `{FALLA}` usa el campo `falla` (antes agarraba la condicion estetica).
- Variables nuevas: `{SALDO}`, `{SENA}`, `{DETALLE}` (los arreglos con su
  precio), `{HORARIO}`, `{TELEFONO}`.
- Bugs: las plantillas `fase_*` se guardaban pero **no volvian de Firestore**
  (el loader solo copiaba las 4 viejas), y "Restablecer" del modal viejo se
  las llevaba puestas. `repair_presupuesto` por fin se puede editar.

**"¿Se lleva el equipo?" — se fueron los confirm() del navegador**
- Los tres lugares que preguntaban por la entrega (cobrar desde la caja, y
  pasar a Listo desde la ficha y desde la lista) ahora usan UN modal propio,
  `tpEntregaModal` en tp-fases.js (vive en las dos paginas).
- Dice de QUE equipo habla (N° de orden, modelo, cliente) y cuanta plata
  entra y queda debiendo. El confirm viejo no decia nada de eso.
- Tres salidas escritas: se lo lleva / queda en el local / volver. Antes
  "Cancelar" se leia como "cancelar el cobro" pero el cobro se hacia igual;
  ahora volver de verdad no cobra nada.
- Al entregar escribe tambien la FASE (antes solo el `estado`, asi que la
  entrega no quedaba en el historial del tablero) y lo anota en `actividad`,
  asi la entrega hecha desde la caja aparece en la campanita.
- Opcion de mandar el WhatsApp de gracias + garantia ahi mismo.
- `tpWaFono` / `tpWaAbrir` se mudaron a tp-fases.js: el normalizador de
  telefono estaba solo en repairs.js, que caja.html no carga.

**Comprobante de venta desde la caja**
- Se borro `comprobante-venta.html` (389 KB). La caja ahora abre un formulario
  propio e imprime con `print.js`, el MISMO A5 que sale desde Stock.
- El A5 de venta acepta todo lo que tenia la pagina vieja, **todo opcional**:
  IMEI 2, N° de serie, ciclos, estado estetico, libre de fabrica, cuentas
  removidas, accesorios, funciones probadas, permuta con su valor tomado,
  cuotas, saldo abonado y N° de comprobante. Lo que no cargas, no se imprime.
- Con permuta aparece una clausula extra de procedencia licita.
- `caja.html` ahora carga `qr.js` y `print.js`.

## Lo que se hizo el 2026-08-19

Un dia largo: 22 commits, todo pusheado y en produccion. **Casi nada probado
en el mostrador todavia.** Si algo molesta, cada cosa se revierte por separado
(`git log --oneline` y `git revert <hash>`).

**Seguridad e infraestructura**
- `/api/ai`, `/api/send-push` y `/api/telegram-notify` estaban ABIERTOS a
  internet. Ahora exigen el ID token de Firebase contra la allowlist de
  `firestore.rules`. `apiFetch()` en utils.js engancha el token solo.
- **`firestore.rules` y `firestore.indexes.json` DEPLOYADOS** (por fin). El
  archivo de indices tenia una entrada invalida (un indice de un solo campo)
  que hacia fallar el deploy entero: por eso nunca se habia podido subir.

**Reparaciones**
- **Varias reparaciones por equipo**, cada una con su precio. `arreglos[]` es
  la lista; `arreglo` sigue siendo el resumen ("Modulo + Bateria") para que
  las ~110 lecturas que ya habia no se rompan.
- Campo **`falla`**: lo que cuenta el cliente. Va a la boleta.
- **`motivoCierre`**: al marcar "No va" pide una categoria. Desglose en stats.
- Cargar el **costo ya no es obligatorio** para entregar.
- El **ingreso paso de 5 pasos a 3**, con pasos numerados.
- Las **cards**: dos niveles de botones (solidos lo del dia, fantasma el resto).
- **Estadisticas con periodo a medida** (boton "Elegir"), con atajos.

**Otros**
- **Campanita de novedades** en las dos paginas, agrupada por equipo.
- El **comprobante de venta** lleva los datos del comprador.
- La **clave y el patron ya NO se imprimen** en la boleta.
- `print.js` bajo de 1256 a 679 lineas.

**Bugs que aparecieron y se arreglaron**
- No se podia **cobrar una reparacion** desde Reparaciones: `_todayAR()` y
  `fmt()` vivian en `caja.js`, que `index.html` no carga. Se mudaron a
  `utils.js`. Lo vigila `tests/test-cross-pagina.js`.
- El **retiro dueno** se contaba como gasto y bajaba el total del mes.
- Las stats filtraban las canceladas por `'no_van'`, un estado que la app
  nunca escribe: ese contador daba casi siempre 0.
- Las fechas de las stats salian de `toISOString()` (UTC): despues de las
  21:00 el rango se iba un dia para adelante.
- **Avisos en vivo de cobros entre dispositivos**: nunca funcionaron, faltaba
  el indice compuesto que el deploy roto nunca subio.
- **Backup diario**: hacia `.set()` sobre el doc del dia, que las reglas hacen
  inmutable. El 2do dispositivo de cada dia se comia un permission-denied.
- **"Mercado Pago" vs "MercadoPago"**: se guardaban distinto segun de donde
  saliera la venta, y el cierre mostraba dos metodos donde hay uno.

## FACTURACION ARCA - EN PAUSA, fase 1 terminada

**Lee `tools/factura-arca.md` antes de tocar nada de esto.** Ahi esta el
analisis completo, los riesgos y el plan por fases.

Estado al 19/08/2026:

- **Fase 0 lista**: certificado de homologacion sacado y autorizado para
  `wsfe`. Los archivos estan en `Documents/arca-certificados/` (FUERA del
  repo a proposito), con un LEEME que explica cada uno.
- **Fase 1 lista y VERIFICADA contra ARCA**: `/api/factura` con cuatro
  acciones de lectura (`config`, `dummy`, `token`, `ultimo`). WSAA devolvio
  token en **1814 ms**, o sea que entra holgado en los 10 s de Vercel, que
  era el riesgo que podia obligar a replantear todo.
- **Env vars cargadas en Vercel**: ARCA_ENTORNO=homologacion, ARCA_CUIT,
  ARCA_CERT, ARCA_KEY.

**Lo unico que falta para cerrar la fase 1:** dar de alta el punto de venta
tipo "Web Services" en ARCA, cargar `ARCA_PTO_VENTA` y probar la accion
`ultimo`. Para homologacion probablemente alcance con el numero 1 sin hacer
tramite; no se llego a probar.

**Decisiones ya tomadas** (estan en factura-arca.md, no volver a preguntarlas):
monotributo -> Factura C; se factura SOLO desde la app; solo los cobros
digitales (transferencia, MercadoPago, tarjeta); efectivo y dolares no; y la
app SIEMPRE pregunta antes de emitir, nunca sola.

## Pendientes

**Lo primero, antes de escribir una linea nueva:**
Entraron 22 commits en un dia y casi nada se probo en el mostrador. Preguntar
que molesto de lo nuevo ANTES de agregar mas. Meterle features encima de algo
sin estrenar es como se acumulan los problemas.

**Para el dueno (Claude no puede):**
- **Mirar el uso de Firebase.** Con la app abierta, F12 -> Console:
  `console.table({stock:STOCK.length, reparaciones:REPAIRS.length})`
  Importa mas que antes: la campanita lee al abrir sin entrar a ninguna
  seccion. Calculado ~330 lecturas/dia, pero es una cuenta, no una medicion.
  Si sube de mas, bajar `AVISOS_LIMITE` de 60 a 30 en avisos.js es una linea.
- **Bajar el escudo de Brave** para stock-celulares-final.vercel.app. Estaba
  bloqueando trafico de firestore.googleapis.com (ERR_BLOCKED_BY_CLIENT).
- **Punto de venta de ARCA**, si se retoma la facturacion.

**Para charlar:**
- El listener de `stock` todavia trae todos los equipos, incluidos los
  vendidos hace meses. Falta acotarlo, pero antes hay que ver los numeros.
- Las fotos de reparaciones se guardan en base64 dentro del documento de
  Firestore. Es lo que mas va a comer el cupo. Las del stock ya usan Firebase
  Storage, que es como deberia ser.
- Aviso de transferencias de MercadoPago: elegir entre cobrar con QR (webhook
  oficial, instantaneo) o reenviar la notificacion del celu con MacroDroid.
  Ver `tools/gmail-aviso-mp.gs`.
- Falta el backup JSON descargable.
- `rep-fi-presupuesto` lo lee `saveRepair` pero el campo nunca existio en el
  formulario: ese dato siempre se guarda en 0.
- El ALTA DE STOCK sigue sin campos para accesorios ni IMEI 2. Al vender
  desde la caja ahora se cargan a mano y salen en el comprobante; al vender
  desde Stock (index.html) todavia no.
- `repairs.js` tiene ~4400 lineas, `caja.js` ~3600, `app.js` ~3000. No es un
  problema hoy; lo va a ser el dia que haya que cambiar algo del medio.
