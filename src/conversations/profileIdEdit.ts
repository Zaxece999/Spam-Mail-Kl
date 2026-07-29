import { Composer } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { profileIdView } from "../views/settings";
import { UserRepo, type TeamProvider } from "../db/queries";

const composer = new Composer<CustomContext>();

async function profileIdEditConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  team: TeamProvider,
) {
  const cancelMenu = conversation
    .menu("cancel-api", { autoAnswer: false })
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await Menus.middleware()(ctx, () => Promise.resolve());
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await profileIdView(ctx);
      await conversation.halt();
    });

  const waitingText =
    "✍️ Введите новый profileId ключ:\n\n" + "<i>Строка до 32 символов.</i>";

  const requestMsg = await ctx.editMessageText(waitingText, {
    parse_mode: "HTML",
    reply_markup: cancelMenu,
  });

  const answer = await conversation.waitFor(":text").and(
    (ctx) => {
      const key = ctx.msg.text.trim();
      return key.length > 0 && key.length <= 32;
    },
    {
      otherwise: async (ctx) => {
        if (ctx.callbackQuery) return;
        await ctx.deleteMessage();
        if (requestMsg !== true) {
          try {
            await requestMsg.editText(
              `${waitingText}\n\n❌ <b>Некорректный ввод!</b> Ключ не должен быть пустым и длиннее 32 символов.`,
              { parse_mode: "HTML", reply_markup: cancelMenu }
            );
          } catch {}
        }
      },
    }
  );

  const apiKey = answer.msg.text.trim();
  await answer.deleteMessage();

  try {
    await conversation.external((ctx) => UserRepo.setProfileId(team, ctx.from!.id, apiKey));
    if (requestMsg !== true) {
      await requestMsg.editText("✅ API ключ успешно обновлён!");
    }
  } catch (err) {
    if (requestMsg !== true) {
      await requestMsg.editText(
        `❌ Ошибка при обновлении API ключа: <code>${(err as Error).message}</code>`,
        { parse_mode: "HTML" }
      );
    }
    await conversation.halt();
  }

  await conversation.external(async (ctx) => {
    await Menus.middleware()(ctx, () => Promise.resolve());
    await profileIdView(ctx);
  });

  await conversation.halt();
}

composer.use(createConversation(profileIdEditConv));
export default composer;
