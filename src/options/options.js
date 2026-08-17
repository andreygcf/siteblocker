// Настройки: список сайтов, редактор стилей с живым предпросмотром, поведение, данные.

import { DEFAULT_STATS_STYLE, DEFAULT_WASTE_STYLE, MIN_IDLE_SEC } from '../common/defaults.js';
import { applyI18n, t } from '../common/i18n.js';
import { normalizeDomain } from '../common/match.js';
import { getState, newSiteId, resetEverything, resetStats, setState, sumDaily } from '../common/storage.js';
import { dayKey, formatHuman } from '../common/time.js';

const $ = (s) => document.querySelector(s);

let state = null;
let newType = 'waste';
let styleTab = 'waste';
let previewState = 'full';

/** Во сколько раз предпросмотр меньше реального экрана. */
const PREVIEW_SCALE = 0.3;

init();

async function init() {
  applyI18n();
  state = await getState();
  renderSites();
  loadStyleControls();
  loadBehaviour();
  bind();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    state = await getState();
    renderSites();
  });
}

// ------------------------------------------------------------------ сайты

function renderSites() {
  const tbody = $('#sitesTable tbody');
  tbody.textContent = '';
  $('#sitesEmpty').hidden = state.sites.length > 0;
  $('#sitesTable').hidden = state.sites.length === 0;

  for (const site of state.sites) {
    const d = state.daily[site.id] || {};
    const total = state.totals[site.id] ? state.totals[site.id].allTime || 0 : sumDaily(d);

    const tr = document.createElement('tr');
    if (site.enabled === false) tr.style.opacity = '.5';

    const tdDomain = document.createElement('td');
    tdDomain.textContent = site.domain;
    tdDomain.style.fontWeight = '600';

    const tdType = document.createElement('td');
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const [type, label] of [['waste', t('typeWasteShort')], ['stats', t('typeStats')]]) {
      const b = document.createElement('button');
      b.textContent = label;
      if (site.type === type) b.classList.add('on');
      b.addEventListener('click', () => updateSite(site.id, { type }));
      seg.appendChild(b);
    }
    tdType.appendChild(seg);

    const tdToday = document.createElement('td');
    tdToday.className = 'num muted';
    tdToday.textContent = formatHuman(d[dayKey()] || 0);

    const tdTotal = document.createElement('td');
    tdTotal.className = 'num muted';
    tdTotal.textContent = formatHuman(total);

    const tdActions = document.createElement('td');
    tdActions.innerHTML = '';
    const actions = document.createElement('div');
    actions.className = 'sites-actions';

    const statsBtn = document.createElement('button');
    statsBtn.className = 'ghost';
    statsBtn.textContent = t('btnStats');
    statsBtn.addEventListener('click', () => openStats(site.id));

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ghost';
    toggleBtn.textContent = site.enabled === false ? t('optionsSiteEnable') : t('optionsSiteDisable');
    toggleBtn.addEventListener('click', () => updateSite(site.id, { enabled: site.enabled === false }));

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = t('optionsSiteDelete');
    delBtn.addEventListener('click', () => removeSite(site));

    actions.append(statsBtn, toggleBtn, delBtn);
    tdActions.appendChild(actions);

    tr.append(tdDomain, tdType, tdToday, tdTotal, tdActions);
    tbody.appendChild(tr);
  }
}

async function addSite() {
  const input = $('#domainInput');
  const domain = normalizeDomain(input.value);
  if (!domain) {
    input.focus();
    input.select();
    flash(t('optionsBadDomain'));
    return;
  }
  if (state.sites.some((s) => s.domain === domain)) {
    flash(t('optionsAlreadyAdded', [domain]));
    return;
  }
  state.sites = [...state.sites, { id: newSiteId(), domain, type: newType, enabled: true, createdAt: Date.now() }];
  await setState({ sites: state.sites });
  input.value = '';
  renderSites();
  flash(t('optionsAdded', [domain]));
}

async function updateSite(id, patch) {
  state.sites = state.sites.map((s) => (s.id === id ? { ...s, ...patch } : s));
  await setState({ sites: state.sites });
  renderSites();
}

async function removeSite(site) {
  const hasStats = Boolean(state.daily[site.id] && Object.keys(state.daily[site.id]).length);
  let dropStats = false;
  if (hasStats) {
    dropStats = confirm(t('optionsConfirmRemove', [site.domain]));
  }
  state.sites = state.sites.filter((s) => s.id !== site.id);
  const patch = { sites: state.sites };
  if (dropStats) {
    delete state.daily[site.id];
    delete state.totals[site.id];
    patch.daily = state.daily;
    patch.totals = state.totals;
  }
  await setState(patch);
  renderSites();
}

