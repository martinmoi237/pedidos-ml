import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await pdfParse(buffer);

    return new Response(JSON.stringify({ ok: true, text: data.text, pages: data.numpages }), {
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
