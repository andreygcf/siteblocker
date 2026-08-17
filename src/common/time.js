// Работа с датами (локальная таймзона) и форматирование длительностей.

import { t, uiLocale } from './i18n.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** "YYYY-MM-DD" в локальной таймзоне. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM" в локальной таймзоне. */
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Ключ дня, сдвинутый на offset суток назад от base. */
export function shiftDayKey(offsetDays, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() - offsetDays);
  return dayKey(d);
}

/** Массив ключей дней за последние n суток, от старых к новым (включая сегодня). */
export function lastDayKeys(n, base = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftDayKey(i, base));
  return out;
}

export function dayKeyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Секунды → "1:02:03" или "2:03" (компактный вид для плашки). */
export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${m}:${pad(ss)}`;
}

/** Секунды → "3 ч 24 мин" (человекочитаемый вид для статистики). */
export function formatHuman(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} ${t('unitHour')} ${m} ${t('unitMin')}` : `${h} ${t('unitHour')}`;
  if (m > 0) return `${m} ${t('unitMin')}`;
  return `${s} ${t('unitSec')}`;
}

// Названия месяцев берём у Intl — их не нужно держать в _locales и они уже согласованы
// с языком интерфейса браузера.
let dayLabelFmt = null;

export function formatDayLabel(key) {
  if (!dayLabelFmt) dayLabelFmt = new Intl.DateTimeFormat(uiLocale(), { day: 'numeric', month: 'long' });
  return dayLabelFmt.format(dayKeyToDate(key));
}
