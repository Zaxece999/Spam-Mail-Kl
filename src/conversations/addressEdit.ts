import { Composer, InlineKeyboard } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { UserRepo } from "../db/queries";

const composer = new Composer<CustomContext>();

async function addressEditConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
) {
  const cancelMenu = conversation
    .menu("cancel-address", { autoAnswer: false })
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await Menus.middleware()(ctx, () => Promise.resolve());
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await addressView(ctx);
      await conversation.halt();
    });

  const waitingText =
    "✍️ Введите новый адрес:\n\n" + "<i>Строка до 500 символов.</i>";

  const requestMsg = await ctx.editMessageText(waitingText, {
    parse_mode: "HTML",
    reply_markup: cancelMenu,
  });

  const answer = await conversation.waitFor(":text").and(
    (ctx) => {
      const address = ctx.msg.text.trim();
      return address.length > 0 && address.length <= 500;
    },
    {
      otherwise: async (ctx) => {
        if (ctx.callbackQuery) return;
        await ctx.deleteMessage();
        if (requestMsg !== true) {
          try {
            await requestMsg.editText(
              `${waitingText}\n\n❌ <b>Некорректный ввод!</b> Адрес не должен быть пустым и длиннее 500 символов.`,
              { parse_mode: "HTML", reply_markup: cancelMenu }
            );
          } catch {}
        }
      },
    }
  );

  const newAddress = answer.msg.text.trim();
  await UserRepo.setAddress(ctx.from!.id, newAddress);

  await conversation.external(() => ctx.deleteMessage());

  if (requestMsg !== true) {
    try {
      await requestMsg.delete();
    } catch {}
  }

  const address = newAddress;
  const keyboard = new InlineKeyboard()
    .text("🔄 Установить", "address-menu/0/0")
    .text("🔙 Назад", "settings-menu/0/0")
    .row()
    .text("♻️ Скрыть", "address-menu/2/0");

  await conversation.external(async (ctx) => {
    await ctx.reply(
      `<b>📍 Текущий адрес (GAG):</b>\n\n<code>${address || "—"}</code>`,
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      }
    );
  });
}

composer.use(createConversation(addressEditConv, "addressEditConv"));

export default composer;
