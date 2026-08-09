# Pruebas

```bash
npm test
```

Corre todo en ~1 segundo. **Si algo falla, no pushees**: producción se deploya
sola con el push a `main`.

## Por qué son así

La app está detrás de un login y usa Firebase, así que no se puede abrir en un
navegador automático para probarla. En vez de eso, cada prueba carga los
archivos de verdad (`caja.js`, `repairs.js`, `print.js`…) dentro de una sandbox
de node, con un Firestore y un DOM falsos, y revisa lo que hacen: qué se
guarda, qué se muestra y qué se le manda al cliente.

Es la única forma de verificar la parte que maneja plata sin cargar ventas de
prueba en la caja real.

## Qué cubre cada una

| Archivo | Qué protege |
|---|---|
| `test-carrito.js` | Cobrar una reparación y productos en la misma venta, con los montos separados y la ganancia bien calculada |
| `test-fases.js` | El tablero de fases, los SLA, el deshacer, los avisos push y que el QR del cliente se actualice **por todos los caminos** |
| `test-cupo.js` | Que la app no vuelva a leer colecciones enteras al abrirse (fue lo que agotó el cupo diario de Firebase) |
| `test-qr.js` | El generador de QR propio. Incluye un lector que decodifica el QR generado: si el texto vuelve igual, se puede escanear |
| `test-fase3.js` | La página pública del cliente y, sobre todo, **qué datos NO expone** |
| `test-venta-a5.js` | Los comprobantes A5 de recepción y de venta (original + copia) |
| `test-barra.js` | La barra de pasos, en la app y en la página del cliente |
| `test-push-sw.js` | Cómo muestra las notificaciones el service worker |
| `test-sync.js` | El indicador de sincronización |
| `test-repuesto-nombre.js` | Que un repuesto muestre y guarde el modelo, no solo la marca |
| `test-mp-mail.js` | El filtro de mails de MercadoPago del script de Gmail (`tools/`) |

## Agregar una prueba

Un archivo `test-loquesea.js` en esta carpeta. Tiene que:

1. Terminar con `process.exit(1)` si algo falló (así lo detecta `run.js`).
2. Imprimir cada chequeo empezando con dos espacios y `OK` o `FAIL`.

La forma más rápida es copiar el patrón de `test-sync.js`, que es el más corto.

Esta carpeta no se publica: está en `.vercelignore`.
