import { run } from "@grammyjs/runner";
import { bot } from "./bot";
import { EmailStreamManager } from "./emailStream";
import { stopAllSends } from "./emailSender";

const activeConversations = new Map<number, { startTime: number; name: string }>();

function startConversationMonitor() {
  setInterval(() => {
    const now = Date.now();
    for (const [userId, info] of activeConversations.entries()) {
      const elapsed = now - info.startTime;
      if (elapsed > 600000) {
        console.warn(`⚠️ User ${userId} stuck in conversation "${info.name}" for ${Math.round(elapsed / 1000)}s`);
      }
    }
  }, 60000);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

process.on("unhandledRejection", (reason: any) => {

  if (reason?.code === "NoConnection" || reason?.message?.includes("Connection not available")) {

    return;
  }

  console.error("💥 Необработанное отклонение промиса:", reason);
  console.log("   Бот продолжает работу...");
});

console.log("🚀 Бот инициализируется...");

try {
  const webhookTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("deleteWebhook timeout")), 5000));
  await Promise.race([bot.api.deleteWebhook({ drop_pending_updates: false }), webhookTimeout]);
  console.log("✅ Webhook удалён, работаем по long polling");
} catch (err) {
  console.error("⚠️ Не удалось удалить webhook (продолжаем):", err?.message || err);
}

const runner = run(bot, {
  runner: {

    fetch: {
      allowed_updates: ["message", "callback_query", "inline_query"],
    },
  },
});

console.log("✅ Cris Mailer бот запущен!");
startConversationMonitor();

EmailStreamManager.startAllForEveryone()
  .then(() => console.log("📧 IMAP потоки запущены"))
  .catch((err) => console.error("❌ Ошибка при запуске IMAP:", err));

setInterval(() => {

  Promise.resolve().then(() => {}).catch(() => {});
}, 5000);

setInterval(() => {
  const now = new Date().toISOString();
  console.log(`💓 [${now}] Бот работает. Runner: ${runner.isRunning() ? "✅" : "❌"}`);
}, 30000);

setInterval(() => {
  if (!runner.isRunning()) {
    console.error("⚠️ Runner остановлен! Пытаюсь перезапустить...");
    try {
      runner.start();
      console.log("✅ Runner перезапущен");
    } catch (err) {
      console.error("❌ Не удалось перезапустить runner:", err);
    }
  }
}, 10000);

const stopRunner = async () => {
  if (runner.isRunning()) {
    console.log("\n⛔ Остановка Cris Mailer...");
    await stopAllSends();
    await EmailStreamManager.stopAllForEveryone();
    await runner.stop();
    console.log("🛑 Cris Mailer бот остановлен!");
  }
};

process.once("SIGINT", stopRunner);
process.once("SIGTERM", stopRunner);
