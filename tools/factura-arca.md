# Facturación electrónica con ARCA (ex AFIP)

Análisis hecho el **19/08/2026**. Todavía NO se escribió nada de código: falta
el certificado digital, sin el cual no se puede probar absolutamente nada.

**Condición fiscal del local: Monotributo → Factura C.** Eso simplifica bastante:
un solo tipo de comprobante, sin discriminar IVA.

---

## Lo primero: verificar con el contador

Dos cosas que salieron al investigar y que **no son decisión del programador**:

1. **RG 5782, extendida por la RG 5852/2026**: movió del 1 de junio al **1 de
   agosto de 2026** la obligación de pedir el **CAE en tiempo real**. Aplica a
   responsables inscriptos. Siendo monotributo probablemente no aplique, pero
   que lo confirme el contador.
2. **Manual de WSFEv1 versión 4.6** (la vigente al 19/08/2026): hace obligatorio el campo
   `CondicionIVAReceptorId` en los comprobantes alcanzados. Si falta, ARCA
   rechaza la emisión. O sea: **hay que preguntarle la condición de IVA al
   cliente** al facturar.

---

## Cómo funciona, en dos pasos

Son dos servicios SOAP encadenados:

### 1. WSAA — autenticación
Se le manda un XML ("Login Ticket Request") firmado con el certificado digital
del CUIT, y devuelve un **token + sign** que vale **12 horas**.
Hay que cachearlo: no se pide uno por factura.

### 2. WSFEv1 — el comprobante

**Sobre `wsfe` vs `wsfev1` — no confundirse:**

La página de ARCA los lista como dos servicios, y eso hace pensar que hay que
autorizar `wsfev1`. Pero son dos cosas distintas:

- **Endpoint SOAP**: `wsfev1` es la versión vigente (comprobantes A, B, **C** y
  M). El `wsfe` V0 quedó discontinuado el 1-jul-2011.
- **Identificador de servicio para WSAA**: es **`wsfe`**, aunque después se
  llame al endpoint de `wsfev1`. Es una rareza histórica de AFIP.

En el desplegable de WSASS lo que aparece es **`wsfe`**, y es lo correcto.
El 19/08/2026 se autorizó así (`ws://wsfe`).

Si en la fase 1 WSAA rechazara el token, ahí sí habría que probar con
`wsfev1`. Pero la apuesta es que `wsfe` es el bueno.

Con ese token:
- `FECompUltimoAutorizado` → qué número sigue para ese punto de venta y tipo
- `FECAESolicitar` → pide el CAE

Devuelve el **CAE** y su **fecha de vencimiento**. Los dos van impresos en la
factura, más un **QR obligatorio**.

Ventaja: el QR lo podemos generar con `qr.js`, que ya está en el repo y no
necesita librerías ni internet.

---

## Dónde va cada cosa en esta app

**La clave privada NUNCA puede estar en el navegador.** Va como variable de
entorno en Vercel, y un endpoint nuevo `/api/factura` es el único que la toca.

El patrón ya existe: `api/_auth.js` protege los endpoints exigiendo el ID token
de Firebase de una cuenta de la allowlist. Este endpoint sería **el más sensible
de todos los que hay** — más que `/api/ai`, porque acá lo que se filtra es la
identidad fiscal del local.

Datos que hoy **no existen** en la app y hay que agregar: CUIT, razón social,
condición de IVA propia, punto de venta. No hay ni uno cargado.

---

## Los riesgos, en orden

### 1. La numeración no puede tener huecos ni repetidos
El bug clásico: se pide el CAE, se corta la conexión por timeout, el software
cree que falló y reintenta — pero ARCA sí lo procesó. Resultado: número
duplicado o salteado.

Eso **no es un bug de pantalla, es un problema fiscal**. La solución tiene que
ser idempotente: antes de reintentar, consultar con `FECompConsultar` si ese
número ya se emitió.

### 1b. La app es el UNICO camino para facturar
Consecuencia de la decision de arriba: si ARCA no contesta, se cae Vercel o
vence el certificado, **no hay forma alternativa de emitir**. Si la web de ARCA
fuera el plan B esto podria ser mas relajado; siendo el unico camino, no.

