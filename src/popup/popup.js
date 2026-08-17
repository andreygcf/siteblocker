// Попап: время по текущему сайту + быстрые действия.

import { applyI18n, t } from '../common/i18n.js';
import { hostOf, matchSite, normalizeDomain } from '../common/match.js';
import { getState, newSiteId, setState } from '../common/storage.js';
import { formatDuration, formatHuman } from '../common/time.js';

const $ = (s) => document.querySelector(s);

let currentHost = '';
let timer = null;

init();

async function init() {
  applyI18n();
  $('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentHost = tab ? hostOf(tab.url) : '';
  const state = await getState();
  const site = tab ? matchSite(tab.url || '', state.sites) : null;

  $('#stats').addEventListener('click', () => {
    const url = chrome.runtime.getURL('src/stats/stats.html') + (site ? `?site=${encodeURIComponent(site.id)}` : '');
    chrome.tabs.create({ url });
    window.close();
  });

  if (!site) {
    $('#site').textContent = currentHost || t('popupNotTracked');
    $('#status').textContent = currentHost ? t('popupNotInList') : t('popupBrowserPage');
    if (currentHost) {
      $('#quick').hidden = false;
      $('#addWaste').addEventListener('click', () => addCurrent('waste'));
      $('#addStats').addEventListener('click', () => addCurrent('stats'));
    }
    return;
  }

  $('#site').textContent = site.domain;
  $('#lines').hidden = false;
  await refresh(site.id);
  timer = setInterval(() => refresh(site.id), 1000);
  window.addEventListener('unload', () => clearInterval(timer));
}

async function refresh(siteId) {
  try {
    const s = await chrome.runtime.sendMessage({ type: 'stats', siteId });
    if (!s || s.error) return;
    $('#session').textContent = formatDuration(s.session);
    $('#today').textContent = formatHuman(s.today);
    $('#month').textContent = formatHuman(s.month);
    $('#total').textContent = formatHuman(s.total);
    $('#status').textContent = s.running ? t('popupRunning') : t('popupPaused');
  } catch {
    $('#status').textContent = t('popupNoConnection');
  }
}

async function addCurrent(type) {
  const domain = normalizeDomain(currentHost);
  if (!domain) return;
  const state = await getState();
  if (!state.sites.some((s) => s.domain === domain)) {
    await setState({
      sites: [...state.sites, { id: newSiteId(), domain, type, enabled: true, createdAt: Date.now() }],
    });
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.tabs.reload(tab.id);
  window.close();
}
