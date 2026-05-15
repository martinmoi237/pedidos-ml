import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const jobId = event.queryStringParameters?.id;
    if (!jobId) return { statusCode: 400, headers, body: JSON.stringify({ ready: false, error: 'Sin id' }) };

    const store = getStore({
      name: 'parsear-jobs',
      siteID: '70734c8a-78c9-471a-8fd8-aa88cfea8636',
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    const result = await store.get(jobId, { type: 'json' });
    if (!result) return { statusCode: 200, headers, body: JSON.stringify({ ready: false }) };

    // Limpiar después de leer
    try { await store.delete(jobId); } catch (_) {}

    return { statusCode: 200, headers, body: JSON.stringify({ ready: true, ...result }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ready: false, error: e.message }) };
  }
};
