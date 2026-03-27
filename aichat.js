// ── AI CHAT FLOTANTE ─────────────────────────────────────────
// Capacidades:
// 1. Consultas libres (precios, listados, recomendaciones)
// 2. Agregar stock con lenguaje natural
// 3. Contexto del stock actual para respuestas precisas
// 4. Diagnóstico de reparaciones
// 5. Redactar mensajes de WhatsApp para clientes
// 6. Análisis del negocio (qué equipos rotan más, etc.)

let _aiChatOpen = false;

function toggleAiChat() {
  _aiChatOpen ? closeAiChat() : openAiChat();
}

function openAiChat() {
  _aiChatOpen = true;
  document.getElementById('ai-chat-overlay').classList.remove('hidden');
  document.getElementById('ai-chat-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('ai-chat-input').focus(), 100);
}

function closeAiChat() {
  _aiChatOpen = false;
  document.getElementById('ai-chat-overlay').classList.add('hidden');
  document.getElementById('ai-chat-modal').classList.add('hidden');
}

function aiChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAiChat();
  }
}

// Construye un resumen del stock actual para dar contexto a la IA
function buildStockContext() {
  try {
    // Intentar acceder a datos de PHONES (stock) si están disponibles
    if (typeof PHONES !== 'undefined' && PHONES.length) {
      const resumen = PHONES.slice(0, 60).map(p =>
        `${p.marca} ${p.modelo}${p.almacenamiento ? ' '+p.almacenamiento : ''} | ${p.estado || ''} | $${(p.precio||0).toLocaleString('es-AR')}`
      ).join('\n');
      return `Stock actual (${PHONES.length} equipos):\n${resumen}`;
    }
  } catch {}
  return '';
}

async function sendAiChat() {
  const input = document.getElementById('ai-chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  input.style.height = 'auto';

  // Agregar burbuja del usuario
  addChatBubble(msg, 'user');

  // Mostrar typing
  const typingEl = addTyping();

  const btn = document.getElementById('ai-chat-send');
  btn.disabled = true;

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'chat',
        data: {
          message: msg,
          stockContext: buildStockContext()
        }
      })
    });
    const json = await res.json();
    typingEl.remove();

    if (json.error) {
      addChatBubble(`⚠️ Error: ${json.error}`, 'ai');
      return;
    }

    const text = json.text || '';

    // Detectar si es un comando de agregar stock
    const cmdMatch = text.match(/\{"__cmd":"add_stock"[\s\S]*\}/);
    if (cmdMatch) {
      try {
        const cmd = JSON.parse(cmdMatch[0]);
        showAddStockConfirm(cmd);
        return;
      } catch {}
    }

    addChatBubble(text, 'ai', true);
  } catch (err) {
    typingEl.remove();
    addChatBubble('⚠️ No se pudo conectar con la IA. Intentá de nuevo.', 'ai');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function addChatBubble(text, who, withCopy = false) {
  const msgs = document.getElementById('ai-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = `ai-chat-bubble ${who === 'ai' ? 'ai-bubble' : 'user-bubble'}`;

  // Convertir markdown básico
  const html = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>');

  wrap.innerHTML = html;

  if (who === 'ai' && withCopy) {
    const actions = document.createElement('div');
    actions.className = 'ai-bubble-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ai-copy-btn';
    copyBtn.textContent = '📋 Copiar';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✅ Copiado';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = '📋 Copiar';
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    };
    actions.appendChild(copyBtn);
    wrap.appendChild(actions);
  }

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function addTyping() {
  const msgs = document.getElementById('ai-chat-messages');
  const el = document.createElement('div');
  el.className = 'ai-typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

// ── Confirmar agregar stock ───────────────────────────────────
function showAddStockConfirm(cmd) {
  const msgs = document.getElementById('ai-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'ai-chat-bubble ai-bubble';

  const precio = cmd.precio ? `$${Number(cmd.precio).toLocaleString('es-AR')}` : '—';
  wrap.innerHTML = `
    ✅ Entendido. ¿Querés agregar este equipo al stock?
    <div class="ai-confirm-card">
      <div class="ai-confirm-title">📱 NUEVO EQUIPO</div>
      <div class="ai-confirm-row"><span>Marca</span><b>${cmd.marca || '—'}</b></div>
      <div class="ai-confirm-row"><span>Modelo</span><b>${cmd.modelo || '—'}</b></div>
      ${cmd.almacenamiento ? `<div class="ai-confirm-row"><span>Almacenamiento</span><b>${cmd.almacenamiento}</b></div>` : ''}
      <div class="ai-confirm-row"><span>Estado</span><b>${cmd.estado || 'Usado'}</b></div>
      <div class="ai-confirm-row"><span>Precio</span><b>${precio}</b></div>
      ${cmd.notas ? `<div class="ai-confirm-row"><span>Notas</span><b>${cmd.notas}</b></div>` : ''}
    </div>
    <div class="ai-bubble-actions">
  `;

  const addBtn = document.createElement('button');
  addBtn.className = 'ai-add-btn';
  addBtn.textContent = '➕ Sí, agregar';
  addBtn.onclick = () => executeAddStock(cmd, wrap);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-copy-btn';
  cancelBtn.textContent = '✕ Cancelar';
  cancelBtn.onclick = () => {
    wrap.querySelector('.ai-bubble-actions').innerHTML = '<span style="color:#64748b;font-size:.75rem">Cancelado</span>';
  };

  const actions = wrap.querySelector('.ai-bubble-actions');
  actions.appendChild(addBtn);
  actions.appendChild(cancelBtn);

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

async function executeAddStock(cmd, wrap) {
  const actions = wrap.querySelector('.ai-bubble-actions');
  actions.innerHTML = '<span style="color:#94a3b8;font-size:.75rem">⏳ Guardando...</span>';

  try {
    // Construir objeto compatible con el formato de la app
    const newPhone = {
      marca: (cmd.marca || '').trim(),
      modelo: (cmd.modelo || '').trim(),
      almacenamiento: (cmd.almacenamiento || '').trim(),
      estado: cmd.estado || 'Usado',
      precio: Number(cmd.precio) || 0,
      notas: cmd.notas || '',
      ubicacion: 'Stock',
      fecha: new Date().toISOString(),
      vendido: false,
    };

    // Usar la función global de la app si existe
    if (typeof addPhoneFromAI === 'function') {
      await addPhoneFromAI(newPhone);
    } else if (typeof db !== 'undefined') {
      const ref = db.collection('phones').doc();
      newPhone.id = ref.id;
      await ref.set(newPhone);
    } else {
      throw new Error('No se encontró la conexión con la base de datos');
    }

    actions.innerHTML = '<span style="color:#34d399;font-size:.8rem;font-weight:700">✅ ¡Equipo agregado al stock!</span>';
    addChatBubble(`📱 ${cmd.marca} ${cmd.modelo} agregado correctamente. Ya aparece en el stock.`, 'ai');
  } catch (err) {
    actions.innerHTML = `<span style="color:#ef4444;font-size:.75rem">❌ Error: ${err.message}</span>`;
  }
}

// Auto-resize del textarea
document.getElementById('ai-chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
