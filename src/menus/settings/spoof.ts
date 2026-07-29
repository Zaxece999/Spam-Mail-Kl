import { Menu } from "@grammyjs/menu";
import type { CustomContext } from "../../types";
import { settingsView } from "../../views/settings";

export const spoofMenu = new Menu<CustomContext>("spoof-menu")
  .text("🔄 Установить", async (ctx) => {
    await ctx.conversation.enter("spoofNameEditConv");
  })
  .text("🔙 Назад", async (ctx) => {
    await settingsView(ctx);
  })
  .row()
  .text("♻️ Скрыть", async (ctx) => {
    await ctx.answerCallbackQuery("♻️ Скрыто");
    await ctx.deleteMessage();
  });
