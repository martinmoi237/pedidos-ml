import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const grupos = JSON.parse(event.body);
    const store = getStore({
      name: 'pedidos-config',
      siteID: '70734c8a-78c9-471a-8fd8-aa88cfea8636',
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    await store.set('grupos', JSON.stringify(grupos));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
