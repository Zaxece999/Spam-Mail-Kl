import { Menu } from "@grammyjs/menu";
import type { CustomContext } from "../../types";
import { settingsView } from "../../views/settings";

export const addressMenu = new Menu<CustomContext>("address-menu")
  .text("🔄 Установить", async (ctx) => {
    await ctx.conversation.enter("addressEditConv");
  })
  .text("🔙 Назад", async (ctx) => {
    await settingsView(ctx);
  })
  .row()
  .text("♻️ Скрыть", async (ctx) => {
    await ctx.answerCallbackQuery("♻️ Скрыто");
    await ctx.deleteMessage();
  });
