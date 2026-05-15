import Anthropic from '@anthropic-ai/sdk';
import { getStore } from '@netlify/blobs';
import { extractFields } from './_multipart.js';

const PROMPT = `Analizá este PDF de etiquetas de MercadoLibre Argentina.
Cada página es una etiqueta de envío.

Necesito DOS cosas:

## 1. TABLA DE SKUs

Para cada etiqueta, identificá el/los SKU(s) y su cantidad:
- CRÍTICO: el SKU está SIEMPRE precedido por la palabra "SKU:" en la etiqueta. Buscá esa etiqueta específicamente. Todo lo demás (Nombre del comprador, Descripción del producto, Color:, Talle:, Pack Id:, Nombre:, etc.) NO es el SKU. Si no encontrás el campo "SKU:" en la página, devolvé sku="" para esa página.
- El SKU en la etiqueta tiene el formato BASE.COLOR+TALLE o BASE-COLOR+TALLE (el separador puede ser punto o guion), por ejemplo: OMPISF02.NEGRO38, FNAPOLO0.AZUL42, EO020000P12.ROJO46, FD700300-BLANCO. Devolvé siempre con punto como separador (BASE.COLORTALLE), aunque en la etiqueta aparezca guion.
- El BASE es todo lo que está antes del punto/guion: una secuencia continua de letras y dígitos SIN espacios (ejemplos: OMPISF02, FNAPOLO0, EO020000P12, BPMANTA2).
- CRÍTICO — O vs 0: el 0 (cero) tiene barra diagonal, la O (letra) es redonda. Los SKUs contienen palabras en español (POLO, MEDIA, CALZA, BOTA, RUSO, PUNTA, PISO, etc.) — en esas secuencias todo es letra O. Los ceros aparecen en códigos numéricos. Ejemplo: FNAPOLO0 = FN+APOLO+0.
- La cantidad es el número que dice la etiqueta ("X Unidades", o 1 si no especifica)
- NO multipliques por el número del sufijo de pack — devolvé la cantidad cruda
- Si la página tiene múltiples SKUs, listá TODOS con cantidad 1 cada uno
- Agrupá SKUs idénticos (mismo string exacto) sumando cantidades

## 2. ORDEN DE PÁGINAS

Para cada página:
- sku_orden = BASE del PRIMER SKU (todo antes del punto, sin sufijo de pack P6/P12/etc.)
- tipo = tipo de pedido:
  * "COLECTA": hay un código de barras lineal grande (barras verticales) en el centro-izquierdo
  * "FLEX": hay un código QR grande (cuadrado con patrones de puntos) en el centro-izquierdo
  (ignorá el QR pequeño más abajo en etiquetas de colecta)

Respondé ÚNICAMENTE con JSON válido, sin texto ni markdown:
{
  "filas": [{"sku":"SKU_EXACTO","variante":"","cant":N},...],
  "paginas": [{"idx":0,"sku_orden":"BASE","tipo":"FLEX"},...]
}

En "filas": variante es siempre string vacío. Una entrada por página del PDF en "paginas".`;

const STORE_CONFIG = {
  name: 'parsear-jobs',
  siteID: '70734c8a-78c9-471a-8fd8-aa88cfea8636',
  token: process.env.NETLIFY_BLOBS_TOKEN
};

export const handler = async (event) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    const fields = extractFields(event);
    if (!fields) return;

    const fileData = fields['pdf'];
    const jobId = fields['jobId']?.toString();
    if (!fileData || !jobId) return;

    const store = getStore(STORE_CONFIG);

    // Ventana de cancelación: esperar 800ms para que llegue señal de cancel
    await new Promise(r => setTimeout(r, 800));
    const cancelFlag = await store.get(jobId + '-cancel');
    if (cancelFlag) {
      try { await store.delete(jobId + '-cancel'); } catch (_) {}
      return;
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData.toString('base64') } },
        { type: 'text', text: PROMPT }
      ]}]
    });

    const rawText = message.content[0].text.trim();
    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON inválido: ' + rawText.substring(0, 200));
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.filas || !Array.isArray(parsed.filas)) throw new Error('Formato inesperado');

    await store.setJSON(jobId, { ok: true, filas: parsed.filas, paginas: parsed.paginas || [] });
  } catch (e) {
    try {
      const fields = extractFields(event);
      const jobId = fields?.['jobId']?.toString();
      if (jobId) {
        const store = getStore(STORE_CONFIG);
        await store.setJSON(jobId, { ok: false, error: e.message });
      }
    } catch (_) {}
  }
};
