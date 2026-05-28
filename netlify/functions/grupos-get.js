import { getStore } from '@netlify/blobs';

export default async () => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const store = getStore('pedidos-config');
    const grupos = await store.get('grupos', { type: 'json' });
    return new Response(JSON.stringify({ ok: true, grupos: grupos || {} }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/grupos-get' };
