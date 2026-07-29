import { Composer } from "grammy";

import type { CustomContext } from "../types";
import { settingsView } from "../views/settings";

const composer = new Composer<CustomContext>();

composer.hears("⚙️ Настройки", async (ctx) => {
  console.log(`[handlers/settings] ⚙️ Настройки clicked by user ${ctx.from.id}`);
  try {
    await settingsView(ctx);
    await ctx.deleteMessage();
    console.log(`[handlers/settings] ⚙️ Success for user ${ctx.from.id}`);
  } catch (error) {
    console.error(`[handlers/settings] ⚙️ Error for user ${ctx.from.id}:`, error);
    await ctx.reply("❌ Ошибка при открытии настроек. Попробуйте /start").catch(() => {});
  }
});

export default composer;
