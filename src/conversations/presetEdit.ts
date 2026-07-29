import { Composer } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { presetsView } from "../views/settings";
import { PresetRepo } from "../db/queries";

const composer = new Composer<CustomContext>();

async function presetEditConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  presetId: number,
  Title: string
) {

  const cancelMenu = conversation.menu("cancel", { autoAnswer: false }).text("🚫 Отмена", async (ctx) => {
    await ctx.menu.close();
    await Menus.middleware()(ctx, () => Promise.resolve());
    await ctx.answerCallbackQuery("⚡️ Действие отменено");
    await presetsView(ctx);
    await conversation.halt();
  });

  const waitingText =
    `✍️ Редактирование пресета: <b>${Title}</b>\n\n` +
    "<i>Введите новый текст (от 1 до 1024 символов).</i>";

  await ctx.editMessageText(waitingText, {
    parse_mode: "HTML",
    reply_markup: cancelMenu,
  });

  const answer = await conversation.waitFor(":text").and(
    (ctx) => ctx.msg.text.trim().length > 0 && ctx.msg.text.trim().length <= 1024,
    {
      otherwise: async (ctx) => {
        if (ctx.callbackQuery) return;
        await ctx.deleteMessage();
        try {
          await ctx.editMessageText(
            `${waitingText}\n\n❌ <b>Некорректный ввод!</b> Длина текста должна быть от 1 до 1024 символов.`,
            { parse_mode: "HTML", reply_markup: cancelMenu }
          );
        } catch {}
      },
    }
  );

  const newText = answer.msg.text.trim();
  await answer.deleteMessage();

  try {
    await conversation.external((ctx) =>
      PresetRepo.update(ctx.from!.id, presetId, newText)
    );
    await ctx.editMessageText(`✅ Текст для пресета <b>${Title}</b> обновлён!`, {
      parse_mode: "HTML",
    });
  } catch (err) {
    await ctx.editMessageText(
      `❌ Ошибка: <code>${(err as Error).message}</code>`,
      { parse_mode: "HTML" }
    );
    await conversation.halt();
  }

  await conversation.external(async (ctx) => {
    await Menus.middleware()(ctx, () => Promise.resolve());
    await presetsView(ctx);
  });

  await conversation.halt();
}

composer.use(createConversation(presetEditConv));
export default composer;
