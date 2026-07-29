import { Composer } from "grammy";
import type { CustomContext } from "../types";

import nickChek from "./nickCheck";
import htmlTemplates from "./htmlTemplates";
import settings from "./settings";
import { handleAdminCallbacks } from "./adminCallbacks";
import { ADMIN_SESSION_KEY } from "./adminPanel";

import { isUserSending } from "../emailSender";

const composer = new Composer<CustomContext>();

composer.use(async (ctx, next) => {
  console.log(
    `[handlers] incoming update ${ctx.update.update_id}, message="${ctx.message?.text ?? ""}", callback="${ctx.callbackQuery?.data ?? ""}"`
  );
  try {
    await next();
    console.log(
      `[handlers] handled update ${ctx.update.update_id}, message="${ctx.message?.text ?? ""}", callback="${ctx.callbackQuery?.data ?? ""}"`
    );
  } catch (err) {
    console.error(`[handlers] error inside handlers composer for update ${ctx.update.update_id}:`, err);
    throw err;
  }
});

composer.command("send_status", async (ctx: CustomContext) => {
  await ctx.reply(isUserSending(ctx.from!.id) ? "⚙️ Рассылка идёт." : "✅ Рассылка не запущена.");
});

composer.command("test", async (ctx: CustomContext) => {
  await ctx.reply("test",{
        parse_mode: "HTML",
        reply_parameters: {
          message_id: 0,
          allow_sending_without_reply: true,
        },
        link_preview_options: { is_disabled: true },
      });
});

