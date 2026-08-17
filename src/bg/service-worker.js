// Трекер времени: единственный источник правды о том, сколько времени проведено на сайте.
// Content script только рисует плашку и запрашивает готовые числа.

import { MIN_IDLE_SEC } from '../common/defaults.js';
import { matchSite } from '../common/match.js';
import { addSeconds, ensureInitialized, getSettings, getSites, getState, summaryFor } from '../common/storage.js';

const ALARM_FLUSH = 'flush';

/** Потолок одной записи: alarm будит воркер раз в минуту, всё сверх — сон машины. */
const MAX_FLUSH_SEC = 300;

/**
 * Состояние в памяти. MV3 выгружает service worker примерно через 30 секунд простоя,
 * поэтому всё, что нельзя потерять, дублируется в chrome.storage.session.
 */
let state = {
  // текущая непрерывная сессия по каждой вкладке: tabId → { siteId, sec }
  sessions: {},
  // что тикает прямо сейчас
  active: null, // { tabId, siteId, startedAt }
};

let loaded = null;

/**
 * Все мутации состояния идут через очередь. Обработчики событий асинхронные, и на сайтах
 * с активной навигацией их прилетает по нескольку разом: без сериализации параллельные
 * flush() успевали записать одну и ту же дельту дважды или потерять её, а recompute()
 * мог создать сессию поверх ещё не завершённой.
 */
let taskQueue = Promise.resolve();

function serialize(fn) {
  const result = taskQueue.then(fn, fn);
  taskQueue = result.then(() => {}, () => {});
  return result;
}

async function load() {
  if (loaded) return loaded;
  loaded = (async () => {
    const saved = await chrome.storage.session.get(['tracker']);
    if (saved.tracker) {
      state.sessions = saved.tracker.sessions || {};
      state.active = saved.tracker.active || null;
    }
  })();
  return loaded;
}

async function persist() {
  await chrome.storage.session.set({ tracker: state });
}

// ---------------------------------------------------------------- учёт времени

/**
 * Записывает накопленное с момента startedAt время и переставляет точку отсчёта.
 * Дельта ограничена MAX_FLUSH_SEC: если машина ушла в сон или воркер надолго завис,
 * это время пользователь на сайте не провёл.
 */
async function flush(now = Date.now()) {
  const a = state.active;
  if (!a || !a.startedAt) return;
  const deltaSec = Math.min((now - a.startedAt) / 1000, MAX_FLUSH_SEC);
  a.startedAt = now;
  if (deltaSec < 0.5) return;
  const session = state.sessions[a.tabId];
  if (session && session.siteId === a.siteId) session.sec += deltaSec;
  await addSeconds(a.siteId, deltaSec, new Date(now));
}

async function stopTracking() {
  await flush();
  state.active = null;
  await persist();
}

async function startTracking(tabId, siteId) {
  const prev = state.sessions[tabId];
  if (!prev || prev.siteId !== siteId) {
    // новая вкладка или уход на другой сайт в той же вкладке — сессия с нуля
    state.sessions[tabId] = { siteId, sec: 0 };
  }
  state.active = { tabId, siteId, startedAt: Date.now() };
  await persist();
}

/** Пересчитывает, что должно тикать прямо сейчас, и переключает состояние. */
function recompute() {
  return serialize(doRecompute);
}

async function doRecompute() {
  await load();

  // Фокус и активность спрашиваем у браузера каждый раз, а не помним между вызовами:
  // событие onFocusChanged может произойти до старта воркера, и тогда закешированное
  // «окно не в фокусе» осталось бы навсегда — сайт молча перестал бы учитываться.
  const idle = await currentIdleState();
  const tab = idle === 'active' ? await getFocusedTab() : null;
  const siteId = tab ? await siteIdForUrl(tab.url) : null;

  if (!tab || !siteId) {
    if (state.active) await stopTracking();
    return;
  }

  const a = state.active;
  if (a && a.tabId === tab.id && a.siteId === siteId) {
    await flush(); // тот же контекст — просто фиксируем накопленное
    await persist();
    return;
  }

  await flush();
  state.active = null;
  await startTracking(tab.id, siteId);
}

/** Активная вкладка окна, которое прямо сейчас в фокусе; null, если браузер не на переднем плане. */
async function getFocusedTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return null;
    const win = await chrome.windows.get(tab.windowId);
    if (!win.focused) return null;
    return tab;
  } catch {
    return null;
  }
}

async function currentIdleState() {
  try {
    const settings = await getSettings();
    const sec = Math.max(MIN_IDLE_SEC, Number(settings.idleTimeoutSec) || MIN_IDLE_SEC);
    return await new Promise((resolve) => chrome.idle.queryState(sec, resolve));
  } catch {
    return 'active';
  }
}

async function siteIdForUrl(url) {
  const sites = await getSites();
  const site = matchSite(url || '', sites);
  return site ? site.id : null;
}

// ---------------------------------------------------------------- события

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  await setupIdle();
  await setupAlarm();
  await recompute();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.remove('tracker'); // вкладок из прошлой сессии больше нет
  await setupIdle();
  await setupAlarm();
  await recompute();
});

