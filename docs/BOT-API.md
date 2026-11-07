# Bot API — کفتر کاکل به سر

مثل Bot API تلگرام، ولی روی Supabase.

**ساخت ربات:** سایت ← تنظیمات ← «🤖 ربات‌ها (BotFather)» ← ساخت. نام کاربری باید به `bot` ختم شود (حداکثر ۵ ربات برای هر کاربر).
توکن فقط یک بار نمایش داده می‌شود (`<uuid>:<secret>`)؛ گم شد → «توکن جدید».

**آدرس:** `https://wqdcnnjccvvxeeqhnipe.supabase.co/functions/v1/bot-api/bot<TOKEN>/<method>`
پارامترها: query string، JSON یا form. پاسخ: `{"ok":true,"result":…}` یا `{"ok":false,"error_code":…,"description":…}`.

> تفاوت با تلگرام: `chat_id` و `message_id` رشته‌ی UUID هستند و `update_id` عدد است.

## متدها
| متد | توضیح |
|---|---|
| `getMe` | مشخصات ربات |
| `getUpdates` | `offset`, `limit` (≤100), `timeout` (≤25 ثانیه، long polling). با `offset = آخرین update_id + 1` آپدیت‌های قبلی تأیید می‌شوند |
| `sendMessage` | `chat_id`, `text`, `reply_to_message_id`, `reply_markup` |
| `sendPhoto` / `sendDocument` / `sendVoice` | `chat_id`, `file_base64` یا بدنه‌ی خام، `file_name`, `mime`, `caption`، حداکثر ۲۰ مگابایت |
| `editMessageText`, `editMessageReplyMarkup`, `deleteMessage` | فقط روی پیام‌های خود ربات |
| `answerCallbackQuery` | `callback_query_id`, `text`, `show_alert` |
| `sendChatAction` | `chat_id`, `action` (`typing` / `record_voice`) |
| `getChat`, `getFile` (با `message_id`، لینک موقت دانلود) | |
| `setMyCommands`, `getMyCommands`, `setMyDescription`, `setMyName` | |
| `setWebhook` | پشتیبانی نمی‌شود (فقط `getUpdates`) |

## دکمه‌های شیشه‌ای
```json
{"inline_keyboard": [[{"text": "بله", "callback_data": "yes"}, {"text": "سایت", "url": "https://example.com"}]]}
```
با فشردن دکمه‌ی callback، آپدیتی با کلید `callback_query` (`id`, `data`, `from`, `message`) می‌رسد.

## چه پیام‌هایی به ربات می‌رسد
در چت خصوصی: همه‌ی پیام‌ها. در گروه: فقط دستورهای `/command` و `/command@username`، منشن `@username` و پاسخ به پیام‌های ربات.
مثال کامل: `examples/echo_bot.py`.
