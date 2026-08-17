// Минимальный SVG-рендер графиков. Без зависимостей — CSP Manifest V3 запрещает внешние скрипты.

import { t, uiLocale } from '../common/i18n.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

function svgRoot(w, h) {
  const s = el('svg', {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    height: h,
    role: 'img',
  });
  return s;
}

/** Аккуратный «круглый» верх шкалы: 1/2/5 × 10^n. */
function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const norm = v / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * base;
}

function tooltipEvents(node, text) {
  node.appendChild(el('title', {}, text));
}

/**
 * Столбчатая диаграмма.
 * @param {{labels:string[], values:number[], color?:string, fmt?:(v:number)=>string,
 *          tips?:string[], height?:number}} opts
 */
export function barChart(container, opts) {
  const { labels, values, color = 'var(--accent)', fmt = String, tips = [], height = 240 } = opts;
  container.textContent = '';
  const W = 900;
  const H = height;
  const padL = 64;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const s = svgRoot(W, H);

  const max = niceMax(Math.max(1, ...values));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = values.length || 1;
  const slot = innerW / n;
  const bw = Math.max(2, Math.min(slot * 0.72, 46));

  // горизонтальная сетка + подписи оси Y
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i) / 4;
    const val = max * (1 - i / 4);
    s.appendChild(el('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid' }));
    s.appendChild(el('text', { x: padL - 10, y: y + 4, class: 'axis', 'text-anchor': 'end' }, fmt(val)));
  }

  values.forEach((v, i) => {
    const h = max > 0 ? (v / max) * innerH : 0;
    const x = padL + slot * i + (slot - bw) / 2;
    const y = padT + innerH - h;
    const rect = el('rect', {
      x, y: h > 0 ? y : padT + innerH - 1, width: bw, height: Math.max(h, v > 0 ? 2 : 0),
      rx: Math.min(4, bw / 2), fill: color, class: 'bar',
    });
    tooltipEvents(rect, tips[i] || `${labels[i]}: ${fmt(v)}`);
    s.appendChild(rect);
  });

  // подписи оси X — не чаще, чем влезает
  const every = Math.max(1, Math.ceil(n / 12));
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    s.appendChild(el('text', {
      x: padL + slot * i + slot / 2, y: H - 12, class: 'axis', 'text-anchor': 'middle',
    }, l));
  });

  s.appendChild(el('line', { x1: padL, y1: padT + innerH, x2: W - padR, y2: padT + innerH, class: 'axis-line' }));
  container.appendChild(s);
}

/** Линейный график с заливкой (накопительный итог). */
export function lineChart(container, opts) {
  const { labels, values, color = 'var(--accent)', fmt = String, tips = [], height = 240 } = opts;
  container.textContent = '';
  const W = 900;
  const H = height;
  const padL = 64;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const s = svgRoot(W, H);

  const max = niceMax(Math.max(1, ...values));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = values.length;
  const xAt = (i) => padL + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v) => padT + innerH - (max > 0 ? (v / max) * innerH : 0);

  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i) / 4;
    s.appendChild(el('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid' }));
    s.appendChild(el('text', { x: padL - 10, y: y + 4, class: 'axis', 'text-anchor': 'end' }, fmt(max * (1 - i / 4))));
  }

  if (n > 0) {
    const pts = values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
    const area = `M ${xAt(0)},${padT + innerH} L ` + values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L ') +
      ` L ${xAt(n - 1)},${padT + innerH} Z`;
    s.appendChild(el('path', { d: area, fill: color, opacity: '.16' }));
    s.appendChild(el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    values.forEach((v, i) => {
      const c = el('circle', { cx: xAt(i), cy: yAt(v), r: 3, fill: color });
      tooltipEvents(c, tips[i] || `${labels[i]}: ${fmt(v)}`);
      s.appendChild(c);
    });
  }

  const every = Math.max(1, Math.ceil(n / 12));
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    s.appendChild(el('text', { x: xAt(i), y: H - 12, class: 'axis', 'text-anchor': 'middle' }, l));
  });

  s.appendChild(el('line', { x1: padL, y1: padT + innerH, x2: W - padR, y2: padT + innerH, class: 'axis-line' }));
  container.appendChild(s);
}

