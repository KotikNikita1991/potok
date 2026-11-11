// Запуск приложения: собирает экран, связывает части, следит за временем.

import { Board } from './ui/board.js';
import { h, icon } from './ui/dom.js';
import { GistSync } from './sync/gist.js';
import { TableClient } from './sync/table.js';
import { NowBar } from './ui/nowbar.js';
import { openDaySheet } from './ui/day-sheet.js';
import { initTheme, openSettingsSheet } from './ui/settings-sheet.js';
import { openTableSheet } from './ui/table-sheet.js';
import { openTaskSheet } from './ui/task-sheet.js';
import { closeSheet, isSheetOpen, positionSheet, watchKeyboard } from './ui/sheet.js';
import { store } from './ui/store.js';
import { Timeline } from './ui/timeline.js';
import { toast } from './ui/overlays.js';

initTheme();
store.init();

const ctx = {
  store,
  timeline: null,
  board: null,
  sync: null,
  table: null,
  taskSheet: null,
  settingsRefresh: null,
  closeSheet,
  openTask: (id) => {
    if (ctx.taskSheet?.isDirty()) {
      toast('Сначала сохраните или отмените изменения в открытой задаче');
      return;
    }
    openTaskSheet(ctx, { id });
  },
  addTask: (placement = null) => openTaskSheet(ctx, { placement }),
  openDay: (key) => {
    if (ctx.taskSheet?.isDirty()) {
      toast('Сначала сохраните или отмените изменения в открытой задаче');
      return;
    }
    openDaySheet(ctx, key);
  },
  openSettings: (focus) => openSettingsSheet(ctx, focus),
  openTable: () => {
    if (ctx.taskSheet?.isDirty()) {
      toast('Сначала сохраните или отмените изменения в открытой задаче');
      return;
    }
    openTableSheet(ctx);
  },
};

// ---------- Экран ----------

const logo = `<svg viewBox="0 0 32 20" width="30" height="19" aria-hidden="true"><rect x="0" y="3" width="11" height="14" rx="3" fill="var(--sky-edge)"/><rect x="13" y="3" width="6" height="14" rx="1.5" fill="var(--lav-edge)"/><rect x="21" y="3" width="11" height="14" rx="3" fill="var(--coral-edge)"/></svg>`;
const brandMark = h('span', { class: 'brand-mark' });
brandMark.innerHTML = logo;

const syncButton = h('button', {
  class: 'icon-btn sync-btn',
  type: 'button',
  onclick: () => ctx.openSettings('sync'),
});

const nowHost = h('div', { class: 'now-host' });
const top = h(
  'header',
  { class: 'top' },
  h('div', { class: 'brand' }, brandMark, h('span', { class: 'brand-name' }, 'Поток')),
  nowHost,
  h('div', { class: 'top-actions' },
    syncButton,
    h('button', {
      class: 'icon-btn',
      type: 'button',
      title: 'Google Таблица',
      'aria-label': 'Google Таблица',
      onclick: () => ctx.openTable(),
    }, icon('table')),
    h('button', {
      class: 'icon-btn',
      type: 'button',
      title: 'Настройки',
      'aria-label': 'Настройки',
      onclick: () => ctx.openSettings(),
    }, icon('sliders')),
    h('button', {
      class: 'btn btn-primary btn-add-task',
      type: 'button',
      onclick: () => ctx.addTask(),
    }, icon('plus', 16), 'Задача')),
);
const timelineHost = h('div', { class: 'timeline-host' });
const boardHost = h('main', { class: 'board-host' });
const fab = h('button', {
  class: 'fab',
  type: 'button',
  'aria-label': 'Новая задача',
  onclick: () => ctx.addTask(),
}, icon('plus', 26));

document.getElementById('app').append(h('div', { class: 'app' }, top, timelineHost, boardHost, fab));

ctx.timeline = new Timeline(timelineHost, {
  onMark: (placement) => {
    if (ctx.taskSheet) ctx.taskSheet.setPlacement(placement);
    else ctx.addTask(placement);
  },
  onLane: (at) => {
    if (ctx.taskSheet) ctx.taskSheet.setPlacement({ kind: 'moment', at });
    else if (!isSheetOpen()) ctx.addTask({ kind: 'moment', at });
  },
  onTask: (id) => ctx.openTask(id),
  onDay: (key) => ctx.openDay(key),
  canDrag: () => !isSheetOpen(),
});

ctx.sync = new GistSync({
  store: {
    getDoc: () => store.doc,
    applyRemote: (doc) => store.applyRemote(doc),
  },
  fetchImpl: (...args) => fetch(...args),
  storage: localStorage,
  onStatus: () => {
    renderSyncButton();
    ctx.settingsRefresh?.();
  },
});

ctx.table = new TableClient({
  fetchImpl: (...args) => fetch(...args),
  getUrl: () => store.doc.table?.url ?? '',
  isOnline: () => navigator.onLine !== false,
});

ctx.board = new Board(boardHost, ctx);
const nowBar = new NowBar(nowHost, ctx);

function renderSyncButton() {
  const { sync } = ctx;
  const { state, message } = sync.status;
  const names = { off: 'cloudOff', idle: 'cloudCheck', busy: 'sync', offline: 'cloudOff', error: 'cloudOff' };
  const titles = {
    off: 'Синхронизация не подключена',
    idle: 'Всё сохранено',
    busy: 'Синхронизирую…',
    offline: message,
    error: message,
  };
  syncButton.replaceChildren(icon(names[state] ?? 'cloud'));
  syncButton.dataset.state = state;
  syncButton.title = titles[state] ?? '';
  syncButton.setAttribute('aria-label', titles[state] ?? 'Синхронизация');
}

// ---------- Отрисовка ----------

let scheduled = false;
function render() {
  scheduled = false;
  ctx.timeline.update(store.view());
  if (!store.preview) {
    const base = store.base();
    nowBar.update(base);
    ctx.board.update(base);
  }
  positionSheet(ctx);
}

store.on(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(render);
});

store.onLocalChange(() => ctx.sync.noteLocalChange());

render();
renderSyncButton();
watchKeyboard();
window.addEventListener('resize', () => {
  render();
});

// Время идёт: раз в минуту план пересчитывается.
let lastMinute = store.now();
setInterval(() => {
  const current = store.now();
  if (current !== lastMinute) {
    lastMinute = current;
    store.tick();
  }
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store.tick();
});

// На iPhone щипок не должен увеличивать всю страницу: масштаб есть только у графика.
document.addEventListener('gesturestart', (event) => event.preventDefault());

// ---------- Клавиши ----------

window.addEventListener('keydown', (event) => {
  const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    if (store.undo()) toast('Отменено', { timeout: 2500 });
    return;
  }
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'KeyN' && !isSheetOpen()) {
    event.preventDefault();
    ctx.addTask();
  } else if (event.code === 'KeyT') {
    ctx.timeline.scrollToNow(true);
  } else if (event.key === '/') {
    event.preventDefault();
    document.getElementById('task-search')?.focus();
  }
});

// ---------- Синхронизация и офлайн ----------

try {
  navigator.storage?.persist?.();
} catch {
  // браузер сам решит, как хранить данные
}

ctx.sync.start(window);

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || new URLSearchParams(location.search).has('sw'))) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (isSheetOpen()) {
      toast('Вышло обновление. Оно применится при следующем запуске.');
      return;
    }
    location.reload();
  });
}
