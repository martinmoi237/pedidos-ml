import { getStore } from '@netlify/blobs';

export const handler = async () => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const store = getStore({
      name: 'pedidos-config',
      siteID: '70734c8a-78c9-471a-8fd8-aa88cfea8636',
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    const grupos = await store.get('grupos', { type: 'json' });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, grupos: grupos || {} }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
