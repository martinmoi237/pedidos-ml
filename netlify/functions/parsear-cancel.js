import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const jobId = event.queryStringParameters?.id;
  if (!jobId) return { statusCode: 400, body: '' };
  try {
    const store = getStore({
      name: 'parsear-jobs',
      siteID: '70734c8a-78c9-471a-8fd8-aa88cfea8636',
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    await store.setJSON(jobId + '-cancel', { ts: Date.now() });
  } catch (_) {}
  return { statusCode: 200, body: '' };
};
