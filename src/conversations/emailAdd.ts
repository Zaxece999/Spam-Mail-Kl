import { Composer } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { emailsView } from "../views/settings";
import { EmailRepo } from "../db/queries";
import { EmailStreamManager } from "../emailStream";

export async function checkEmail(raw: string): Promise<boolean> {
  try {
    if (!raw || raw.length > 256) return false;

    if (/[;, ]/.test(raw)) return false;

    const parts = raw.split(":");
    if (parts.length !== 2) return false;

    const [email, pass] = parts.map((p) => p.trim());
    if (!email || !pass) return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

    return true;
  } catch {
    return false;
  }
}

const composer = new Composer<CustomContext>();

function validateName(name: string): boolean {
  if (!name) return false;
  if (name.length > 64) return false;
  if (name.includes("::") || name.includes("..")) return false;
  return true;
}

async function showEmailsMenu(
  conversation: Conversation<CustomContext, CustomContext>,
  page: number
) {
  await conversation.external(async (ctx) => {
    await Menus.middleware()(ctx, () => Promise.resolve());
    await emailsView(ctx, page);
  });
}

async function emailAddConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  page: number
) {
  console.log(`🚀 [emailAdd] Conversation started for user ${ctx.from?.id}, page ${page}`);

  const { InlineKeyboard } = await import("grammy");
  const chooseKeyboard = new InlineKeyboard()
    .text("1️⃣ Одно имя", "choose_single")
    .row()
    .text("🚫 Отмена", "choose_cancel");

  console.log(`📤 [emailAdd] Showing choose keyboard to user ${ctx.from?.id}`);
  await ctx.editMessageText("📧 Выберите способ добавления e-mail:", {
    parse_mode: "HTML",
    reply_markup: chooseKeyboard,
  });

  console.log(`⏳ [emailAdd] Waiting for callback_query...`);
  const choice = await conversation.waitForCallbackQuery(/^choose_/);
  console.log(`📍 [emailAdd] Received callback: ${choice.callbackQuery.data}`);

  await choice.answerCallbackQuery();

  if (choice.callbackQuery.data === "choose_cancel") {
    await showEmailsMenu(conversation, page);
    return;
  }

  if (choice.callbackQuery.data === "choose_single") {
    console.log(`📍 [emailAdd] User ${ctx.from?.id} chose single name mode`);

    const cancelKeyboard = new InlineKeyboard()
      .text("🚫 Отмена", "cancel_single");

    console.log(`📝 [emailAdd] Editing message for user ${ctx.from?.id}`);
    await choice.editMessageText(
      "✍️ Введите имя и фамилию (например: <code>Jessy Jackson</code>)",
      { parse_mode: "HTML", reply_markup: cancelKeyboard }
    );

    console.log(`⏳ [emailAdd] Waiting for text or cancel...`);
    const nameCtx = await conversation.wait();

    if (nameCtx.callbackQuery?.data === "cancel_single") {
      await nameCtx.answerCallbackQuery("⚡️ Действие отменено");
      await showEmailsMenu(conversation, page);
      return;
    }

    if (!nameCtx.message?.text) {
      await ctx.reply("❌ Нужно отправить текст");
      await showEmailsMenu(conversation, page);
      return;
    }

    console.log(`📥 [emailAdd] Received name from user ${ctx.from?.id}: ${nameCtx.message.text}`);
    const name = nameCtx.message.text.trim();
    await nameCtx.deleteMessage();

    if (!validateName(name)) {
      await ctx.reply("❌ Некорректное имя. До 64 символов, без двойных точек/двоеточий.");
      await showEmailsMenu(conversation, page);
      return;
    }

    const cancelKeyboard2 = new InlineKeyboard()
      .text("🚫 Отмена", "cancel_list");

    await ctx.editMessageText(
      "📧 Отправьте список email:password (каждый с новой строки):",
      { parse_mode: "HTML", reply_markup: cancelKeyboard2 }
    );

    console.log(`⏳ [emailAdd] Waiting for email list or cancel...`);
    const listCtx = await conversation.wait();

    if (listCtx.callbackQuery?.data === "cancel_list") {
      await listCtx.answerCallbackQuery("⚡️ Действие отменено");
      await showEmailsMenu(conversation, page);
      return;
    }

    if (!listCtx.message?.text) {
      await ctx.reply("❌ Нужно отправить текст");
      await showEmailsMenu(conversation, page);
      return;
    }

    const rawList = listCtx.message.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    await listCtx.deleteMessage();

    const results = await Promise.all(
      rawList.map(async (line) => {
        const ok = await checkEmail(line);
        if (!ok) {
          return { name: name ?? "", email: line ?? "", valid: false };
        }
        const [email, pass] = line.split(":").map((p) => p.trim());
        return { name: name ?? "", email: `${email}:${pass}`, valid: true };
      })
    );

    const valid = results.filter((r) => r.valid);
    const invalid = results.filter((r) => !r.valid);

    if (valid.length > 0) {
      await conversation.external((ctx) =>
        EmailRepo.add(
          ctx.from!.id,
          valid.map((r) => ({ name: r.name ?? "", email: r.email ?? "" }))
        )
      );
    }

    await ctx.editMessageText("Идет синхронизация почт ⛓️", {
      parse_mode: "HTML",
    });

    console.log(`🔄 [emailAdd] Starting background sync for user ${ctx.from!.id}...`);

    EmailStreamManager.syncWithDb(ctx.from!.id).catch((err) => {
      console.error(`❌ [emailAdd] Sync failed:`, err);
    });

    console.log(`✅ [emailAdd] Deleting sync message`);
    await ctx.deleteMessage().catch(() => {});

    console.log(`✅ [emailAdd] Conversation completed`);
  }

}

composer.use(createConversation(emailAddConv));
export default composer;
