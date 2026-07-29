#!/usr/bin/env tsx

import { makeAdmin } from "./src/utils/createAdmin.js";

const telegramId = process.argv[2];

if (!telegramId) {
  console.log("❌ Укажите Telegram ID пользователя");
  console.log("Использование: npm run create-admin YOUR_TELEGRAM_ID");
  console.log("Пример: npm run create-admin 123456789");
  process.exit(1);
}

const id = parseInt(telegramId);
if (isNaN(id)) {
  console.log("❌ Telegram ID должен быть числом");
  process.exit(1);
}

console.log(`🔄 Назначение администратора для пользователя ${id}...`);

makeAdmin(id)
  .then((success) => {
    if (success) {
      console.log("🎉 Администратор успешно назначен!");
      console.log("Теперь пользователь может использовать команду /admin");
    } else {
      console.log("❌ Не удалось назначить администратора");
    }
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("❌ Ошибка:", error);
    process.exit(1);
  });