function openStats(siteId) {
  const url = chrome.runtime.getURL('src/stats/stats.html') + (siteId ? `?site=${encodeURIComponent(siteId)}` : '');
  chrome.tabs.create({ url });
}

// ------------------------------------------------------------------ стили

function currentStyle() {
  return state.settings.styles[styleTab];
}

function loadStyleControls() {
  const st = currentStyle();
  $('#color').value = st.color;
  $('#textColor').value = st.textColor;
  $('#opacity').value = st.opacity;
  $('#mode').value = st.mode;
  $('#edge').value = st.edge;
  $('#corner').value = st.corner;
  $('#size').value = st.size;
  $('#collapsedSize').value = st.collapsedSize;
  $('#fontScale').value = st.fontScale;
  syncOutputs();
  updateModeVisibility();
  renderPreview();
}

function syncOutputs() {
  $('#opacityOut').textContent = Math.round(Number($('#opacity').value) * 100) + '%';
  $('#sizeOut').textContent = $('#size').value;
  $('#collapsedOut').textContent = $('#collapsedSize').value;
  $('#fontOut').textContent = '×' + Number($('#fontScale').value).toFixed(2);
}

function updateModeVisibility() {
  const mode = $('#mode').value;
  $('#edgeCtl').style.display = mode === 'edge' ? '' : 'none';
  $('#cornerCtl').style.display = mode === 'corner' ? '' : 'none';
  $('#sizeCtl').style.display = mode === 'fullscreen' ? 'none' : '';
}

async function saveStyle() {
  const st = {
    color: $('#color').value,
    textColor: $('#textColor').value,
    opacity: Number($('#opacity').value),
    mode: $('#mode').value,
    edge: $('#edge').value,
    corner: $('#corner').value,
    size: Number($('#size').value),
    collapsedSize: Number($('#collapsedSize').value),
    fontScale: Number($('#fontScale').value),
  };
  state.settings.styles[styleTab] = st;
  await setState({ settings: state.settings });
  syncOutputs();
  updateModeVisibility();
  renderPreview();
}

/** Уменьшенная копия того, что нарисует content script. */
function renderPreview() {
  const st = {
    color: $('#color').value,
    textColor: $('#textColor').value,
    opacity: Number($('#opacity').value),
    mode: $('#mode').value,
    edge: $('#edge').value,
    corner: $('#corner').value,
    size: Number($('#size').value),
    collapsedSize: Number($('#collapsedSize').value),
    fontScale: Number($('#fontScale').value),
  };
  const p = $('#fakePanel');
  const collapsed = previewState === 'collapsed';
  const compact = collapsed || st.mode === 'corner';
  const k = PREVIEW_SCALE;
  const fs = st.fontScale * k;

  p.className = 'fake-panel' + (compact ? '' : ' p-full');
  p.style.cssText = '';
  p.style.background = st.color;
  p.style.color = st.textColor;
  p.style.opacity = String(st.opacity);
  p.style.boxShadow = '0 2px 14px rgba(0,0,0,.25)';

  // крестик есть только у stats-плашки и только если закрывать разрешено
  const closable = styleTab === 'stats' && state.settings.statsClosable !== false;
  const closeMark = closable ? '<span class="p-close">×</span>' : '';

  // демо-числа: 1 ч 12 мин сегодня и 26 ч всего
  const miniShort = `${t('overlayToday')} ${formatHuman(4320)}`;
  const miniFull = t('overlayMini', [formatHuman(4320), formatHuman(93600)]);

  p.innerHTML = (compact
    ? `<span class="p-domain" style="font-size:${Math.max(7, 11 * st.fontScale)}px">example.com</span>
       <span class="p-session" style="font-size:${Math.max(9, 16 * st.fontScale)}px">12:34</span>
       <span class="p-mini" style="font-size:${Math.max(7, 10 * st.fontScale)}px">${miniShort}</span>`
    : `<span class="p-domain" style="font-size:${Math.max(8, 16 * fs)}px">example.com</span>
       <span class="p-session" style="font-size:${Math.max(14, 84 * fs)}px">12:34</span>
       <span class="p-mini" style="font-size:${Math.max(7, 13 * fs)}px">${miniFull}</span>`) + closeMark;

  const size = collapsed ? st.collapsedSize : st.size;
  const scaled = Math.max(14, Math.round(size * k));

  if (!compact && st.mode === 'fullscreen') {
    p.style.inset = '0';
    p.style.borderRadius = '0';
    return;
  }

  if (!compact && st.mode === 'edge') {
    const e = st.edge;
    p.style.borderRadius = '0';
    if (e === 'top' || e === 'bottom') {
      p.style.left = '0';
      p.style.right = '0';
      p.style.height = scaled + 'px';
      p.style[e] = '0';
    } else {
      p.style.top = '0';
      p.style.bottom = '0';
      p.style.width = scaled + 'px';
      p.style[e] = '0';
      p.style.writingMode = 'vertical-rl';
    }
    return;
  }

  const corner = st.mode === 'corner' ? st.corner : cornerFromEdge(st.edge);
  const [v, h] = corner.split('-');
  p.style[v] = '8px';
  p.style[h] = '8px';
  p.style.height = Math.max(16, scaled) + 'px';
  p.style.borderRadius = '999px';
}

