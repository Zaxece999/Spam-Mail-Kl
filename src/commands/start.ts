import { Keyboard } from "grammy";
import type { CustomContext } from "../types";
import { Command } from "@grammyjs/commands";
import { bot } from "../bot";
import { UserRepo } from "../db/queries";

export default new Command<CustomContext>(
  "start",
  "Начать работу",
  async (ctx) => {
    if (!ctx.from) {
      await ctx.reply("❌ Ошибка: Не удалось определить пользователя");
      return;
    }

    await ctx.conversation.exitAll();

    try {

      const userRole = await UserRepo.getRole(ctx.from.id);

      if (userRole === "guest") {
        await ctx.reply(
          "🚫 <b>Доступ ограничен</b>\n\n" +
          "У вас нет доступа к боту. Обратитесь к администратору для получения доступа.\n\n" +
          `Ваш ID: <code>${ctx.from.id}</code>`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const keyboard = new Keyboard()
        .text("📝 Шаблоны")
        .text("⚙️ Настройки")
        .row();

      if (userRole === "admin") {
        keyboard.text("👑 Админ панель").row();
      }

      keyboard.resized();

      const welcomeMessage = userRole === "admin"
        ? "📬 <b>Добро пожаловать, Администратор!</b>"
        : "📬 <b>Добро пожаловать!</b>";

      await ctx.reply(welcomeMessage, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });

      await ctx.deleteMessage();

    } catch (error) {
      console.error("Error in start command:", error);
      await ctx.reply("❌ Ошибка при загрузке. Попробуйте позже.");
    }
  }
);