Lo que obliga a que tenga la app:
- **Estado visible por venta**: facturada / sin facturar / fallo. Nunca en
  silencio.
- **Reintentar** una que fallo, sin duplicar el numero (ver riesgo n1).
- **Lista de ventas sin facturar**, para que no se pierda ninguna a fin de mes.
- **Aviso cuando el certificado esta por vencer** (duran 2 anios). Si vence sin
  que nadie mire, se corta la facturacion de un dia para el otro. Ya hay
  Telegram armado para avisar.

### 2. El timeout de Vercel
En el plan gratis las funciones node cortan a los **10 segundos**. WSAA +
WSFEv1 encadenados pueden no entrar.

Ya nos pasó: por eso `api/ai.js` se quedó en edge runtime (ver el comentario en
`api/_auth-edge.js`). Acá **no hay esa salida**, porque firmar el certificado
necesita node, no edge.

Si no entra en 10s, las opciones son: cachear el token de WSAA en Firestore
para que la mayoría de las llamadas se salteen ese paso, o pagar el plan de
Vercel.

### 3. No se puede verificar con `tests/`
Todo lo demás en este repo se valida con la sandbox de node sin red. ARCA es un
servicio externo con autenticación por certificado.

Las pruebas **sí** pueden cubrir: el armado del XML, la lógica de numeración, el
formato del comprobante, que el endpoint exija sesión.
Las pruebas **no** pueden cubrir: que ARCA devuelva un CAE.

Eso se prueba contra **homologación**, y para eso hace falta el certificado.

---

## Lo que tiene que hacer el dueño (no lo puede hacer Claude)

1. **Certificado de homologación** — se saca con el servicio **WSASS**
   (autogestión de certificados para el ambiente de prueba).
2. **Certificado de producción** — desde el "Administrador de Certificados
   Digitales", con clave fiscal.
3. **Punto de venta del tipo "Web Services".** Se da de alta en ARCA desde
   "Administración de puntos de venta y domicilios". Es **uno solo**.

   Un "punto de venta" en ARCA NO es un local: es una serie de numeración. El
   local sigue siendo uno, mismo CUIT.

   **DECISION TOMADA (19/08/2026): se factura SOLO desde la app.** O sea que
   alcanza con un unico PV, tipo Web Services. No hace falta el de
   "Comprobantes en linea".

   (Para el registro: ARCA exige que los PV de Comprobantes en linea,
   Facturador Plus y Web Services sean distintos entre si. Si alguna vez se
   quisiera facturar tambien desde la web de ARCA como plan B, habria que dar
   de alta un segundo PV. Se puede hacer despues, en minutos: no es una
   decision para hoy.)

4. **Asociar el certificado al servicio** en el Administrador de Relaciones de
   Clave Fiscal.

Homologación y producción tienen **servidores distintos y certificados
distintos**. No se mezclan.

---

## Plan por fases

| Fase | Qué | Quién |
|---|---|---|
| **0** | Certificado de homologación + PV tipo Web Services (HECHO 28/10: PV 6) + confirmar con el contador | Dueño |
| **1** | `/api/factura` + WSAA + consultar último número. **Solo leer** | HECHO 19/08 |
| **2** | Emitir en homologación, con numeración idempotente | HECHO y VERIFICADO 29/10 |
| **3** | La factura impresa con CAE, vencimiento y QR | HECHO 29/10 (factura-venta.js) |
| **3b** | Estado por venta, reintento y lista de sin facturar (ver riesgo 1b) | HECHO 29/10 (falta: aviso de vencimiento del certificado) |
| **4** | Producción con el certificado real | Los dos |

**La fase 1 es la que despeja las dudas grandes**: si el timeout de Vercel
alcanza y si el flujo del certificado funciona. Antes de pasar eso, no vale la
pena escribir el resto.

---

## QUE se factura (decidido el 19/08/2026)

**Solo los cobros digitales, y siempre preguntando.** La app nunca emite sola.

Que se factura y que no depende del metodo de pago. Los valores reales que usa
la app hoy:

| Metodo | Factura? |
|---|---|
| Transferencia | si |
| MercadoPago | si |
| Tarjeta debito | si |
| Tarjeta credito | si |
| Efectivo | no |
| Dolares | no (es efectivo fisico) |

