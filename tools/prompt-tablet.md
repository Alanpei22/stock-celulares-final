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
2. **`npm test` antes de cada push.** Son 57 suites, ~2200 chequeos, 7 segundos.
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
- `caja.html` + `caja.js` — caja diaria, cobros, carrito de venta, venta de
  equipos y planes de ahorro (colección `planes`)
- `print.js` — comprobantes A5 (recepción, que también sirve de entrega) y venta
  A5 con original + copia. Todo B/N, con auto-ajuste para que entre en una hoja
- `utils.js` — lo que usan TODAS las pantallas: `toast`, el menú deslizante
  (`openSheet`) y el modo oscuro. Estaban copiados en app.js, caja.js y
  placas.js y se habían separado solos. Si agregás algo que usen dos páginas,
  va acá: lo vigila tests/test-una-sola-copia.js
- `qr.js` — generador de QR propio, sin librerías ni internet
- Lector de camara: 1920x1080 (a 1280 una barra de 0,25mm son ~4 pixeles y no
  engancha) y zoom 2x si la camara lo tiene, porque abajo de ~10cm el celular no
  enfoca. Ver `_escZoomUtil` en escaner.js.
- `barcode.js` — generador de Code 128, igual de propio. La tabla de patrones se
  verifica DECODIFICANDO lo que dibuja con la ZXing de verdad
  (tests/test-etiquetas-barcode.js): escribirla de memoria y confiar no alcanza.
  Modo C (2 dígitos por símbolo) para que un IMEI entre en una etiqueta de 63mm
- `estado.html` + `seguimiento.js` — página pública que ve el cliente al escanear
  el QR del comprobante. Sin SDK: lee por REST
- `webpush.js` + `api/send-push.js` — avisos a todos los dispositivos
- `avisos.js` — campanita de novedades de reparaciones. Vive en las DOS
  páginas y es autosuficiente a propósito (caja.html no carga repairs.js)
- `api/cron-resumen-telegram.js` — resumen de las 19:15 AR por Telegram: que
  entro a reparar, que se entrego, equipos vendidos y ventas separando efectivo
  de digital. Lo dispara .github/workflows/resumen-telegram.yml (22:15 UTC).
  `armarResumen()` es pura a proposito: es lo que prueba el test
- `api/chequeo-aviso.js` — manda por Telegram el resultado de un chequeo. El
  mensaje lo arma el SERVER desde lo guardado, no el celular: el celular del
  empleado no sabe cuánto tendría que haber (la apertura es plata y las reglas
  no se la dan), y un control que se edita desde el aparato controlado no
  controla nada
- `chequeo.js` — chequeo de caja obligatorio. A la hora que configuró el dueño
  traba la app en todos los celulares hasta que alguien cuente el efectivo. El
  conteo es **a ciegas**: la pantalla nunca muestra el esperado, que se guarda
  aparte en `caja_chequeos_detalle` (el empleado lo escribe pero no lo lee).
  Vive en las DOS páginas, como avisos.js
- `roles.js` — quién es cada cuenta: `dueno` o `empleado`. El empleado trabaja
  pero no ve la plata del día. La lista de UIDs está hardcodeada (cuesta cero
  lecturas) y tiene que coincidir con la de `firestore.rules`; lo vigila
  `tests/test-roles.js`. Cómo agregar un empleado: `EMPLEADOS.md`
- `api/` — funciones serverless de Vercel (push, crons, bot de Telegram).
  `api/_auth.js` y `api/_auth-edge.js` son el guardia: todos los endpoints
  exigen el ID token de Firebase de una cuenta de la allowlist


## Lo que se fue haciendo

El changelog está en [`tools/historial.md`](historial.md), aparte: son 600
líneas que no hacen falta para arrancar y acá solo molestan.

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

## Lo que falta ordenar (medido, no a ojo)

- **`style.css` tiene 295 selectores escritos dos veces y ~1.120 propiedades
  que el navegador ignora.** De ahi salieron tres bugs seguidos (modo oscuro
  mezclado, metodo de pago que no se marcaba, dos `.owner-pin-modal` con
  bordes distintos). `tests/test-css-orden.js` congela el numero para que no
  crezca; arreglarlo es reescribir 6.000 lineas y hay que hacerlo con una
  herramienta de verdad, no a mano.
- **Los menus repiten 3 items en las 6 pantallas** (modo oscuro, modo dueno,
  cerrar sesion). Van a un pie comun.
- **70 archivos sueltos en la raiz**: CSS, JS, iconos, HTML y documentacion al
  mismo nivel.
- **Los precios tienen 10 nombres** para 4 ideas (`precio`, `precioVenta`,
  `precioCosto`, `precioCompra`, `precioCostoUSD`, `precioUSD`, `precioLista`,
  `costoARS`, `costoUSD`, `costoARSTotal`), segun la coleccion. No se puede
  renombrar sin tocar datos viejos; falta la tabla que diga cual es cual.

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
