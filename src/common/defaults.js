// Значения по умолчанию и схема хранилища.

export const SCHEMA_VERSION = 1;

/** Пресет стиля waste-плашки: агрессивный полноэкранный красный экран. */
export const DEFAULT_WASTE_STYLE = {
  color: '#c0392b',
  textColor: '#ffffff',
  opacity: 0.95,
  mode: 'fullscreen', // fullscreen | edge | corner
  edge: 'top', // для mode=edge: top | bottom | left | right
  corner: 'top-right', // для mode=corner
  size: 120, // px: толщина полосы (edge) или сторона плашки (corner)
  collapsedSize: 44, // px: высота свёрнутого бейджа
  fontScale: 1,
};

/** Пресет стиля stats-плашки: небольшая полупрозрачная плашка в углу. */
export const DEFAULT_STATS_STYLE = {
  color: '#1f2937',
  textColor: '#ffffff',
  opacity: 0.6,
  mode: 'corner',
  edge: 'bottom',
  corner: 'bottom-right',
  size: 72,
  collapsedSize: 36,
  fontScale: 1,
};

export const DEFAULT_SETTINGS = {
  idleTimeoutSec: 60, // после скольких секунд бездействия счётчик встаёт на паузу
  bannerHoldMs: 5000, // сколько waste-плашка висит на весь экран перед сворачиванием
  statsClosable: true, // stats-плашку можно закрыть крестиком; waste-плашку закрыть нельзя никогда
  styles: {
    waste: DEFAULT_WASTE_STYLE,
    stats: DEFAULT_STATS_STYLE,
  },
};

export const DEFAULT_STATE = {
  schemaVersion: SCHEMA_VERSION,
  settings: DEFAULT_SETTINGS,
  sites: [],
  daily: {}, // { siteId: { "YYYY-MM-DD": seconds } }
  totals: {}, // { siteId: { allTime: seconds, since: ts } }
};

/** Chrome не даёт idle-интервал меньше 15 секунд. */
export const MIN_IDLE_SEC = 15;
