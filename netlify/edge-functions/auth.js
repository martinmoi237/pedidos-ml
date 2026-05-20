export default async (request, context) => {
  const user = Deno.env.get('SITE_USER');
  const pass = Deno.env.get('SITE_PASS');
  if (!user || !pass) return context.next();

  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const colon = decoded.indexOf(':');
      if (colon > -1 && decoded.slice(0, colon) === user && decoded.slice(colon + 1) === pass) {
        return context.next();
      }
    } catch (_) {}
  }

  return new Response('Acceso restringido', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Listita Pedidos"' },
  });
};

export const config = { path: '/*' };
