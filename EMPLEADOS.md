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
| Hacer el chequeo de caja obligatorio | Ver cuánto tenía que haber (cuenta a ciegas) |
| | Configurar o saltear el chequeo |
| Corregir un movimiento que cargó mal | **Borrar** movimientos, equipos o reparaciones |
| | Ver el Dashboard, Estadísticas ni Configuración |
| | Entrar en modo dueño (ver costos y ganancias) |

La lista de movimientos del día **sí** se ve: es lo que evita cargar dos veces
la misma venta. Los totales, no.

## Agregar un empleado — desde la app

**☰ (Inicio o Stock) → 👥 Empleados** (solo el dueño, pide el PIN).

1. Nombre, usuario (ej: `nacho`) y una contraseña provisoria (el 🎲 sugiere una).
2. **Crear cuenta** → aparecen los datos para pasarle, con botón de WhatsApp.
3. El empleado entra en `login.html` con **usuario y contraseña** (no necesita mail).

Desde la misma pantalla: 🔑 cambiar la contraseña, ✏️ el nombre (es el que
firma las ventas y reparaciones) y ⛔ **Desactivar** (no entra más; la sesión
que tenga abierta se corta en menos de una hora). Lo que cargó queda igual.

### Cómo funciona por adentro
La cuenta se crea en `/api/usuarios` (solo el dueño puede llamarlo) con la
marca `rol: 'empleado'` (custom claim de Firebase Auth). Esa marca solo la
puede poner el servidor, con la clave de administrador: registrarse en Firebase
no alcanza. `firestore.rules`, `storage.rules` y `/api` aceptan esa marca, así
que **sumar un empleado ya no es tocar código ni publicar reglas**.

### Una sola vez: publicar las reglas
Las reglas que aceptan la marca hay que publicarlas una vez (no viajan con el
git push):

```bash
firebase deploy --only firestore:rules,storage --project stockcelustech
```

O a mano: copiar `firestore.rules` en
https://console.firebase.google.com/project/stockcelustech/firestore/rules y
`storage.rules` en
https://console.firebase.google.com/project/stockcelustech/storage/rules →
*Publicar* en cada una.

## Sacarle el acceso a alguien

👥 Empleados → ⛔ Desactivar. Si no tenés la app a mano: Firebase Console →
Authentication → deshabilitar la cuenta.

## Cargado a mano (la forma vieja)

Sigue andando para cuentas que ya existían: anotar el UID en `roles.js`
(`TP_USUARIOS`), `firestore.rules` (`esEmpleado`) y `api/_auth.js`
(`EMPLEADOS`), y publicar las reglas. `tests/test-roles.js` controla que las
tres listas coincidan.

## Lo que NO es esto

Esconder un botón no protege nada: cualquiera con la consola del navegador
abierta puede llamar a la función. Lo que decide es `firestore.rules`. Por eso
la plata del día (arqueos, cierres, turnos, caja del dueño) y el PIN de dueño
están cerrados **ahí**, no solo en la pantalla.
