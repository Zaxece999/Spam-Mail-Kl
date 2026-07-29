import { Bot, GrammyError, HttpError, session, InlineKeyboard } from "grammy";
import { sequentialize } from "@grammyjs/runner";
import { autoRetry } from "@grammyjs/auto-retry";
import { conversations } from "@grammyjs/conversations";
import { commands } from "@grammyjs/commands";
import { limit } from "@grammyjs/ratelimiter";
import { hydrateApi, hydrateContext, hydrate } from "@grammyjs/hydrate";
import { hydrateFiles } from "@grammyjs/files";
import { EntitiesParser } from "@qz/telegram-entities-parser";
import type { Message } from "@qz/telegram-entities-parser/types";

import replyOrEditMiddleware from "./middlewares/ReplyOrEdit";
import type { CustomContext, CustomApi, SessionData } from "./types";
import { BOT_TOKEN } from "./config";
import { userCommands } from "./commands";
import { userMiddleware } from "./middlewares/userMiddleware";
import Conv from "./conversations";
import Handlers from "./handlers";
import Menus from "./menus";
import { addressMenu } from "./menus/settings/address";
import { buyerNameMenu } from "./menus/settings/buyerName";
import Callbacks from "./callbacks";
import { handleAdminPanelCommand } from "./handlers/adminPanel";

export const bot = new Bot<CustomContext, CustomApi>(BOT_TOKEN);

function initial(): SessionData {
  return { step: "" };
}

bot.use(limit());
bot.api.config.use(
  autoRetry({
    maxRetryAttempts: 3,
    maxDelaySeconds: 30,
    rethrowInternalServerErrors: false,
    rethrowHttpErrors: false,
  })
);

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    console.log(
      `🔍 [bot.ts] Callback received: ${ctx.callbackQuery.data?.substring(0, 50)} from user ${ctx.from?.id}`
    );
    console.log(`🔍 [bot.ts] Full callback data: "${ctx.callbackQuery.data}"`);
  }

  if (ctx.message?.text) {
    console.log(
      `📝 [bot.ts] Message received: "${ctx.message.text}" from user ${ctx.from?.id}`
    );
  }

  const timeoutMs = 30_000;
  const startedAt = Date.now();
  let timedOut = false;

  const watchdog = setTimeout(() => {
    timedOut = true;
    console.warn(
      `⏱ [watchdog] Update ${ctx.update.update_id} for user ${ctx.from?.id} exceeds ${timeoutMs}ms`
    );
  }, timeoutMs);

  try {
    await next();
  } catch (err) {
    clearTimeout(watchdog);
    console.error(`❌ [bot.ts] Error in middleware chain:`, err);
    throw err;
  }

  clearTimeout(watchdog);

  if (timedOut) {
    const duration = Date.now() - startedAt;
    console.warn(
      `✅ [watchdog] Update ${ctx.update.update_id} finished after ${duration}ms (user ${ctx.from?.id})`
    );
  } else if (ctx.callbackQuery) {
    console.log(`✅ [bot.ts] Callback processed successfully for user ${ctx.from?.id}`);
  }
});

bot.use(session({
  initial,

  getSessionKey: (ctx) => {
    return ctx.chat?.id && ctx.from?.id
      ? `${ctx.chat.id}:${ctx.from.id}`
      : undefined;
  },
}));
bot.use(replyOrEditMiddleware);
bot.use(hydrateContext());
bot.api.config.use(hydrateApi());
bot.api.config.use(hydrateFiles(bot.token));

bot.use(
  sequentialize((ctx) => {
    const chat = ctx.chat?.id.toString();
    const user = ctx.from?.id.toString();
    return [chat, user].filter((con) => con !== undefined);
  })
);

bot.use(
  conversations<CustomContext, CustomContext>({
    plugins: [hydrate(), replyOrEditMiddleware],
  })
);

bot.use(commands());
bot.use(userMiddleware);
bot.use(userCommands);

try {
  const timeout = new Promise<void>((_, reject) => setTimeout(() => reject(new Error("setCommands timeout")), 5000));
  await Promise.race([userCommands.setCommands(bot), timeout]);
  console.log("✅ bot.ts: команды Telegram установлены");
} catch (err) {
  console.error("⚠️ bot.ts: не удалось установить команды (продолжаем работу):", err?.message || err);
}

bot.hears("👑 Админ панель", async (ctx, next) => {
  try {
    await handleAdminPanelCommand(ctx as any);
  } catch (err) {
    console.error("[bot.ts] admin panel handler error:", err);
  }
  return;
});

bot.use(async (ctx, next) => {
  console.log(
    `[pipeline] after userCommands, message="${ctx.message?.text ?? ""}", callback="${ctx.callbackQuery?.data ?? ""}"`
  );
  await next();
});

bot.use(Conv);

bot.use(async (ctx, next) => {
  console.log(
    `[pipeline] after Conv, message="${ctx.message?.text ?? ""}", callback="${ctx.callbackQuery?.data ?? ""}"`
  );
  await next();
});

bot.use(Menus);

bot.use(async (ctx, next) => {
  console.log(
    `[pipeline] after Menus, message="${ctx.message?.text ?? ""}", callback="${ctx.callbackQuery?.data ?? ""}"`
  );
  await next();
});

bot.use(addressMenu);
bot.use(buyerNameMenu);
console.log("[menus] registered addressMenu & buyerNameMenu");
bot.use(Callbacks);

bot.use(async (ctx, next) => {
  console.log(
    `[pipeline] after Callbacks, message="${ctx.message?.text ?? ""}", callback="${ctx.callbackQuery?.data ?? ""}"`
  );
  await next();
});
bot.use(Handlers);

bot.catch(async (err) => {
  const ctx = err.ctx;
  console.error(`❌ Ошибка при обработке обновления ${ctx.update.update_id} (user: ${ctx.from?.id}):`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Ошибка в запросе:", e.description);

    if (e.description.includes("message is not modified")) {

    } else {
      await ctx.reply("❌ Произошла ошибка. Попробуйте еще раз.").catch(() => {});
    }
  } else if (e instanceof HttpError) {
    console.error("Не удалось связаться с Telegram:", e);
    await ctx.reply("❌ Проблема связи с Telegram. Попробуйте позже.").catch(() => {});
  } else {
    console.error("Неизвестная ошибка:", e);
    await ctx.reply("❌ Произошла неожиданная ошибка. Попробуйте /start").catch(() => {});
  }
});
