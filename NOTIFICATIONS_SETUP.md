# 🔔 Setup de notificaciones push (Fase 2)

> **Fase 1 (banners in-app)** funciona automáticamente sin ningún setup.
> Esta guía es para activar la **Fase 2 (push del sistema)** vía Vercel + GitHub Actions.

---

## Resumen
- **Backend:** 3 Vercel Functions (`/api/send-push`, `/api/cron-cierre-pendiente`, `/api/cron-reparaciones-demoradas`).
- **Cron:** GitHub Actions dispara los crons (gratis).
- **Costo:** $0/mes para uso normal.
- **Tiempo de setup:** ~20-30 minutos.

---

## ✅ Checklist de pasos

### 1️⃣ Generar VAPID keys (1 vez, local)

En tu máquina, en cualquier carpeta:

```bash
npx web-push generate-vapid-keys
```

Te imprime algo así:
```
Public Key:
BMv...
Private Key:
xCq...
```

**Guardalas** — las usás en los pasos siguientes.

---

### 2️⃣ Pegar la PUBLIC key en `webpush.js`

Abrí `webpush.js` y reemplazá la línea:

```js
const VAPID_PUBLIC_KEY = window.VAPID_PUBLIC_KEY || '';
```

Por:

```js
const VAPID_PUBLIC_KEY = 'BMv...'; // tu public key
```

(La pública es segura de exponer en frontend; la privada NO.)

---

### 3️⃣ Crear Service Account de Firebase (para Admin SDK)

1. Andá a https://console.firebase.google.com/ → tu proyecto
2. ⚙️ → **Project Settings** → **Service Accounts** → **Generate new private key**
3. Descargás un JSON. **Copiá el contenido completo del archivo.**

---

### 4️⃣ Configurar variables de entorno en Vercel

Andá a https://vercel.com/dashboard → tu proyecto → **Settings** → **Environment Variables**.

Agregá las siguientes (todas en "Production" + "Preview" + "Development"):

| Name | Value |
|------|-------|
| `VAPID_PUBLIC_KEY` | la public key del paso 1 |
| `VAPID_PRIVATE_KEY` | la private key del paso 1 |
| `VAPID_SUBJECT` | `mailto:tu-email@gmail.com` |
| `FIREBASE_SERVICE_ACCOUNT` | el JSON entero del paso 3 (en una sola línea, sin saltos) |
| `CRON_SECRET` | una contraseña random — generá una con: `openssl rand -hex 32` o https://generate-secret.vercel.app/32 |
| `PUBLIC_URL` | `https://stock-celulares-final.vercel.app` (sin slash final) |

**Importante**: el `FIREBASE_SERVICE_ACCOUNT` tiene que ser el JSON COMPLETO en una sola línea. Vercel acepta multilínea pero por las dudas, podés minificarlo con un editor o con:

```bash
cat path/to/service-account.json | tr -d '\n' | tr -d ' '
```

(Pero asegurate de NO romper los espacios dentro de strings.)

---

### 5️⃣ Configurar GitHub Secrets

Andá a https://github.com/Alanpei22/stock-celulares-final/settings/secrets/actions

Agregá:

| Name | Value |
|------|-------|
| `BASE_URL` | `https://stock-celulares-final.vercel.app` (sin slash final) |
| `CRON_SECRET` | el mismo valor que pusiste en Vercel |

---

### 6️⃣ Deploy

```bash
git add -A
git commit -m "Setup notifications"
git push origin main
```

Vercel auto-deploya con `package.json` y las funciones `/api/*`.

---

### 7️⃣ Probar

1. Abrí la PWA → menú ⋮ → **🔔 Notificaciones**
2. Activá el toggle **"Recibir push en este dispositivo"**
3. Te pide permiso del navegador → aceptar
4. Te pide nombre del dispositivo (ej *"Mi celu"*) → aceptar
5. Tocá **"🧪 Enviar push de prueba"**
6. Si todo está OK, te llega una notif del sistema en ~3 segundos.

**Si NO llega:**
- F12 → Console → buscá errores con `[push]`
- Vercel dashboard → Deployments → última función → Logs (errores del backend)
- Verificá que las env vars estén cargadas (Vercel: Settings → Environment Variables debe tener los 6 nombres)

---

### 8️⃣ Verificar que los crons funcionan

Después de deployar, andá a:
https://github.com/Alanpei22/stock-celulares-final/actions/workflows/notifications-cron.yml

→ **Run workflow** → manual trigger.

Si todo está bien, debería completarse verde y te llega push (si es la hora apropiada).

Los crons automáticos corren:
- **19:30 AR** (22:30 UTC) → cierre pendiente
- **10:00 AR** (13:00 UTC) → reparaciones demoradas

> Nota: GitHub Actions puede tener delay de hasta ~10 min en horarios pico. No es exacto al minuto.

---

## 🛠 Troubleshooting

**"VAPID_PUBLIC_KEY env vars faltantes"**
→ Falta una env var en Vercel. Revisá el paso 4.

**"unauthorized" en cron**
→ Falta `CRON_SECRET` o no coincide entre Vercel y GitHub Secrets.

**Push llega como "Notificación" sin contenido**
→ La función está enviando pero el SW no decodifica bien. Revisá `sw.js`.

**No aparece el botón "Activar push"**
→ El navegador no soporta push (Safari iOS solo lo soporta si la PWA está **instalada** en home screen).

**iOS no recibe push**
→ La PWA tiene que estar **instalada** (compartir → "Agregar a inicio"). En Safari abierto no funciona.

---

## 💵 Costos

- **Vercel Functions**: 100k invocaciones/mes gratis. Tu uso real: ~5/día = ~150/mes.
- **GitHub Actions**: 2000 min/mes gratis. Tu uso real: ~1 min/día = ~30 min/mes.
- **Firebase**: el plan Spark (gratis) alcanza para Firestore reads/writes.

**Total: $0/mes** para uso normal.

---

## 🔐 Seguridad

- **VAPID_PRIVATE_KEY** vive solo en Vercel env vars. Si se filtra, regenerá un par nuevo (paso 1) y actualizá.
- **CRON_SECRET** evita que terceros disparen tus crons. Si se filtra, generá uno nuevo y actualizá Vercel + GitHub Secrets.
- **FIREBASE_SERVICE_ACCOUNT** tiene poderes admin sobre tu proyecto. **Nunca lo comitees al repo.** Si se filtra, revocálo en Firebase Console → Service Accounts.

---

## 📋 Archivos creados

```
api/
  send-push.js                      ← endpoint principal de envío
  cron-cierre-pendiente.js          ← llamado por GitHub Actions 19:30
  cron-reparaciones-demoradas.js    ← llamado por GitHub Actions 10:00
.github/workflows/
  notifications-cron.yml             ← cron de GH Actions
notifications.js                     ← módulo client-side (config + reglas in-app)
webpush.js                           ← suscripción cliente al Push API
notif-settings.js                    ← controlador de la pantalla de config
package.json                         ← deps: web-push + firebase-admin
```
