import Anthropic from '@anthropic-ai/sdk';

function buildPrompt(pageCount) {
  return `Analizá este PDF de etiquetas de MercadoLibre Argentina.
Este PDF tiene exactamente ${pageCount} página${pageCount === 1 ? '' : 's'}. Cada página es una etiqueta de envío.

CRÍTICO: tu respuesta en "paginas" DEBE tener EXACTAMENTE ${pageCount} entrada${pageCount === 1 ? '' : 's'}, una por cada página, en orden. No omitas ninguna página aunque no tenga SKU.

Necesito DOS cosas:

## 1. TABLA DE SKUs

Para cada etiqueta, identificá el/los SKU(s) y su cantidad:
- CRÍTICO: el SKU está SIEMPRE precedido por la palabra "SKU:" en la etiqueta. Buscá esa etiqueta específicamente. Todo lo demás (Nombre del comprador, Descripción del producto, Color:, Talle:, Pack Id:, Nombre:, etc.) NO es el SKU. Si no encontrás el campo "SKU:" en la página, devolvé sku="" para esa página.
- El SKU tiene formato BASE.COLOR+TALLE o BASE-COLOR+TALLE. Devolvé siempre con punto como separador.
- El BASE es todo lo que está antes del punto/guion: letras y dígitos SIN espacios (ejemplos: OMPISF02, FNAPOLO0, EO020000P12).
- CRÍTICO — caracteres similares: prestá atención a estas confusiones frecuentes:
  * O vs 0: la O (letra) es redonda, el 0 (cero) tiene barra diagonal. En palabras españolas (POLO, MEDIA, CALZA, BOTA, etc.) todo es letra O. Los ceros aparecen en códigos numéricos.
  * B vs 8: la B (letra) tiene palo izquierdo recto y dos protuberancias hacia la derecha. El 8 (ocho) es simétrico, dos óvalos apilados sin palo. En un código como CO808004, los 8 son dígitos.
  * NO inventes separadores. Si el SKU en la etiqueta no tiene punto ni guion visible, devolvé el código completo sin separador.
- La cantidad es el número que dice la etiqueta ("X Unidades"), o 1 si no especifica.
- NO multipliques por el sufijo de pack — devolvé la cantidad cruda.
- Si hay múltiples SKUs en la página, listá TODOS con cantidad 1 cada uno.
- Agrupá SKUs idénticos sumando cantidades.

## 2. ORDEN DE PÁGINAS

Para cada una de las ${pageCount} páginas (índice 0 a ${pageCount - 1}):
- idx = índice de la página (0 para la primera, ${pageCount - 1} para la última)
- sku_orden = BASE del primer SKU (sin sufijo de pack P6/P12/etc.)
- tipo = "COLECTA" si hay código de barras lineal grande en el centro-izquierdo, "FLEX" si hay código QR grande

Respondé ÚNICAMENTE con JSON válido, sin texto ni markdown:
{
  "filas": [{"sku":"SKU_EXACTO","variante":"","cant":N},...],
  "paginas": [{"idx":0,"sku_orden":"BASE","tipo":"FLEX"},...]
}

En "paginas" debe haber EXACTAMENTE ${pageCount} entradas. "variante" es siempre string vacío.`;
}

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
    let pageCountField = null;
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
      if (partHeader.includes('name="pdf"')) fileData = bodyBuffer.slice(dataStart, dataEnd);
      if (partHeader.includes('name="pageCount"')) pageCountField = bodyBuffer.slice(dataStart, dataEnd).toString().trim();
      pos = nextBoundary === -1 ? bodyBuffer.length : nextBoundary;
    }

    if (!fileData) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Sin archivo PDF' }) };

    const expectedPages = pageCountField ? parseInt(pageCountField) : null;
    const prompt = buildPrompt(expectedPages || 1);

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData.toString('base64') } },
        { type: 'text', text: prompt }
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

    if (!parsed.filas || !Array.isArray(parsed.filas)) throw new Error('Formato inesperado');

    const paginas = parsed.paginas || [];
    if (expectedPages && paginas.length !== expectedPages) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: `Páginas incompletas: esperaba ${expectedPages}, recibí ${paginas.length}`, incomplete: true, filas: parsed.filas, paginas }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, filas: parsed.filas, paginas }) };
  } catch (e) {
    const isRateLimit = e.status === 429 || (e.message && e.message.includes('rate_limit'));
    return { statusCode: isRateLimit ? 429 : 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
