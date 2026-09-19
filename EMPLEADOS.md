# Cuentas de empleado

Cada empleado entra con **su** cuenta desde su celular. Así queda registrado
quién cargó cada venta y cada reparación, y se le puede sacar el acceso a uno
solo sin tocar el resto.

## Qué ve un empleado

| Puede | No puede |
|---|---|
| Tomar reparaciones y cambiarles el estado | Ver el efectivo en caja y el neto del día |
| Ingresar equipos al stock (uno o por lote) | Ver apertura, ingresos, egresos, desglose |
| Cargar ventas y gastos en la caja | Abrir el reporte del día ni el cierre |
| Cargar productos al inventario | Hacer el arqueo ni el cierre de turno |
| Ver la lista de movimientos del día | Ver otros días |
| Corregir un movimiento que cargó mal | **Borrar** movimientos, equipos o reparaciones |
| | Ver el Dashboard, Estadísticas ni Configuración |
| | Entrar en modo dueño (ver costos y ganancias) |

La lista de movimientos del día **sí** se ve: es lo que evita cargar dos veces
la misma venta. Los totales, no.

## Agregar un empleado — 3 pasos

### 1. Crearle la cuenta
Firebase Console → **Authentication** → *Agregar usuario*:
https://console.firebase.google.com/project/stockcelustech/authentication/users

Poné su mail y una contraseña provisoria (que después la cambie con
"olvidé mi contraseña"). Copiá el **UID** que aparece en la fila.

### 2. Anotarlo en los dos lugares

**`roles.js`**, en `TP_USUARIOS`:
```js
'EL-UID-QUE-COPIASTE': { nombre: 'Nacho', rol: 'empleado' },
```

**`firestore.rules`**, en la lista de `esEmpleado()`:
```
'EL-UID-QUE-COPIASTE'   // nacho@...
```

Los dos tienen que decir lo mismo. Si se separan, `npm test` falla
(`tests/test-roles.js`).

### 3. Publicar — son dos cosas distintas

```bash
npm test && git push
```
Eso sube la **app**: lo que se ve y lo que no.

```bash
firebase deploy --only firestore:rules --project stockcelustech
```
Eso sube las **reglas**: lo que de verdad se puede hacer contra la base.
**No viajan con el git push.** Sin este paso el empleado no puede ni entrar
(la base le niega todo), y las pantallas escondidas son solo cosmética.

Si no tenés el CLI: se pueden pegar a mano en
https://console.firebase.google.com/project/stockcelustech/firestore/rules
y tocar *Publicar*.

## Sacarle el acceso a alguien

Borralo de las dos listas y volvé a hacer los dos deploys. Si es urgente y no
estás en la PC: Firebase Console → Authentication → deshabilitar la cuenta.
Eso corta el acceso al instante sin tocar código.

## Lo que NO es esto

Esconder un botón no protege nada: cualquiera con la consola del navegador
abierta puede llamar a la función. Lo que decide es `firestore.rules`. Por eso
la plata del día (arqueos, cierres, turnos, caja del dueño) y el PIN de dueño
están cerrados **ahí**, no solo en la pantalla.
