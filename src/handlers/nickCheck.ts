import { Composer, InputFile } from "grammy";
import type { CustomContext } from "../types";
import { startCheckFromDb, isUserProcessing } from "../emailQueue";
import { nickify, toTxt, buildAdverts } from "../utils/nickify";
import { AdvertsRepo } from "../db/queries/adverts";

const composer = new Composer<CustomContext>();

async function handleNickFile(ctx: CustomContext) {
  const userId = ctx.from!.id;
  console.log(`🔵 [nickCheck/handler] START processing file for user ${userId}`);

  try {
    console.log(`📂 [nickCheck/handler] Getting file for user ${userId}...`);
    const file = await ctx.getFile();

    console.log(`⬇️ [nickCheck/handler] Downloading file for user ${userId}...`);
    const path = await file.download();

    console.log(`📄 [nickCheck/handler] Reading file content for user ${userId}...`);
    const content = await Bun.file(path).text();
    console.log(`✅ [nickCheck/handler] File read successfully, size: ${content.length} chars`);

    console.log(`🔨 [nickCheck/handler] Building adverts for user ${userId}...`);
    const candidates = buildAdverts(content);
    const prepared = candidates.length;
    console.log(`✅ [nickCheck/handler] Built ${prepared} candidates`);

    console.log(`💾 [nickCheck/handler] Inserting to DB for user ${userId}...`);
    const insertedCount = await AdvertsRepo.bulkAddByTelegramId(
      ctx.from!.id,
      candidates
    );
    console.log(`✅ [nickCheck/handler] Inserted ${insertedCount} records to DB`);

    console.log(`📝 [nickCheck/handler] Generating nicks.txt for user ${userId}...`);
    const { nicks, text } = nickify(content);
    console.log(`✅ [nickCheck/handler] Generated nicks file with ${nicks.length} nicks`);

    console.log(`📤 [nickCheck/handler] Sending nicks.txt to user ${userId}...`);
    await ctx.replyWithDocument(new InputFile(toTxt(text), "nicks.txt"), {
      caption: `🔎 Найдено никнеймов: <b>${nicks.length}</b>\n🗃 Отобрано объявлений: <b>${prepared}</b>\n✅ Добавлено в БД: <b>${insertedCount}</b>`,
      parse_mode: "HTML",
    });
    console.log(`✅ [nickCheck/handler] Nicks.txt sent successfully`);

    console.log(`🚀 [nickCheck/handler] Starting check from DB for user ${userId}...`);
    await startCheckFromDb(ctx, 3000);
    console.log(`🟢 [nickCheck/handler] COMPLETED processing file for user ${userId}`);
  } catch (err) {
    console.error(`❌ [nickCheck/handler] FATAL ERROR for user ${userId}:`, err);
    console.error(`❌ [nickCheck/handler] Error stack:`, (err as Error)?.stack);
    await ctx
      .reply("❌ Ошибка обработки файла. Попробуйте отправить его ещё раз позднее.")
      .catch((replyErr) => {
        console.error(`❌ [nickCheck/handler] Failed to send error message:`, replyErr);
      });
  }
}

composer.on("message:document", async (ctx: CustomContext) => {
  const userId = ctx.from!.id;
  const fileName = ctx.message.document.file_name || "";
  console.log(`📎 [nickCheck/handler] Document received from user ${userId}: ${fileName}`);

  if (!fileName.endsWith(".json") && !fileName.endsWith(".txt")) {
    console.log(`⚠️ [nickCheck/handler] Skipping file ${fileName} - wrong extension`);
    return;
  }

  if (isUserProcessing(userId)) {
    console.log(`⚠️ [nickCheck/handler] User ${userId} already processing, rejecting new file`);
    await ctx.reply(
      "⏳ У вас уже идёт подбор. Новый запуск невозможен до завершения текущего."
    );
    return;
  }

  console.log(`✅ [nickCheck/handler] Accepting file from user ${userId}, starting background processing`);
  await ctx.reply("📥 Файл принят, начинаю обработку в фоне...");

  handleNickFile(ctx).catch((err) => {
    console.error(`❌ [nickCheck/handler] Background processing CRASHED for user ${userId}:`, err);
    console.error(`❌ [nickCheck/handler] Crash stack:`, (err as Error)?.stack);
  });

  console.log(`🔄 [nickCheck/handler] Handler completed for user ${userId}, background task running`);
});

export default composer;
