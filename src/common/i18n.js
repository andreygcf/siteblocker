// Локализация страниц расширения. Тексты лежат в _locales/<lang>/messages.json,
// язык выбирает сам Chrome по языку интерфейса браузера (fallback — en).

/** Сообщение по ключу; subs — подстановки для $1, $2… */
export function t(key, subs) {
  return chrome.i18n.getMessage(key, subs) || key;
}

/** Локаль интерфейса — для Intl (названия месяцев, дней недели). */
export function uiLocale() {
  return chrome.i18n.getUILanguage();
}

/**
 * Подставляет тексты в разметку. Атрибуты:
 *   data-i18n            — textContent
 *   data-i18n-html       — innerHTML (для сообщений с <b>; строки наши, не пользовательские)
 *   data-i18n-title      — title
 *   data-i18n-placeholder— placeholder
 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  document.documentElement.lang = uiLocale();
}
