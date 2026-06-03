// ══════════════════════════════════════════
//  bluetooth-print.js — Impresión térmica 58mm
//  Android: vía RawBT (app puente) por Bluetooth
//  PC: usa la impresión del sistema (window.print)
// ══════════════════════════════════════════
'use strict';

const TERM_WIDTH = 32; // caracteres por línea en 58mm (fuente A)

// ── Helpers de formato de texto ─────────────
function termLine(ch = '-') { return ch.repeat(TERM_WIDTH); }

function termCenter(text) {
  text = String(text || '');
  if (text.length >= TERM_WIDTH) return text.slice(0, TERM_WIDTH);
  const pad = Math.floor((TERM_WIDTH - text.length) / 2);
  return ' '.repeat(pad) + text;
}

// Texto a izquierda + valor a derecha en la misma línea
function termLR(left, right) {
  left = String(left || ''); right = String(right || '');
  const space = TERM_WIDTH - left.length - right.length;
  if (space < 1) {
    // No entra en una línea → cortar el left
    const maxLeft = Math.max(0, TERM_WIDTH - right.length - 1);
    left = left.slice(0, maxLeft);
    return left + ' ' + right;
  }
  return left + ' '.repeat(space) + right;
}

// Envuelve texto largo en varias líneas de 32
function termWrap(text) {
  text = String(text || '');
  const out = [];
  while (text.length > TERM_WIDTH) {
    let cut = text.lastIndexOf(' ', TERM_WIDTH);
    if (cut <= 0) cut = TERM_WIDTH;
    out.push(text.slice(0, cut));
    text = text.slice(cut).trim();
  }
  if (text) out.push(text);
  return out.join('\n');
}

function _isAndroid() { return /Android/i.test(navigator.userAgent); }

// ── Envío a RawBT (Android) ─────────────────
// RawBT acepta texto plano por su esquema URL. Le agregamos feed final.
function printRawBT(text) {
  const payload = text + '\n\n\n';
  const url = 'rawbt:' + encodeURIComponent(payload);
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { a.remove(); } catch {} }, 1500);
}

// ── Impresión vía sistema (fallback PC) ─────
// Abre una ventana con el texto en monoespaciado angosto y dispara print().
function printSystemThermal(text, title) {
  const w = window.open('', '_blank', 'width=380,height=600');
  if (!w) { if (typeof toast === 'function') toast('Habilitá los popups para imprimir', 'error'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title || 'Ticket'}</title>
    <style>
      @page { size: 58mm auto; margin: 2mm; }
      body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.35; white-space: pre-wrap; width: 54mm; margin: 0; }
    </style></head><body>${_escHtml(text)}</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 350);
}

function _escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── API pública ─────────────────────────────
// Imprime un ticket de texto. Decide el método según dispositivo.
function imprimirTermica(text, opts = {}) {
  const title = opts.title || 'Ticket';
  if (_isAndroid()) {
    // En Android intentamos RawBT. Si no está instalado, no pasa nada visible,
    // así que mostramos un aviso por las dudas.
    printRawBT(text);
    if (typeof toast === 'function') {
      toast('🖨️ Enviado a la impresora (RawBT)', 'success');
    }
  } else {
    // PC u otro: impresión del sistema
    printSystemThermal(text, title);
  }
}

// Convierte el texto del reporte (con *negritas* de WhatsApp y emojis)
// a un formato más limpio para ticket de 58mm.
function reporteToTermica(rawText) {
  // Quitar marcadores de WhatsApp (* _) y envolver líneas a 32 chars
  const sinMarkdown = String(rawText || '')
    .replace(/\*/g, '')
    .replace(/_/g, '');
  // Wrap por línea respetando saltos existentes
  return sinMarkdown.split('\n').map(line => termWrap(line)).join('\n');
}
