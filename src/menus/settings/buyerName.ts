import { Menu } from "@grammyjs/menu";
import type { CustomContext } from "../../types";
import { settingsView } from "../../views/settings";

export const buyerNameMenu = new Menu<CustomContext>("buyer-name-menu")
  .text("🔄 Установить", async (ctx) => {
    await ctx.conversation.enter("buyerNameEditConv");
  })
  .text("🔙 Назад", async (ctx) => {
    await settingsView(ctx);
  })
  .row()
  .text("♻️ Скрыть", async (ctx) => {
    await ctx.answerCallbackQuery("♻️ Скрыто");
    await ctx.deleteMessage();
  });
