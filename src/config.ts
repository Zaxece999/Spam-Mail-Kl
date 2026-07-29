import { readFileSync } from "fs";
import { resolve } from "path";

function loadConfigIni(): Record<string, string> {
  try {
    const configPath = resolve(process.cwd(), "config.ini");
    const configContent = readFileSync(configPath, "utf-8");
    const config: Record<string, string> = {};

    configContent.split('\n').forEach((line: string) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#') && !trimmedLine.startsWith('[')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          config[key.trim()] = valueParts.join('=').trim();
        }
      }
    });

    return config;
  } catch (error) {
    throw new Error(`❌ Не удалось загрузить config.ini: ${error}`);
  }
}

const config = loadConfigIni();

const required = <T>(value: T | undefined, name: string): T => {
  if (value === undefined || value === null || value === "") {
    throw new Error(`❌ Missing required config variable: ${name}`);
  }
  return value;
};

const optional = <T>(value: string | undefined, defaultValue: T): T => {
  if (!value || value === "") {
    return defaultValue;
  }

  if (typeof defaultValue === "boolean") {
    return (value.toLowerCase() === "true") as T;
  }

  if (typeof defaultValue === "number") {
    const num = parseInt(value);
    return (isNaN(num) ? defaultValue : num) as T;
  }
  return value as T;
};

export const BOT_TOKEN = required(config.BOT_TOKEN, "BOT_TOKEN");

export const ADMIN_IDS = optional(config.ADMIN_IDS, "").split(',').map(id => id.trim()).filter(id => id !== "");

export const DB_FILE_NAME = optional(config.DB_FILE_NAME, "db.sqlite");

export const DEEPSEEK_API_KEY = required(config.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY");

export const SMTP_HOST = optional(config.SMTP_HOST, "");
export const SMTP_PORT = optional(config.SMTP_PORT, 587);
export const SMTP_USER = optional(config.SMTP_USER, "");
export const SMTP_PASS = optional(config.SMTP_PASS, "");

export const PROXY_HOST = optional(config.PROXY_HOST, "");
export const PROXY_PORT = optional(config.PROXY_PORT, 0);
export const PROXY_USER = optional(config.PROXY_USER, "");
export const PROXY_PASS = optional(config.PROXY_PASS, "");

export const DEBUG_MODE = optional(config.DEBUG_MODE, false);
export const MAX_RETRY_ATTEMPTS = optional(config.MAX_RETRY_ATTEMPTS, 3);
export const DEFAULT_SEND_INTERVAL = optional(config.DEFAULT_SEND_INTERVAL, 1);

export function getConfig() {
  return {
    BOT_TOKEN: BOT_TOKEN ? "***скрыт***" : "не установлен",
    ADMIN_IDS: ADMIN_IDS.length > 0 ? ADMIN_IDS.map(id => `${id.substring(0, 3)}***`) : [],
    DB_FILE_NAME,
    DEEPSEEK_API_KEY: DEEPSEEK_API_KEY ? "***скрыт***" : "не установлен",
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER: SMTP_USER ? "***скрыт***" : "не установлен",
    PROXY_HOST,
    PROXY_PORT,
    DEBUG_MODE,
    MAX_RETRY_ATTEMPTS,
    DEFAULT_SEND_INTERVAL,
  };
}

if (DEBUG_MODE) {
  console.log("📋 Загружена конфигурация:", getConfig());
}
