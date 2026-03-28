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
- Si el usuario quiere AGREGAR un equipo/celular al stock (ej: "agregá Samsung A13 128GB nuevo a $90000", "entró un iPhone 14"), respondé ÚNICAMENTE con este JSON exacto (sin texto antes ni después):
{"__cmd":"add_stock","marca":"...","modelo":"...","almacenamiento":"...","estado":"Nuevo","precio":90000,"notas":""}
- Si el usuario quiere AGREGAR UN NUEVO REPUESTO/MÓDULO/PIEZA (ej: "agregá pantalla Samsung A54", "entró batería Motorola G32", "nuevo módulo cámara iPhone 13", "agregar flex de carga"), respondé ÚNICAMENTE con este JSON exacto (sin texto antes ni después):
{"__cmd":"add_repuesto","nombre":"...","marca":"...","modelo":"...","tipo":"...","cantidad":1,"stockMin":2,"precioCompra":0,"proveedor":"","notas":""}
Tipos válidos para repuestos: "Pantalla", "Batería", "Conector", "Flex", "Táctil", "Cámara", "Parlante", "Micrófono", "Marco", "Tapa", "Botón", "Board", "Otro"
- Si el usuario quiere ACTUALIZAR CANTIDADES de repuestos ya existentes (ej: "actualizá el stock: pantalla Samsung A13 x3, batería Moto G32 x2"), respondé ÚNICAMENTE con este JSON exacto (sin texto antes ni después):
{"__cmd":"update_repuestos","items":[{"marca":"Samsung","nombre":"Pantalla Samsung A13 S/M","cantidad":3},{"marca":"Motorola","nombre":"Pantalla Moto G32 S/M","cantidad":2}]}
- IMPORTANTE: Un módulo, pantalla, batería, flex, conector, cámara, tapa, marco = REPUESTO (usa add_repuesto). Un celular, smartphone, equipo = STOCK (usa add_stock).
- Para cualquier otra consulta, respondé normalmente en texto.`;

    // Historial completo = memoria de la conversación
    let messages = Array.isArray(data.messages) && data.messages.length
      ? data.messages
      : [{ role: 'user', content: data.message || '' }];

    // Si el último mensaje tiene imagen adjunta, convertirlo a content array con visión
    if (data.imageBase64 && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === 'user' && typeof last.content === 'string') {
        messages = [
          ...messages.slice(0, -1),
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: data.imageMediaType || 'image/jpeg', data: data.imageBase64 } },
              { type: 'text', text: last.content || 'Analizá esta imagen y extraé toda la información relevante sobre el repuesto o equipo.' }
            ]
          }
        ];
      }
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
Responde SOLO con el rango en pesos: "$XXX.000 - $XXX.000". Sin explicaciones adicionales.`,

    extractEquipo:
`Extraé los datos de este equipo/celular.${data.imageBase64 ? ' Analizá la imagen adjunta.' : ''}${data.texto ? ` Descripción adicional: "${data.texto}"` : ''}
Respondé ÚNICAMENTE con este JSON (sin texto antes ni después, sin markdown):
{"marca":"","modelo":"","estado":"","precio":0,"almacenamiento":"","ram":"","bateria":0,"imei":"","notas":""}
Reglas:
- estado: solo "Nuevo", "Usado" o "Reacondicionado" (si no se menciona, usá "Usado")
- precio: número entero en pesos argentinos (0 si no se menciona)
- almacenamiento: formato "128GB", "256GB", etc. (vacío si no se menciona)
- ram: formato "4GB", "8GB", etc. (vacío si no se menciona)
- bateria: porcentaje de batería como número (0 si no se menciona)
- imei: solo dígitos, 15 caracteres (vacío si no se menciona)
- notas: detalles adicionales relevantes`,

    extractRepuesto:
`Extraé los datos de este repuesto/accesorio.${data.imageBase64 ? ' Analizá la imagen adjunta (puede ser foto del repuesto, caja, etiqueta o factura).' : ''}${data.texto ? ` Descripción adicional: "${data.texto}"` : ''}
Respondé ÚNICAMENTE con este JSON (sin texto antes ni después, sin markdown):
{"nombre":"","marca":"","modelo":"","tipo":"","cantidad":1,"stockMin":2,"precioCompra":0,"proveedor":"","notas":""}
Reglas:
- nombre: nombre descriptivo del repuesto (ej: "Pantalla Samsung A54 OLED")
- tipo: uno de estos valores exactos: "Pantalla", "Batería", "Conector", "Flex", "Táctil", "Cámara", "Parlante", "Micrófono", "Marco", "Tapa", "Botón", "Board", "Otro"
- cantidad: número entero de unidades (1 si no se menciona)
- stockMin: stock mínimo sugerido (2 si no se especifica)
- precioCompra: precio de compra en pesos (0 si no se menciona)
- proveedor: nombre del proveedor o negocio si aparece (vacío si no se menciona)`
  };

  if (!prompts[action]) {
    return new Response(JSON.stringify({ error: 'Acción no válida' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    });
  }

  // Construir mensaje con o sin imagen
  const buildUserMsg = (text, imageBase64, imageMediaType) => {
    if (!imageBase64) return [{ role: 'user', content: text }];
    return [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text }
      ]
    }];
  };

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
        max_tokens: 400,
        messages: buildUserMsg(prompts[action], data.imageBase64, data.imageMediaType)
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