chrome.tabs.onActivated.addListener(() => recompute());

/** Навигация могла увести вкладку с отслеживаемого домена — тогда сессия закрывается. */
async function handleNavigation(tabId, url) {
  await load();
  const newSiteId = await siteIdForUrl(url);
  const session = state.sessions[tabId];
  if (session && session.siteId !== newSiteId) {
    if (state.active && state.active.tabId === tabId) await flush();
    delete state.sessions[tabId];
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url && info.status !== 'complete') return;
  serialize(async () => {
    if (info.url) await handleNavigation(tabId, info.url);
    await doRecompute();
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serialize(async () => {
    await load();
    if (state.active && state.active.tabId === tabId) await stopTracking();
    delete state.sessions[tabId];
    await persist();
    await doRecompute();
  });
});

// Оба события — только повод пересчитать: актуальные фокус и idle doRecompute спросит сам.
chrome.windows.onFocusChanged.addListener(() => recompute());
chrome.idle.onStateChanged.addListener(() => recompute());

// SPA-навигация (pushState) не поднимает onUpdated с url в части случаев
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  serialize(async () => {
    await handleNavigation(details.tabId, details.url);
    await doRecompute();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_FLUSH) return;
  recompute(); // заодно проверяет, что тикающий контекст всё ещё актуален
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) await setupIdle();
  if (changes.sites || changes.settings) await recompute();
});

async function setupIdle() {
  const settings = await getSettings();
  const sec = Math.max(MIN_IDLE_SEC, Number(settings.idleTimeoutSec) || MIN_IDLE_SEC);
  chrome.idle.setDetectionInterval(sec);
}

/**
 * Пересоздание alarm сбрасывает его таймер. Воркер просыпается на каждое событие вкладок,
 * поэтому безусловный create означал бы, что периодический flush не срабатывает никогда.
 */
async function setupAlarm() {
  const existing = await chrome.alarms.get(ALARM_FLUSH);
  if (!existing) await chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 1 });
}

// ---------------------------------------------------------------- сообщения

async function statsFor(siteId) {
  await load();
  const now = Date.now();
  const st = await getState();
  const base = summaryFor(st, siteId);
  // добавляем ещё не записанные секунды текущего тика
  const a = state.active;
  let pending = 0;
  if (a && a.siteId === siteId && a.startedAt) pending = (now - a.startedAt) / 1000;
  const session = a && a.siteId === siteId ? state.sessions[a.tabId] : null;
  return {
    session: Math.round((session ? session.sec : 0) + pending),
    today: Math.round(base.today + pending),
    month: Math.round(base.month + pending),
    total: Math.round(base.total + pending),
    running: Boolean(a && a.siteId === siteId && a.startedAt),
  };
}

/** Сессия конкретной вкладки — плашка показывает своё время, а не чужой вкладки. */
async function statsForTab(siteId, tabId) {
  const s = await statsFor(siteId);
  const own = state.sessions[tabId];
  if (!own || own.siteId !== siteId) {
    s.session = 0;
  } else {
    const a = state.active;
    const pending = a && a.tabId === tabId && a.startedAt ? (Date.now() - a.startedAt) / 1000 : 0;
    s.session = Math.round(own.sec + pending);
  }
  s.running = Boolean(state.active && state.active.tabId === tabId);
  return s;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
  return true; // ответ асинхронный
});

async function handleMessage(msg, sender) {
  await load();
  const tabId = sender.tab ? sender.tab.id : null;

  switch (msg && msg.type) {
    case 'hello': {
      const st = await getState();
      const site = matchSite(msg.url || '', st.sites);
      if (!site) return { tracked: false };
      return {
        tracked: true,
        site: { id: site.id, domain: site.domain, type: site.type },
        style: st.settings.styles[site.type === 'waste' ? 'waste' : 'stats'],
        settings: {
          bannerHoldMs: st.settings.bannerHoldMs,
          idleTimeoutSec: st.settings.idleTimeoutSec,
          statsClosable: st.settings.statsClosable,
        },
        stats: tabId != null ? await statsForTab(site.id, tabId) : await statsFor(site.id),
      };
    }
    case 'sync': {
      if (!msg.siteId) return { error: 'no siteId' };
      return tabId != null ? await statsForTab(msg.siteId, tabId) : await statsFor(msg.siteId);
    }
    case 'stats':
      return await statsFor(msg.siteId);
    case 'openStats': {
      const url = chrome.runtime.getURL('src/stats/stats.html') + (msg.siteId ? `?site=${encodeURIComponent(msg.siteId)}` : '');
      await chrome.tabs.create({ url });
      return { ok: true };
    }
    case 'openOptions':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'flushNow':
      await flush();
      return { ok: true };
    default:
      return { error: 'unknown message' };
  }
}

// Инициализация при каждом «просыпании» воркера.
(async () => {
  await ensureInitialized();
  await load();
  await setupIdle();
  await setupAlarm();
  await recompute();
})();
