import { Composer, InputFile } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";

import { startCheckFromDb, isUserProcessing } from "../emailQueue";
import { nickify, toTxt, buildAdverts } from "../utils/nickify";
import { AdvertsRepo } from "../db/queries/adverts";

const composer = new Composer<CustomContext>();

async function processNickDocument(ctx: CustomContext) {
  const userId = ctx.from!.id;
  console.log(`🔵 [nickCheck/conv] START processing document for user ${userId}`);

  try {
    console.log(`📂 [nickCheck/conv] Getting file for user ${userId}...`);
    const file = await ctx.getFile();

    console.log(`⬇️ [nickCheck/conv] Downloading file for user ${userId}...`);
    const path = await file.download();

    console.log(`📄 [nickCheck/conv] Reading file content for user ${userId}...`);
    const content = await Bun.file(path).text();
    console.log(`✅ [nickCheck/conv] File read successfully, size: ${content.length} chars`);

    console.log(`🔨 [nickCheck/conv] Building adverts for user ${userId}...`);
    const candidates = buildAdverts(content);
    const prepared = candidates.length;
    console.log(`✅ [nickCheck/conv] Built ${prepared} candidates`);

    console.log(`💾 [nickCheck/conv] Inserting to DB for user ${userId}...`);
    const insertedCount = await AdvertsRepo.bulkAddByTelegramId(
      ctx.from!.id,
      candidates
    );
    console.log(`✅ [nickCheck/conv] Inserted ${insertedCount} records to DB`);

    console.log(`📝 [nickCheck/conv] Generating nicks.txt for user ${userId}...`);
    const { nicks, text } = nickify(content);
    console.log(`✅ [nickCheck/conv] Generated nicks file with ${nicks.length} nicks`);

    console.log(`📤 [nickCheck/conv] Sending nicks.txt to user ${userId}...`);
    await ctx.replyWithDocument(new InputFile(toTxt(text), "nicks.txt"), {
      caption: `🔎 Найдено никнеймов: <b>${nicks.length}</b>\n🗃 Отобрано объявлений: <b>${prepared}</b>\n✅ Добавлено в БД: <b>${insertedCount}</b>`,
      parse_mode: "HTML",
    });
    console.log(`✅ [nickCheck/conv] Nicks.txt sent successfully`);

    console.log(`🚀 [nickCheck/conv] Starting check from DB for user ${userId}...`);
    await startCheckFromDb(ctx, 3000);
    console.log(`🟢 [nickCheck/conv] COMPLETED processing document for user ${userId}`);
  } catch (err) {
    console.error(`❌ [nickCheck/conv] FATAL ERROR for user ${userId}:`, err);
    console.error(`❌ [nickCheck/conv] Error stack:`, (err as Error)?.stack);
    await ctx
      .reply("❌ Ошибка обработки файла. Попробуйте отправить его ещё раз позднее.")
      .catch((replyErr) => {
        console.error(`❌ [nickCheck/conv] Failed to send error message:`, replyErr);
      });
  }
}

async function nickCheckConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext
) {
  const userId = ctx.from!.id;
  console.log(`🟣 [nickCheck/conv] ENTER conversation for user ${userId}`);

  if (isUserProcessing(userId)) {
    console.log(`⚠️ [nickCheck/conv] User ${userId} already processing, halting`);
    await ctx.reply(
      "⏳ У вас уже идёт подбор. Новый запуск невозможен до завершения текущего."
    );
    await conversation.halt();
    console.log(`🛑 [nickCheck/conv] Conversation halted for user ${userId}`);
    return;
  }

  console.log(`⏳ [nickCheck/conv] Waiting for document from user ${userId}...`);
  const documentCtx = ctx.message?.document ? ctx : await conversation.waitFor(":document");
  console.log(`✅ [nickCheck/conv] Document received for user ${userId}`);

  await ctx.reply("📥 Файл принят, начинаю обработку в фоне...");
  console.log(`🔄 [nickCheck/conv] Starting background processing for user ${userId}`);

  processNickDocument(documentCtx).catch((err) => {
    console.error(`❌ [nickCheck/conv] Background processing CRASHED for user ${userId}:`, err);
    console.error(`❌ [nickCheck/conv] Crash stack:`, (err as Error)?.stack);
  });

  console.log(`🛑 [nickCheck/conv] Halting conversation for user ${userId}`);
  await conversation.halt();
  console.log(`🟢 [nickCheck/conv] EXIT conversation for user ${userId}`);
}

composer.use(createConversation(nickCheckConv));

export default composer;
