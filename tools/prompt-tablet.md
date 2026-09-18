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
2. **`npm test` antes de cada push.** Son 46 suites, ~1820 chequeos, 5 segundos.
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
- `qr.js` — generador de QR propio, sin librerías ni internet
- `estado.html` + `seguimiento.js` — página pública que ve el cliente al escanear
  el QR del comprobante. Sin SDK: lee por REST
- `webpush.js` + `api/send-push.js` — avisos a todos los dispositivos
- `avisos.js` — campanita de novedades de reparaciones. Vive en las DOS
  páginas y es autosuficiente a propósito (caja.html no carga repairs.js)
- `api/` — funciones serverless de Vercel (push, crons, bot de Telegram).
  `api/_auth.js` y `api/_auth-edge.js` son el guardia: todos los endpoints
  exigen el ID token de Firebase de una cuenta de la allowlist


## Lo ultimo que se hizo (2026-09-17)

**Modo oscuro: UNA sola paleta** — tests/test-modo-oscuro.js
- Habia **tres** bloques `body.dark` con variables, de tres epocas: gris casi
  negro (#0A0A0B/#161618), azul marino (#0f172a/#1e293b) y otro. Ganaba el
  ultimo del archivo, asi que la pantalla mezclaba las tres.
- Ahora hay UNO solo (grafito neutro, `--bg #111316` / `--card #1a1d21`), con
  el dorado del local como unico color fuerte. La prueba falla si aparece otro.
- Los textos chicos (hora, categoria, fechas) daban **2,6:1** de contraste:
  ilegibles. Ahora 5,3:1. La prueba **mide el contraste** (formula WCAG), no
  mira a ojo.
- Chips de categoria y metodo: eran blancos (un cartel de luz en la mano).
  Ahora fantasma con borde y el elegido en dorado. Los inputs dejaron de verse
  claros sobre el fondo oscuro.
- 194 declaraciones de reglas `.dark` reescritas al mapa nuevo.

**Formulario de movimientos de la caja** — tests/test-mov-form.js
- **La categoria ya NO se elige sola.** `setMovTipo` hacia `selectCat(cats[0])`:
  toda venta rapida quedaba "Venta equipo" y todo gasto "Compra repuesto" si no
  te acordabas de tocar el chip. Ensuciaba el desglose del dia y las stats.
- Sin categoria el boton de abajo queda bloqueado y dice que falta
  (`_actualizarBotonCobrar`).
- Cuando se deduce sola (productos, reparacion) los chips se esconden pero
  aparece el renglon `#mov-cat-auto` con la categoria que quedo.
- Se fueron los pasos numerados 1/2/3. Orden nuevo: **monto primero**, despues
  que fue, categoria y metodo. Con carrito el monto NO desaparece: queda en
  modo lectura con "Sale de los productos cargados" (antes saltaba la pantalla).
- Rotulos segun tipo: "Rubro del gasto", "Con que se pago", placeholder propio.

**Etiquetas de equipos** — print.js `printEtiquetas(lista)` + test-etiquetas.js
- Hoja A4, 3 columnas x 34 mm (63x34 = medida de las hojas autoadhesivas
  comunes), con linea de corte punteada por si se imprime en papel normal.
- Llevan: marca+modelo (2 lineas), specs, estado, PRECIO grande (en USD si se
  compro en dolares), ultimos 6 del IMEI y **QR con el IMEI completo** (se
  escanea con la misma app).
- Se ofrecen al terminar un lote y hay boton "🏷️ Etiqueta" en la ficha del
  equipo (`etiquetaDe`), solo en los no vendidos.

**Ingreso por lote** — lote.js + tests/test-lote.js
- Stock → menu ⋮ → "📦 Ingreso por lote". Escaneas los IMEI uno atras del otro
  (`abrirEscaner` en modo `continuo`), cada equipo entra con marca y modelo por
  TAC, completas precio y se guardan TODOS con un `batch.commit()`.
- Campos comunes al lote: estado, ubicacion, garantia, proveedor (va a `notas`
  como "Lote: X"). Botones para copiar el 1er precio/costo a los que falten.
- **El borrador se guarda en localStorage (`loteBorrador`) en cada cambio** y si
  el commit falla NO se borra. Escanear 15 equipos y perderlos es el peor
  escenario posible: hay prueba para eso.
- No entra dos veces el mismo IMEI ni uno que ya este en STOCK (validacion
  local, sin lecturas de Firebase).
- **Costos y moneda**: columna de costo por equipo (solo en modo dueno, con
  aviso de por que no se ve) y botones ARS/USD para todo el lote. En USD se
  guardan `precioUSD`, `costoUSD`, el convertido y `dolarSnapshot` con la
  cotizacion usada. Sin cotizacion no guarda: no inventa el cambio.

**Escanear el IMEI y saber QUE equipo es** — tests/test-modelo-imei.js
- Los primeros 8 digitos del IMEI (TAC) identifican el modelo. Al escanear se
  completan marca y modelo, SIN pisar lo que ya este escrito.
- Dos fuentes, en orden: (1) el historial propio (STOCK/REPAIRS), asi respeta
  como escribis vos los modelos; (2) `vendor/tac.json`.
- `vendor/tac.json`: 109.655 TAC / 8.721 modelos, sacado de la base publica
  MoazEb/tac-database (255k filas) recortado a las marcas que se venden aca.
  Formato compacto {m:[modelos], t:{tac:indice}}: 1,8 MB crudo, ~440 KB
  comprimido. Se baja UNA vez por dispositivo y solo cuando hace falta; el sw
  ahora cachea .json.
- Lo que el IMEI NO dice: capacidad, color ni estado. Eso se sigue cargando.
- Para actualizar la tabla: bajar tac_full.csv del repo, filtrar marcas y
  regenerar el formato compacto (ver el commit).

**IMEI con la camara** — tests/test-imei-camara.js
- Boton 📷 al lado de los CUATRO campos de IMEI: alta de stock (`fi-imei`),
  ingreso de reparacion (`rep-fi-imei`) y los dos de la venta (`ve-imei`,
  `ve-imei2`). El boton lo pone `imeiBotonCam(id)` por JS, no hay que tocar el
  HTML de cada formulario.
- `imeiDesdeCodigo(raw)` en utils.js: saca el IMEI de lo que diga la etiqueta
  (rotulos, espacios) y **solo acepta si cierra por Luhn**. Si la etiqueta trae
  14 digitos sin verificador, lo calcula (`imeiVerificador`).
- Por que importa: la caja tiene varios codigos pegados (IMEI1, IMEI2, serie y
  el EAN del producto). Sin el filtro, el lector cargaba el codigo del carton
  como IMEI. Ahora avisa "ese no es el IMEI" y sigue buscando.
- `abrirEscaner` acepta `opts.validar` y `opts.noSirve` para esto.
- index.html ahora tambien carga escaner.js y tiene el modal del lector.

**El stock se lee en DOS partes** — tests/test-stock-vendidos.js
- Era la lectura mas cara: listener a la coleccion `stock` ENTERA en cada
  apertura, con todos los vendidos de años anteriores, en cada aparato.
- Ahora: listener en vivo con `where('vendido','==',false)` + los vendidos
  on-demand (`cargarVendidos()`, cache 6 h en localStorage `stockVendidosCache`).
  Se piden al filtrar "Vendidos"/"Todos", en estadisticas, exportar y backup.
- `vendidosListos()` dice si estan. El contador de vendidos muestra "–" hasta
  cargarlos (un 0 se leeria como "no vendiste nada").
- `autoBackup` NO guarda si no pudo traerlos: media copia es peor que ninguna.
- Con el uso normal del dia (filtro "En stock") **no se lee nada de mas**.

**Se agoto el cupo y la app no dejaba ingresar equipos** — tests/test-sin-cupo.js
- El cupo de Firebase se renueva a **medianoche de California = 4 AM de aca**.
- Por que frenaba el ingreso: para dar el N° de orden hay que LEER el contador
  `config/repairsMeta`, y **leer** estaba agotado.
- Ahora el ingreso NO se frena nunca:
  `_numeroDeOrden()` intenta la transaccion; si falla usa el siguiente al mas
  alto que tenga el celu y marca el doc con `numeroProvisorio: true`.
  El chequeo de N° repetido, si no puede consultar, se hace contra REPAIRS.
  La escritura va **sin await** (`_guardarRepairSinBloquear`): Firestore la deja
  en su cola y la sube sola. Ademas queda copia en localStorage
  (`repsPendientes`), que `_pendReintentar()` sube al abrir la app.
- Si algun dia hay que revisar: buscar los que tengan `numeroProvisorio`.

**Cupo de Firebase: medir y bajar lecturas** — test-cupo.js (7, 8, 9)
- **Contador propio** en utils.js: `cupoContar(col, n)`, `cupoSnap(col, snap,
  primero)`, `cupoApertura()`, `cupoLeer()`, `cupoTotal()`. Guarda por dia y por
  DISPOSITIVO en localStorage. Se ve en Configuracion → "Cupo de Firebase"
  (`renderCupoPanel`). Enganchado en stock, repairs, caja_movimientos,
  productos, repuestos y el historial completo.
  OJO: un listener manda todo la 1a vez y despues solo cambios → por eso
  `cupoSnap` recibe `primero`.
- **El corte de la ventana de reparaciones ahora va a medianoche.** Antes
  llevaba hora y milisegundos: para Firestore era otra consulta cada vez, no
  podia reusar lo cacheado y **releia toda la ventana en cada apertura**.
- **"Todo el historial" se guarda 6 h en el dispositivo** (`_HIST_TTL_MS`,
  localStorage `repairsHistCache`, sin fotos). Antes cada apertura leia la
  coleccion entera.
- Lo mas caro que queda: el listener de `stock` (colección entera, sin filtro,
  pero consulta estable) y el historial completo. Medir con el panel antes de
  tocar otra cosa.

**BUG: el escaner abria la camara y no leia NADA** (tests/test-escaner-lectura.js)
- Culpa del hint `TRY_HARDER` de ZXing. Suena a que ayuda; en esta version deja
  de leer. Medido en navegador de verdad sobre un <video> con un EAN-13 real:
  **0 de 6 con el hint, 20 de 20 sin el**. NO lo vuelvas a poner.
- Ademas ZXing falla **uno si y uno no** sobre la MISMA imagen: el envoltorio
  intenta 2 veces por cuadro (10/20 con un intento, 20/20 con dos). ~17 ms c/u.
- La prueba nueva dibuja un EAN-13 a mano (tabla de codificacion) y lo pasa por
  la ZXing REAL de vendor/. Las otras pruebas usan una libreria de mentira y por
  eso no agarraban esto.
- Se sumo enfoque continuo (focusMode) y un aviso a los 8 s: "no lo estoy
  leyendo, alejá el celu, mas luz".

**Leer codigos de barras con la camara** — escaner.js + tests/test-escaner.js
- `escaner.js`: modulo aparte, pensado para reusar (IMEI, cobro). API:
  `escanerDisponible()`, `abrirEscaner(cb, {titulo, continuo})`, `cerrarEscaner()`,
  `escanerLuz()`. El modal (`#esc-modal`) vive en caja.html.
- **Dos motores, el liviano primero**: BarcodeDetector del navegador (Chrome de
  Android: cero peso) y, si no esta (iPhone, Chrome de escritorio en Windows,
  Firefox), se baja `vendor/zxing.min.js` (336 KB) UNA vez por dispositivo y
  queda en el cache de la app. En Android NO se baja nunca.
- El envoltorio de ZXing tiene la misma forma que BarcodeDetector
  (`detect(video) -> [{rawValue}]`), asi el resto del archivo no sabe cual usa.
  La prueba 7d lo corre contra la libreria REAL de vendor/: si una version nueva
  cambia constructor/decode/reset, falla ahi.
- El boton se ve SIEMPRE. Al principio se escondia si el navegador no sabia
  leer codigos y era peor: no aparecia y no se sabia por que. Ahora al tocarlo
  dice el motivo segun el aparato (Android → abri Chrome; iPhone/PC → lector de
  mano). BarcodeDetector NO esta en Chrome de escritorio en Windows.
- Inventario: boton "📷 Escanear" al lado del buscador → `escanearInvCam()` →
  `_handleInvScan` (el mismo camino del lector de mano): codigo conocido abre el
  producto, codigo nuevo abre el alta con el codigo puesto.
- Lo que mas se cuida en la prueba: que la camara SIEMPRE se apague (cerrar,
  leer, o mandar la app a segundo plano). Un stream abierto calienta el celu.
- Antirrebote de 2,5 s por codigo (el detector dispara varias veces por segundo).
- Linterna solo si la camara la soporta. No toca Firebase: no gasta cupo.

**Demorados: una sola cuenta** — tests/test-demorados.js
- Habia 5 definiciones (lista por SLA de fase; inicio, estadisticas y resumen
  por "+3 dias reparando"; demoradas de estadisticas metia listos).
  Ahora `tpDemorado(r)` en tp-fases.js = estado 'reparando' + vencido el SLA
  de su fase. `_repDemorado` en repairs.js es el respaldo. Todo usa eso.
- `TP_SLA.ingresado` 4 h → 72 h (la card salta Ingresado → Listo, asi que casi
  todo vivia en Ingresado y a las 4 h salia demorado). `aprobado` 4 → 24 h.
- `tpVencido` (reloj rojo) ya no marca "no va" devueltos. Listo vencido
  dice "sin retirar" y no suma en Demorados.
- `tpDesde`: si la ultima fase anotada no es la actual, usa el ultimo cambio
  de estado; con una sola fase, cuenta desde fechaIngreso si es anterior.
- Estadisticas: "Demoradas" filtraba por Reparando; el boton WA llamaba a
  sendWA() que no existe (ahora repairWhatsApp).

**Alcance de la lista de reparaciones: ultimos 30 dias / todo** — test-reparaciones-estados.js (10-13)
- Primer filtro de la lista (`#rep-alcance`). Se guarda por dispositivo
  (localStorage `repAlcance`). Lista, contadores de arriba y marcas usan el
  alcance (`_enAlcance`). En 30 dias cuenta SOLO la fecha de ingreso.
- Al pie de la lista, en 30 dias: "N mas viejos ocultos" + boton Ver todo.
- **Cupo**: la ventana en vivo sigue en 60 dias (la usan las estadisticas del
  mes vs mes anterior). "Todo" hace UN `.get()` del historial al abrir la app
  (loadAllRepairsHistory, compartido con estadisticas), nunca listener a la
  coleccion. Si falla, vuelve a 30.
- Se saco el listener de "abiertos" del commit anterior: en 30 dias el usuario
  pidio literalmente 30 dias, y en Todo el historial ya los trae.
- Lo viejo no recibe snapshot: `_repPatchLocal(id, data)` despues de cada
  escritura en repairs.js (estado, cobro, edicion, nota, borrar, garantia,
  arreglos, costo). tp-fases ya muta el objeto y repinta. Cambios a equipos
  viejos hechos desde OTRO dispositivo se ven al reabrir la app.
- El cache de localStorage guarda solo la ventana (el historial no entra).

**Revision de reparaciones (estados y card)** — tests/test-reparaciones-estados.js
- **La card y la ficha cambiaban el estado por dos caminos copiados** que se
  habian separado (quickStatusChange/_doStatusChange vs changeRepairStatus).
  Desde la card: Listo no ofrecia avisar al cliente, Entregado no abria el
  cobro. Ahora quickStatusChange delega en changeRepairStatus con
  `{ desdeCard: true }` (lo unico distinto: no reabre la ficha).
  `_doStatusChange` queda como envoltorio.
- **Cobrar desde reparaciones registraba el TOTAL aunque hubiera sena** → la
  sena entraba dos veces a la caja. Ahora cobra el saldo (`_saldoACobrar`), no
  ingresa $0 si la sena cubre todo, y relee la reparacion al confirmar: si ya
  se cobro desde la caja, no registra de nuevo. Entregar algo ya cobrado no
  abre el cobro.
- "No va" con motivo "rechazo el presupuesto" caia en fase `irreparable` y el
  aviso le decia al cliente "no tiene arreglo viable". Ahora va a `rechazado`
  (`_tpSyncFase` acepta fase destino). {MOTIVO} sin texto usa la categoria.
- Las cards en `no va` no tenian botones (la tabla solo conocia 'cancelado').
  Ahora: Devuelto (si falta) y reabrir.
- Garantia en la card se contaba desde el INGRESO y salia en equipos en el
  banco. Ahora desde fechaEntrega, solo entregados y vigente. Se fue el "Dia N
  en taller" (repetia el ⏱). Saldo no se muestra si esta cobrado.
- Reabrir/deshacer un entregado pone `fechaEntrega: null`.
- **Equipos abiertos con mas de 60 dias desaparecian de la lista** (repuesto que
  no llega, abandonados). Segundo listener SOLO de `estado in [reparando,listo]`,
  unido por id con la ventana de 60 dias. Cuesta ~1 lectura por equipo abierto.
- Filtro Hoy/Mes con fecha argentina (`_diaAR`), antes UTC. Orden "por estado"
  sigue las fases. Sacada la opcion "Para entregar" (= "Listo").
- test-costo-opcional y test-entrega contaban que la logica estuviera copiada
  en dos lugares; ahora verifican que la card use el mismo camino.

## Lo que se hizo el 2026-09-10

**Barra del dolar en la caja** — tests/test-dolar-bar.js
- Arriba de los numeros del dia: Blue, compra y venta por separado (que es lo
  que le cantas al cliente que paga en dolares). Tocarla la actualiza y avisa
  con la hora de la cotizacion.
- **Compra/venta NO es el numero con el que la app convierte.** Para las
  cuentas se usa getCurrentDolar() (la venta con el recargo del local, o el
  valor cargado a mano). Si difieren, la barra lo aclara: "la app usa $1.555".
  Sin eso el dueno ve venta 1.545 y la app convirtiendo a otro numero.
- Si la cotizacion esta cargada a mano en Configuracion, la barra esconde
  compra/venta y dice "a mano": mostrar las de la API seria mentir.
- Cache de 10 minutos. **No gasta cupo**: es dolarapi.com, no Firestore. Hay
  prueba que lo vigila.
- test-cupo.js agarro de paso que si ensureDolar no devolvia promesa, la caja
  no abria. Ahora va envuelto en Promise.resolve con catch.

**Validacion de IMEI** — tests/test-imei.js
- 15 digitos + verificador **Luhn** (el mismo de las tarjetas). Agarra el error
  de tipeo mas comun: cambiar un digito lo detecta SIEMPRE, y dar vuelta dos
  casi siempre.
- Aviso EN VIVO al lado del campo mientras escribis: "7/15 digitos", "15
  digitos pero el numero no cierra — revisa *#06#", o el tilde verde.
- **NO bloquea**: el cliente esta parado en el mostrador y a veces hay que
  cargar lo que dice la caja. Al guardar vuelve a preguntar una vez.
- Enganchado en los 4 campos: alta de stock, ingreso de reparacion, y los dos
  IMEI de la venta desde la caja.
- Los placeholders de la app mostraban IMEI inventados que NO pasan el
  verificador. Cambiados por uno valido: la app no puede ensenar un ejemplo
  malo. Hay prueba que lo vigila.
- `imeiDigitos` / `imeiLuhnOk` / `imeiEstado` / `imeiWatch` / `imeiConfirmar`
  viven en utils.js (lo cargan las dos paginas).

## Lo que se hizo el 2026-08-20

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

**Lista de equipos para WhatsApp** (2026-09-05) — `tests/test-lista-equipos.js`
- Boton flotante **📋 Lista** abajo a la derecha en la pantalla de Stock (no
  entre los filtros: esa fila scrollea de costado y en el celular el boton
  quedaba fuera de pantalla). Arma el texto con
  LO QUE ESTAS VIENDO: filtras arriba (marca, estado, precio, buscador) y el
  boton convierte esa misma lista en un mensaje. No hay un segundo juego de
  filtros a proposito.
- `_stockFiltrado()` (app.js) es el filtro UNICO: lo usan `render()` y la
  lista. Si estuviera escrito dos veces, un dia le mandas al cliente equipos
  que no estabas viendo.
- Agrupado por marca (alfabetico), adentro del mas barato al mas caro.
  Linea: `• modelo · memoria · estado — precio`.
- **En los iPhone va la salud de bateria** (es lo que siempre preguntan); en
  el resto no, aunque el dato este cargado. Se detecta por marca O modelo.
- **Nunca entra un equipo vendido ni reservado**, aunque el filtro de arriba
  los muestre: ofrecer algo reservado es quedar mal con dos clientes.
- Los precios cargados en dolares salen convertidos a pesos, y **se ordenan
  por el precio convertido**: ordenando por `precio` a secas valian 0 y se
  iban al principio de la lista.
- **Filtros propios adentro del cuadro**: buscador, marca, estado y precio
  desde/hasta. Arrancan con lo que tengas puesto en la pantalla de atrás y de
  ahí mandan los de adentro.
- **EL FILTRO MANDA**: al cambiarlo quedan elegidos EXACTAMENTE los que se
  ven. Primero se hizo al reves (la seleccion se mantenia entre filtros, para
  poder juntar dos marcas) y era una trampa reportada por el dueño: filtrabas
  Motorola, veias tres tildados, y en el mensaje seguian yendo los quince de
  antes. Para mandar solo los Motorola habia que sacar el filtro, tocar
  Ninguno y volver a filtrar. Si querés sacar alguno, lo destildás dentro del
  filtro. Todos/Ninguno trabajan sobre lo que se ve.
- `batchExportWA` (modo selección múltiple) armaba su PROPIO formato, distinto
  al del botón: el mismo negocio mandaba dos mensajes con dos caras. Ahora
  abre este cuadro con lo seleccionado y usa el mismo texto.
- Adentro del cuadro hay una **lista de tildes**: filtrar por marca/precio no
  alcanza, muchas veces querés mandarle a un cliente ESTOS TRES y no toda la
  categoría. Arrancan todos tildados (sacar dos es más rápido que tildar
  quince) y hay atajos Todos / Ninguno. El mensaje se rearma al tildar.
- **El cambio se tiene que NOTAR.** Lo primero que se ve en el cuadro es el
  encabezado, que nunca cambia: al destildar un equipo la parte visible queda
  igual y parece que no hizo nada (los equipos estan mas abajo). Por eso el
  rotulo dice "Mensaje · N equipos · M caracteres" y el cuadro pega un
  destello al rearmarse. Fue un bug reportado.
- Tildar NO rearma la lista entera: con innerHTML nuevo el scroll saltaba al
  principio y si estabas abajo eligiendo el equipo 12 perdias el lugar. Se
  toca solo esa fila (por eso llevan data-id).
- El texto es EDITABLE antes de mandarlo. Encabezado y pie se editan en
  Configuracion (`lista_header` / `lista_footer` en WA_TEMPLATES).
- El boton grande es **Copiar**: el link `wa.me?text=` mete el texto en la URL
  y con listas largas se corta. Arriba de 1800 caracteres avisa antes de abrir.

**El buscador de ventas** (2026-09-01) — `tests/test-buscar-ventas.js`
- Comparaba con `includes()` sobre el texto en minusculas, sin normalizar:
  buscar "reparacion" NO encontraba "Reparación" y "modulo" no encontraba
  "módulo". Era lo que lo hacia sentir roto. Ahora usa `searchMatch`
  (utils.js), que saca acentos y expande sinonimos.
- Se puede buscar **por monto** ("50000" o "50.000") y **por fecha**
  ("14/08/2026" o "2026-08-14"). Antes ninguna de las dos.
- Al abrir muestra los movimientos del periodo en vez de una pantalla en
  blanco esperando que escribas.
- Chips nuevos de **tipo** (Todo / Ingresos / Egresos), en su propia fila:
  mezclados, "Todo" quedaba al lado de "1 año" y parecia otro periodo.
- Muestra los **dos totales** (ingresos y egresos). Antes decia "ingresos $0"
  cuando buscabas un egreso.
- Cada resultado dice el cliente.
- El rango arrancaba con `toISOString()` (UTC): despues de las 21:00 empezaba
  un dia tarde.
- El cache por periodo no se invalidaba nunca: una venta recien cargada no
  aparecia en toda la sesion. Ahora lo invalida el listener del dia.

**El cartel de "¿le aviso al cliente?"** (2026-09-01)
- Al marcar una reparacion como Listo salia un `confirm()` del navegador que
  decia el nombre y el modelo pero NO que mensaje se iba a mandar. Como el
  texto se edita desde la ficha, podia decir cualquier cosa.
- Ahora es un cartel propio (`openAvisoWaModal` en repairs.js) con la vista
  previa del mensaje REAL, el `*negrita*` dibujado como lo ve el cliente, y
  tres salidas: abrir WhatsApp / copiar el texto / ahora no.
- `_repairWaMsg()` arma el texto una sola vez: la previa y lo que se manda no
  pueden quedar distintos.
- **`setWaListoPref` era codigo muerto**: el comentario hablaba de "no
  preguntar mas" pero no habia forma de activarlo. Ahora esta el tilde en el
  cartel y un selector en Configuracion (preguntar / mandar solo / no avisar),
  asi se puede volver atras.

**Auditoria de la caja** (2026-09-01) — `tests/test-caja-auditoria.js`
- **El desglose del dia no sumaba.** Una reparacion cobrada por transferencia
  contaba en "Digital" Y en "Reparaciones"; una cobrada en efectivo no
  aparecia en ninguno de los dos. Ahora Ef. ventas + Dig. ventas +
  Reparaciones = todo lo que entro. La etiqueta paso a "Dig. ventas".
- **Los dolares se contaban como "Digital"** en el cierre de turno. Ya no:
  tienen su propio renglon en u$.
- **"Efectivo en caja" estaba calculado en dos lugares distintos** (el panel
  del dia y el cierre). Ahora el panel llama a `_getCierreEsperado()`, que es
  la unica cuenta.
- **Borrar un movimiento dejaba datos colgados**, todo con su deshacer:
  · un cobro de reparacion la dejaba marcada como cobrada sin la plata → ahora
    se le saca `cobrado` (el ESTADO no se toca: si se entrego, se entrego);
  · una entrega de plan ahorro no se le descontaba al plan;
  · la seña de una reserva no se le sacaba al equipo, y con el arreglo del
    doble conteo eso le habria descontado del precio una plata inexistente.
- El pago del plan y su movimiento de caja comparten la marca de tiempo: es lo
  que permite borrar el movimiento y sacar el pago EXACTO y no otro igual.
- **CUPO — el historial**: cada pestaña hace un `.get()` sobre
  `caja_movimientos` y Firebase cobra por DOCUMENTO. "Anual" son ~18.000
  lecturas de las 50.000 gratis EN UN TOQUE. Ahora el resultado queda en
  memoria 5 minutos y se invalida solo si cambia un movimiento del dia
  (`_histInvalidar`). Sigue siendo la consulta mas cara de la app: si algun
  dia molesta, hay que guardar totales por mes en vez de releer los
  movimientos.
- `_planFechaLimite` armaba la fecha con `toISOString` (UTC): despues de las
  21:00 el plazo salia un dia largo. Ahora parte del dia argentino.

**Planes de ahorro y comprobante de reserva** (2026-09-01)
- **Planes de ahorro**: el cliente va dejando plata y al completar se lleva el
  equipo. Colección nueva `planes`. Se entra por el FAB de la caja (🐷).
  Alta, registro de entregas, lista con barra de avance, entrega final y
  cancelacion. Cada entrega imprime su comprobante A5 con el acumulado, lo
  que falta y el historial de pagos (la "libreta" del cliente).
- Reglas del negocio, escritas en el comprobante: **precio congelado hasta la
  fecha limite** (por defecto 90 dias; pasado el plazo lo entregado conserva
  su valor en pesos y se aplica al precio del dia), y si abandona, lo
  entregado **queda como credito** para otra compra, NO se devuelve efectivo.
- El equipo puede ser del stock (queda reservado, reusando los campos
  `reserva*` que ya existian) o uno a pedido descrito a mano.
- **CUPO**: `planes` se lee con un `.get()` puntual al abrir la seccion, con
  limit(100). NUNCA un listener. Lo vigila `tests/test-planes.js`.
- **Comprobante de reserva** A5: la reserva ya existia en Stock, le faltaba
  el papel. Sale al reservar y se puede reimprimir desde el detalle del
  equipo. Ahora la reserva ademas guarda un `reservaNro` correlativo.
- **BUG DE PLATA**: al vender un equipo reservado se registraba el precio
  COMPLETO en la caja, asi que la seña quedaba contada dos veces. Ahora se
  cobra solo el saldo. La ganancia sigue siendo la de la venta entera, asi
  que sumando los dos dias la plata y el margen cierran.
- Al entregar un plan NO entra plata nueva a la caja: ya entro entrega por
  entrega. Esa es la trampa de este modulo, y hay prueba que la vigila.

**Buscar una reparacion por N° de orden al cobrar (estaba roto)**
- Tipeabas el numero y la orden no aparecia. `searchMatch` busca por
  SUBCADENA, asi que un numero suelto pega en los IMEI (15 digitos) y en las
  capacidades del stock ("128" matchea todo equipo de 128 GB). Como las
  reparaciones iban forzadas al final de una lista cortada en 10, veinte
  equipos se metian adelante y la orden quedaba afuera.
- Ahora, si lo tipeado son solo numeros, se trata como N° de orden: exacta >
  empieza con > lo contiene, y va PRIMERA de todo.
- El corte de 10 reserva hasta 3 lugares para reparaciones
  (`_cortarSugerencias`), asi una orden nunca desaparece de la lista.
- Buscar por nombre, por IMEI completo y por texto sigue igual que antes.

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
