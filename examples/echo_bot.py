#!/usr/bin/env python3
"""Echo bot for «کفتر کاکل به سر» — only the Python standard library.

1. In the site: Settings → 🤖 ربات‌ها → create a bot, copy the token.
2. Run:  BOT_TOKEN="<uuid>:<secret>" python3 echo_bot.py
3. Open a chat with the bot, press «شروع» and talk to it.
"""
import json, os, urllib.request, urllib.parse

BASE = "https://wqdcnnjccvvxeeqhnipe.supabase.co/functions/v1/bot-api/bot" + os.environ["BOT_TOKEN"]

def call(method, **params):
    req = urllib.request.Request(f"{BASE}/{method}", data=json.dumps(params).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return json.load(e)

print("bot:", call("getMe"))
call("setMyCommands", commands=[{"command": "start", "description": "شروع"}, {"command": "menu", "description": "نمایش دکمه‌ها"}])
offset = 0
while True:
    res = call("getUpdates", offset=offset, timeout=20)
    for u in res.get("result", []):
        offset = u["update_id"] + 1
        if "callback_query" in u:
            q = u["callback_query"]
            call("answerCallbackQuery", callback_query_id=q["id"], text="گزینه شما: " + q["data"])
            call("editMessageText", chat_id=q["message"]["chat"]["id"], message_id=q["message"]["message_id"], text="انتخاب شد: " + q["data"])
            continue
        m = u.get("message")
        if not m:
            continue
        chat, text = m["chat"]["id"], m.get("text", "")
        if text.startswith("/start"):
            call("sendMessage", chat_id=chat, text="سلام! هر چی بنویسی تکرار می‌کنم. /menu را امتحان کن.")
        elif text.startswith("/menu"):
            call("sendMessage", chat_id=chat, text="یکی را انتخاب کن:", reply_markup={"inline_keyboard": [[{"text": "الف", "callback_data": "a"}, {"text": "ب", "callback_data": "b"}], [{"text": "سایت", "url": "https://example.com"}]]})
        else:
            call("sendMessage", chat_id=chat, text="🔁 " + text, reply_to_message_id=m["message_id"])
