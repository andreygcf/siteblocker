# Модель данных

Всё лежит в `chrome.storage.local`. Доступ — только через `src/common/storage.js`,
который подставляет дефолты из `src/common/defaults.js`.

## Схема

```js
{
  schemaVersion: 1,

  settings: {
    idleTimeoutSec: 60,      // пауза после бездействия; минимум MIN_IDLE_SEC = 15
    bannerHoldMs: 5000,      // сколько waste-плашка висит развёрнутой
    statsClosable: true,     // показывать ли крестик на stats-плашке
    styles: {
      waste: { color, textColor, opacity, mode, edge, corner, size, collapsedSize, fontScale },
      stats: { /* те же поля */ },
    },
  },

  sites: [
    { id: 'uuid', domain: 'youtube.com', type: 'waste' | 'stats', enabled: true, createdAt: 1750000000000 },
  ],

  daily:  { '<siteId>': { '2026-07-20': 3540 } },   // секунды по суткам, локальная TZ
  totals: { '<siteId>': { allTime: 123456, since: 1750000000000 } },
}
```

Поля стиля: `mode` — `fullscreen | edge | corner`; `edge` — `top | bottom | left | right`;
`corner` — `top-left | top-right | bottom-left | bottom-right`; `size` и `collapsedSize` в пикселях;
`opacity` — `0.1…1`; `fontScale` — множитель шрифта.

## Почему день и «всего» хранятся отдельно

`daily` — суточные бакеты, из них агрегируются неделя и месяц. `totals.allTime` дублирует сумму,
чтобы:

- сброс за день или месяц не ломал общий счётчик неявно (он уменьшается ровно на удалённое);
- «всего» пережило возможную чистку старых суток.

Объём данных ничтожен: одна запись — восемь байт на сутки на сайт.

## Агрегации

Все — чистые функции в `src/common/storage.js`, работают с объектом `daily[siteId]`:

| Функция | Что делает |
|---|---|
| `sumDaily(d)` | сумма по всем сохранённым суткам |
| `sumMonth(d, '2026-07')` | сумма за месяц (по префиксу ключа) |
| `sumLastDays(d, 7)` | сумма за последние N суток |
| `summaryFor(state, siteId)` | `{ today, month, total }` — то, что показывает плашка |

Ключи дат строит `src/common/time.js`: `dayKey()` → `YYYY-MM-DD`, `monthKey()` → `YYYY-MM`,
`lastDayKeys(n)` → массив от старых к новым. Всё в **локальной** таймзоне: сутки заканчиваются
в местную полночь, смена часового пояса задним числом данные не переразбивает.

## Запись

`addSeconds(siteId, seconds, when)` — единственный способ добавить время: читает состояние,
прибавляет к суточному бакету и к `totals.allTime`, пишет обратно. Вызывается только из
`flush()` в service worker — на переходах и раз в минуту по alarm, поэтому запись нечастая
и чтение-модификация-запись целиком безопасны.

## Сбросы

```js
resetStats('today' | 'month' | 'all', siteId | null)
resetEverything()
```

- `today` / `month` — удаляют подходящие суточные ключи и уменьшают `allTime` ровно на
  удалённую сумму;
- `all` — удаляет и `daily[siteId]`, и `totals[siteId]`;
- `siteId = null` — применить ко всем сайтам;
- `resetEverything()` — обнуляет `daily` и `totals`, оставляя список сайтов и настройки.

## Удаление сайта

Настройки спрашивают, что делать со статистикой. «Удалить со статистикой» чистит `daily[id]`
и `totals[id]`; «оставить» — убирает запись только из `sites`, данные остаются в хранилище
(и снова станут видны, если добавить домен заново — нет, у нового сайта будет новый `id`;
осиротевшие данные попадут в сумму «Все сайты» на странице статистики).

## Экспорт и импорт

Экспорт (`options.js`) отдаёт весь стейт как есть: `site-time-tracker-YYYY-MM-DD.json`.
Импорт валидирует наличие массива `sites`, спрашивает подтверждение и **полностью заменяет**
настройки, список сайтов и статистику.

## Сессионное хранилище

`chrome.storage.session` (ключ `tracker`) держит рабочее состояние трекера между пробуждениями
service worker. Это не персистентные данные: `chrome.runtime.onStartup` их удаляет.
Подробнее — [architecture.md](architecture.md).
