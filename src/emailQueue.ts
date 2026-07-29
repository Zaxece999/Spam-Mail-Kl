import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { CustomContext } from "./types";
import { AdvertsRepo } from "./db/queries/adverts";

function parseProxyPool(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      if (/^https?:\/\//i.test(entry)) return entry;
      const parts = entry.split(":");
      if (parts.length >= 4) {
        const [host, port, user, ...passRest] = parts;
        const pass = passRest.join(":");
        return `http://${encodeURIComponent(user!)}:${encodeURIComponent(pass)}@${host}:${port}`;
      }
      if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`;
      return "";
    })
    .filter(Boolean);
}

const VALIDEMAIL_PROXY_POOL: string[] = parseProxyPool(
  `${process.env.VALIDEMAIL_PROXIES || ""}\n${process.env.VALIDEMAIL_PROXY || ""}`
);
const USE_PROXY = VALIDEMAIL_PROXY_POOL.length > 0;
console.log(`🌐 validemail proxy pool: ${VALIDEMAIL_PROXY_POOL.length} IP (USE_PROXY=${USE_PROXY})`);

let _proxyRR = 0;
function nextProxy(): string | undefined {
  if (!USE_PROXY) return undefined;
  const p = VALIDEMAIL_PROXY_POOL[_proxyRR % VALIDEMAIL_PROXY_POOL.length];
  _proxyRR = (_proxyRR + 1) >>> 0;
  return p;
}

type KeysConfig = {
  keys: Array<{ key: string; rps?: number; enabled?: boolean }>;
};

async function getKeys(): Promise<KeysConfig> {
  try {
    const { KeysRepo } = await import("./db/queries");
    const keys = await KeysRepo.getEnabled();

    return {
      keys: keys.map(k => ({
        key: k.keyValue,
        rps: k.rps,
        enabled: k.enabled
      }))
    };
  } catch (error) {
    console.error("Error loading keys from database:", error);
    return { keys: [] };
  }
}

async function disableKey(key: string, reason: string) {
  try {
    const { KeysRepo } = await import("./db/queries");
    const success = await KeysRepo.disableByValue(key, reason);
    if (success) {
      console.warn(`💾 DB: disable key ${maskKey(key)} reason="${reason}"`);
    } else {
      console.warn(`💾 DB: key ${maskKey(key)} not found or already disabled`);
    }
  } catch (error) {
    console.error("Error disabling key in database:", error);
  }
}

async function getDomains(userId: number): Promise<string[]> {

  if (userId == 8490972754) return ["gmx.net"];

  return ["gmail.com", "gmx.net", "gmx.de", "web.de"];
}

const STATUS_UPDATE_EVERY_MS = 1500;

const DEFAULT_RPS = 5;

const DISABLE_AFTER_429 = 1000;
const DISABLE_AFTER_TIMEOUT = 1000;
const AXIOS_TIMEOUT_MS = 15000;

const SCHED_TICK_MS = 80;
const KEY_COOLDOWN_MS = 3000;
const PER_USER_SOFT_CAP = 128;
const PROXY_NET_RETRIES = 3;

const MAX_REQUEUE_PER_ITEM = 6;

const RPS_MIN = 2;

const RPS_MAX = USE_PROXY ? 15 : 4;
const RPS_START = USE_PROXY ? 6 : 3;
let GLOBAL_RPS = RPS_START;
const KEY_MAX_CONCURRENCY = USE_PROXY ? 5 : 1;

const nowMs = () => Date.now();
const maskKey = (k: string) => (k.length > 8 ? `…${k.slice(-8)}` : k);

const formatTime = (ms: number) => {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} мин ${s % 60} сек` : `${s} сек`;
};

const createProgressBar = (done: number, total: number, size = 20) => {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const filled = Math.round((pct / 100) * size);
  return `[${"■".repeat(filled)}${"□".repeat(size - filled)}] ${pct}%`;
};

type Job = { name: string; advertId: number };

type UserQueue = {
  userId: number;
  ctx: CustomContext;

  names: Job[];
  results: (string | undefined)[];
  domains: string[];

  domainIdx: number;
  queues: number[][];
  domainInflight: number[];
  inflight: Set<number>;
  roundsFinalized: number[];
  requeue: Map<number, number>;

  found: number;

  startTime: number;
  lastStatusAt: number;
  statusMsgId: number | null;
  isRunning: boolean;
  finalized: boolean;
  deadNotified?: boolean;
};

const userQueues = new Map<number, UserQueue>();

function computeTotals(q: UserQueue) {
  const R = q.domains.length;
  const domIndex = new Map(q.domains.map((d, i) => [d, i]));
  let total = 0;

  for (let i = 0; i < q.names.length; i++) {
    const r = q.results[i];
    if (!r) {
      total += R;
    } else {
      const email = r.split(" | ")[0] || "";
      const dom = email.slice(email.lastIndexOf("@") + 1);
      const j = domIndex.get(dom) ?? (R - 1);
      total += j + 1;
    }
  }

  const done = q.roundsFinalized.reduce((a, b) => a + Math.min(b, R), 0);
  const remain = Math.max(0, total - done);
  return { total, done, remain };
}

const getETAms = (q: UserQueue) => {
  const elapsed = nowMs() - q.startTime;
  const { done, remain } = computeTotals(q);
  const avgPerCheck = done > 0 ? elapsed / done : 0;
  return avgPerCheck * remain;
};

class KeyWorker {
  key: string;
  id: string;
  rps: number;

  tokens = 0;
  lastRefill = 0;

  inflight = 0;

  disabled = false;
  coolUntil = 0;

  consec429 = 0;
  consecTimeout = 0;

  constructor(key: string, rps: number) {
    this.key = key;
    this.id = key.replace(/[^a-zA-Z0-9_\-]/g, "_");
    this.rps = Math.max(1, rps);
    this.tokens = this.rps;
    this.lastRefill = nowMs();
  }

  refill(now = nowMs()) {
    if (this.disabled) return;
    const dt = now - this.lastRefill;
    if (dt <= 0) return;
    const add = Math.floor((dt / 1000) * this.rps);
    if (add > 0) {
      this.tokens = Math.min(this.rps, this.tokens + add);
      this.lastRefill = now;
    }
  }

  available(now = nowMs()): number {
    if (this.disabled) return 0;
    if (now < this.coolUntil) return 0;
    this.refill(now);
    const room = Math.max(0, KEY_MAX_CONCURRENCY - this.inflight);
    return Math.max(0, Math.min(this.tokens, room));
  }

  takeOne(now = nowMs()): boolean {
    if (this.available(now) <= 0) return false;
    this.tokens--;
    this.inflight++;
    return true;
  }

  release() {
    if (this.inflight > 0) this.inflight--;
  }

  markBadLocal(reason: string) {
    if (!this.disabled) {
      this.disabled = true;
      console.warn(`🧯 local disable ${this.id}: ${reason}`);

      disableKey(this.key, reason).catch((err) => {
        console.error(`Failed to disable key ${this.id} in DB:`, err);
      });
    } else {
      console.warn(`🔒 key ${this.id} already disabled locally`);
    }
  }

  cooldown429() {
    this.consec429++;
    this.coolUntil = Math.max(this.coolUntil, nowMs() + KEY_COOLDOWN_MS);
  }

  penalizeTimeout() {
    this.consecTimeout++;

    const wait = Math.min(5000, 1000 + 250 * (this.consecTimeout - 1));
    this.coolUntil = Math.max(this.coolUntil, nowMs() + wait);
  }

  resetErrors() {
    this.consec429 = 0;
    this.consecTimeout = 0;
  }

  shouldHardDisableByCounters(): string | null {
    if (this.consec429 >= DISABLE_AFTER_429) return `TOO_MANY_429_${this.consec429}`;
    if (this.consecTimeout >= DISABLE_AFTER_TIMEOUT) return `TOO_MANY_TIMEOUTS_${this.consecTimeout}`;
    return null;
  }
}

class GlobalKeyFleet {
  keys: KeyWorker[] = [];
  rr = 0;
  lastReload = 0;
  reloading: Promise<void> | null = null;

  async init() {
    await this.reload();
  }

  async reload() {
    if (this.reloading) return this.reloading;
    this.reloading = (async () => {
      const cfg = await getKeys();
      const enabled = cfg.keys.filter((k) => k.enabled !== false);
      const byKey = new Map(this.keys.map((k) => [k.key, k]));
      const next: KeyWorker[] = [];
      for (const { key, rps } of enabled) {
        const rate = rps ?? DEFAULT_RPS;
        const ex = byKey.get(key);
        if (ex) {
          ex.rps = Math.max(1, rate);
          next.push(ex);
          byKey.delete(key);
        } else {
          next.push(new KeyWorker(key, rate));
        }
      }
      this.keys = next;
      this.lastReload = nowMs();
    })();
    await this.reloading;
    this.reloading = null;
  }

  async maybeReload() {
    if (nowMs() - this.lastReload > 30_000) {
      await this.reload().catch(() => {});
    }
  }

  usableCount(): number {
    return this.keys.filter((k) => !k.disabled).length;
  }

  totalRps(): number {
    return this.keys.filter((k) => !k.disabled).reduce((s, w) => s + w.rps, 0);
  }
}

const FLEET = new GlobalKeyFleet();

const updateUserStatus = async (q: UserQueue) => {
  const now = nowMs();
  if (now - q.lastStatusAt < STATUS_UPDATE_EVERY_MS) return;
  q.lastStatusAt = now;

  const totalUsers = [...userQueues.values()].filter(u => u.isRunning).length || 1;
  const userIndex = [...userQueues.keys()].indexOf(q.userId) + 1;
  const { total, done } = computeTotals(q);

  const text =
    `🔄 Подбор почт по именам (раунды)\n\n${createProgressBar(done, total)}\n\n` +
    `📧 Найдено: ${q.found} / ${q.names.length}\n` +
    `⏳ ETA: ~ ${formatTime(getETAms(q))}\n\n` +
    `🔑 Активных ключей: ${FLEET.usableCount()} / ${FLEET.keys.length}\n` +
    `📌 Вы №${userIndex} из ${totalUsers}`;
  try {
    q.statusMsgId
      ? await q.ctx.api.editMessageText(q.ctx.chat!.id, q.statusMsgId, text)
      : (q.statusMsgId = (await q.ctx.reply(text)).message_id);
  } catch {}
};

const notifyAllKeysDead = async (q: UserQueue) => {
  if (q.deadNotified) return;
  q.deadNotified = true;
  await q.ctx
    .reply(`❌ Все API-ключи недоступны. Проверь токены/лимиты и запусти снова.`)
    .catch(() => {});
};

const finalizeUser = async (q: UserQueue) => {
  const totalTime = nowMs() - q.startTime;

  const notFoundIds: number[] = [];
  for (let i = 0; i < q.names.length; i++) {
    if (!q.results[i]) notFoundIds.push(q.names[i]!.advertId);
  }
  if (notFoundIds.length) {
    await Promise.all(
      notFoundIds.map((id) => AdvertsRepo.setNotFound(id).catch(() => false))
    );
  }

  if (q.statusMsgId) {
    await q.ctx.api.deleteMessage(q.ctx.chat!.id, q.statusMsgId).catch(() => {});
  }
  await q.ctx
    .reply(
      `✅ Подбор завершён!\n\n📧 Найдено: ${q.found} / ${q.names.length}\n⏱ Время: ${formatTime(totalTime)}`
    )
    .catch(() => {});

  q.isRunning = false;
  userQueues.delete(q.userId);
};

function initRoundQueue(q: UserQueue, d: number) {
  const R = q.domains.length;
  if (d >= R) return;
  if (!q.queues[d]) {
    const stripDot = q.domains[d]!.startsWith("!");
    const arr: number[] = [];
    for (let i = 0; i < q.names.length; i++) {
      if (q.results[i]) continue;

      if (stripDot && !q.names[i]!.name.includes(".")) continue;
      arr.push(i);
    }
    q.queues[d] = arr;
    q.domainInflight[d] = 0;
  }
}

function domainComplete(q: UserQueue, d: number): boolean {
  if (!q.queues[d]) return true;
  if (q.domainInflight[d] > 0) return false;

  return q.queues[d]!.length === 0;
}

async function maybeAdvanceAndFinalize(q: UserQueue) {
  const R = q.domains.length;
  while (q.domainIdx < R && domainComplete(q, q.domainIdx)) {
    q.domainIdx++;
    if (q.domainIdx < R) initRoundQueue(q, q.domainIdx);
  }
  if (q.domainIdx >= R && q.inflight.size === 0 && !q.finalized) {
    q.finalized = true;
    await finalizeUser(q);
  }
}

function perUserLimit(): number {
  const users = Math.max(1, [...userQueues.values()].filter(u => u.isRunning).length);
  const total = Math.max(1, FLEET.totalRps());
  const fair = Math.max(1, Math.floor(total / users));

  return Math.min(PER_USER_SOFT_CAP, fair * 2);
}

function popNextIndex(q: UserQueue): number | null {
  const d = q.domainIdx;
  if (d >= q.domains.length) return null;
  const queue = q.queues[d];
  if (!queue || queue.length === 0) return null;

  if (q.inflight.size >= perUserLimit()) return null;

  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (q.results[idx]) continue;
    if (q.inflight.has(idx)) continue;
    return idx;
  }
  return null;
}

