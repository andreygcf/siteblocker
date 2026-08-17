// Обёртка над chrome.storage.local: чтение с дефолтами, запись, агрегации, сбросы.

import {
  DEFAULT_STATE,
  DEFAULT_SETTINGS,
  DEFAULT_STATS_STYLE,
  DEFAULT_WASTE_STYLE,
  SCHEMA_VERSION,
} from './defaults.js';
import { dayKey, lastDayKeys, monthKey } from './time.js';

const KEYS = ['schemaVersion', 'settings', 'sites', 'daily', 'totals'];

/** Читает всё состояние, подставляя дефолты для отсутствующих полей. */
export async function getState() {
  const raw = await chrome.storage.local.get(KEYS);
  return {
    schemaVersion: raw.schemaVersion || SCHEMA_VERSION,
    settings: mergeSettings(raw.settings),
    sites: Array.isArray(raw.sites) ? raw.sites : [],
    daily: raw.daily && typeof raw.daily === 'object' ? raw.daily : {},
    totals: raw.totals && typeof raw.totals === 'object' ? raw.totals : {},
  };
}

export async function setState(patch) {
  await chrome.storage.local.set(patch);
}

/** Глубокий merge настроек с дефолтами — чтобы новые поля появлялись у старых установок. */
export function mergeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const styles = src.styles && typeof src.styles === 'object' ? src.styles : {};
  return {
    ...DEFAULT_SETTINGS,
    ...src,
    styles: {
      waste: { ...DEFAULT_WASTE_STYLE, ...(styles.waste || {}) },
      stats: { ...DEFAULT_STATS_STYLE, ...(styles.stats || {}) },
    },
  };
}

export async function getSettings() {
  const { settings } = await getState();
  return settings;
}

export async function getSites() {
  const { sites } = await getState();
  return sites;
}

/** Первичная инициализация хранилища при установке. */
export async function ensureInitialized() {
  const raw = await chrome.storage.local.get(KEYS);
  const patch = {};
  if (!raw.schemaVersion) patch.schemaVersion = SCHEMA_VERSION;
  if (!raw.settings) patch.settings = DEFAULT_STATE.settings;
  if (!Array.isArray(raw.sites)) patch.sites = [];
  if (!raw.daily) patch.daily = {};
  if (!raw.totals) patch.totals = {};
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

export function newSiteId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Очередь операций «прочитать — изменить — записать».
 * Без неё два параллельных обновления читают одну и ту же копию `daily`, и то,
 * что записалось первым, затирается вторым — статистика откатывается назад.
 */
let writeQueue = Promise.resolve();

function serializeWrite(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(() => {}, () => {});
  return result;
}

/**
 * Добавляет секунды сайту: в суточный бакет и в общий счётчик.
 * Вызывается только из flush() в service worker.
 */
export function addSeconds(siteId, seconds, when = new Date()) {
  const sec = Math.round(seconds);
  if (!siteId || sec <= 0) return Promise.resolve();
  return serializeWrite(async () => {
    const { daily, totals } = await getState();
    const key = dayKey(when);
    const perSite = daily[siteId] || (daily[siteId] = {});
    perSite[key] = (perSite[key] || 0) + sec;
    const t = totals[siteId] || (totals[siteId] = { allTime: 0, since: Date.now() });
    t.allTime = (t.allTime || 0) + sec;
    await chrome.storage.local.set({ daily, totals });
  });
}

// ---------- агрегации ----------

export function sumDaily(dailyForSite) {
  let sum = 0;
  for (const k in dailyForSite) sum += dailyForSite[k] || 0;
  return sum;
}

export function sumMonth(dailyForSite, mKey = monthKey()) {
  let sum = 0;
  for (const k in dailyForSite) {
    if (k.startsWith(mKey + '-')) sum += dailyForSite[k] || 0;
  }
  return sum;
}

export function sumLastDays(dailyForSite, n) {
  let sum = 0;
  for (const k of lastDayKeys(n)) sum += (dailyForSite && dailyForSite[k]) || 0;
  return sum;
}

/** Сводка по сайту: сегодня / месяц / всего. */
export function summaryFor(state, siteId) {
  const d = state.daily[siteId] || {};
  const total = state.totals[siteId];
  return {
    today: d[dayKey()] || 0,
    month: sumMonth(d),
    total: total ? total.allTime || 0 : sumDaily(d),
  };
}

// ---------- сбросы ----------

/**
 * scope: 'today' | 'month' | 'all'
 * siteId: конкретный сайт или null — тогда по всем сайтам.
 * Сброс 'today'/'month' уменьшает и allTime, чтобы «всего» оставалось суммой прожитого.
 */
export function resetStats(scope, siteId = null) {
  return serializeWrite(() => doResetStats(scope, siteId));
}

async function doResetStats(scope, siteId) {
  const { daily, totals } = await getState();
  const ids = siteId ? [siteId] : Object.keys(daily);
  const today = dayKey();
  const mKey = monthKey();

  for (const id of ids) {
    const perSite = daily[id];
    if (!perSite) continue;
    if (scope === 'all') {
      delete daily[id];
      delete totals[id];
      continue;
    }
    let removed = 0;
    for (const k of Object.keys(perSite)) {
      const hit = scope === 'today' ? k === today : k.startsWith(mKey + '-');
      if (hit) {
        removed += perSite[k] || 0;
        delete perSite[k];
      }
    }
    if (totals[id]) {
      totals[id].allTime = Math.max(0, (totals[id].allTime || 0) - removed);
    }
  }
  await chrome.storage.local.set({ daily, totals });
}

/** Полная очистка статистики (список сайтов и настройки остаются). */
export async function resetEverything() {
  await chrome.storage.local.set({ daily: {}, totals: {} });
}