**Como pregunta:** al terminar el cobro aparece un cartel "Facturar esta
venta?" con Si / Ahora no. Igual al que ya existe para el comprobante.

**Pago dividido:** la caja deja cobrar con dos metodos (mitad efectivo, mitad
transferencia). Si CUALQUIERA de los dos es digital, se ofrece facturar la
venta ENTERA. Facturar media venta no tiene sentido.

**Ojo, inconsistencia encontrada:** caja.html usa `MercadoPago` (junto) y
app.js:10 usa `Mercado Pago` (separado) en DEFAULT_PAYMENTS. La regla va a ser
"distinto de efectivo/dolares", asi que hoy no molesta -- pero si alguna vez se
compara contra una lista de nombres, uno de los dos no matchea.

**Nota:** que se factura y que no es decision del duenio y su contador. Aca
solo queda escrita la regla que pidio, para poder programarla.

---

## Endpoints (verificados el 19/08/2026 pidiendo el WSDL)

|  | Homologación | Producción |
|---|---|---|
| **WSAA** | `wsaahomo.afip.gov.ar/ws/services/LoginCms` | `wsaa.afip.gov.ar/ws/services/LoginCms` |
| **WSFEv1** | `wswhomo.afip.gov.ar/wsfev1/service.asmx` | `servicios1.afip.gov.ar/wsfev1/service.asmx` |

**`wsfev1homo.afip.gov.ar` NO existe**, aunque circule en tutoriales. El host
de homologación es `wswhomo`. Se comprobó: no resuelve.

---

## Estado de la fase 1 (19/08/2026) — VERIFICADA CONTRA ARCA

Corrida de verdad contra homologación. Resultado:

    TOKEN {ok: true, expira: '2026-08-20T07:22:56.078-03:00',
           deCache: false, ms: 1814}

**Las tres dudas que estaban abiertas quedaron resueltas:**

1. **¿Entra en los 10 s de Vercel?** WSAA respondió en **1814 ms**. Entra
   holgado. Era el riesgo que podía obligar a replantear todo el enfoque.
2. **¿SHA-256 o SHA-1 para la firma CMS?** SHA-256. WSAA la aceptó.
3. **¿El servicio era `wsfe` o `wsfev1`?** `wsfe`, como estaba.

**Un bug que apareció en esa primera corrida:** WSAA devuelve el ticket
ESCAPADO como entidades XML adentro de `<loginCmsReturn>` (`&lt;token&gt;`),
NO dentro de un CDATA. Buscar `<token>` directo no encontraba nada y el error
decía "WSAA no devolvió token" cuando sí lo había devuelto. Arreglado con
`desescapar()`, y con prueba que arma una respuesta con la forma real.

Env vars ya cargadas en Vercel: ARCA_ENTORNO, ARCA_CUIT, ARCA_CERT, ARCA_KEY.
Falta ARCA_PTO_VENTA (el PV todavía no se dio de alta).

Archivos: `api/_arca.js` (ayudante) y `api/factura.js` (endpoint).
Dependencia nueva: `node-forge`, para firmar en CMS/PKCS#7.

Acciones disponibles, todas de lectura:
- `config` — qué falta configurar. No llama a ARCA.
- `dummy`  — ¿está viva ARCA? No usa el certificado. Sirve para separar
  "no llego a ARCA" de "mi certificado está mal", que se parecen desde afuera.
- `token`  — ¿WSAA da token? No lo devuelve al navegador: es una credencial.
- `ultimo` — FECompUltimoAutorizado. Qué número sigue.

Cada respuesta trae `ms`: cuánto tardó. Es el dato que decide si esto entra en
los 10 segundos de Vercel cuando haya que emitir.

**Env vars que hay que cargar en Vercel:**

    ARCA_ENTORNO    homologacion      (el default ya es este, a proposito)
    ARCA_CUIT       20385199628
    ARCA_PTO_VENTA  <el numero del PV tipo Web Services>
    ARCA_CERT       <el .crt entero, en PEM>
    ARCA_KEY        <la clave privada entera, en PEM>

