import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Bot API for "کفتر کاکل به سر" (Telegram-like).
//   https://<project>.supabase.co/functions/v1/bot-api/bot<TOKEN>/<method>
// Params: query string, JSON body or form. Reply: {ok:true,result} | {ok:false,error_code,description}.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB_URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
class ApiError extends Error { constructor(public code: number, msg: string) { super(msg); } }
const out = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, name: string) => {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new ApiError(400, `bad ${name}`);
  return s.toLowerCase();
};
const hits = new Map<string, number[]>();
function rate(key: string) {
  const now = Date.now(), a = (hits.get(key) ?? []).filter((t) => now - t < 10000);
  a.push(now); hits.set(key, a);
  if (a.length > 80) throw new ApiError(429, "too many requests");
}

function cleanMarkup(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return null;
  let m: any = raw;
  if (typeof raw === "string") { try { m = JSON.parse(raw); } catch (_) { throw new ApiError(400, "reply_markup is not valid JSON"); } }
  const rows = Array.isArray(m?.inline_keyboard) ? m.inline_keyboard : [];
  const kb = rows.slice(0, 8).map((r: any[]) => (Array.isArray(r) ? r : []).slice(0, 8).map((b) => {
    const text = String(b?.text ?? "").slice(0, 64);
    if (!text) return null;
    if (b.url) { const u = String(b.url); return /^https?:\/\//i.test(u) ? { text, url: u.slice(0, 500) } : null; }
    return { text, callback_data: String(b?.callback_data ?? text).slice(0, 64) };
  }).filter(Boolean)).filter((r: unknown[]) => r.length);
  return kb.length ? { inline_keyboard: kb } : null;
}

async function params(req: Request, u: URL) {
  const p: Record<string, any> = {};
  u.searchParams.forEach((v, k) => (p[k] = v));
  let raw: Uint8Array | null = null;
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) { try { Object.assign(p, await req.json()); } catch (_) { throw new ApiError(400, "bad JSON"); } }
    else if (ct.includes("application/x-www-form-urlencoded")) { new URLSearchParams(await req.text()).forEach((v, k) => (p[k] = v)); }
    else { raw = new Uint8Array(await req.arrayBuffer()); }
  }
  return { p, raw };
}
const msgJson = (m: any, bot: any) => ({
  message_id: m.id, date: Math.floor(new Date(m.created_at).getTime() / 1000),
  chat: { id: m.conversation_id }, from: { id: bot.user_id, is_bot: true, username: bot.username, first_name: bot.display_name },
  text: m.body, ...(m.metadata?.markup ? { reply_markup: m.metadata.markup } : {}),
});

