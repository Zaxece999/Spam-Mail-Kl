import { Composer, InlineKeyboard } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { UserRepo } from "../db/queries";

const composer = new Composer<CustomContext>();

async function buyerNameEditConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
) {
  const cancelMenu = conversation
    .menu("cancel-buyer-name", { autoAnswer: false })
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await Menus.middleware()(ctx, () => Promise.resolve());
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await buyerNameView(ctx);
      await conversation.halt();
    });

  const waitingText =
    "✍️ Введите имя покупателя:\n\n" + "<i>Строка до 200 символов.</i>";

  const requestMsg = await ctx.editMessageText(waitingText, {
    parse_mode: "HTML",
    reply_markup: cancelMenu,
  });

  const answer = await conversation.waitFor(":text").and(
    (ctx) => {
      const name = ctx.msg.text.trim();
      return name.length > 0 && name.length <= 200;
    },
    {
      otherwise: async (ctx) => {
        if (ctx.callbackQuery) return;
        await ctx.deleteMessage();
        if (requestMsg !== true) {
          try {
            await requestMsg.editText(
              `${waitingText}\n\n❌ <b>Некорректный ввод!</b> Имя не должно быть пустым и длиннее 200 символов.`,
              { parse_mode: "HTML", reply_markup: cancelMenu }
            );
          } catch {}
        }
      },
    }
  );

  const newName = answer.msg.text.trim();
  await UserRepo.setBuyerName(ctx.from!.id, newName);

  await conversation.external(() => ctx.deleteMessage());

  if (requestMsg !== true) {
    try {
      await requestMsg.delete();
    } catch {}
  }

  const buyerName = newName;
  const keyboard = new InlineKeyboard()
    .text("🔄 Установить", "buyer-name-menu/0/0")
    .text("🔙 Назад", "settings-menu/0/0")
    .row()
    .text("♻️ Скрыть", "buyer-name-menu/2/0");

  await conversation.external(async (ctx) => {
    await ctx.reply(
      `<b>👤 Имя покупателя (GAG):</b>\n\n<code>${buyerName || "—"}</code>`,
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      }
    );
  });
}

composer.use(createConversation(buyerNameEditConv, "buyerNameEditConv"));

export default composer;
