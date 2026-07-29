#!/usr/bin/env bun

import { UserRepo } from "./src/db/queries";

const arg = process.argv[2];
const telegramId = Number(arg);

if (!arg || !Number.isInteger(telegramId)) {
  console.error("❌ Укажите числовой Telegram ID: bun run grant-admin.ts 985329138");
  process.exit(1);
}

try {
  await UserRepo.upsert(telegramId);
  await UserRepo.setRole(telegramId, "admin");
  const role = await UserRepo.getRole(telegramId);
  console.log(`✅ Пользователь ${telegramId} → роль: ${role}`);
  process.exit(0);
} catch (error) {
  console.error("❌ Ошибка при выдаче админа:", error);
  process.exit(1);
}
