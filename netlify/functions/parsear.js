import Anthropic from '@anthropic-ai/sdk';

function buildPrompt(pageCount, skusConocidos) {
  const skuRef = skusConocidos && skusConocidos.length
    ? `\n## REFERENCIA DE SKUs VÁLIDOS\nEstos son los SKUs reales del catálogo. Cuando leas el texto antes del punto/guion, buscá si coincide exactamente con alguno de esta lista y usalo como BASE. Esta lista es autoritativa para: (a) resolver caracteres similares (O/0, B/8, etc.) y (b) determinar el largo exacto del BASE — si el SKU de la lista tiene 10 caracteres, el BASE tiene 10. Si difiere en 1-2 caracteres, USÁ EL DE LA LISTA:\n${skusConocidos.join(', ')}\n`
    : '';

  return `Analizá este PDF de etiquetas de MercadoLibre Argentina.
Este PDF tiene exactamente ${pageCount} página${pageCount === 1 ? '' : 's'}. Cada página es una etiqueta de envío.

CRÍTICO: tu respuesta en "paginas" DEBE tener EXACTAMENTE ${pageCount} entrada${pageCount === 1 ? '' : 's'}, una por cada página, en orden. No omitas ninguna página aunque no tenga SKU.

Necesito DOS cosas:
${skuRef}
## 1. TABLA DE SKUs

Para cada etiqueta, identificá el/los SKU(s) y su cantidad:
- CRÍTICO: el SKU está SIEMPRE precedido por la palabra "SKU:" en la etiqueta. Buscá esa etiqueta específicamente. Todo lo demás (Nombre del comprador, Descripción del producto, Color:, Talle:, Pack Id:, Nombre:, etc.) NO es el SKU. Si no encontrás el campo "SKU:" en la página, devolvé sku="" para esa página.
- El SKU tiene formato BASE.VARIANTE o BASE-VARIANTE. Devolvé siempre con punto como separador. El campo "sku" debe contener el código COMPLETO incluyendo punto y variante (ej: "OMFRAN02.39"). El campo "variante" en el JSON es SIEMPRE string vacío "".
- El BASE es todo lo que está antes del punto/guion. La MAYORÍA de los BASE tienen exactamente 8 caracteres (ej: OMPISF02, FNAPOLO0, EO073000, OMFRAN02, CO808004), pero algunos tienen más (ej: 10 caracteres como PABOMB16BE). CRÍTICO: si tenés lista de SKUs válidos, buscá el texto antes del punto/guion en esa lista — el largo exacto del BASE es el que coincide con el SKU de la lista, sin importar cuántos caracteres tenga. NO ajustes el largo del BASE para que quede en 8 si el SKU completo aparece en la lista con otro largo. Si tu BASE tiene 7 o 9 caracteres Y no coincide con ningún SKU de la lista, revisá bien — probablemente te falta o sobra un carácter.
- CRÍTICO — caracteres similares, prestalés máxima atención:
  * O (letra) vs 0 (cero): O es redonda y cerrada, 0 tiene barra diagonal. En palabras españolas (POLO, MEDIA, BOTA, FRANELA, etc.) son letras O. En secuencias numéricas son ceros. Ej: EO0102B0 tiene letras E,O y luego dígitos 0,1,0,2,B,0.
  * B (letra) vs 0 (cero): B tiene palo vertical izquierdo con dos protuberancias. 0 es un óvalo con barra. En EO0102B0 la B es una letra, no un cero.
  * B (letra) vs 8 (dígito): B tiene palo izquierdo recto. 8 es simétrico sin palo. En CO808004 los 8 son dígitos.
  * NO agregues ni quites caracteres. Copiá exactamente lo que ves. EO073000 son 8 caracteres, no 9.
  * NO inventes separadores. Si no hay punto ni guion visible, devolvé el código completo sin separador.
- La cantidad es el número que dice la etiqueta ("X Unidades"), o 1 si no especifica.
- NO multipliques por el sufijo de pack — devolvé la cantidad cruda.
- Si hay múltiples SKUs en la página, listá TODOS con cantidad 1 cada uno.
- Agrupá SKUs idénticos sumando cantidades.

## 2. ORDEN DE PÁGINAS

Para cada una de las ${pageCount} páginas (índice 0 a ${pageCount - 1}):
- idx = índice de la página (0 para la primera, ${pageCount - 1} para la última)
- sku_orden = BASE del primer SKU (sin sufijo de pack P6/P12/etc.)
- tipo = evaluá en este orden de prioridad:
  1. "RECIBO": la página es un "Recibo de entrega de producto" (tiene ese título y un "OK" grande en el margen superior derecho, sin código de barras ni QR grande).
  2. "TURBO": hay un recuadro/bloque negro con la palabra "TURBO" visible. Puede tener QR pero lo que la distingue es ese bloque negro "TURBO".
  3. "COLECTA": hay un código de barras lineal grande (CODE128/barras verticales). CRÍTICO: aunque la etiqueta TAMBIÉN tenga un código QR, si tiene código de barras lineal grande → es COLECTA, no FLEX. Las etiquetas de logística de MercadoLibre a veces tienen ambos pero siguen siendo COLECTA.
  4. "FLEX": hay código QR grande y NO tiene código de barras lineal grande. Solo usá FLEX si descartaste los tres casos anteriores.

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
    let skusConocidosField = null;
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
      if (partHeader.includes('name="skusConocidos"')) skusConocidosField = bodyBuffer.slice(dataStart, dataEnd).toString().trim();
      pos = nextBoundary === -1 ? bodyBuffer.length : nextBoundary;
    }

    if (!fileData) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Sin archivo PDF' }) };

    const expectedPages = pageCountField ? parseInt(pageCountField) : null;
    const skusConocidos = skusConocidosField ? skusConocidosField.split(',').map(s => s.trim()).filter(Boolean) : [];
    const prompt = buildPrompt(expectedPages || 1, skusConocidos);

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
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
