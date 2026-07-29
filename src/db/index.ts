import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { DB_FILE_NAME } from "../config";

const sqlite = new Database(DB_FILE_NAME, {
  create: true,
  readwrite: true,
});

sqlite.exec("PRAGMA foreign_keys = ON;");

sqlite.exec("PRAGMA journal_mode = WAL;");

sqlite.exec("PRAGMA busy_timeout = 5000;");

sqlite.exec("PRAGMA synchronous = NORMAL;");
sqlite.exec("PRAGMA cache_size = 10000;");
sqlite.exec("PRAGMA temp_store = MEMORY;");

console.log("✅ SQLite database initialized with WAL mode");

export const db = drizzle({ client: sqlite, casing: 'snake_case' });
