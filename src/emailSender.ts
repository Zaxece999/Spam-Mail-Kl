import {
  ProxyRepo,
  UserRepo,
  EmailRepo,
  AdvertsRepo,
  SmartPresetRepo,
} from "./db/queries";
import { toProxyAuth } from "./utils/proxyForm";
import { launchSend } from "./utils/sendEmail";
import { bot } from "./bot";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randInt = (a: number, b: number) =>
  Math.floor(Math.random() * (b - a + 1)) + a;
const formatTime = (ms: number) => {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000),
    m = Math.floor(s / 60);
  return m > 0 ? `${m} мин ${s % 60} сек` : `${s} сек`;
};

type SendItem = { id: number; title: string; email: string };
type SendQueue = {
  telegramId: number;
  items: SendItem[];
  startTime: number;
  lastStatusAt: number;
  statusMsgId: number | null;
  isRunning: boolean;
  stopRequested: boolean;
  sent: number;
  processed: number;
};

const sendQueues = new Map<number, SendQueue>();

export const isUserSending = (userId: number): boolean => {
  const q = sendQueues.get(userId);
  return !!(q && q.isRunning);
};

export const stopSendForUser = async (telegramId: number) => {
  const q = sendQueues.get(telegramId);
  if (!q || !q.isRunning) {
    await bot.api
      .sendMessage(telegramId, "ℹ️ У вас нет активной рассылки.")
      .catch(() => { });
    return;
  }

  q.stopRequested = true;

  const elapsed = Date.now() - q.startTime;
  const elapsedText = formatTime(elapsed);

  const total = q.items.length;
  const processed = q.processed;

  await bot.api
    .sendMessage(
      telegramId,
      `🛑 Останавливаю рассылку…\n\n` +
      `⏱ Время работы: <b>${elapsedText}</b>\n` +
      `✉️ Отправлено: <b>${processed}</b> из <b>${total}</b>`,
      { parse_mode: "HTML" }
    )
    .catch(() => { });
};

export const stopAllSends = async () => {
  for (const [, q] of sendQueues) q.stopRequested = true;
};

const finalizeSend = async (q: SendQueue) => {
  console.log(`[SENDER] ✅ Рассылка завершена для пользователя ${q.telegramId}. Обработано: ${q.processed} из ${q.items.length}`);

  if (q.statusMsgId) {
    await bot.api.deleteMessage(q.telegramId, q.statusMsgId).catch(() => { });
  }
  await bot.api
    .sendMessage(q.telegramId, `✅ Рассылка завершена.`)
    .catch(() => { });

  q.isRunning = false;
  sendQueues.delete(q.telegramId);
};

export const sendStatusForUser = async (telegramId: number) => {
  const q = sendQueues.get(telegramId);

  if (!q || !q.isRunning) {
    await bot.api
      .sendMessage(telegramId, "ℹ️ У вас нет активной рассылки.")
      .catch(() => { });
    return;
  }

  const elapsed = Date.now() - q.startTime;
  const elapsedText = formatTime(elapsed);

  const total = q.items.length;
  const processed = q.processed;

  const text =
    `📊 Статус рассылки\n\n` +
    `⏱ Идёт уже: <b>${elapsedText}</b>\n` +
    `✉️ Отправлено: <b>${processed}</b> из <b>${total}</b>\n`;

  await bot.api
    .sendMessage(telegramId, text, { parse_mode: "HTML" })
    .catch(() => { });
};

const processSendQueue = async (q: SendQueue) => {
  q.isRunning = true;

  const total = q.items.length;

  console.log(`[SENDER] 🚀 Начало рассылки для пользователя ${q.telegramId}, писем: ${total}`);

  await bot.api
    .sendMessage(
      q.telegramId,
      `🚀 Начинаю рассылку в фоне.\nБудет отправлено <b>${total}</b> писем.`,
      { parse_mode: "HTML" }
    )
    .catch(() => { });

  for (const ad of q.items) {
    try {
      if (q.stopRequested) break;

      const { min, max } = await UserRepo.getInterval(q.telegramId);
      const waitSec = randInt(min, max);

      const picked = await ProxyRepo.nextValidProxy(q.telegramId);
      if (!picked) {
        console.warn(`[SENDER] Нет валидных прокси для пользователя ${q.telegramId}`);
        await bot.api
          .sendMessage(
            q.telegramId,
            "❌ Нет валидных прокси для отправки. Останавливаюсь."
          )
          .catch(() => { });
        break;
      }
      const proxyUrl = toProxyAuth(picked.proxy);
      console.log(`[SENDER] Используется прокси: ${picked.proxy} (нормализован: ${proxyUrl})`);

      const sender = await EmailRepo.nextValidEmail(q.telegramId);
      if (!sender) {
        await bot.api
          .sendMessage(
            q.telegramId,
            "❌ Нет доступных e-mail отправителей (isValid=1, isSpam=0). Останавливаюсь."
          )
          .catch(() => { });
        break;
      }

      const preset = await SmartPresetRepo.nextSmartPreset(q.telegramId);

      let bodyText: string;
      if (preset) {
        const replaced = preset.text.replaceAll("OFFER", ad.title);
        bodyText = `${replaced}`;
      } else {
        bodyText = `${ad.title}`;
      }

      const leftBefore = total - q.processed;

      const senderName = sender.name;

      await sleep(waitSec * 1000);

      if (q.stopRequested) break;

      try {
        console.log(`[SENDER] Отправка письма: ${ad.email} | Тема: ${ad.title} | Прокси: ${picked.proxy}`);
        await launchSend(
          q.telegramId,
          waitSec,
          leftBefore,
          sender.id,
          sender.email,
          proxyUrl,
          senderName,
          ad.email,
          ad.title,
          bodyText,
          ad.id,
          picked.proxy
        );
      } catch (e: any) {
        console.error(`[SENDER] Ошибка отправки: ${e?.message ?? e}`);
        await console.warn(e);
        await bot.api.sendMessage(q.telegramId, e, { parse_mode: "HTML" });
      }

      q.processed++;
    } catch {
      break;
    }
  }

  await finalizeSend(q);
};

export const startSendFromDb = async (telegramId: number) => {
  if (isUserSending(telegramId)) {
    await bot.api
      .sendMessage(
        telegramId,
        "⏳ У вас уже идёт рассылка. Новый запуск невозможен до завершения текущей."
      )
      .catch(() => { });
    return;
  }

  const ready = await AdvertsRepo.listReadyByTelegramId(telegramId);
  if (!ready.length) {
    bot.api
      .sendMessage(
        telegramId,
        "😐 Нет объявлений со статусом 2 (готово к отправке)."
      )
      .catch(() => { });
    return;
  }

  const q: SendQueue = {
    telegramId,
    items: ready.map((r) => ({ id: r.id, title: r.title, email: r.email! })),
    startTime: Date.now(),
    lastStatusAt: 0,
    statusMsgId: null,
    isRunning: false,
    stopRequested: false,
    sent: 0,
    processed: 0,
  };
  sendQueues.set(telegramId, q);

  processSendQueue(q).catch((err) => {
    console.error(`Sender error [${telegramId}]:`, err);
    q.isRunning = false;
    sendQueues.delete(telegramId);
  });
};
