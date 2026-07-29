import { Menu } from "@grammyjs/menu";
import type { CustomContext } from "../../types";
import { settingsView, intervalView } from "../../views/settings";
import { UserRepo } from "../../db/queries";

export const intervalMenu = new Menu<CustomContext>("interval-menu")
  .text("🔄 Изменить интервал", async (ctx) => {
    await ctx.conversation.enter("intervalEditConv");
  })
  .text("↩️ Сбросить интервал", async (ctx) => {
    await ctx.answerCallbackQuery("⏳ Интервал сброшен");
    await UserRepo.setInterval(ctx.from!.id, 1, 1);
    await intervalView(ctx);
  })
  .row()
  .text("🔙 Назад", async (ctx) => {
    await settingsView(ctx);
  })
  .text("♻️ Скрыть", async (ctx) => {
    await ctx.answerCallbackQuery("♻️ Скрыто");
    await ctx.deleteMessage();
  });
