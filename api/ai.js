export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const { action, data = {} } = body;
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return new Response(JSON.stringify({ error: 'API key no configurada en Vercel' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }

  if (!action) {
    return new Response(JSON.stringify({ error: 'Parámetro action requerido' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  const year = new Date().getFullYear();

  // ── Chat libre con contexto de stock y memoria ──
  if (action === 'chat') {
    const stockCtx = data.stockContext
      ? `\n\nDATOS REALES DEL NEGOCIO HOY:\n${data.stockContext}\n`
      : '';

    const systemPrompt =
`Sos el asistente IA de TechPoint, una tienda y taller de celulares en Argentina.
Tenés acceso a los datos reales del negocio y recordás toda la conversación actual.${stockCtx}
Reglas:
- Respondé en español rioplatense, claro y útil.
- Usá los datos reales del stock cuando te pregunten por equipos disponibles, precios o reparaciones.
- Precios en pesos argentinos (${year}).
- Si te piden listar equipos, usá formato con emojis, uno por línea.
- Si el usuario quiere AGREGAR un equipo al stock (ej: "agregá Samsung A13 128GB nuevo a $90000"), respondé ÚNICAMENTE con este JSON exacto (sin texto antes ni después):
{"__cmd":"add_stock","marca":"...","modelo":"...","almacenamiento":"...","estado":"Nuevo","precio":90000,"notas":""}
- Si el usuario quiere ACTUALIZAR CANTIDADES de repuestos (ej: "actualizá el stock: pantalla Samsung A13 x3, batería Moto G32 x2" o pasa una lista de módulos con cantidades), respondé ÚNICAMENTE con este JSON exacto (sin texto antes ni después):
{"__cmd":"update_repuestos","items":[{"marca":"Samsung","nombre":"Pantalla Samsung A13 S/M","cantidad":3},{"marca":"Motorola","nombre":"Pantalla Moto G32 S/M","cantidad":2}]}
- Para cualquier otra consulta, respondé normalmente en texto.`;

    // Historial completo = memoria de la conversación
    const messages = Array.isArray(data.messages) && data.messages.length
      ? data.messages
      : [{ role: 'user', content: data.message || '' }];

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 900,
          system: systemPrompt,
          messages   // historial completo para memoria
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || 'Error de API');
      return new Response(JSON.stringify({ text: result.content[0].text }), {
        headers: { 'content-type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { 'content-type': 'application/json' }
      });
    }
  }

  // ── Acciones clásicas ──
  const prompts = {
    diagnosis:
`Eres un técnico experto en reparación de celulares en Argentina.
Un ${data.marca} ${data.modelo} llega con este problema: "${data.problema}".
Responde en español, conciso y técnico (máx 150 palabras):
1. **Diagnóstico probable**
2. **Pasos de reparación**
3. **Repuestos posibles**`,

    waMessage:
`Redactá un mensaje de WhatsApp para enviar a un cliente de un taller de celulares en Argentina.
Datos: Nombre: ${data.nombre || 'cliente'}, Equipo: ${data.marca} ${data.modelo}, Estado: ${data.estado}, Arreglo: ${data.arreglo}, Orden N°${data.nOrden}.
El mensaje debe ser cordial, breve (máx 3 líneas), informar el estado${data.estado === 'Listo' || data.estado === 'listo' ? ' e invitar a retirar' : ''}. Usar pocos emojis. Solo el mensaje, sin explicaciones.`,

    timePrice:
`Para la reparación de un ${data.marca} ${data.modelo} — "${data.arreglo}", indicá:
1. Tiempo estimado
2. Precio aproximado en pesos argentinos (rango)
3. Dificultad: Fácil / Media / Difícil
Muy breve, máx 60 palabras. Precios Argentina ${year}.`,

    stockSpecs:
`Para el celular ${data.marca} ${data.modelo}, dame las especificaciones principales en UNA sola línea para ficha de venta.
Formato exacto: "[pant.]" [tipo] | [procesador] | [RAM]/[storage] | [cámara] | [batería]mAh"
Solo esa línea, sin texto extra. Ejemplo: 6.5" AMOLED | Snapdragon 680 | 4GB/128GB | 50MP | 5000mAh`,

    stockPrice:
`Precio de venta en tienda de celulares Argentina ${year} para: ${data.marca} ${data.modelo}${data.almacenamiento ? ' ' + data.almacenamiento : ''}, estado: "${data.estado || 'Usado'}".
Responde SOLO con el rango en pesos: "$XXX.000 - $XXX.000". Sin explicaciones adicionales.`
  };

  if (!prompts[action]) {
    return new Response(JSON.stringify({ error: 'Acción no válida' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        messages: [{ role: 'user', content: prompts[action] }]
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error?.message || 'Error de API');

    return new Response(JSON.stringify({ text: result.content[0].text }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
