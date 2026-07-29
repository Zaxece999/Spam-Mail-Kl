import { Composer } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { emailsView } from "../views/settings";
import { EmailRepo } from "../db/queries";

const composer = new Composer<CustomContext>();

async function emailEditConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  emailId: number,
  oldEmail: string,
  page: number,
) {
  const cancelMenu = conversation
    .menu("cancel-email", { autoAnswer: false })
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await Menus.middleware()(ctx, () => Promise.resolve());
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await emailsView(ctx, page);
      await conversation.halt();
    });

  const waitingText =
    `✍️ Редактирование имени для: <b>${oldEmail}</b>\n\n` +
    "<i>Введите новое имя и фамилию через пробел (например: Иван Иванов).</i>";

  const requestMsg = await ctx.editMessageText(waitingText, {
    parse_mode: "HTML",
    reply_markup: cancelMenu,
  });

  const answer = await conversation.waitFor(":text").and(
    (ctx) => {
      const text = ctx.msg?.text?.trim() ?? "";
      const [first = "", second = ""] = text.split(/\s+/);
      return first.length > 0 && second.length > 0;
    },
    {
      otherwise: async (ctx) => {
        if (ctx.callbackQuery) return;
        await ctx.deleteMessage();
        if (requestMsg !== true) {
          try {
            await requestMsg.editText(
              `${waitingText}\n\n❌ <b>Некорректный ввод!</b> Укажите имя и фамилию через пробел.`,
              { parse_mode: "HTML", reply_markup: cancelMenu }
            );
          } catch {}
        }
      },
    }
  );

  const newName = answer.msg?.text?.trim() ?? "";
  await answer.deleteMessage();

  try {
    await conversation.external(async (ctx) => {
      if (!ctx.from) throw new Error("No from in context");
      await EmailRepo.updateName(ctx.from.id, emailId, newName);
    });
    if (requestMsg !== true) {
      await requestMsg.editText(`✅ Имя обновлено на: <b>${newName}</b>`, {
        parse_mode: "HTML",
      });
    }
  } catch (err) {
    if (requestMsg !== true) {
      await requestMsg.editText(
        `❌ Ошибка: <code>${(err as Error).message}</code>`,
        { parse_mode: "HTML" }
      );
    }
    await conversation.halt();
  }

  await conversation.external(async (ctx) => {
    await Menus.middleware()(ctx, () => Promise.resolve());
    await emailsView(ctx, page);
  });

  await conversation.halt();
}

composer.use(createConversation(emailEditConv));
export default composer;
