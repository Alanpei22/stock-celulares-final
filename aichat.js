// ── AI CHAT FLOTANTE ─────────────────────────────────────────
let _aiChatOpen = false;
let _chatHistory = []; // historial de la conversación (memoria)

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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiChat(); }
}

// ── Contexto real del negocio ─────────────────────────────
function buildStockContext() {
  const lines = [];

  // Stock de equipos
  if (typeof STOCK !== 'undefined' && STOCK.length) {
    lines.push(`📦 STOCK ACTUAL (${STOCK.length} equipos):`);
    STOCK.slice(0, 80).forEach(p => {
      const precio = p.precio ? `$${Number(p.precio).toLocaleString('es-AR')}` : 'sin precio';
      lines.push(`  · ${p.marca || ''} ${p.modelo || ''}${p.almacenamiento ? ' '+p.almacenamiento : ''} | ${p.estado || ''} | ${precio} | ${p.ubicacion || 'Stock'}`);
    });
  }

  // Reparaciones activas
  if (typeof REPAIRS !== 'undefined' && REPAIRS.length) {
    const activas = REPAIRS.filter(r => r.estado !== 'entregado' && r.estado !== 'cancelado');
    lines.push(`\n🔧 REPARACIONES ACTIVAS (${activas.length}):`);
    activas.slice(0, 30).forEach(r => {
      lines.push(`  · N°${r.nOrden} ${r.marca||''} ${r.modelo||''} | ${r.arreglo||''} | ${r.estado||''} | $${(r.monto||0).toLocaleString('es-AR')}`);
    });
  }

  return lines.join('\n');
}

