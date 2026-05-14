import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: Netlify.env.get('ANTHROPIC_API_KEY') });

const PROMPT = `Analizá este PDF de etiquetas FLEX de MercadoLibre Argentina.
Cada página es una etiqueta de envío. Algunas páginas muestran múltiples productos (cuando dice "X productos").

Extraé todos los SKUs con sus cantidades aplicando estas reglas:

1. Buscá líneas con "SKU:" en cada etiqueta
2. El SKU tiene formato BASE o BASE.VARIANTE (separado por punto)
3. Si la base termina en P seguido de número (ej: P6, P12, P3), ese es el tamaño del pack — multiplicá la cantidad del pedido por ese número y eliminá el sufijo Px del base
4. En la variante: eliminá el sufijo AR al final (ej: 46AR → 46); separá letras de números (ej: VERDE46 → VERDE 46)
5. Páginas con "X productos": cada SKU único listado cuenta como 1 unidad
6. Páginas con "X unidades" de un solo SKU: ese es la cantidad de ese SKU
7. Páginas con un solo SKU sin indicación de cantidad: 1 unidad
8. Agrupá SKUs idénticos sumando cantidades

Respondé ÚNICAMENTE con un JSON válido, sin texto adicional, sin markdown:
{"filas":[{"sku":"BASE","variante":"VARIANTE","cant":N},...]}

Donde "variante" es string vacío si no hay variante. Ordenado alfabéticamente por sku.`;

export default async (req) => {
  try {
    const formData = await req.formData();
    const file = formData.get('pdf');
    if (!file) {
      return new Response(JSON.stringify({ ok: false, error: 'Sin archivo' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64
            }
          },
          {
            type: 'text',
            text: PROMPT
          }
        ]
      }]
    });

    const rawText = message.content[0].text.trim();

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Claude no devolvió JSON válido: ' + rawText.substring(0, 200));
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.filas || !Array.isArray(parsed.filas)) {
      throw new Error('Formato inesperado: ' + JSON.stringify(parsed).substring(0, 200));
    }

    return new Response(JSON.stringify({ ok: true, filas: parsed.filas }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/parsear' };
