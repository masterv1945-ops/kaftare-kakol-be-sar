const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const iceServers: Record<string, unknown>[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  // Optional own TURN server: set secrets TURN_URLS (comma separated), TURN_USER, TURN_PASS
  const urls = (Deno.env.get('TURN_URLS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const user = Deno.env.get('TURN_USER');
  const pass = Deno.env.get('TURN_PASS');
  if (urls.length && user && pass) iceServers.push({ urls, username: user, credential: pass });
  return new Response(JSON.stringify({ iceServers, custom: !!(urls.length && user && pass) }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