async function botFromToken(token: string) {
  const [id, secret] = token.split(":");
  if (!id || !secret || !UUID.test(id)) throw new ApiError(401, "Unauthorized");
  const { data: b } = await admin.from("bots").select("user_id,token_hash,description,commands").eq("user_id", id).maybeSingle();
  if (!b || b.token_hash !== (await sha256(secret))) throw new ApiError(401, "Unauthorized");
  const { data: pr } = await admin.from("profiles").select("username,display_name").eq("id", id).maybeSingle();
  admin.from("bots").update({ last_api_at: new Date().toISOString() }).eq("user_id", id).then(() => {});
  return { ...b, ...pr };
}
async function assertMember(botId: string, chat: string) {
  const { data } = await admin.from("conversation_members").select("user_id").eq("conversation_id", chat).eq("user_id", botId).maybeSingle();
  if (!data) throw new ApiError(403, "bot is not a member of this chat");
}
async function sendRow(bot: any, p: Record<string, any>, row: Record<string, unknown>) {
  const chat = uuid(p.chat_id, "chat_id");
  await assertMember(bot.user_id, chat);
  const markup = cleanMarkup(p.reply_markup);
  const meta = { ...(row.metadata as object ?? {}), ...(markup ? { markup } : {}) };
  const reply = p.reply_to_message_id ? uuid(p.reply_to_message_id, "reply_to_message_id") : null;
  const { data, error } = await admin.from("messages").insert({ conversation_id: chat, sender_id: bot.user_id, reply_to: reply, ...row, metadata: meta }).select().single();
  if (error) throw new ApiError(400, error.message);
  return msgJson(data, bot);
}
async function sendFile(bot: any, p: Record<string, any>, raw: Uint8Array | null, kind: "file" | "image" | "voice") {
  const chat = uuid(p.chat_id, "chat_id");
  await assertMember(bot.user_id, chat);
  let bytes = raw;
  if (!bytes && p.file_base64) { try { bytes = Uint8Array.from(atob(String(p.file_base64)), (c) => c.charCodeAt(0)); } catch (_) { throw new ApiError(400, "bad file_base64"); } }
  if (!bytes || !bytes.length) throw new ApiError(400, "no file: send file_base64 or a raw body");
  if (bytes.length > 20 * 1024 * 1024) throw new ApiError(413, "file too large (20 MB max)");
  const name = String(p.file_name ?? p.filename ?? "file").slice(0, 100);
  const ext = (name.split(".").pop() ?? "bin").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "bin";
  const mime = String(p.mime ?? p.mime_type ?? "application/octet-stream");
  const path = `${chat}/${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  const up = await admin.storage.from("attachments").upload(path, bytes, { contentType: mime });
  if (up.error) throw new ApiError(500, "upload failed");
  return sendRow(bot, p, { kind, body: p.caption ? String(p.caption).slice(0, 1000) : name, attachment_path: path, metadata: { name, size: bytes.length, mime, ...(kind === "voice" ? { dur: Number(p.duration) || 0 } : {}) } });
}
async function ownMessage(bot: any, p: Record<string, any>) {
  const id = uuid(p.message_id, "message_id");
  const { data } = await admin.from("messages").select("*").eq("id", id).eq("sender_id", bot.user_id).maybeSingle();
  if (!data) throw new ApiError(400, "message not found or not sent by this bot");
  return data;
}

const methods: Record<string, (bot: any, p: Record<string, any>, raw: Uint8Array | null) => Promise<unknown>> = {
  getMe: async (bot) => ({ id: bot.user_id, is_bot: true, username: bot.username, first_name: bot.display_name }),
  getUpdates: async (bot, p) => {
    const offset = Number(p.offset) || 0;
    const limit = Math.min(100, Math.max(1, Number(p.limit) || 100));
    const timeout = Math.min(25, Math.max(0, Number(p.timeout) || 0));
    if (offset > 0) await admin.from("bot_updates").delete().eq("bot_id", bot.user_id).lt("id", offset);
    await admin.from("bot_updates").delete().eq("bot_id", bot.user_id).lt("created_at", new Date(Date.now() - 86400000).toISOString());
    const t0 = Date.now();
    for (;;) {
      const { data } = await admin.from("bot_updates").select("id,payload").eq("bot_id", bot.user_id).gte("id", offset).order("id").limit(limit);
      if ((data && data.length) || Date.now() - t0 >= timeout * 1000) return (data ?? []).map((r) => ({ update_id: r.id, ...r.payload }));
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
  sendMessage: async (bot, p) => {
    const text = String(p.text ?? "");
    if (!text.trim()) throw new ApiError(400, "text is empty");
    return sendRow(bot, p, { kind: "text", body: text.slice(0, 4000) });
  },
  sendDocument: (bot, p, raw) => sendFile(bot, p, raw, "file"),
  sendPhoto: (bot, p, raw) => sendFile(bot, p, raw, "image"),
  sendVoice: (bot, p, raw) => sendFile(bot, p, raw, "voice"),
  editMessageText: async (bot, p) => {
    const m = await ownMessage(bot, p);
    const text = String(p.text ?? ""); if (!text.trim()) throw new ApiError(400, "text is empty");
    const meta = { ...(m.metadata ?? {}) }; const mk = cleanMarkup(p.reply_markup);
    if (p.reply_markup !== undefined) { if (mk) meta.markup = mk; else delete meta.markup; }
    const { data, error } = await admin.from("messages").update({ body: text.slice(0, 4000), edited_at: new Date().toISOString(), metadata: meta }).eq("id", m.id).select().single();
    if (error) throw new ApiError(400, error.message);
    return msgJson(data, bot);
  },
  editMessageReplyMarkup: async (bot, p) => {
    const m = await ownMessage(bot, p);
    const meta = { ...(m.metadata ?? {}) }; const mk = cleanMarkup(p.reply_markup);
    if (mk) meta.markup = mk; else delete meta.markup;
    const { data, error } = await admin.from("messages").update({ metadata: meta }).eq("id", m.id).select().single();
    if (error) throw new ApiError(400, error.message);
    return msgJson(data, bot);
  },
  deleteMessage: async (bot, p) => {
    const m = await ownMessage(bot, p);
    await admin.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    return true;
  },
  answerCallbackQuery: async (_bot, p) => {
    const uid = String(p.callback_query_id ?? "").split(":")[0];
    if (!UUID.test(uid)) throw new ApiError(400, "bad callback_query_id");
    if (p.text) await admin.from("bot_answers").insert({ user_id: uid, text: String(p.text).slice(0, 200), alert: p.show_alert === true || p.show_alert === "true" });
    return true;
  },
  sendChatAction: async (bot, p) => {
    const chat = uuid(p.chat_id, "chat_id");
    await assertMember(bot.user_id, chat);
    const kind = /voice|record/i.test(String(p.action ?? "")) ? "voice" : "text";
    try {
      await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
        method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ topic: "kaftar-typing", event: "typing", payload: { conv: chat, user: bot.user_id, kind } }] }),
      });
    } catch (_) { /* best effort */ }
    return true;
  },
  getChat: async (bot, p) => {
    const chat = uuid(p.chat_id, "chat_id");
    await assertMember(bot.user_id, chat);
    const { data: c } = await admin.from("conversations").select("id,type,title,description").eq("id", chat).single();
    const { count } = await admin.from("conversation_members").select("user_id", { count: "exact", head: true }).eq("conversation_id", chat);
    return { id: c.id, type: c.type === "direct" ? "private" : "group", title: c.title, description: c.description, members_count: count };
  },
  getFile: async (bot, p) => {
    const id = uuid(p.message_id, "message_id");
    const { data: m } = await admin.from("messages").select("conversation_id,attachment_path,metadata").eq("id", id).maybeSingle();
    if (!m || !m.attachment_path) throw new ApiError(404, "no file in this message");
    await assertMember(bot.user_id, m.conversation_id);
    const { data } = await admin.storage.from("attachments").createSignedUrl(m.attachment_path, 3600);
    return { file_url: data?.signedUrl, file_name: m.metadata?.name ?? null, file_size: m.metadata?.size ?? null };
  },
  setMyCommands: async (bot, p) => {
    let raw = p.commands; if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (_) { raw = []; } }
    const list = (Array.isArray(raw) ? raw : []).map((c: any) => ({ command: String(c?.command ?? "").replace(/^\//, "").toLowerCase(), description: String(c?.description ?? "").slice(0, 100) }))
      .filter((c: any) => /^[a-z0-9_]{1,32}$/.test(c.command)).slice(0, 30);
    await admin.from("bots").update({ commands: list }).eq("user_id", bot.user_id);
    return true;
  },
  getMyCommands: async (bot) => bot.commands ?? [],
  setMyDescription: async (bot, p) => { await admin.from("bots").update({ description: String(p.description ?? "").slice(0, 200) }).eq("user_id", bot.user_id); return true; },
  setMyName: async (bot, p) => { const n = String(p.name ?? "").trim().slice(0, 40); if (!n) throw new ApiError(400, "name is empty"); await admin.from("profiles").update({ display_name: n }).eq("id", bot.user_id); return true; },
  deleteWebhook: async () => true,
  getWebhookInfo: async () => ({ url: "", pending_update_count: 0 }),
  setWebhook: async () => { throw new ApiError(400, "webhooks are not supported; use getUpdates (long polling)"); },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url);
    const m = /\/bot([^/]+)\/([A-Za-z]+)\/?$/.exec(u.pathname);
    if (!m) throw new ApiError(404, "use /bot<TOKEN>/<method>");
    const token = decodeURIComponent(m[1]);
    rate(token.slice(0, 40));
    const bot = await botFromToken(token);
    const fn = methods[m[2]];
    if (!fn) throw new ApiError(404, "unknown method " + m[2]);
    const { p, raw } = await params(req, u);
    return out({ ok: true, result: await fn(bot, p, raw) });
  } catch (e) {
    if (e instanceof ApiError) return out({ ok: false, error_code: e.code, description: e.message }, e.code);
    return out({ ok: false, error_code: 500, description: String((e as Error)?.message ?? e) }, 500);
  }
});
