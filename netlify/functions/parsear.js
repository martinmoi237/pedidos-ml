import Anthropic from '@anthropic-ai/sdk';

const PROMPT = `Analizá este PDF de etiquetas FLEX de MercadoLibre Argentina.
Cada página es una etiqueta de envío.

Necesito DOS cosas:

## 1. TABLA DE SKUs

Para cada etiqueta, identificá el/los SKU(s) y su cantidad:
- El SKU en la etiqueta tiene el formato BASE.COLOR+TALLE o BASE-COLOR+TALLE (el separador puede ser punto o guion), por ejemplo: OMPISF02.NEGRO38, FNAPOLO0.AZUL42, EO020000P12.ROJO46, FD700300-BLANCO. Devolvé siempre con punto como separador (BASE.COLORTALLE), aunque en la etiqueta aparezca guion.
- El BASE es todo lo que está antes del punto: una secuencia continua de letras y dígitos SIN espacios ni puntos internos (ejemplos: OMPISF02, FNAPOLO0, EO020000P12, BPMANTA2). El punto solo aparece UNA vez, separando base de color/talle.
- Devolvé el SKU como BASE.COLORTALLE exactamente. Si no hay punto en la etiqueta, devolvé solo el BASE.
- CRÍTICO: el SKU está SIEMPRE precedido por la palabra "SKU:" en la etiqueta. Buscá esa etiqueta específicamente. Todo lo demás (Nombre del comprador, Descripción del producto, Color:, Talle:, Pack Id:, Nombre:, etc.) NO es el SKU. Si no encontrás el campo "SKU:" en la página, devolvé sku="" para esa página.
- CRÍTICO — O vs 0: el 0 (cero) tiene barra diagonal, la O (letra) es redonda. Los SKUs contienen palabras en español (POLO, MEDIA, CALZA, BOTA, RUSO, PUNTA, PISO, etc.) — en esas secuencias todo es letra O. Los ceros aparecen en códigos numéricos. Ejemplo: FNAPOLO0 = FN+APOLO+0, no FNAPOL+00.
- La cantidad es el número que dice la etiqueta ("X Unidades", o 1 si no especifica)
- NO multipliques por el número del sufijo de pack — devolvé la cantidad cruda
- Si la página tiene múltiples SKUs (aunque no diga "X productos"), listá TODOS con cantidad 1 cada uno
- Agrupá SKUs idénticos (mismo string exacto) sumando cantidades

## 2. ORDEN DE PÁGINAS

Para cada página:
- sku_orden = BASE del PRIMER SKU (todo antes del punto, sin sufijo de pack P6/P12/etc.). Ej: "EO020000P12.ROJO46" → "EO020000"
- tipo = tipo de pedido según el código presente en la parte izquierda de la etiqueta:
  * "COLECTA": hay un código de barras lineal grande (barras verticales, tipo EAN/Code128) en el centro-izquierdo
  * "FLEX": hay un código QR grande (cuadrado con patrones de puntos) en el centro-izquierdo
  (ignorá el QR pequeño que aparece más abajo en las etiquetas de colecta, ese no cuenta)

Respondé ÚNICAMENTE con JSON válido, sin texto ni markdown:
{
  "filas": [{"sku":"SKU_EXACTO","variante":"","cant":N},...],
  "paginas": [{"idx":0,"sku_orden":"BASE","tipo":"FLEX"},...]
}

En "filas": variante es siempre string vacío (la variante va dentro del campo sku después del punto). Una entrada por página del PDF en "paginas".`;

export const handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' }) };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    const contentType = event.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Content-Type inválido' }) };

    const boundary = boundaryMatch[1];
    const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary');
    const boundaryBuf = Buffer.from('--' + boundary);
    let fileData = null;
    let pos = 0;

    while (pos < bodyBuffer.length) {
      const start = bodyBuffer.indexOf(boundaryBuf, pos);
      if (start === -1) break;
      const headerStart = start + boundaryBuf.length + 2;
      const headerEnd = bodyBuffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
      if (headerEnd === -1) break;
      const partHeader = bodyBuffer.slice(headerStart, headerEnd).toString();
      const dataStart = headerEnd + 4;
      const nextBoundary = bodyBuffer.indexOf(boundaryBuf, dataStart);
      const dataEnd = nextBoundary === -1 ? bodyBuffer.length : nextBoundary - 2;
      if (partHeader.includes('name="pdf"')) { fileData = bodyBuffer.slice(dataStart, dataEnd); break; }
      pos = nextBoundary === -1 ? bodyBuffer.length : nextBoundary;
    }

    if (!fileData) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Sin archivo PDF' }) };

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
      if (!match) throw new Error('Claude no devolvió JSON válido: ' + rawText.substring(0, 300));
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.filas || !Array.isArray(parsed.filas)) throw new Error('Formato inesperado: ' + JSON.stringify(parsed).substring(0, 300));

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, filas: parsed.filas, paginas: parsed.paginas || [] }) };
  } catch (e) {
    const isRateLimit = e.status === 429 || (e.message && e.message.includes('rate_limit'));
    return { statusCode: isRateLimit ? 429 : 500, headers, body: JSON.stringify({ ok: false, error: e.message, rateLimited: isRateLimit }) };
  }
};
