import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Deletes the caller's account: every uploaded file, then the auth user (all rows cascade).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user) return json({ error: 'unauthorized' }, 401);
  const uid = u.user.id;

  const { data: files, error: fe } = await admin.rpc('user_storage_paths', { uid });
  if (fe) return json({ error: fe.message }, 500);
  const byBucket = new Map<string, string[]>();
  for (const f of (files || []) as { bucket: string; name: string }[]) {
    if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
    byBucket.get(f.bucket)!.push(f.name);
  }
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(names.slice(i, i + 100));
      if (error) return json({ error: 'storage: ' + error.message }, 500);
      removed += Math.min(100, names.length - i);
    }
  }
  const { error: de } = await admin.auth.admin.deleteUser(uid);
  if (de) return json({ error: de.message }, 500);
  return json({ ok: true, removed });
});