async function checkEmailOnKey(
  w: KeyWorker,
  email: string
): Promise<{ valid: boolean; message: string; keyDisabled?: boolean }> {
  if (w.disabled) {
    return { valid: false, message: "KEY_DISABLED", keyDisabled: true };
  }

  const url = `https://validemail.co/api/v1/validate?email=${encodeURIComponent(email)}&timeout=8`;

  let netAttempt = 0;
  while (true) {
    try {

      const proxyUrl = nextProxy();
      const httpsAgent = proxyUrl
        ? new HttpsProxyAgent(proxyUrl, { keepAlive: false })
        : undefined;

      const { data } = await axios.get(url, {
        family: 4,
        timeout: AXIOS_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${w.key}`,
          ...(httpsAgent ? { Connection: "close" } : {}),
        },
        ...(httpsAgent ? { httpsAgent, proxy: false as const } : {}),
      });

      w.resetErrors();

      const valid = data?.status === "deliverable";
      return { valid, message: data?.reason || data?.status || "Нет данных" };
    } catch (e: any) {
      const s = e?.response?.status;

      if (s === 401 || s === 402 || s === 403) {
        console.log(`❌ KEY_${s} - disabling key`);
        w.markBadLocal(`KEY_${s}`);
        return { valid: false, message: `KEY_${s}`, keyDisabled: true };
      }

      const isProxyNetErr =
        USE_PROXY &&
        !e?.response &&
        (e?.code === "ERR_BAD_REQUEST" ||
          e?.code === "ECONNRESET" ||
          e?.code === "ECONNREFUSED" ||
          e?.code === "EPROTO" ||
          e?.code === "ETIMEDOUT" ||
          e?.code === "ECONNABORTED");
      if (isProxyNetErr && netAttempt < PROXY_NET_RETRIES) {
        netAttempt++;
        continue;
      }

      throw e;
    }
  }
}

let schedulerStarted = false;
let USERS_RR = 0;

type Task = {
  q: UserQueue;
  idx: number;
  domainIdx: number;
  email: string;
};

function activeUsers(): UserQueue[] {
  return [...userQueues.values()].filter((q) => q.isRunning && q.domainIdx < q.domains.length);
}

function collectBatchForKey(k: KeyWorker, maxTasks = Infinity): Task[] {
  const tasks: Task[] = [];
  if (maxTasks <= 0) return tasks;
  const users = activeUsers();
  if (users.length === 0) return tasks;

  for (const q of users) initRoundQueue(q, q.domainIdx);

  let start = USERS_RR % users.length;
  let guard = users.length * 4;

  while (k.available() > 0 && tasks.length < maxTasks && guard-- > 0) {
    let assigned = false;

    for (let pass = 0; pass < users.length; pass++) {
      const q = users[(start + pass) % users.length]!;
      const d = q.domainIdx;
      if (d >= q.domains.length) continue;

      if (q.domainInflight[d] > 0 && (!q.queues[d] || q.queues[d]!.length === 0)) continue;

      const idx = popNextIndex(q);
      if (idx == null) continue;

      if (!k.takeOne()) return tasks;

      const rawTarget = q.domains[d]!;
      const stripDot = rawTarget.startsWith("!");
      const domain = stripDot ? rawTarget.slice(1) : rawTarget;
      const { name } = q.names[idx]!;
      const localName = stripDot ? name.replace(/\./g, "") : name;
      const email = `${localName}@${domain}`;

      q.inflight.add(idx);
      q.domainInflight[d]++;

      tasks.push({ q, idx, domainIdx: d, email });
      assigned = true;

      if (k.available() <= 0 || tasks.length >= maxTasks) break;
    }

    if (!assigned) break;
    start = (start + 1) % users.length;
  }

  USERS_RR = (USERS_RR + 1) >>> 0;
  return tasks;
}

function requeueOrGiveUp(
  q: UserQueue,
  idx: number,
  domainIdx: number,
  why: string
): boolean {
  const rk = idx * 1000 + domainIdx;
  const n = (q.requeue.get(rk) ?? 0) + 1;
  q.requeue.set(rk, n);
  if (n <= MAX_REQUEUE_PER_ITEM) {
    q.queues[domainIdx]!.push(idx);
    return true;
  }

  q.roundsFinalized[idx] = Math.min(q.roundsFinalized[idx] + 1, q.domains.length);
  console.log(`🛑 give up (${why}) после ${MAX_REQUEUE_PER_ITEM} попыток → idx#${idx} dom#${domainIdx}`);
  return false;
}

function launchBatch(k: KeyWorker, batch: Task[]) {
  const promises = batch.map(({ q, idx, domainIdx, email }) =>
    (async () => {
      try {
        const res = await checkEmailOnKey(k, email);

        if (res.keyDisabled) {
          const reason = (k.shouldHardDisableByCounters() ?? res.message) || "KEY_DISABLED";
          k.markBadLocal(reason);
        }

        if (!res.keyDisabled) rateStats.ok++;

        if (res.valid) {
          const ok = await AdvertsRepo.setReady(q.names[idx]!.advertId, email).catch(() => false);
          if (ok) {
            q.results[idx] = `${email} | ✅ ${q.domains[domainIdx]!.replace(/^!/, "")}`;
            q.found++;
          }

          q.roundsFinalized[idx] = Math.min(q.roundsFinalized[idx] + 1, q.domains.length);
        } else {

          q.roundsFinalized[idx] = Math.min(q.roundsFinalized[idx] + 1, q.domains.length);
        }
      } catch (e: any) {
        const s = e?.response?.status;

        if (s === 429) {
          rateStats.r429++;

          k.cooldown429();
          if (requeueOrGiveUp(q, idx, domainIdx, "429")) {
            console.log(`⏱ 429 (${k.id}) cooldown ${KEY_COOLDOWN_MS}ms → ${email}`);
          }
        } else {
          const isTimeout =
            e?.code === "ECONNABORTED" ||
            e?.message?.toLowerCase?.().includes("timeout") ||
            (!e?.response && e?.request);

          if (isTimeout) {

            k.penalizeTimeout();
            if (requeueOrGiveUp(q, idx, domainIdx, "timeout")) {
              console.log(`⏱ timeout (${k.id}) → requeue → ${email}`);
            }
          } else {

            q.roundsFinalized[idx] = Math.min(q.roundsFinalized[idx] + 1, q.domains.length);
            console.log(`⚠️ http ${s ?? "?"} (${k.id}) → ${email}`);
          }
        }
      } finally {
        k.release();
        q.inflight.delete(idx);
        q.domainInflight[domainIdx] = Math.max(0, q.domainInflight[domainIdx] - 1);

        await updateUserStatus(q);
        if (FLEET.usableCount() === 0) await notifyAllKeysDead(q);

        await maybeAdvanceAndFinalize(q);
      }
    })()
  );

  Promise.allSettled(promises).catch(() => {});
}

const _dispatchTimes: number[] = [];
function globalBudget(now = nowMs()): number {

  while (_dispatchTimes.length && now - _dispatchTimes[0]! >= 1000) {
    _dispatchTimes.shift();
  }
  return Math.max(0, Math.floor(GLOBAL_RPS) - _dispatchTimes.length);
}
function markDispatched(n: number, now = nowMs()) {
  for (let i = 0; i < n; i++) _dispatchTimes.push(now);
}

const rateStats = { ok: 0, r429: 0 };
const ADAPT_EVERY_MS = 4000;
let _adaptLast = nowMs();
function adaptRate(now = nowMs()) {
  if (now - _adaptLast < ADAPT_EVERY_MS) return;
  _adaptLast = now;

  const ok = rateStats.ok;
  const r429 = rateStats.r429;
  rateStats.ok = 0;
  rateStats.r429 = 0;

  const total = ok + r429;
  if (total < 3) return;

  const ratio = r429 / total;
  const prev = GLOBAL_RPS;
  if (ratio > 0.15) {

    GLOBAL_RPS = Math.max(RPS_MIN, Math.floor(GLOBAL_RPS * 0.6));
    _dispatchTimes.length = 0;
  } else if (ratio < 0.03 && GLOBAL_RPS < RPS_MAX) {

    GLOBAL_RPS = Math.min(RPS_MAX, GLOBAL_RPS + 1);
  }
  if (GLOBAL_RPS !== prev) {
    console.log(
      `🎚 adaptRate: 429=${(ratio * 100).toFixed(0)}% (${r429}/${total}) → GLOBAL_RPS ${prev}→${GLOBAL_RPS}`
    );
  }
}

function startSchedulerLoop() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const loop = async () => {
    try {
      await FLEET.maybeReload();

      if (FLEET.keys.length > 0 && FLEET.usableCount() === 0) {
        for (const q of [...userQueues.values()]) {
          if (q.isRunning && !q.finalized) {
            await notifyAllKeysDead(q);
            q.finalized = true;
            await finalizeUser(q);
          }
        }
      }

      for (const q of activeUsers()) {
        await maybeAdvanceAndFinalize(q);
      }

      if (activeUsers().length > 0) adaptRate();

      let budget = globalBudget();
      for (const k of FLEET.keys) {
        if (budget <= 0) break;
        const cap = k.available();
        if (cap <= 0) continue;

        const batch = collectBatchForKey(k, budget);
        if (batch.length > 0) {
          budget -= batch.length;
          markDispatched(batch.length);
          launchBatch(k, batch);
        }
      }
    } catch (e) {
      console.error("Scheduler tick error:", e);
    } finally {
      setTimeout(loop, SCHED_TICK_MS);
    }
  };

  loop();
}

export const isUserProcessing = (userId: number): boolean => {
  const q = userQueues.get(userId);
  return !!(q && q.isRunning);
};

export const startCheckFromDb = async (ctx: CustomContext, limit = 200) => {
  const userId = ctx.from!.id;

  if (!FLEET.keys.length) {
    await FLEET.init().catch(() => {});
  }

  const { KeysRepo } = await import("./db/queries");
  const hasKeys = await KeysRepo.hasActiveKeys();

  if (!hasKeys) {
    await ctx.reply(
      "❌ <b>Ключи отсутствуют</b>\n\n" +
      "Для работы парсера необходимо добавить API ключи.\n" +
      "Обратитесь к администратору для настройки ключей.",
      { parse_mode: "HTML" }
    ).catch(() => {});
    return;
  }

  startSchedulerLoop();

  if (isUserProcessing(userId)) {
    await ctx
      .reply("⏳ У вас уже идёт подбор. Новый запуск невозможен до завершения текущего.")
      .catch(() => {});
    return;
  }

  const pending = await AdvertsRepo.listPendingByTelegramId(userId, limit);
  if (!pending.length) {
    await ctx.reply("😐 Нет объявлений со статусом 0 для проверки.").catch(() => {});
    return;
  }

  const baseDomains = (await getDomains(userId)).map((s) => s.trim()).filter(Boolean);

  const domains = baseDomains;

  const q: UserQueue = {
    userId,
    ctx,
    names: pending.map((p) => ({ name: p.personDotName, advertId: p.id })),
    results: Array(pending.length),
    domains,

    domainIdx: 0,
    queues: [],
    domainInflight: Array(domains.length).fill(0),
    inflight: new Set<number>(),
    roundsFinalized: Array(pending.length).fill(0),
    requeue: new Map<number, number>(),

    found: 0,

    startTime: nowMs(),
    lastStatusAt: 0,
    statusMsgId: null,
    isRunning: true,
    finalized: false,
  };
  userQueues.set(userId, q);

  initRoundQueue(q, 0);

  await updateUserStatus(q);
};