function cornerFromEdge(edge) {
  if (edge === 'bottom') return 'bottom-right';
  if (edge === 'left') return 'top-left';
  return 'top-right';
}

// ------------------------------------------------------------------ поведение

function loadBehaviour() {
  $('#idleTimeout').value = state.settings.idleTimeoutSec;
  $('#bannerHold').value = Math.round((state.settings.bannerHoldMs || 0) / 1000);
  $('#statsClosable').checked = state.settings.statsClosable !== false;
}

async function saveBehaviour() {
  const idle = Math.max(MIN_IDLE_SEC, Number($('#idleTimeout').value) || MIN_IDLE_SEC);
  const hold = Math.max(0, Number($('#bannerHold').value) || 0);
  $('#idleTimeout').value = idle;
  state.settings.idleTimeoutSec = idle;
  state.settings.bannerHoldMs = hold * 1000;
  state.settings.statsClosable = $('#statsClosable').checked;
  await setState({ settings: state.settings });
  renderPreview();
}

// ------------------------------------------------------------------ данные

async function exportJson() {
  const s = await getState();
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `site-time-tracker-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.sites)) throw new Error('bad format');
    if (!confirm(t('optionsConfirmImport'))) return;
    await setState({
      schemaVersion: data.schemaVersion || 1,
      settings: data.settings || state.settings,
      sites: data.sites,
      daily: data.daily || {},
      totals: data.totals || {},
    });
    state = await getState();
    renderSites();
    loadStyleControls();
    loadBehaviour();
    flash(t('optionsImported'));
  } catch (e) {
    flash(t('optionsImportFailed', [e.message]));
  }
}

// ------------------------------------------------------------------ связывание

function bind() {
  $('#addSite').addEventListener('click', addSite);
  $('#domainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSite();
  });
  $('#newType').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    newType = b.dataset.type;
    setSeg($('#newType'), b);
  });

  $('#styleTab').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-style]');
    if (!b) return;
    styleTab = b.dataset.style;
    setSeg($('#styleTab'), b);
    loadStyleControls();
  });

  for (const id of ['color', 'textColor', 'opacity', 'mode', 'edge', 'corner', 'size', 'collapsedSize', 'fontScale']) {
    const elm = document.getElementById(id);
    elm.addEventListener('input', () => {
      syncOutputs();
      updateModeVisibility();
      renderPreview();
    });
    elm.addEventListener('change', saveStyle);
  }

  $('#previewState').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-state]');
    if (!b) return;
    previewState = b.dataset.state;
    setSeg($('#previewState'), b);
    renderPreview();
  });

  $('#resetStyle').addEventListener('click', async () => {
    state.settings.styles[styleTab] = { ...(styleTab === 'waste' ? DEFAULT_WASTE_STYLE : DEFAULT_STATS_STYLE) };
    await setState({ settings: state.settings });
    loadStyleControls();
    flash(t('optionsStyleReset'));
  });

  $('#idleTimeout').addEventListener('change', saveBehaviour);
  $('#bannerHold').addEventListener('change', saveBehaviour);
  $('#statsClosable').addEventListener('change', saveBehaviour);

  $('#openStats').addEventListener('click', () => openStats(null));

  $('#exportBtn').addEventListener('click', exportJson);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });

  $('#resetToday').addEventListener('click', () => doReset('today', t('optionsConfirmResetToday')));
  $('#resetMonth').addEventListener('click', () => doReset('month', t('optionsConfirmResetMonth')));
  $('#resetAll').addEventListener('click', () => doReset('everything', t('optionsConfirmResetAll')));
}

async function doReset(scope, question) {
  if (!confirm(question)) return;
  if (scope === 'everything') await resetEverything();
  else await resetStats(scope, null);
  state = await getState();
  renderSites();
  flash(t('optionsStatsReset'));
}

function setSeg(container, active) {
  container.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === active));
}

let flashTimer = null;
function flash(text) {
  const n = $('#savedNote');
  n.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    n.textContent = t('optionsSavedNote');
  }, 2600);
}
