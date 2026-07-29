import { Composer } from "grammy";
import { Menu } from "@grammyjs/menu";
import type { CustomContext } from "../types";

const composer = new Composer();

const htmlTemplatesMenu = new Menu<CustomContext>("html-templates")
  .text("📄 GO", async (ctx) => {
    await ctx.conversation.enter("htmlTemplateGetConv", "go");
  })
  .row()
  .text("📨 PUSH", async (ctx) => {
    await ctx.conversation.enter("htmlTemplateGetConv", "push");
  })
  .text("💬 SMS", async (ctx) => {
    await ctx.conversation.enter("htmlTemplateGetConv", "sms");
  })
  .row()
  .text("🆘 BACK", async (ctx) => {
    await ctx.conversation.enter("htmlTemplateGetConv", "back");
  })
  .row()
  .text("♻️ Скрыть", async (ctx) => {
    await ctx.deleteMessage();
  });

composer.use(htmlTemplatesMenu);

composer.hears("📝 Шаблоны", async (ctx) => {
  await ctx.reply("Выберите шаблон:", {
    reply_markup: htmlTemplatesMenu,
  });

  await ctx.deleteMessage();
});

export default composer;