composer.hears("👑 Админ панель", async (ctx: CustomContext) => {
  console.log("🔧 Admin panel button clicked by user:", ctx.from?.id);

  if (!ctx.from) {
    console.error("❌ No user found in admin panel handler");
    return;
  }

  try {
    const { isAdmin } = await import("../middlewares/roleMiddleware");
    console.log("🔍 Checking admin status for user:", ctx.from.id);
    const userIsAdmin = await isAdmin(ctx.from.id);
    console.log("✅ Admin check result:", userIsAdmin);

    if (!userIsAdmin) {
      console.log("🚫 Access denied for user:", ctx.from.id);
      await ctx.reply("🚫 У вас нет доступа к админ панели.");
      return;
    }

    const { InlineKeyboard } = await import("grammy");
    const keyboard = new InlineKeyboard()
      .text("👥 Управление пользователями", "admin_manage")
      .row()
      .text("📋 Просмотр доступа", "admin_access")
      .row()
      .text("🔑 Ключи", "admin_keys")
      .row()
      .text("⬅️ Закрыть", "admin_close");

    console.log("📤 Sending admin panel keyboard to user:", ctx.from.id);
    await ctx.reply("👑 <b>Админ панель</b>\n\nВыберите действие:", {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
    console.log("✅ Admin panel sent successfully");

  } catch (error) {
    console.error("❌ Error in admin panel handler:", error);
    await ctx.reply("❌ Ошибка открытия админ панели");
  }
});

composer.on("callback_query", handleAdminCallbacks);

composer.on("message:text", async (ctx: CustomContext, next: () => Promise<void>) => {
  if (ctx.session && ctx.session.step === ADMIN_SESSION_KEY && ctx.message?.text) {
    console.log(`[admin-manage] ID input received: "${ctx.message.text}" from ${ctx.from?.id}`);
    const { processUserIdSubmission } = await import("./adminPanel");
    try {
      await processUserIdSubmission(ctx, ctx.message.text);
    } catch (err) {
      console.error(`[admin-manage] Failed to process ID ${ctx.message.text}:`, err);
      await ctx.reply("❌ Ошибка при обработке ID, попробуйте ещё раз.");
    }
    return;
  }

  if (ctx.session && ctx.session.step === "await_key_add" && ctx.message?.text) {
    await processKeyAdd(ctx, ctx.message.text);
    return;
  }

  if (ctx.session && ctx.session.step?.startsWith("await_key_edit_") && ctx.message?.text) {
    const keyId = parseInt(ctx.session.step.replace("await_key_edit_", ""));
    await processKeyEdit(ctx, keyId, ctx.message.text);
    return;
  }

  if (ctx.session && ctx.session.step?.startsWith("await_edit_amount_") && ctx.message?.text) {
    const advertId = parseInt(ctx.session.step.replace("await_edit_amount_", ""));
    await processEditAmount(ctx, advertId, ctx.message.text);
    return;
  }

  await next();
});

async function processKeyAdd(ctx: CustomContext, text: string) {
  const { KeysRepo } = await import("../db/queries");

  try {
    const parts = text.trim().split(":");
    const keyValue = parts[0]?.trim();
    const rps = parts[1] ? parseInt(parts[1].trim()) : 5;

    if (!keyValue || keyValue.length < 10) {
      await ctx.reply("❌ Неверный формат ключа. Ключ должен быть длиннее 10 символов.");
      return;
    }

    if (isNaN(rps) || rps < 1 || rps > 100) {
      await ctx.reply("❌ Неверное значение RPS. Должно быть число от 1 до 100.");
      return;
    }

    const keyId = await KeysRepo.create(keyValue, rps);
    ctx.session.step = "";

    await ctx.reply(
      `✅ <b>Ключ добавлен!</b>\n\nID: ${keyId}\nRPS: ${rps}`,
      { parse_mode: "HTML" }
    );

  } catch (error) {
    ctx.session.step = "";
    await ctx.reply("❌ Ошибка при добавлении ключа.");
  }
}

async function processKeyEdit(ctx: CustomContext, keyId: number, text: string) {
  const { KeysRepo } = await import("../db/queries");

  try {
    const parts = text.trim().split(":");
    const keyValue = parts[0]?.trim();
    const rps = parts[1] ? parseInt(parts[1].trim()) : 5;

    if (!keyValue || keyValue.length < 10) {
      await ctx.reply("❌ Неверный формат ключа. Ключ должен быть длиннее 10 символов.");
      return;
    }

    if (isNaN(rps) || rps < 1 || rps > 100) {
      await ctx.reply("❌ Неверное значение RPS. Должно быть число от 1 до 100.");
      return;
    }

    const success = await KeysRepo.update(keyId, {
      keyValue,
      rps,
      enabled: true,
      errorMessage: null
    });

    ctx.session.step = "";

    if (success) {
      await ctx.reply(
        `✅ <b>Ключ обновлен!</b>\n\nНовый RPS: ${rps}`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply("❌ Ключ не найден или ошибка обновления.");
    }

  } catch (error) {
    ctx.session.step = "";
    await ctx.reply("❌ Ошибка при обновлении ключа.");
  }
}

async function processEditAmount(ctx: CustomContext, advertId: number, text: string) {
  const { AdvertsRepo } = await import("../db/queries");

  try {
    const amount = text.trim();

    if (!/^\d+[\d,.]*$/.test(amount)) {
      await ctx.reply("❌ Неверный формат суммы. Введите только числа, например: 129.99");
      return;
    }

    const success = await AdvertsRepo.setPrice(advertId, amount);
    ctx.session.step = "";

    if (success) {
      await ctx.reply(`✅ Сумма обновлена: ${amount}`);
    } else {
      await ctx.reply("❌ Ошибка обновления суммы: объявление не найдено или ошибка базы данных.");
    }
  } catch (error) {
    ctx.session.step = "";
    await ctx.reply("❌ Ошибка при сохранении суммы.");
  }
}

composer.use(htmlTemplates);
composer.use(nickChek);
composer.use(settings);

composer.use(async (ctx: CustomContext) => {
  if (ctx.message?.pinned_message) return;
  await ctx.reply(
    "❗️ <b>Неизвестная команда.</b> Используйте /start, чтобы перезапустить бота.",
    { parse_mode: "HTML" }
  );
});

export default composer;
