import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import type { CustomContext } from "../types";
import { EmailMsgRepo, ProxyRepo, AdvertsRepo, UserRepo } from "../db/queries";
import { toProxyAuth } from "../utils/proxyForm";
import { InputFile } from "grammy";
import { bot } from "../bot";

import { isUserSending } from "../emailSender";

const makeHtmlFile = (html: string, filename = "message.html") =>
  new InputFile(Buffer.from(html, "utf8"), filename);

const safeFileName = (raw?: string) => {
  const base =
    (raw || "message").replace(/[^\p{L}\p{N}\-_. ]/gu, "").trim() || "message";
  return `${base.slice(0, 60)}.html`;
};

export async function sendEmail(options: {
  login: string;
  appPassword: string;
  proxy?: string;
  displayName: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
}) {
  const {
    login,
    appPassword,
    proxy,
    displayName,
    to,
    subject,
    text,
    html,
    inReplyTo,
  } = options;

  const domain = login.split("@")[1]?.toLowerCase();
  let host: string;
  let port: number;
  let secure: boolean;

  switch (domain) {
    case "gmail.com":
      host = "smtp.gmail.com";
      port = 465;
      secure = true;
      break;
    case "yahoo.com":
      host = "smtp.mail.yahoo.com";
      port = 465;
      secure = true;
      break;
    case "outlook.com":
    case "hotmail.com":
    case "live.com":
      host = "smtp.office365.com";
      port = 587;
      secure = false;
      break;
    case "icloud.com":
    case "me.com":
    case "mac.com":
      host = "smtp.mail.me.com";
      port = 465;
      secure = true;
      break;
    default:
      host = `smtp.${domain}`;
      port = 465;
      secure = true;
      break;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: login, pass: appPassword },

    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    ...(proxy
      ? { proxy: proxy.startsWith("http") ? proxy : `http://${proxy}` }
      : {}),
  } as SMTPTransport.Options);

  return transporter.sendMail({
    from: `"${displayName}" <${login}>`,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  });
}

export function isConnectionError(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  const CODES = new Set([
    "ECONNECTION",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "ESOCKET",
    "EPIPE",
  ]);
  return (
    CODES.has(code) ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("proxy") ||
    msg.includes("socks") ||
    msg.includes("tunneling") ||
    msg.includes("failed to setup proxy connection") ||
    msg.includes("connection closed") ||
    msg.includes("getaddrinfo")
  );
}

