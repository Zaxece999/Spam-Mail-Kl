import { Menu, MenuRange } from "@grammyjs/menu";
import type { CustomContext } from "../../types";
import { settingsView, proxiesView } from "../../views/settings";
import { ProxyRepo } from "../../db/queries";

const proxiesMenu = new Menu<CustomContext>("proxies-menu", { autoAnswer: false })
  .text("➕ Добавить прокси", async (ctx) => {
    await ctx.conversation.enter("proxyAddConv");
  })
  .text("✏️ Изменить прокси", async (ctx) => {
    const proxies = await ProxyRepo.list(ctx.from!.id);

    if (proxies.length === 0) {
      await ctx.answerCallbackQuery({
        text: "❌ Нет прокси",
        show_alert: true,
      });
    } else {
      await ctx.replyOrEdit("📋 Ваши прокси:", {
        reply_markup: proxiesEditMenu,
      });
    }
  })
  .row()
  .text("🗑 Удалить прокси", async (ctx) => {
    const proxies = await ProxyRepo.list(ctx.from!.id);

    if (proxies.length === 0) {
      await ctx.answerCallbackQuery({
        text: "❌ Нет прокси",
        show_alert: true,
      });
    } else {
      await ctx.replyOrEdit("🗑 Выберите прокси для удаления:", {
        reply_markup: proxiesDeleteMenu,
      });
    }
  })
  .text("🗑 Удалить все", async (ctx) => {
    const proxies = await ProxyRepo.list(ctx.from!.id);

    if (proxies.length === 0) {
      await ctx.answerCallbackQuery({
        text: "❌ Нет прокси",
        show_alert: true,
      });
    } else {
      await ProxyRepo.clear(ctx.from!.id);
      await ctx.answerCallbackQuery("✅ Все прокси удалены");
      await proxiesView(ctx);
    }
  })
  .row()
  .text("🔙 Назад", async (ctx) => {
    await settingsView(ctx);
  })
  .text("♻️ Скрыть", async (ctx) => {
    await ctx.answerCallbackQuery("♻️ Скрыто");
    await ctx.deleteMessage();
  });

const proxiesEditMenu = new Menu<CustomContext>("proxies-edit-menu").dynamic(
  async (ctx) => {
    const range = new MenuRange<CustomContext>();
    const proxies = await ProxyRepo.list(ctx.from!.id);

    for (const proxy of proxies) {
      range
        .text(`${proxy.proxy} ${proxy.isValid ? "🟢" : "🔴"}`, async (ctx) => {
          const newValid = proxy.isValid ? 0 : 1;
          await ProxyRepo.setValid(ctx.from!.id, proxy.id, !!newValid);
          await ctx.answerCallbackQuery(
            `⚡️ Статус изменён: ${proxy.proxy} → ${newValid ? "валид" : "невалид"}`
          );
          await ctx.menu.update();
        })
        .text("✏️", async (ctx) => {
          await ctx.conversation.enter("proxyEditConv", proxy.id, proxy.proxy);
        })
        .row();
    }

    range
      .text("🔙 Назад", async (ctx) => {
        await proxiesView(ctx);
      })
      .text("♻️ Скрыть", async (ctx) => {
        await ctx.answerCallbackQuery("♻️ Скрыто");
        await ctx.deleteMessage();
      });

    return range;
  }
);

const proxiesDeleteMenu = new Menu<CustomContext>("proxies-delete-menu").dynamic(
  async (ctx) => {
    const range = new MenuRange<CustomContext>();
    const proxies = await ProxyRepo.list(ctx.from!.id);

    for (const proxy of proxies) {
      range
        .text(proxy.proxy, (ctx) =>
          ctx.answerCallbackQuery(`📌 Прокси выбрана: ${proxy.proxy}`)
        )
        .text("🗑", async (ctx) => {
          await ProxyRepo.remove(ctx.from!.id, proxy.id);
          await ctx.answerCallbackQuery({
            text: `🗑 Прокси удалена: ${proxy.proxy}`,
            show_alert: true,
          });
          await ctx.menu.update();
        })
        .row();
    }

    range
      .text("🔙 Назад", async (ctx) => {
        await proxiesView(ctx);
      })
      .text("♻️ Скрыть", async (ctx) => {
        await ctx.answerCallbackQuery("♻️ Скрыто");
        await ctx.deleteMessage();
      });

    return range;
  }
);

proxiesMenu.register(proxiesEditMenu);
proxiesMenu.register(proxiesDeleteMenu);

export { proxiesMenu };
