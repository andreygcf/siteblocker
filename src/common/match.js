// Нормализация доменов и сопоставление URL со списком отслеживаемых сайтов.

/**
 * Приводит пользовательский ввод к голому домену:
 * "https://www.YouTube.com/watch?v=1" → "youtube.com".
 * Возвращает "" если распарсить не удалось.
 */
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // схема
  s = s.replace(/^[^/@]*@/, ''); // user:pass@
  s = s.split(/[/?#]/)[0]; // путь/запрос/якорь
  s = s.replace(/:\d+$/, ''); // порт
  s = s.replace(/^www\./, '');
  s = s.replace(/\.+$/, '');
  if (!s || !/^[a-z0-9.-]+$/.test(s) || !s.includes('.')) return '';
  return s;
}

/** Хост URL без www, либо "" для служебных схем (chrome://, about:, file: и т. п.). */
export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Хост принадлежит домену или его поддомену. */
export function hostMatchesDomain(host, domain) {
  if (!host || !domain) return false;
  return host === domain || host.endsWith('.' + domain);
}

/**
 * Находит подходящий сайт из списка. При нескольких совпадениях
 * (example.com и sub.example.com) выигрывает более длинный — конкретный домен.
 */
export function matchSite(url, sites) {
  const host = hostOf(url);
  if (!host) return null;
  let best = null;
  for (const site of sites) {
    if (site.enabled === false) continue;
    if (hostMatchesDomain(host, site.domain)) {
      if (!best || site.domain.length > best.domain.length) best = site;
    }
  }
  return best;
}
