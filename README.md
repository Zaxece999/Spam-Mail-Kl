# Spam-Mail-Kl

Telegram-бот для массовой рассылки email с очередью отправки, поддержкой прокси, шаблонов и панелью администратора.

## Стек

- Bun + TypeScript
- grammY (Telegram Bot API)
- Drizzle ORM + SQLite
- Nodemailer / IMAPFlow

## Установка

```bash
bun install
```

Скопируйте пример конфига и заполните значения:

```bash
cp config.example.ini config.ini
```

Параметры в `config.ini`:

- `BOT_TOKEN` — токен бота от @BotFather
- `DEEPSEEK_API_KEY` — ключ DeepSeek API
- `DB_FILE_NAME` — файл базы SQLite (по умолчанию `db.sqlite`)
- `SMTP_*` — параметры SMTP-сервера
- `PROXY_*` — параметры прокси
- `DEBUG_MODE`, `MAX_RETRY_ATTEMPTS`, `DEFAULT_SEND_INTERVAL` — дополнительные настройки

## Миграции

```bash
bunx drizzle-kit migrate
```

## Запуск

```bash
bun run index.ts
```

## Назначение администратора

```bash
bun run grant-admin.ts <telegram_id>
```

## Структура

- `src/commands` — команды бота
- `src/conversations` — диалоги (пошаговый ввод)
- `src/handlers` — обработчики событий и колбэков
- `src/menus` — inline-меню и настройки
- `src/db` — схема и запросы к базе
- `src/emailQueue.ts`, `src/emailSender.ts`, `src/emailStream.ts` — очередь и отправка почты
- `src/utils` — вспомогательные функции
- `src/templates` — шаблоны писем
- `drizzle` — SQL-миграции