// ── Enviar mensaje ────────────────────────────────────────
async function sendAiChat() {
  const input = document.getElementById('ai-chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  input.style.height = 'auto';

  addChatBubble(msg, 'user');

  // Agregar al historial
  _chatHistory.push({ role: 'user', content: msg });

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
          messages: _chatHistory,          // historial completo = memoria
          stockContext: buildStockContext() // datos reales del negocio
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

    // Guardar respuesta en historial
    _chatHistory.push({ role: 'assistant', content: text });

    // Limitar historial a últimos 20 mensajes (10 intercambios)
    if (_chatHistory.length > 20) _chatHistory = _chatHistory.slice(-20);

    // Detectar comando de agregar stock
    const cmdMatch = text.match(/\{"__cmd":"add_stock"[\s\S]*?\}/);
    if (cmdMatch) {
      try {
        const cmd = JSON.parse(cmdMatch[0]);
        showAddStockConfirm(cmd);
        return;
      } catch {}
    }

    // Detectar comando de actualizar repuestos
    const cmdRepMatch = text.match(/\{"__cmd":"update_repuestos"[\s\S]*?\}/);
    if (cmdRepMatch) {
      try {
        const cmd = JSON.parse(cmdRepMatch[0]);
        showUpdateRepuestosConfirm(cmd);
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

// ── Renderizar burbujas ───────────────────────────────────
function addChatBubble(text, who, withCopy = false) {
  const msgs = document.getElementById('ai-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = `ai-chat-bubble ${who === 'ai' ? 'ai-bubble' : 'user-bubble'}`;

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
        setTimeout(() => { copyBtn.textContent = '📋 Copiar'; copyBtn.classList.remove('copied'); }, 2000);
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

// ── Confirmar agregar stock ───────────────────────────────
function showAddStockConfirm(cmd) {
  const msgs = document.getElementById('ai-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'ai-chat-bubble ai-bubble';

  const precio = cmd.precio ? `$${Number(cmd.precio).toLocaleString('es-AR')}` : '—';
  wrap.innerHTML = `
    ✅ Entendido. ¿Querés agregar este equipo al stock?
    <div class="ai-confirm-card">
      <div class="ai-confirm-title">📱 NUEVO EQUIPO</div>
      <div class="ai-confirm-row"><span>Marca</span><b>${cmd.marca||'—'}</b></div>
      <div class="ai-confirm-row"><span>Modelo</span><b>${cmd.modelo||'—'}</b></div>
      ${cmd.almacenamiento?`<div class="ai-confirm-row"><span>Almacenamiento</span><b>${cmd.almacenamiento}</b></div>`:''}
      <div class="ai-confirm-row"><span>Estado</span><b>${cmd.estado||'Usado'}</b></div>
      <div class="ai-confirm-row"><span>Precio</span><b>${precio}</b></div>
      ${cmd.notas?`<div class="ai-confirm-row"><span>Notas</span><b>${cmd.notas}</b></div>`:''}
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'ai-bubble-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'ai-add-btn';
  addBtn.textContent = '➕ Sí, agregar';
  addBtn.onclick = () => executeAddStock(cmd, actions);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-copy-btn';
  cancelBtn.textContent = '✕ Cancelar';
  cancelBtn.onclick = () => { actions.innerHTML = '<span style="color:#64748b;font-size:.75rem">Cancelado</span>'; };

  actions.appendChild(addBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

async function executeAddStock(cmd, actions) {
  actions.innerHTML = '<span style="color:#94a3b8;font-size:.75rem">⏳ Guardando...</span>';
  try {
    const newPhone = {
      marca:          (cmd.marca||'').trim(),
      modelo:         (cmd.modelo||'').trim(),
      almacenamiento: (cmd.almacenamiento||'').trim(),
      estado:         cmd.estado||'Usado',
      precio:         Number(cmd.precio)||0,
      notas:          cmd.notas||'',
      ubicacion:      'Stock',
      fecha:          new Date().toISOString(),
      vendido:        false,
    };
    if (typeof addPhoneFromAI === 'function') {
      await addPhoneFromAI(newPhone);
    } else if (typeof db !== 'undefined') {
      const ref = db.collection('stock').doc();
      newPhone.id = ref.id;
      await ref.set(newPhone);
    } else {
      throw new Error('Sin conexión a base de datos');
    }
    actions.innerHTML = '<span style="color:#34d399;font-size:.8rem;font-weight:700">✅ ¡Agregado al stock!</span>';
    _chatHistory.push({ role: 'assistant', content: `Equipo ${cmd.marca} ${cmd.modelo} agregado al stock correctamente.` });
  } catch (err) {
    actions.innerHTML = `<span style="color:#ef4444;font-size:.75rem">❌ Error: ${err.message}</span>`;
  }
}

// ── Confirmar actualización de repuestos ─────────────────────
function showUpdateRepuestosConfirm(cmd) {
  const msgs = document.getElementById('ai-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'ai-chat-bubble ai-bubble';

  const items = Array.isArray(cmd.items) ? cmd.items : [];
  const rows = items.map(it =>
    `<div class="ai-confirm-row"><span>${it.marca || ''} · ${it.nombre || ''}</span><b>+${it.cantidad}</b></div>`
  ).join('');

  wrap.innerHTML = `
    ✅ Actualizando cantidades en repuestos:
    <div class="ai-confirm-card">
      <div class="ai-confirm-title">🔩 STOCK DE REPUESTOS</div>
      ${rows}
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'ai-bubble-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'ai-add-btn';
  addBtn.textContent = '➕ Sí, actualizar';
  addBtn.onclick = () => executeUpdateRepuestos(cmd, actions);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-copy-btn';
  cancelBtn.textContent = '✕ Cancelar';
  cancelBtn.onclick = () => { actions.innerHTML = '<span style="color:#64748b;font-size:.75rem">Cancelado</span>'; };

  actions.appendChild(addBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

async function executeUpdateRepuestos(cmd, actions) {
  actions.innerHTML = '<span style="color:#94a3b8;font-size:.75rem">⏳ Actualizando...</span>';
  try {
    if (typeof db === 'undefined') throw new Error('Sin conexión a base de datos');
    const items = Array.isArray(cmd.items) ? cmd.items : [];
    let updated = 0;
    let notFound = [];

    for (const it of items) {
      // Fuzzy match: buscar en REPUESTOS por nombre (contiene) o marca+nombre
      const needle = (it.nombre || '').toLowerCase();
      const marcaNeedle = (it.marca || '').toLowerCase();
      let match = null;

      if (typeof REPUESTOS !== 'undefined') {
        // Exact name match first
        match = REPUESTOS.find(r => (r.nombre || '').toLowerCase() === needle);
        // Fallback: contains
        if (!match) match = REPUESTOS.find(r => (r.nombre || '').toLowerCase().includes(needle) && (!marcaNeedle || (r.marca || '').toLowerCase().includes(marcaNeedle)));
        // Fallback: needle contains repuesto name
        if (!match) match = REPUESTOS.find(r => needle.includes((r.nombre || '').toLowerCase()) && (!marcaNeedle || (r.marca || '').toLowerCase().includes(marcaNeedle)));
      }

      if (match) {
        const nueva = Math.max(0, (match.cantidad || 0) + Number(it.cantidad || 0));
        await db.collection('repuestos').doc(match.id).update({ cantidad: nueva });
        updated++;
      } else {
        notFound.push(it.nombre || '?');
      }
    }

    let msg = `✅ ${updated} repuesto${updated !== 1 ? 's' : ''} actualizado${updated !== 1 ? 's' : ''}.`;
    if (notFound.length) msg += ` No encontrados: ${notFound.join(', ')}`;
    actions.innerHTML = `<span style="color:#34d399;font-size:.8rem;font-weight:700">${msg}</span>`;
    _chatHistory.push({ role: 'assistant', content: `Stock de repuestos actualizado: ${updated} items.` });
  } catch (err) {
    actions.innerHTML = `<span style="color:#ef4444;font-size:.75rem">❌ Error: ${err.message}</span>`;
  }
}

// Auto-resize textarea
document.getElementById('ai-chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
