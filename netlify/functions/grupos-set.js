import { getStore } from '@netlify/blobs';

export default async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  try {
    const grupos = await req.json();
    const store = getStore('pedidos-config');
    await store.set('grupos', JSON.stringify(grupos));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/grupos-set' };
