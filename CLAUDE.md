# TechPoint — app del local (stock, reparaciones, caja)

Local de reparación y venta de celulares en Caseros (Buenos Aires). El dueño es
Alan. Hablale en **español rioplatense**, claro y sin jerga técnica: es el que
usa la app en el mostrador, no un programador.

## Cómo trabajamos (reglas fijas)

- **Todo cambio terminado va a `main`** con `git push origin HEAD:main`. Vercel
  deploya `main` solo, en un par de minutos.
- **En cada cambio, subí la versión del service worker** en `sw.js`
  (`const CACHE = 'cel-vNNN'`, +1). Si no, los celulares siguen con lo viejo.
  Igual, después de un deploy hay que hacer Ctrl+Shift+R (JS y CSS se sirven
  del caché y se actualizan atrás).
- **Antes de subir: `npm test`.** Fallan 2 que ya fallaban y no son nuestras:
  `test-arca.js` y `test-stats-periodo.js`. Cualquier OTRA falla se arregla
  antes de pushear (mirá la línea de resumen, no solo el final de la salida).
- Tests nuevos: se registran en `tests/run.js`, en el objeto `QUE_CUBRE`
  (agregar la línea justo después de `const QUE_CUBRE = {`). Usan `vm` con
  DOM y Firestore de mentira; mirá los que ya existen como modelo.
- Commits en español, explicando el porqué. Comentarios en el código también
  en español y con el porqué ("antes pasaba X, por eso Y").
- Al terminar, contale qué cambió en criollo, cómo probarlo y qué NO se probó
  de verdad (impresora, Firebase real, etc.).

## Stack

- **Sin framework**: HTML + CSS + JS puro (PWA). Páginas: `index.html` (stock,
  reparaciones, repuestos, inicio), `caja.html`, `login.html`, `equipos.html`
  (catálogo público), `fotos-celu.html`, `estado.html` (seguimiento público).
- **Firebase** (proyecto `stockcelustech`): Firestore (SDK compat,
  `db.collection(...)`), Auth (mail+contraseña), Storage (fotos de equipos).
- **Vercel**: estático + funciones en `/api` (node con `firebase-admin`, o
  edge). Auth de las funciones: `exigirSesion` (`api/_auth.js`) o
  `corteSiNoAutorizadoEdge` (`api/_auth-edge.js`). `/api/equipos` es pública a
  propósito (solo lectura, lista blanca de campos).
- Env vars en Vercel: `FIREBASE_SERVICE_ACCOUNT`, `ANTHROPIC_API_KEY`,
  `QZ_PRIVATE_KEY`, `CRON_SECRET`, Telegram, push. Nunca claves en el repo.
- Crons: GitHub Actions (`.github/workflows`), no Vercel.

## Cosas que no son obvias

- **Las reglas de Firebase NO viajan con el push.** Si cambiás
  `firestore.rules` o `storage.rules`, hay que publicarlas en la consola de
  Firebase (o `firebase deploy --only firestore:rules,storage`). Avisale.
- **Roles**: dueño (UID fijo en `roles.js`, `firestore.rules`, `api/_auth.js`)
  y empleados. Los empleados se crean desde la app (👥 Empleados →
  `api/usuarios.js`) con la marca `rol: 'empleado'` en la cuenta; entran con
  usuario corto (`nacho` = `nacho@techpoint.local`). Esconder un botón no
  protege: lo que frena son las reglas. Ver `EMPLEADOS.md`.
- **Permisos por empleado** (`TP_PERMISOS` en `roles.js`): `tpPuede(p)` /
  `tpFrenar(p, 'qué')` en el código y `.req-<permiso>` en el HTML. La misma
  lista en `api/usuarios.js` y en `firestore.rules` (`permisos()`, `puede()`).
- **Impresión**: QZ Tray imprime directo (`qz-print.js`, firma en
  `api/qz-sign.js`); si no está, sale el diálogo de Chrome. Sin QZ, la ventana
  de impresión tiene que abrirse EN el toque: si se espera algo (Firestore)
  antes, Chrome la bloquea → usar `_imprimirDespuesDe` en `print.js`.
- **Etiquetadora XPrinter, rollo 40×30, 203 dpi.** Las barras (Code 128,
  `barcode.js`) van en puntos enteros de la impresora (2 puntos = 0,25mm
  mínimo). Códigos que no entran (~8 caracteres con letras) usan un código
  corto `codigoCorto` (TP#####); la caja busca por los dos.
- **Ticket de venta**: rollo de 58mm (`comprobante-venta.js`).
- **Caja**: movimientos en `caja_movimientos`. Las señas de reparación van
  vinculadas (`repairId`, `esSena`): el cobro final descuenta lo pagado y
  borrar el movimiento revierte la seña.
- **Catálogo público** `/equipos`: sale del `stock` (los que tienen
  `publicar: true`); vendido = "Sin stock" 30 días y después desaparece.
- **Fotos**: `fotos-subir.js` (compu y celu), 1000px, WebP/JPG, a Storage.
- **Cupo gratis de Firestore** (50.000 lecturas/día): evitar lecturas por
  visita o por render; preferir caché y listeners ya abiertos.
- WhatsApp: `waAbrir(url)` en `utils.js` (abre la app de escritorio).
- IA: `api/ai.js` (edge, Claude). Lee tickets de gastos (`ticket-gasto.js`).

## Probar en la compu

- Abrir la app local: `npx serve .` (o `python -m http.server`) y entrar a
  `http://localhost:3000/index.html`. Las funciones de `/api` solo andan con
  `vercel dev` o en el deploy.
- Para algo visual o de impresión, Playwright está disponible para sacar
  capturas; pero lo que manda es probarlo en el local con la impresora real.