/** Горизонтальные бары — сравнение сайтов между собой. */
export function hBarChart(container, opts) {
  const { items, fmt = String } = opts; // items: [{label, value, color}]
  container.textContent = '';
  if (!items.length) {
    container.appendChild(Object.assign(document.createElement('p'), { className: 'empty', textContent: t('chartNoData') }));
    return;
  }
  const rowH = 34;
  const W = 900;
  const H = items.length * rowH + 12;
  const padL = 180;
  const padR = 90;
  const s = svgRoot(W, H);
  const max = Math.max(1, ...items.map((i) => i.value));

  items.forEach((it, i) => {
    const y = 6 + i * rowH;
    const w = ((W - padL - padR) * it.value) / max;
    s.appendChild(el('text', { x: padL - 12, y: y + rowH / 2 + 1, class: 'axis strong', 'text-anchor': 'end' }, it.label));
    s.appendChild(el('rect', { x: padL, y: y + 5, width: W - padL - padR, height: rowH - 14, rx: 6, class: 'track' }));
    const bar = el('rect', { x: padL, y: y + 5, width: Math.max(w, it.value > 0 ? 3 : 0), height: rowH - 14, rx: 6, fill: it.color || 'var(--accent)' });
    tooltipEvents(bar, `${it.label}: ${fmt(it.value)}`);
    s.appendChild(bar);
    s.appendChild(el('text', { x: padL + Math.max(w, 0) + 10, y: y + rowH / 2 + 1, class: 'axis' }, fmt(it.value)));
  });

  container.appendChild(s);
}

// Короткие названия месяцев и дней недели для календаря — из Intl, чтобы не держать
// двенадцать строк в каждом переводе. Дни недели идут с понедельника.
let monthCache = null;
let weekdayCache = null;

function monthNames() {
  if (!monthCache) {
    const fmt = new Intl.DateTimeFormat(uiLocale(), { month: 'short' });
    monthCache = Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2021, m, 1)));
  }
  return monthCache;
}

function weekdayNames() {
  if (!weekdayCache) {
    const fmt = new Intl.DateTimeFormat(uiLocale(), { weekday: 'short' });
    // 2021-03-01 — понедельник
    weekdayCache = Array.from({ length: 7 }, (_, d) => fmt.format(new Date(2021, 2, 1 + d)));
  }
  return weekdayCache;
}

/** Календарь-heatmap на год, как contributions-график. */
export function heatmap(container, opts) {
  const { data, year, fmt = String, color = '#3b82f6' } = opts; // data: { "YYYY-MM-DD": sec }
  container.textContent = '';
  const cell = 13;
  const gap = 3;
  const padL = 30;
  const padT = 22;

  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  // сетка начинается с понедельника недели, в которую попало 1 января
  const firstMonday = new Date(start);
  const shift = (start.getDay() + 6) % 7;
  firstMonday.setDate(start.getDate() - shift);

  const weeks = Math.ceil((end - firstMonday) / (7 * 86400000)) + 1;
  const W = padL + weeks * (cell + gap) + 10;
  const H = padT + 7 * (cell + gap) + 6;
  const s = svgRoot(W, H);
  s.setAttribute('height', H);
  s.removeAttribute('width');
  s.setAttribute('width', W);
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const max = Math.max(1, ...Object.values(data));
  const MONTHS = monthNames();
  // подписаны только понедельник, среда, пятница и воскресенье — иначе строки наезжают
  const DAYS = weekdayNames().map((d, i) => (i % 2 === 0 ? d : ''));

  DAYS.forEach((d, i) => {
    if (!d) return;
    s.appendChild(el('text', { x: padL - 6, y: padT + i * (cell + gap) + cell - 2, class: 'axis tiny', 'text-anchor': 'end' }, d));
  });

  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(firstMonday);
      date.setDate(firstMonday.getDate() + w * 7 + d);
      if (date.getFullYear() !== year) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const v = data[key] || 0;
      const x = padL + w * (cell + gap);
      const y = padT + d * (cell + gap);
      const rect = el('rect', {
        x, y, width: cell, height: cell, rx: 3,
        fill: v > 0 ? color : 'var(--cell-empty)',
        'fill-opacity': v > 0 ? String(0.22 + 0.78 * Math.sqrt(v / max)) : '1',
      });
      tooltipEvents(rect, `${key}: ${fmt(v)}`);
      s.appendChild(rect);

      if (d === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        s.appendChild(el('text', { x, y: padT - 8, class: 'axis tiny' }, MONTHS[lastMonth]));
      }
    }
  }
  container.appendChild(s);
}
