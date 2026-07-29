import { InlineKeyboard } from "grammy";
import type { CustomContext } from "../types";
import { Command } from "@grammyjs/commands";
import { isAdmin } from "../middlewares/roleMiddleware";

export default new Command<CustomContext>(
  "admin",
  "Админ панель",
  async (ctx) => {
    console.log("🔧 Admin command triggered by user:", ctx.from?.id);

    if (!ctx.from) {
      console.error("❌ No user found in admin command");
      await ctx.reply("❌ Ошибка: Не удалось определить пользователя");
      return;
    }

    console.log("🔍 Checking admin status for user:", ctx.from.id);
    const userIsAdmin = await isAdmin(ctx.from.id);
    console.log("✅ Admin check result:", userIsAdmin);

    if (!userIsAdmin) {
      console.log("🚫 Access denied for user:", ctx.from.id);
      await ctx.reply("🚫 У вас нет доступа к админ панели.");
      return;
    }

    await ctx.conversation.exitAll();

    const keyboard = new InlineKeyboard()
      .text("👥 Управление пользователями", "admin_manage")
      .row()
      .text("📋 Просмотр доступа", "admin_access")
      .row()
      .text("🔑 Ключи", "admin_keys")
      .row()
      .text("⬅️ Закрыть", "admin_close");

    console.log("📤 Sending admin panel to user:", ctx.from.id);
    await ctx.reply("👑 <b>Админ панель</b>\n\nВыберите действие:", {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
);
