// Страница статистики: цифры, графики, сбросы.

import { applyI18n, t } from '../common/i18n.js';
import { getState, resetEverything, resetStats, sumDaily, sumLastDays, sumMonth } from '../common/storage.js';
import { dayKey, formatDayLabel, formatHuman, lastDayKeys, monthKey } from '../common/time.js';
import { barChart, hBarChart, heatmap, lineChart } from './charts.js';

const ALL = '__all__';
const PALETTE = ['#4f8cff', '#e0563f', '#35b585', '#c084fc', '#f59e0b', '#22d3ee', '#f472b6', '#a3e635'];

let state = null;
let selected = new URLSearchParams(location.search).get('site') || ALL;
let range = 30;
let compareRange = 1;
let year = new Date().getFullYear();

const $ = (sel) => document.querySelector(sel);

init();

async function init() {
  applyI18n();
  // «7 / 30 / 90 дней» — одна строка с подстановкой, чтобы не плодить три ключа
  for (const b of document.querySelectorAll('#rangeSeg button[data-range]')) {
    b.textContent = t('statsRangeDays', [b.dataset.range]);
  }

  state = await getState();
  if (selected !== ALL && !state.sites.some((s) => s.id === selected)) selected = ALL;

  buildSiteSelect();
  buildYearSelect();
  bindControls();
  renderAll();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    state = await getState();
    renderAll();
  });

  // пока страница открыта, подтягиваем текущий тик из воркера
  setInterval(async () => {
    state = await getState();
    renderTiles();
  }, 10000);
}

// ------------------------------------------------------------------ контролы

function buildSiteSelect() {
  const sel = $('#siteSelect');
  sel.textContent = '';
  sel.appendChild(new Option(t('statsAllSites'), ALL));
  for (const s of state.sites) {
    const type = s.type === 'waste' ? t('typeWasteLower') : t('typeStatsLower');
    sel.appendChild(new Option(`${s.domain}  ·  ${type}`, s.id));
  }
  sel.value = selected;
  sel.addEventListener('change', () => {
    selected = sel.value;
    const url = new URL(location.href);
    if (selected === ALL) url.searchParams.delete('site');
    else url.searchParams.set('site', selected);
    history.replaceState(null, '', url);
    renderAll();
  });
}

function buildYearSelect() {
  const years = new Set([new Date().getFullYear()]);
  for (const id in state.daily) {
    for (const k in state.daily[id]) years.add(Number(k.slice(0, 4)));
  }
  const sel = $('#yearSelect');
  sel.textContent = '';
  [...years].sort((a, b) => b - a).forEach((y) => sel.appendChild(new Option(String(y), String(y))));
  sel.value = String(year);
  sel.addEventListener('change', () => {
    year = Number(sel.value);
    renderHeatmap();
  });
}

function bindControls() {
  $('#rangeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    range = Number(b.dataset.range);
    setSeg($('#rangeSeg'), b);
    renderBar();
  });

  $('#compareSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    compareRange = Number(b.dataset.range);
    setSeg($('#compareSeg'), b);
    renderCompare();
  });

  $('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-reset]');
    if (!b) return;
    const scope = b.dataset.reset;
    const who = selected === ALL ? t('statsScopeAllDative') : domainOf(selected);
    const texts = {
      today: t('statsConfirmToday', [who]),
      month: t('statsConfirmMonth', [who]),
      all: t('statsConfirmAll', [who]),
      everything: t('statsConfirmEverything'),
    };
    if (!confirm(texts[scope])) return;
    if (scope === 'everything') await resetEverything();
    else await resetStats(scope, selected === ALL ? null : selected);
    state = await getState();
    renderAll();
  });
}

function setSeg(container, active) {
  container.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === active));
}

// ------------------------------------------------------------------ данные

function domainOf(id) {
  const s = state.sites.find((x) => x.id === id);
  return s ? s.domain : t('statsDeletedSite');
}

