// Плашка со счётчиком времени. Рисуется в закрытом Shadow DOM, чтобы стили сайта
// не влияли на неё и наоборот. Числа приходят из service worker, между ресинками
// счётчик докручивается локально.

(() => {
  if (window.__siteTimeTrackerInjected) return;
  window.__siteTimeTrackerInjected = true;

  const RESYNC_MS = 15000;
  const COLLAPSE_KEY = 'stt:collapsed';
  const CLOSE_KEY = 'stt:closed';

  let cfg = null; // { site, style, settings }
  let stats = { session: 0, today: 0, month: 0, total: 0 };
  let localTicking = true;
  let lastActivity = Date.now();
  let collapsed = false;
  let closed = false;
  let host = null;
  let root = null;
  let els = {};
  let tickTimer = null;
  let syncTimer = null;
  let holdTimer = null;
  let clickTimer = null;

  init();

  async function init() {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'hello', url: location.href });
    } catch {
      return; // воркер недоступен (например, расширение перезагружается)
    }
    if (!res || !res.tracked) return;

    cfg = res;
    stats = res.stats || stats;
    // stats-плашка изначально развёрнута (она и так маленькая),
    // waste — помнит, сворачивали ли её уже в этой вкладке
    collapsed = cfg.site.type === 'waste' && readFlag(COLLAPSE_KEY);
    closed = readFlag(CLOSE_KEY);

    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  // ------------------------------------------------------------------ разметка

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__site_time_tracker__';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    root.appendChild(styleEl());
    root.appendChild(panelEl());

    applyLayout();
    render();
    applyClosed();
    startTimers();

    if (cfg.site.type === 'waste' && !collapsed) {
      const hold = Number(cfg.settings.bannerHoldMs) || 0;
      if (hold > 0) holdTimer = setTimeout(() => setCollapsed(true), hold);
    }
  }

  function styleEl() {
    const s = document.createElement('style');
    s.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .panel {
        position: fixed;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        color: var(--fg);
        background: var(--bg);
        opacity: var(--op);
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        overflow: hidden;
        transition: opacity .2s ease, inset .25s ease, width .25s ease, height .25s ease,
                    border-radius .25s ease, padding .25s ease;
        box-shadow: 0 2px 18px rgba(0,0,0,.28);
        line-height: 1.15;
        -webkit-font-smoothing: antialiased;
      }
      .panel:hover { opacity: 1; }
      .full { flex-direction: column; gap: 18px; padding: 24px; text-align: center; }
      .domain {
        font-size: calc(16px * var(--fs));
        letter-spacing: .18em;
        text-transform: uppercase;
        opacity: .75;
        font-weight: 600;
      }
      .session {
        font-size: calc(84px * var(--fs));
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        letter-spacing: -.02em;
      }
      .caption { font-size: calc(13px * var(--fs)); opacity: .7; letter-spacing: .12em; text-transform: uppercase; }
      .grid { display: flex; gap: 36px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
      .cell { display: flex; flex-direction: column; gap: 4px; }
      .cell b { font-size: calc(26px * var(--fs)); font-weight: 700; font-variant-numeric: tabular-nums; }
      .cell span { font-size: calc(11px * var(--fs)); opacity: .7; text-transform: uppercase; letter-spacing: .1em; }
      .hint { margin-top: 10px; font-size: calc(12px * var(--fs)); opacity: .55; }

      .full .dot { display: none; }

      /* компактный режим: одна строка */
      .compact { flex-direction: row; padding: 0 18px; gap: 10px; white-space: nowrap; }
      .compact .session { font-size: calc(18px * var(--fs)); font-weight: 700; }
      .compact .domain { font-size: calc(11px * var(--fs)); letter-spacing: .1em; }
      .compact .mini { font-size: calc(11px * var(--fs)); opacity: .75; font-variant-numeric: tabular-nums; }
      .compact .grid, .compact .caption, .compact .hint { display: none; }
      .paused { opacity: .45 !important; }
      .close {
        all: unset;
        position: absolute;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        width: 18px; height: 18px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%;
        color: currentColor;
        font-size: 15px;
        line-height: 1;
        opacity: .6;
        cursor: pointer;
      }
      .close:hover { opacity: 1; background: rgba(127,127,127,.35); }
      .full .close { top: 16px; right: 16px; transform: none; width: 30px; height: 30px; font-size: 24px; }
      /* в компактном режиме крестик занимает место справа от текста */
      .compact.closable { padding-right: 32px; }
      .dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: currentColor; opacity: .9; flex: none;
        animation: pulse 2s ease-in-out infinite;
      }
      .paused .dot { animation: none; opacity: .4; }
      @keyframes pulse { 0%,100% { opacity: .9 } 50% { opacity: .25 } }
    `;
    return s;
  }

  function panelEl() {
    const p = document.createElement('div');
    p.className = 'panel';
    p.innerHTML = `
      <div class="dot"></div>
      <div class="domain"></div>
      <div class="session">0:00</div>
      <div class="caption">${esc(t('overlaySessionCaption'))}</div>
      <div class="mini"></div>
      <div class="grid">
        <div class="cell"><b class="today">—</b><span>${esc(t('overlayToday'))}</span></div>
        <div class="cell"><b class="month">—</b><span>${esc(t('overlayMonth'))}</span></div>
        <div class="cell"><b class="total">—</b><span>${esc(t('overlayTotal'))}</span></div>
      </div>
      <div class="hint">${esc(t('overlayHint'))}</div>
      <button class="close" type="button" title="${esc(t('overlayCloseTitle'))}" aria-label="${esc(t('overlayCloseAria'))}">×</button>
    `;
    els = {
      panel: p,
      close: p.querySelector('.close'),
      domain: p.querySelector('.domain'),
      session: p.querySelector('.session'),
      mini: p.querySelector('.mini'),
      today: p.querySelector('.today'),
      month: p.querySelector('.month'),
      total: p.querySelector('.total'),
      hint: p.querySelector('.hint'),
    };

    p.addEventListener('click', () => {
      // одиночный клик открывает статистику, но даём шанс двойному клику
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'openStats', siteId: cfg.site.id }).catch(() => {});
      }, 260);
    });
    p.addEventListener('dblclick', (e) => {
      e.preventDefault();
      clearTimeout(clickTimer);
      clearTimeout(holdTimer);
      setCollapsed(!collapsed);
    });

    // крестик не должен ни открывать статистику, ни сворачивать плашку
    for (const ev of ['click', 'dblclick']) {
      els.close.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(clickTimer);
        if (ev === 'click') setClosed(true);
      });
    }
    return p;
  }

  // ------------------------------------------------------------------ раскладка

  function setCollapsed(v) {
    collapsed = v;
    if (cfg.site.type === 'waste') writeFlag(COLLAPSE_KEY, v);
    applyLayout();
    render();
  }

  /** Закрыть крестиком можно только stats-плашку и только если это разрешено в настройках. */
  function canClose() {
    return cfg.site.type !== 'waste' && cfg.settings.statsClosable !== false;
  }

  function setClosed(v) {
    closed = v;
    writeFlag(CLOSE_KEY, v);
    applyClosed();
  }

  /** Плашка остаётся собранной в памяти — прячем и возвращаем её просто (от)подключением к DOM. */
  function applyClosed() {
    if (!host) return;
    if (closed && canClose()) host.remove();
    else if (!host.isConnected) (document.documentElement || document.body).appendChild(host);
  }

  function applyLayout() {
    const st = cfg.style;
    const p = els.panel;
    p.style.setProperty('--bg', st.color);
    p.style.setProperty('--fg', st.textColor);
    p.style.setProperty('--op', String(st.opacity));
    p.style.setProperty('--fs', String(st.fontScale || 1));

    const compact = collapsed || st.mode === 'corner';
    p.classList.toggle('compact', compact);
    p.classList.toggle('full', !compact);
    els.hint.style.display = cfg.site.type === 'waste' && !compact ? '' : 'none';

    const closable = canClose();
    els.close.style.display = closable ? '' : 'none';
    p.classList.toggle('closable', closable);

    // сбрасываем прежнюю геометрию
    for (const k of ['inset', 'top', 'right', 'bottom', 'left', 'width', 'height', 'borderRadius', 'maxWidth']) {
      p.style[k] = '';
    }

    if (!compact && st.mode === 'fullscreen') {
      p.style.inset = '0';
      p.style.borderRadius = '0';
      return;
    }

    const size = collapsed ? Number(st.collapsedSize) || 40 : Number(st.size) || 100;

    if (!compact && st.mode === 'edge') {
      const e = st.edge || 'top';
      if (e === 'top' || e === 'bottom') {
        p.style.left = '0';
        p.style.right = '0';
        p.style.height = size + 'px';
        p.style[e] = '0';
      } else {
        p.style.top = '0';
        p.style.bottom = '0';
        p.style.width = size + 'px';
        p.style[e] = '0';
      }
      p.style.borderRadius = '0';
      return;
    }

    // компактный бейдж и режим corner
    const corner = st.mode === 'corner' ? st.corner || 'bottom-right' : cornerFromEdge(st.edge);
    const [v, h] = corner.split('-');
    p.style[v] = '16px';
    p.style[h] = '16px';
    p.style.maxWidth = 'calc(100vw - 32px)';
    p.style.height = Math.max(28, size) + 'px';
    p.style.borderRadius = '999px';
  }

  function cornerFromEdge(edge) {
    if (edge === 'bottom') return 'bottom-right';
    if (edge === 'left') return 'top-left';
    return 'top-right';
  }

  // ------------------------------------------------------------------ отрисовка

  function render() {
    const compact = els.panel.classList.contains('compact');
    els.domain.textContent = cfg.site.domain;
    els.session.textContent = fmt(stats.session);
    els.today.textContent = fmtHuman(stats.today);
    els.month.textContent = fmtHuman(stats.month);
    els.total.textContent = fmtHuman(stats.total);
    els.mini.textContent = compact
      ? t('overlayMini', [fmtHuman(stats.today), fmtHuman(stats.total)])
      : '';
    els.panel.classList.toggle('paused', !localTicking);
  }

  // ------------------------------------------------------------------ таймеры

  function startTimers() {
    tickTimer = setInterval(() => {
      if (!localTicking) return;
      const idleMs = (Number(cfg.settings.idleTimeoutSec) || 60) * 1000;
      if (Date.now() - lastActivity > idleMs) {
        localTicking = false;
        render();
        return;
      }
      stats.session += 1;
      stats.today += 1;
      stats.month += 1;
      stats.total += 1;
      render();
    }, 1000);

    syncTimer = setInterval(sync, RESYNC_MS);

    const activity = () => {
      lastActivity = Date.now();
      if (!localTicking && !document.hidden) {
        localTicking = true;
        sync();
      }
    };
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
      window.addEventListener(ev, activity, { passive: true, capture: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        localTicking = false;
        render();
      } else {
        lastActivity = Date.now();
        localTicking = true;
        sync();
      }
    });
    window.addEventListener('focus', () => {
      lastActivity = Date.now();
      localTicking = true;
      sync();
    });
    window.addEventListener('blur', () => {
      localTicking = false;
      render();
    });

    if (document.hidden) localTicking = false;
  }

  async function sync() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'sync', siteId: cfg.site.id });
      if (res && !res.error) {
        stats = res;
        render();
      }
    } catch {
      // воркер спит или расширение перезагрузилось — просто продолжаем локально
    }
  }

  // Настройки изменились — подхватываем стиль без перезагрузки страницы.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!cfg) {
      // сайт мог быть только что добавлен в список — пробуем подключиться заново
      if (changes.sites) init();
      return;
    }
    if (changes.settings) {
      const s = changes.settings.newValue;
      if (s && s.styles) {
        cfg.style = s.styles[cfg.site.type === 'waste' ? 'waste' : 'stats'] || cfg.style;
        cfg.settings = {
          bannerHoldMs: s.bannerHoldMs,
          idleTimeoutSec: s.idleTimeoutSec,
          statsClosable: s.statsClosable,
        };
        if (host) {
          applyLayout();
          render();
          applyClosed(); // закрытие могли запретить — тогда плашка возвращается
        }
      }
    }
    if (changes.sites && host) {
      // сайт могли удалить или выключить — проверяем ещё раз
      chrome.runtime.sendMessage({ type: 'hello', url: location.href }).then((res) => {
        if (!res || !res.tracked) teardown();
        else {
          cfg.site = res.site;
          cfg.style = res.style;
          applyLayout();
          render();
          applyClosed(); // тип сайта мог смениться на waste — такую плашку не скрываем
        }
      }).catch(() => {});
    }
  });

  function teardown() {
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    clearTimeout(holdTimer);
    if (host) host.remove();
    host = null;
    cfg = null; // чтобы повторное добавление сайта снова подняло плашку
  }

  // ------------------------------------------------------------------ флаги вкладки

  // sessionStorage бывает недоступен (жёсткие политики хранилища) — тогда просто
  // не запоминаем состояние между переходами, но плашку не ломаем.
  function readFlag(key) {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function writeFlag(key, v) {
    try {
      sessionStorage.setItem(key, v ? '1' : '0');
    } catch {
      // игнорируем
    }
  }

  // ------------------------------------------------------------------ формат

  // content script не поддерживает import, поэтому i18n здесь свой — как и форматтеры ниже
  function t(key, subs) {
    return chrome.i18n.getMessage(key, subs) || key;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function fmt(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  }

  function fmtHuman(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const uh = t('unitHour');
    const um = t('unitMin');
    if (h > 0) return m > 0 ? `${h} ${uh} ${m} ${um}` : `${h} ${uh}`;
    if (m > 0) return `${m} ${um}`;
    return `${s} ${t('unitSec')}`;
  }
})();
