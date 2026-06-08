# 🔒 Setup de seguridad — pasos manuales

> El código ya quedó listo (PIN hasheado, reglas escritas). Estos pasos
> APLICAN las reglas en Firebase. Hacelos una vez.

## Resumen de lo que se mejoró
- ✅ PIN de dueño ahora se guarda **hasheado con PBKDF2** (antes texto plano). Migración automática: tu PIN actual sigue funcionando.
- ✅ Reglas de Firestore más granulares (protegen el PIN y los backups).
- ✅ Reglas de Storage para las fotos (solo autenticados, solo imágenes, máx 5MB).
- ✅ Índices agregados para queries nuevas.

---

## Cómo aplicar las reglas (2 opciones)

### Opción A — Desde la consola (más fácil, sin instalar nada)

**Firestore rules:**
1. Andá a https://console.firebase.google.com/project/stockcelustech/firestore/rules
2. Borrá lo que haya y pegá el contenido de `firestore.rules`
3. Tocá **"Publicar"**

**Storage rules** (solo si activaste Storage para las fotos):
1. https://console.firebase.google.com/project/stockcelustech/storage/rules
2. Si Storage no está activado, primero "Comenzar" (elegí región `southamerica-east1`)
3. Pegá el contenido de `storage.rules`
4. **"Publicar"**

**Índices:**
1. https://console.firebase.google.com/project/stockcelustech/firestore/indexes
2. Los índices se crean solos la primera vez que la app corre una query que los necesita
   (Firestore te muestra un link en la consola del navegador para crearlos con 1 clic).
   No hace falta crearlos a mano.

### Opción B — Con Firebase CLI (si lo tenés instalado)
```bash
npm install -g firebase-tools   # solo la primera vez
firebase login
firebase deploy --only firestore:rules,storage
```

---

## ⚠️ Importante sobre el PIN
- La primera vez que entres a modo dueño después de este cambio, tu PIN actual
  se va a **migrar solo** a la versión hasheada. No tenés que hacer nada.
- Si reseteaste el PIN alguna vez, el próximo que pongas queda hasheado directamente.

## Verificación rápida (que las reglas estén bien)
1. Abrí la app, entrá normalmente → debe funcionar.
2. En Firebase Console → Firestore → Rules → arriba dice "Última publicación: hace X".
3. Si entrás en modo dueño con tu PIN → funciona = migración OK.
