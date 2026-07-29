import { Menu, MenuRange } from "@grammyjs/menu";
import type { CustomContext } from "../../types";
import { settingsView } from "../../views/settings";

import { UserRepo } from "../../db/queries";

export const teamMenu = new Menu<CustomContext>("team-menu").dynamic(
  async (ctx) => {
    const range = new MenuRange<CustomContext>();

    const team = await UserRepo.getTeam(ctx.from!.id);
    range
      .text(`${team === "aqua" ? "✅ " : ""}Aqua`, async (ctx) => {
        await UserRepo.setTeam(ctx.from.id, "aqua");
        await ctx.menu.update();
      })
      .text(`${team === "tsum" ? "✅ " : ""}Tsum`, async (ctx) => {
        await UserRepo.setTeam(ctx.from.id, "tsum");
        await ctx.menu.update();
      })
      .text(`${team === "gag" ? "✅ " : ""}GAG`, async (ctx) => {
        await UserRepo.setTeam(ctx.from.id, "gag");
        await ctx.menu.update();
      })
      .row()
      .text("🔙 Назад", async (ctx) => {
        await settingsView(ctx);
      })
      .text("♻️ Скрыть", async (ctx) => {
        await ctx.answerCallbackQuery("♻️ Скрыто");
        await ctx.deleteMessage();
      });

    return range;
  }
);
