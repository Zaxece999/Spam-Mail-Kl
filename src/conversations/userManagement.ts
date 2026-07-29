import type { CustomContext } from "../types";
import { createConversation } from "@grammyjs/conversations";
import { UserRepo } from "../db/queries";
import { InlineKeyboard } from "grammy";

export const userManagementConversation = createConversation(
  async (conversation: any, ctx: CustomContext) => {
    await ctx.reply(
      "👥 <b>Управление пользователями</b>\n\n" +
      "Отправьте Telegram ID пользователя, которому хотите выдать доступ:",
      { parse_mode: "HTML" }
    );

    const { message } = await conversation.wait();

    if (!message?.text) {
      await ctx.reply("❌ Пожалуйста, отправьте числовой ID пользователя");
      return;
    }

    const telegramId = parseInt(message.text.trim());

    if (isNaN(telegramId)) {
      await ctx.reply("❌ Неверный формат ID. Введите числовой ID пользователя");
      return;
    }

    try {

      const user = await UserRepo.getUserByTelegramId(telegramId);

      if (!user) {
        await ctx.reply(
          `❌ Пользователь с ID <code>${telegramId}</code> не найден.\n` +
          "Пользователь должен сначала запустить бота командой /start",
          { parse_mode: "HTML" }
        );
        return;
      }

      const roleEmoji = user.role === "admin" ? "👑" : user.role === "user" ? "👤" : "🚫";
      const username = user.username ? `@${user.username}` : "Без ника";

      const keyboard = new InlineKeyboard()
        .text("✅ Выдать доступ (user)", `grant_user_${telegramId}`)
        .row()
        .text("👑 Сделать админом", `grant_admin_${telegramId}`)
        .row()
        .text("🚫 Заблокировать доступ", `revoke_access_${telegramId}`)
        .row()
        .text("🔙 Назад", "admin_back");

      await ctx.reply(
        `👤 <b>Пользователь найден</b>\n\n` +
        `${roleEmoji} <b>${username}</b>\n` +
        `ID: <code>${telegramId}</code>\n` +
        `Роль: <b>${user.role}</b>\n` +
        `Дата регистрации: ${new Date(user.createdAt).toLocaleString("ru-RU")}\n` +
        `Последняя активность: ${new Date(user.lastOnline).toLocaleString("ru-RU")}\n\n` +
        "Выберите действие:",
        {
          reply_markup: keyboard,
          parse_mode: "HTML"
        }
      );

    } catch (error) {
      console.error("Error in user management:", error);
      await ctx.reply("❌ Ошибка при поиске пользователя");
    }
  },
  "userManagementConversation"
);

export const userSearchConversation = createConversation(
  async (conversation: any, ctx: CustomContext) => {
    await ctx.reply(
      "🔍 <b>Поиск пользователя</b>\n\n" +
      "Отправьте Telegram ID пользователя для просмотра информации:",
      { parse_mode: "HTML" }
    );

    const { message } = await conversation.wait();

    if (!message?.text) {
      await ctx.reply("❌ Пожалуйста, отправьте числовой ID пользователя");
      return;
    }

    const telegramId = parseInt(message.text.trim());

    if (isNaN(telegramId)) {
      await ctx.reply("❌ Неверный формат ID. Введите числовой ID пользователя");
      return;
    }

    try {
      const user = await UserRepo.getUserByTelegramId(telegramId);

      if (!user) {
        await ctx.reply(
          `❌ Пользователь с ID <code>${telegramId}</code> не найден`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const roleEmoji = user.role === "admin" ? "👑" : user.role === "user" ? "👤" : "🚫";
      const username = user.username ? `@${user.username}` : "Без ника";

      const keyboard = new InlineKeyboard()
        .text("📋 Управление", `user_manage_${telegramId}`)
        .row()
        .text("🔙 Назад", "admin_back");

      await ctx.reply(
        `👤 <b>Информация о пользователе</b>\n\n` +
        `${roleEmoji} <b>${username}</b>\n` +
        `ID: <code>${telegramId}</code>\n` +
        `Роль: <b>${user.role}</b>\n` +
        `Дата регистрации: ${new Date(user.createdAt).toLocaleString("ru-RU")}\n` +
        `Последняя активность: ${new Date(user.lastOnline).toLocaleString("ru-RU")}`,
        {
          reply_markup: keyboard,
          parse_mode: "HTML"
        }
      );

    } catch (error) {
      console.error("Error in user search:", error);
      await ctx.reply("❌ Ошибка при поиске пользователя");
    }
  },
  "userSearchConversation"
);