**Duda abierta:** la firma va con SHA-256. Si WSAA la rechazara, el otro
candidato es SHA-1. Es el único parámetro del código con margen de duda.

---

## Alternativa: SDK intermediario

Existen SDKs que hacen de proxy y simplifican todo el armado SOAP. El costo es
que **el certificado del local viaja a un tercero**.

Para un taller chico puede ser una decisión razonable — pero es una decisión,
no un detalle técnico, y la tiene que tomar el dueño sabiendo eso.

---

## Fuentes

- [WSAA — documentación oficial](https://www.afip.gob.ar/ws/documentacion/wsaa.asp)
- [WSAA Manual del Desarrollador](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf)
- [Webservices de factura electrónica](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [Generación de certificados para producción](https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf)
- [Ayuda — Factura electrónica](https://www.afip.gob.ar/fe/ayuda/webservice.asp)
- [Habilitación de puntos de venta](https://www.afip.gob.ar/derechos-de-exportacion-de-servicios/comprobantes-y-facturacion/puntos-de-venta.asp)
- [Monotributo — Factura electrónica](https://www.afip.gob.ar/facturacion/monotributo/factura-electronica.asp)

---

## Punto de venta (28/10/2026)

El que se usa es el **6**: "Factura Electronica - Monotributo - Web Services",
Av. Urquiza 4741, Caseros. Va en Vercel como `ARCA_PTO_VENTA=6`.

Ese día se dieron de alta otros dos por error, que quedan sin usar:
- **4**: "CAEA - Fact. Elect. (RECE) - Monotributo - Contingencias". Es para
  contingencia (números pedidos por adelantado), no para facturar en el momento.
- **5**: "Comprobantes de Exportacion - Web Services". Es Factura E (exterior).

## Fase 2 (28/10/2026) — emitir

Archivos: `api/_arca-fe.js` (armar y leer, puro, sin red) y el final de
`api/_arca.js` (`emitirFactura`, `consultarCbte`). Prueba:
`tests/test-arca-emitir.js`, que simula ARCA y Firestore.

Acciones nuevas de `/api/factura`:
- `emitir` + `movId` — factura una venta de la caja. El importe sale del
  movimiento guardado, no del navegador. Rechaza las cobradas en efectivo o
  dólares (con pago dividido, si una parte es digital, va la venta entera).
  Opcionales: `concepto` (productos | servicios | ambos), `docTipo`
  (cf | dni | cuit), `docNro`, `condIva`.
- `prueba` + `importe` — una factura de prueba. SOLO en homologación.
- `consultar` + `nro` — qué dice ARCA de ese número (FECompConsultar).

**Cómo no se rompe la numeración.** Cada venta tiene su doc en `facturas`
(id = la venta). Antes de pedir el CAE se anota el número que se va a usar.
Si se corta, el próximo intento (pasado un minuto) le pregunta a ARCA si ese
número ya salió: si salió con el mismo importe, se queda con ese CAE; si no,
pide número nuevo. Si dos ventas pelean el mismo número, ARCA contesta 10016
y se vuelve a preguntar. Un rechazo no consume número.

**Producción bloqueada:** con `ARCA_ENTORNO=produccion` no emite salvo
`ARCA_EMITIR_PRODUCCION=si`. Se habilita en la fase 4, a propósito.

Defaults (a confirmar con el contador): Factura C, consumidor final
(DocTipo 99, CondicionIVAReceptorId 5), concepto "productos". Para una
reparación conviene `concepto: 'ambos'` (lleva fechas de servicio).

Reglas: `facturas` la escribe solo el servidor; la app la lee. Hay que
publicar firestore.rules.

### Primera factura real en homologación (29/10/2026)

    {ok: true, factura: {ptoVenta: 6, cbteTipo: 11, nro: 1, importe: 1000,
     cae: '86441029094101', caeVto: '2026-11-08', estado: 'emitida'}, ms: 7356}

ARCA aceptó el XML tal cual lo arma `_arca-fe.js` (Factura C, consumidor
final, CondicionIVAReceptorId 5). **Tardó 7,3 s** (incluía pedir token nuevo
a WSAA: el cacheado era de agosto). Como el corte por defecto es a los 10 s,
`vercel.json` le da 60 s a `api/factura.js`.

## Fase 3 (29/10/2026) — en la caja

`factura-venta.js` (caja.html):
- Después de cobrar algo digital sale **"🧾 Cobro digital: ¿factura?"** con
  *Consumidor final* · *A un CUIT* · *Solo ticket* · *No*. Con efectivo sigue
  el "¿Comprobante?" de siempre.
- *A un CUIT*: CUIT (se valida el dígito verificador), nombre y condición
  (Monotributista 6, Responsable Inscripto 1, Exento 4). Siempre Factura C.
- Reparación → concepto "productos y servicios"; lo demás → "productos".
- El ticket (58mm) lleva emisor (razón social, CUIT, IIBB, inicio de
  actividades, monotributo), FACTURA C cód. 011, N° PPPPP-NNNNNNNN, receptor,
  renglones, total, CAE, vto. y el QR. En homologación: "PRUEBA — SIN VALIDEZ
  FISCAL".
- IIBB, inicio de actividades y domicilio: `config/facturaEmisor`, los carga el
  dueño desde Caja → menú → Facturación y tarjetas → Datos del local.
- En la lista: `🧾 FC 00006-…` (tocás y reimprime) o `🧾 sin facturar` /
  `⚠️ falló la factura` (tocás y factura). Menú → *Sin facturar*.
- El servidor deja en la venta `factura: {estado, nro, cae, caeVto, qr, receptor}`.

**qr.js**: el QR de ARCA es una URL de ~300 caracteres y el generador llegaba
a la versión 10. Se extendió a la 15 y aparecieron dos errores que ya estaban
desde la versión 7 (patrones de alineación sobre la línea de tiempo, y la info
de versión con el polinomio truncado): esos QR no se leían. Verificado leyendo
los QR generados con un lector (jsQR) en todas las versiones.

## Fase 4 — pasar a producción (preparado el 29/10/2026)

Lo que quedó listo en el código:
- `/api/factura` action `csr` (solo el dueño): arma el pedido de certificado
  de PRODUCCIÓN con la misma clave que ya está en Vercel (ARCA_KEY). La clave
  no sale de Vercel; el CSR es público. Sujeto: C=AR, O=RICARDI ALAN AGUSTIN,
  CN=techpoint, serialNumber="CUIT 20385199628".
- `config` devuelve `certVence` (cuándo vence el certificado cargado) y
  `emiteEnProduccion`.
- El parte de las 10:30 avisa por Telegram desde 30 días antes de que venza
  el certificado (y si ya venció).
- Una factura de PRUEBA hecha sobre una venta real no traba la de verdad: en
  producción esa venta se factura de nuevo (el doc de `facturas` guarda el
  entorno).

Los pasos, en orden:
1. Visto bueno del contador (Factura C a consumidor final; reparaciones como
   "productos y servicios").
2. En la app, F12 → Console:
   `apiFetch('/api/factura',{method:'POST',body:JSON.stringify({action:'csr'})}).then(r=>r.json()).then(j=>console.log(j.csr))`
   y copiar el texto (de -----BEGIN a -----END).
3. ARCA con clave fiscal → "Administración de Certificados Digitales" →
   Agregar alias (techpoint) → subir el CSR → descargar el .crt.
4. ARCA → "Administrador de Relaciones de Clave Fiscal" → Nueva relación →
   ARCA → WebServices → "Facturación Electrónica" → Representante: el
   computador fiscal (alias techpoint).
5. Vercel: ARCA_CERT = el .crt nuevo (entero), ARCA_ENTORNO = produccion,
   ARCA_EMITIR_PRODUCCION = si → Redeploy.
6. Primera factura real chica y verificarla con el QR.

### Certificado de producción (29/10/2026)

ARCA lo emitió con el CSR que armó la app (action `csr`): sujeto
CN=TECHPOINT, serialNumber="CUIT 20385199628", emisor CN=Computadores, O=AFIP
(la CA de producción). **Vale hasta el 28/10/2028.** Se verificó que su clave
pública es la misma del CSR, o sea la de ARCA_KEY: no hay que cambiar la clave.
El parte de las 10:30 avisa desde el 28/09/2028.