/** Объединённые суточные данные по выбранному сайту (или по всем). */
function dailyFor(siteId) {
  if (siteId !== ALL) return state.daily[siteId] || {};
  const merged = {};
  for (const id in state.daily) {
    for (const k in state.daily[id]) merged[k] = (merged[k] || 0) + state.daily[id][k];
  }
  return merged;
}

function totalFor(siteId) {
  if (siteId !== ALL) {
    const t = state.totals[siteId];
    return t ? t.allTime || 0 : sumDaily(state.daily[siteId] || {});
  }
  let sum = 0;
  for (const id in state.totals) sum += state.totals[id].allTime || 0;
  return sum;
}

// ------------------------------------------------------------------ рендер

function renderAll() {
  renderTiles();
  renderBar();
  renderLine();
  renderHeatmap();
  renderCompare();
  $('#resetScopeNote').textContent =
    selected === ALL ? t('statsScopeAll') : t('statsScopeSite', [domainOf(selected)]);
}

function renderTiles() {
  const d = dailyFor(selected);
  const keys = Object.keys(d);
  const daysTracked = keys.filter((k) => d[k] > 0).length;
  const totalAll = totalFor(selected);
  const best = keys.reduce((acc, k) => (d[k] > (d[acc] || 0) ? k : acc), keys[0]);

  const tiles = [
    [t('statsTileToday'), formatHuman(d[dayKey()] || 0)],
    [t('statsTileWeek'), formatHuman(sumLastDays(d, 7))],
    [t('statsTileMonth'), formatHuman(sumMonth(d, monthKey()))],
    [t('statsTileTotal'), formatHuman(totalAll)],
    [t('statsTileAverage'), formatHuman(daysTracked ? sumDaily(d) / daysTracked : 0)],
    [t('statsTileBest'), best ? `${formatHuman(d[best])} · ${formatDayLabel(best)}` : '—'],
  ];

  $('#tiles').innerHTML = tiles
    .map(([k, v]) => `<div class="tile"><div class="v">${escapeHtml(v)}</div><div class="k">${escapeHtml(k)}</div></div>`)
    .join('');
}

function renderBar() {
  const d = dailyFor(selected);
  const keys = lastDayKeys(range);
  barChart($('#barChart'), {
    labels: keys.map(formatDayLabel),
    values: keys.map((k) => d[k] || 0),
    tips: keys.map((k) => `${formatDayLabel(k)}: ${formatHuman(d[k] || 0)}`),
    color: colorFor(selected),
    fmt: (v) => formatHuman(v),
  });
}

function renderLine() {
  const d = dailyFor(selected);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const upTo = Math.min(daysInMonth, now.getDate());
  const labels = [];
  const values = [];
  let acc = 0;
  for (let day = 1; day <= upTo; day++) {
    const k = `${monthKey(now)}-${String(day).padStart(2, '0')}`;
    acc += d[k] || 0;
    labels.push(String(day));
    values.push(acc);
  }
  lineChart($('#lineChart'), {
    labels,
    values,
    tips: labels.map((l, i) => t('statsLineTip', [l, formatHuman(values[i])])),
    color: colorFor(selected),
    fmt: (v) => formatHuman(v),
  });
}

function renderHeatmap() {
  heatmap($('#heatmap'), {
    data: dailyFor(selected),
    year,
    color: colorFor(selected),
    fmt: (v) => formatHuman(v),
  });
}

function renderCompare() {
  const items = state.sites
    .map((s, i) => {
      const d = state.daily[s.id] || {};
      let value;
      if (compareRange === 0) value = totalFor(s.id);
      else if (compareRange === 1) value = d[dayKey()] || 0;
      else value = sumMonth(d, monthKey());
      return { label: s.domain, value, color: PALETTE[i % PALETTE.length] };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  hBarChart($('#hbar'), { items, fmt: (v) => formatHuman(v) });
}

function colorFor(siteId) {
  if (siteId === ALL) return PALETTE[0];
  const idx = state.sites.findIndex((s) => s.id === siteId);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
