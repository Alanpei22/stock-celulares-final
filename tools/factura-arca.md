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
2. **Manual de WSFEv1 versión 4.5**: hace obligatorio el campo
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

## Los tres riesgos, en orden

### 1. La numeración no puede tener huecos ni repetidos
El bug clásico: se pide el CAE, se corta la conexión por timeout, el software
cree que falló y reintenta — pero ARCA sí lo procesó. Resultado: número
duplicado o salteado.

Eso **no es un bug de pantalla, es un problema fiscal**. La solución tiene que
ser idempotente: antes de reintentar, consultar con `FECompConsultar` si ese
número ya se emitió.

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
   "Administración de puntos de venta y domicilios".

   **Un "punto de venta" NO es un local: es una serie de numeración.** El
   local sigue siendo uno solo, mismo CUIT, mismas facturas. Lo único que
   cambia es que cada serie numera por su cuenta:

       PV 0001 (Comprobantes en línea, la web) -> 0001-00000045, 46, 47...
       PV 0002 (Web Services, esta app)         -> 0002-00000001, 2, 3...

   ARCA exige que los PV de Comprobantes en línea, Facturador Plus y Web
   Services sean **distintos entre sí**, y el motivo es justamente el riesgo
   n° 1 de más abajo: si compartieran serie, la web y la app pedirían el
   mismo número siguiente y se pisarían.

   **Efecto lateral bueno:** el PV viejo sigue andando. Si se cae Vercel, se
   rompe un deploy o ARCA rechaza algo, se factura a mano desde la web de ARCA
   sin romper la numeración de la app. Acá no hay staging, así que ese plan B
   vale.
4. **Asociar el certificado al servicio** en el Administrador de Relaciones de
   Clave Fiscal.

Homologación y producción tienen **servidores distintos y certificados
distintos**. No se mezclan.

---

## Plan por fases

| Fase | Qué | Quién |
|---|---|---|
| **0** | Certificado de homologación + confirmar con el contador | Dueño |
| **1** | `/api/factura` + WSAA + consultar último número. **Solo leer** | Claude |
| **2** | Emitir en homologación, con numeración idempotente | Claude |
| **3** | La factura impresa con CAE, vencimiento y QR | Claude |
| **4** | Producción con el certificado real | Los dos |

**La fase 1 es la que despeja las dudas grandes**: si el timeout de Vercel
alcanza y si el flujo del certificado funciona. Antes de pasar eso, no vale la
pena escribir el resto.

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
