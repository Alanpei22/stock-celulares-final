/**
 * AVISO DE TRANSFERENCIA DE MERCADOPAGO → notificación en todos los dispositivos
 * ─────────────────────────────────────────────────────────────────────────────
 * Por qué esto y no un webhook de MercadoPago: MP solo notifica COBROS
 * (QR, link, Point). Las transferencias que te mandan al alias/CVU no tienen
 * evento de webhook. Lo único que llega siempre es el mail, así que lo leemos.
 *
 * Dónde va: script.google.com → Nuevo proyecto → pegar esto → guardar.
 * Se ejecuta solo cada 1 minuto (ver instrucciones abajo).
 *
 * NO registra nada en la caja. Solo avisa.
 */

// ── 1. COMPLETAR ESTOS DOS VALORES ──────────────────────────────────────────
var URL_APP = 'https://stock-celulares-final.vercel.app';
var SECRETO = 'PEGAR_ACA_EL_CRON_SECRET';   // el mismo CRON_SECRET que está en Vercel
// ────────────────────────────────────────────────────────────────────────────

// Etiqueta que se le pone al mail ya avisado, para no avisar dos veces
var ETIQUETA = 'MP-avisado';

/**
 * Función principal. Es la que hay que poner en el disparador.
 */
function avisarTransferencias() {
  var etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);

  // Solo mails de MercadoPago del último día que todavía no avisamos
  var hilos = GmailApp.search(
    'from:mercadopago newer_than:1d -label:' + ETIQUETA, 0, 20);

  for (var i = 0; i < hilos.length; i++) {
    var mensajes = hilos[i].getMessages();
    var m = mensajes[mensajes.length - 1];           // el último del hilo
    var asunto = m.getSubject() || '';
    var cuerpo = m.getPlainBody() || '';

    var datos = leerTransferencia(asunto, cuerpo);
    if (!datos) continue;                            // no es una transferencia

    enviarAviso(datos);
    hilos[i].addLabel(etiqueta);
  }
}

/**
 * Saca el monto y quién mandó la plata. Devuelve null si el mail no es
 * una transferencia recibida (así no avisamos por resúmenes, promos, etc).
 */
function leerTransferencia(asunto, cuerpo) {
  var texto = asunto + '\n' + cuerpo;

  // Tiene que hablar de plata que ENTRA
  var esEntrada = /te transfiri|recibiste|te envi[oó]|ingresó dinero|te depositaron/i.test(texto);
  if (!esEntrada) return null;

  // Descartar avisos que NO son plata entrando
  if (/pago rechazado|no pudimos|vencimiento|promoci|resumen|factura|tarjeta/i.test(asunto)) return null;

  // Monto: "$ 25.000,50" o "$25000"
  var monto = '';
  var mm = texto.match(/\$\s?([\d.]+(?:,\d{1,2})?)/);
  if (mm) monto = '$' + mm[1];

  // Quién: "Juan Pérez te transfirió"
  var quien = '';
  var qq = texto.match(/([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.'-]+){0,2})\s+te (?:transfiri|envi)/i);
  if (qq) quien = qq[1].trim();

  return { monto: monto, quien: quien, asunto: asunto };
}

/**
 * Dispara la notificación a todos los dispositivos con push activado.
 */
function enviarAviso(d) {
  var titulo = '💸 TRANSFERENCIA RECIBIDA' + (d.monto ? ' · ' + d.monto : '');
  var cuerpo = [
    d.quien ? 'De: ' + d.quien : '',
    d.monto ? 'Monto: ' + d.monto : '',
    'MercadoPago',
  ].filter(String).join('\n');

  var respuesta = UrlFetchApp.fetch(URL_APP + '/api/send-push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + SECRETO },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      targets: 'all',
      title: titulo,
      body: cuerpo,
      url: '/caja.html',
      tag: 'mp-transfer',
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 450],
      actions: [{ action: 'ver', title: '👀 Ver caja' }, { action: 'descartar', title: '✕ Ok' }],
    }),
  });

  Logger.log('Aviso enviado: ' + titulo + ' → ' + respuesta.getResponseCode());
}

/**
 * Para probar sin esperar una transferencia real.
 * Ejecutala a mano desde el menú de arriba y fijate que llegue la notificación.
 */
function probarAviso() {
  enviarAviso({ monto: '$ 25.000', quien: 'Prueba', asunto: 'prueba' });
}

/* ─────────────────────────────────────────────────────────────────────────────
   CÓMO DEJARLO ANDANDO

   1. Entrá a script.google.com con la cuenta de Gmail que recibe los mails de
      MercadoPago → "Nuevo proyecto" → borrá lo que haya y pegá todo esto.
   2. Completá SECRETO con el CRON_SECRET que ya tenés en Vercel
      (Vercel → el proyecto → Settings → Environment Variables).
   3. Guardá (💾) y ponele un nombre al proyecto.
   4. Arriba, elegí la función "probarAviso" y tocá "Ejecutar".
      La primera vez te va a pedir permiso para leer Gmail: aceptá.
      Si todo está bien, te llega la notificación de prueba a los celulares.
   5. En el menú de la izquierda, "Activadores" (el relojito) → "Añadir activador":
        · Función: avisarTransferencias
        · Origen del evento: Según tiempo
        · Tipo: Temporizador por minutos → Cada minuto
      Guardar.

   LISTO. A partir de ahí, cada transferencia que te avise MercadoPago por mail
   dispara la notificación en menos de un minuto.

   SI ALGO NO ANDA: en Apps Script, "Ejecuciones" te muestra el registro de cada
   corrida y el error si lo hubo.
   ───────────────────────────────────────────────────────────────────────────── */
