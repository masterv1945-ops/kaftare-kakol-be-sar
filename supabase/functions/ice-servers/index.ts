const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, 'Content-Type': 'application/json' } });

// Metered static-credential TURN endpoints (global anycast relay).
const METERED_URLS = [
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:80?transport=tcp',
  'turn:global.relay.metered.ca:443',
  'turns:global.relay.metered.ca:443?transport=tcp',
];

// Is the caller a logged-in user (not just the public anon key)? verify_jwt already checked the signature.
function isUser(req: Request): boolean {
  try {
    const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.role === 'authenticated';
  } catch (_) { return false; }
}

// Returns WebRTC ICE servers. A TURN relay lets two people on very different networks connect
// (e.g. home fibre <-> mobile data behind carrier NAT). Configure via secrets:
//   TURN_USER + TURN_PASS            -> Metered static credentials (URLs above), or
//   TURN_URLS (comma separated) + TURN_USER + TURN_PASS -> any other TURN server.
// Only logged-in users receive the relay credentials.
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const iceServers: Record<string, unknown>[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.relay.metered.ca:80' },
  ];
  let custom = false;
  const user = Deno.env.get('TURN_USER'), pass = Deno.env.get('TURN_PASS');
  const own = (Deno.env.get('TURN_URLS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (user && pass && isUser(req)) {
    iceServers.push({ urls: own.length ? own : METERED_URLS, username: user, credential: pass });
    custom = true;
  }
  return json({ iceServers, custom });
});
