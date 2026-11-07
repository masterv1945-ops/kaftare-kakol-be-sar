import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// BotFather-style management of bots for "کفتر کاکل به سر".
// The website calls this with the logged-in user's JWT. Actions:
//   list | create {name, username} | newtoken {bot_id} | update {bot_id, name?, description?, commands?} | delete {bot_id}
// Replies are always HTTP 200 with {ok, ...} / {ok:false, error}.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const rand = (n: number) => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, "").slice(0, n);
};
const MAX_BOTS = 5;

async function userOf(req: Request) {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const { data } = await admin.auth.getUser(tok);
  return data?.user ?? null;
}
async function ownBot(owner: string, id: string) {
  const { data } = await admin.from("bots").select("user_id,owner_id").eq("user_id", id).eq("owner_id", owner).maybeSingle();
  return data;
}
function cleanCommands(raw: unknown) {
  const out: { command: string; description: string }[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const command = String(c?.command ?? "").replace(/^\//, "").toLowerCase();
    if (!/^[a-z0-9_]{1,32}$/.test(command)) continue;
    out.push({ command, description: String(c?.description ?? "").slice(0, 100) });
    if (out.length >= 30) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch (_) { return json({ ok: false, error: "bad_request" }); }
  try {
    const user = await userOf(req);
    if (!user) return json({ ok: false, error: "unauthorized" });
    const me = user.id;
    const { data: mp } = await admin.from("profiles").select("is_bot").eq("id", me).maybeSingle();
    if (!mp || mp.is_bot) return json({ ok: false, error: "forbidden" });

    if (b.action === "list") {
      const { data } = await admin.from("bots").select("user_id,description,commands,last_api_at,created_at").eq("owner_id", me).order("created_at");
      const ids = (data ?? []).map((x) => x.user_id);
      const { data: ps } = ids.length ? await admin.from("profiles").select("id,username,display_name").in("id", ids) : { data: [] };
      return json({ ok: true, bots: (data ?? []).map((x) => ({ ...x, ...(ps ?? []).find((p) => p.id === x.user_id) })) });
    }

    if (b.action === "create") {
      const name = String(b.name ?? "").trim().slice(0, 40);
      const username = String(b.username ?? "").trim();
      if (!name) return json({ ok: false, error: "bad_name" });
      if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username) || !/bot$/i.test(username)) return json({ ok: false, error: "bad_username" });
      const { count } = await admin.from("bots").select("user_id", { count: "exact", head: true }).eq("owner_id", me);
      if ((count ?? 0) >= MAX_BOTS) return json({ ok: false, error: "too_many" });
      const { data: taken } = await admin.from("profiles").select("id").ilike("username", username).maybeSingle();
      if (taken) return json({ ok: false, error: "username_taken" });
      const { data: cu, error } = await admin.auth.admin.createUser({
        email: `bot-${rand(12).toLowerCase()}@bots.kaftar.app`, password: rand(48), email_confirm: true,
        user_metadata: { username, display_name: name, is_bot: true },
      });
      if (error || !cu?.user) return json({ ok: false, error: "create_failed", detail: error?.message });
      const secret = rand(32);
      const { error: e2 } = await admin.from("bots").insert({ user_id: cu.user.id, owner_id: me, token_hash: await sha256(secret) });
      if (e2) { await admin.auth.admin.deleteUser(cu.user.id); return json({ ok: false, error: "db_error", detail: e2.message }); }
      return json({ ok: true, bot_id: cu.user.id, username, token: `${cu.user.id}:${secret}` });
    }

    const id = String(b.bot_id ?? "");
    if (!(await ownBot(me, id))) return json({ ok: false, error: "not_found" });

    if (b.action === "newtoken") {
      const secret = rand(32);
      await admin.from("bots").update({ token_hash: await sha256(secret) }).eq("user_id", id);
      return json({ ok: true, token: `${id}:${secret}` });
    }
    if (b.action === "update") {
      if (typeof b.name === "string" && b.name.trim()) await admin.from("profiles").update({ display_name: b.name.trim().slice(0, 40) }).eq("id", id);
      const patch: Record<string, unknown> = {};
      if (typeof b.description === "string") patch.description = b.description.slice(0, 200);
      if (b.commands !== undefined) patch.commands = cleanCommands(b.commands);
      if (Object.keys(patch).length) await admin.from("bots").update(patch).eq("user_id", id);
      return json({ ok: true });
    }
    if (b.action === "delete") {
      await admin.auth.admin.deleteUser(id);
      return json({ ok: true });
    }
    return json({ ok: false, error: "bad_action" });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String((e as Error)?.message ?? e) });
  }
});
