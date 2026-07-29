#!/usr/bin/env bun

import { db } from "./src/db";
import { keys } from "./src/db/schema";

const now = Math.floor(Date.now() / 1000);

const NEW_KEYS = [
  "45a99485614bf3a4a980d9f0403492c8",
  "419ff24bfb75c62ff9fbef539d7cd0f1",
  "e709b77d198c23d95b042a355610855a",
  "b69fba0ce1b8c7bece9db5dfd77e7ffa",
  "da639b559a6a412827b9d61fe80657b5",
  "5f4314a5690492d7ded1c7d35989ad6e",
  "0228c6a2b163897e4463e15aba6bcec9",
  "82d35562fd66ff0be35d82ecb66ea92a",
  "1f352023706f614828b646831e2a10f1",
  "08b32af478a8757208b804e959808b67",
  "c4abb724bd2c97f580f694d26163bede",
  "0a9fe29c0c0932c71a7607a14521b0c8",
  "db8c6f4e8a46466fc4f7fdde924b6601",
  "267c2522494e34112f3dd47de488207c",
  "9c30103708b8f2be4091bdc86243edcf",
  "e84596f02ec066177eb54c05b8d4291a",
  "d3c33ea5013ad5798e5e3acad03b12cc",
];

try {

  await db.delete(keys);
  console.log("🗑  Старые ключи удалены");

  await db.insert(keys).values(
    NEW_KEYS.map((keyValue) => ({
      keyValue,
      rps: 5,
      enabled: 1,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    }))
  );

  console.log(`✅ Залито ${NEW_KEYS.length} ключей validemail.co`);
  console.log("⚠️  Перезапустите бота, чтобы FLEET подхватил новые ключи сразу.");
  process.exit(0);
} catch (error) {
  console.error("❌ Ошибка сидинга ключей:", error);
  process.exit(1);
}
