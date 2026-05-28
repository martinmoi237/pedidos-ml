import { getStore } from '@netlify/blobs';

export const handler = async () => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const store = getStore('pedidos-config');
    const grupos = await store.get('grupos', { type: 'json' });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, grupos: grupos || {} }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