export function isProxyError(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "");

  return (
    msg.includes("403") ||
    msg.includes("proxy") ||
    msg.includes("407") ||
    msg.includes("invalid response from proxy") ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND"
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultBackoff = (attempt: number) => 1000 * attempt;

export async function sendWithRetry(options: {
  login: string;
  appPassword: string;
  proxy?: string;
  displayName: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  retries?: number;
  backoffMs?: (attempt: number) => number;
}) {
  const { retries = 5, backoffMs = defaultBackoff, ...mail } = options;

  let lastError: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[SEND] Попытка ${attempt}/${retries} отправки на ${mail.to}`);
      const info = await sendEmail(mail);
      console.log(`[SEND] ✅ Успешно отправлено на ${mail.to} с попытки ${attempt}`);
      return { info, attempt };
    } catch (err) {
      lastError = err;
      console.error(`[SEND] ❌ Попытка ${attempt}/${retries} не удалась: ${(err as any)?.message ?? err}`);
      if (attempt < retries) {
        const waitMs = backoffMs(attempt);
        console.log(`[SEND] ⏳ Ожидание ${waitMs}ms перед следующей попыткой...`);
        await sleep(waitMs);
      }
    }
  }
  console.error(`[SEND] ❌ Все ${retries} попыток исчерпаны для ${mail.to}`);
  throw lastError;
}

export async function preSendEmail(
  ctx: CustomContext,
  mailId: number,
  text?: string,
  html?: string
): Promise<void> {
  const tgId = ctx.from!.id;

  const msgRow = await EmailMsgRepo.getFullMessage(mailId);
  if (!msgRow) {
    await ctx.reply(`❌ Message with id=${mailId} not found`).catch(() => {});
    return;
  }

  const [login, appPassword] = msgRow.email.split(":");
  if (!login || !appPassword) {
    await ctx
      .reply(`❌ Invalid email format in DB: ${msgRow.email}`)
      .catch(() => {});
    return;
  }

  const picked = await ProxyRepo.nextValidProxy(tgId);
  if (!picked) {
    await ctx.reply("❌ Нет валидных прокси для отправки.").catch(() => {});
    return;
  }
  const proxyUrl = toProxyAuth(picked.proxy);

  const contentLabel =
    text && text.trim().length > 0
      ? `<code>${text}</code>`
      : html
        ? "<i>[HTML]</i>"
        : "<i>[empty]</i>";

  const flags = await UserRepo.getFlags(ctx.from!.id);
  let senderName: string;
  if (html) {
    senderName = flags.spoofMode
      ? await UserRepo.getSpoofName(ctx.from!.id)
      : msgRow.name;
  } else {
    senderName = msgRow.name;
  }

  const sent = await ctx.reply(
    `<b>Ответ:</b> ${contentLabel} <b>идет отправка</b> <code>${msgRow.emailFrom}</code> ⏳`,
    {
      parse_mode: "HTML",
      reply_parameters: {
        message_id: msgRow.tgMsgId,
        allow_sending_without_reply: true,
      },
    }
  );

  void (async () => {
    try {
      const { info } = await sendWithRetry({
        login,
        appPassword,
        proxy: proxyUrl,
        displayName: senderName,
        to: msgRow.emailFrom,
        subject: msgRow.subject,
        text: text || undefined,
        html: html || undefined,
        inReplyTo: msgRow.msgId,
        retries: 5,
      });

      await sent
        .editText(
          `<b>Ответ:</b> ${contentLabel} <b>успешно отправлен пользователю</b> <code>${msgRow.emailFrom}</code> ⚡️`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});

      if (html && html.trim().length > 0) {
        const file = makeHtmlFile(html, safeFileName(msgRow.subject));
        await ctx.api
          .sendDocument(ctx.chat!.id, file, {
            caption: "📎 HTML, который был отправлен",
            parse_mode: "HTML",
            reply_parameters: {
              message_id: sent.message_id,
              allow_sending_without_reply: true,
            },
          })
          .catch(() => {});
      }

      try {
        await EmailMsgRepo.logSent(
          msgRow.emailId,
          String(info.messageId),
          msgRow.subject,
          msgRow.text,
          msgRow.senderName,
          login,
          sent.message_id,
          msgRow.advertId ?? null
        );
      } catch (logErr: any) {
        console.error(
          `[SEND] ❌ Ответ отправлен (${msgRow.emailFrom}, mailId=${mailId}, messageId=${info.messageId}), но не удалось записать в БД:`,
          logErr
        );
        await ctx.reply(
          `⚠️ Ответ доставлен <code>${msgRow.emailFrom}</code>, но не сохранился в БД. Дальнейшие ответы покупателя могут не привязаться к объявлению. Ошибка: <code>${logErr?.message ?? "UNKNOWN"}</code>`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
    } catch (err: any) {

      if (isProxyError(err)) {
        console.error(`[PROXY ERROR] Прокси помечен как невалидный: ${picked.proxy}`);
        console.error(`[PROXY ERROR] Причина: ${err?.message ?? err?.code ?? "UNKNOWN"}`);

        const is403 = String(err?.message ?? "").includes("403");
        const isHttp = !picked.proxy.toLowerCase().startsWith("socks");
        if (is403 && isHttp) {
          console.warn(`[PROXY ERROR] ⚠️ HTTP прокси блокирует SMTP трафик. Рекомендуется использовать SOCKS5 прокси для отправки писем.`);
        }

        await ProxyRepo.markInvalidByProxy(tgId, picked.proxy).catch(() => {});
      }

      await sent
        .editText(
          `<b>Ответ:</b> ${contentLabel} <b>ошибка при отправке письма</b> <code>${msgRow.emailFrom}</code> <code>${err?.message ?? err?.code ?? "UNKNOWN"}</code> ❌`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }
  })();
}

export async function launchSend(
  telegramId: number,
  waitSec: number,
  leftBefore: number,
  emailId: number,
  email: string,
  proxyUrl: string,
  senderName: string,
  to: string,
  subject: string,
  text: string,
  advertId: number,
  originalProxy?: string
): Promise<void> {
  const [login, appPassword] = email.split(":");
  if (!login || !appPassword) {
    await bot.api
      .sendMessage(telegramId, `❌ Invalid email format in DB: ${email}`)
      .catch(() => {});
    return;
  }

  void (async () => {
    try {
      const { info } = await sendWithRetry({
        login,
        appPassword,
        proxy: proxyUrl,
        displayName: senderName,
        to: to,
        subject: subject,
        text: text,
        retries: 5,
      });

      try {
        await EmailMsgRepo.logSent(
          emailId,
          String(info.messageId),
          subject,
          text,
          senderName,
          login,
          null,
          advertId
        );

        await AdvertsRepo.setStatus(advertId, 3);
      } catch (logErr: any) {
        console.error(
          `[SENDER] ❌ Письмо отправлено (${to}, advertId=${advertId}, messageId=${info.messageId}), но не удалось записать в БД:`,
          logErr
        );
        await bot.api
          .sendMessage(
            telegramId,
            `⚠️ Письмо доставлено <code>${to}</code>, но не сохранилось в БД (advertId=${advertId}). Ответы на него не привяжутся к объявлению автоматически. Ошибка: <code>${logErr?.message ?? "UNKNOWN"}</code>`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
    } catch (err: any) {

      if (originalProxy && isProxyError(err)) {
        console.error(`[PROXY ERROR] Прокси помечен как невалидный: ${originalProxy}`);
        console.error(`[PROXY ERROR] Причина: ${err?.message ?? err?.code ?? "UNKNOWN"}`);
        console.error(`[PROXY ERROR] Получатель: ${to}`);

        const is403 = String(err?.message ?? "").includes("403");
        const isHttp = !originalProxy.toLowerCase().startsWith("socks");
        if (is403 && isHttp) {
          console.warn(`[PROXY ERROR] ⚠️ HTTP прокси блокирует SMTP трафик. Рекомендуется использовать SOCKS5 прокси для отправки писем.`);
        }

        await ProxyRepo.markInvalidByProxy(telegramId, originalProxy).catch(() => {});
      }

      await bot.api
        .sendMessage(
          telegramId,
          `<b>Сообщение:</b> <code>${text}</code> <b>ошибка при отправке письма</b> <code>${to}</code> <code>${err?.message ?? err?.code ?? "UNKNOWN"}</code> ❌`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }
  })();
}
