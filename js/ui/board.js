// Список всех задач: очередь, задачи без даты и выполненные.

import { fmtDur, fmtMoment, fmtShortDay, fmtTime } from '../core/format.js';
import { clone } from '../core/doc.js';
import { placeTask } from '../core/ops.js';
import { h, icon } from './dom.js';
import { moveTask, openMoveMenu } from './actions.js';
import { readStorage, writeStorage } from './store.js';
import { toast } from './overlays.js';

const TAB_KEY = 'potok.tab';
const DONE_PAGE = 40;

export class Board {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.query = '';
    this.tab = readStorage(TAB_KEY) || 'queue';
    this.doneLimit = DONE_PAGE;

    this.hello = h('div', { class: 'hello', hidden: true });
    this.search = h('input', {
      id: 'task-search',
      class: 'search-input',
      type: 'search',
      placeholder: 'Найти задачу',
      'aria-label': 'Найти задачу',
      autocomplete: 'off',
      oninput: () => {
        this.query = this.search.value.trim().toLowerCase();
        this.update(ctx.store.base());
      },
    });
    this.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.cols = {
      queue: this.column('queue', 'Очередь'),
      backlog: this.column('backlog', 'Без даты'),
      done: this.column('done', 'Готово'),
    };
    this.el = h(
      'section',
      { class: 'board', 'aria-label': 'Все задачи' },
      this.hello,
      h('div', { class: 'board-bar' },
        this.tabs,
        h('label', { class: 'search' }, icon('search', 16), this.search)),
      h('div', { class: 'cols' }, this.cols.queue.el, this.cols.backlog.el, this.cols.done.el),
    );
    root.append(this.el);
  }

  column(name, title) {
    const headText = h('span', { class: 'col-title' }, title);
    const headMeta = h('span', { class: 'col-meta' });
    const body = h('div', { class: 'col-body' });
    const el = h('div', { class: 'col', data: { col: name } }, h('div', { class: 'col-head' }, headText, headMeta), body);
    return { el, body, headMeta };
  }

  matches(task) {
    if (!this.query) return true;
    return `${task.title} ${task.note}`.toLowerCase().includes(this.query);
  }

  update({ doc, plan, now }) {
    if (this.dragging) return; // строки нельзя пересоздавать, пока одну из них тянут
    this.renderHello(doc);

    const tasks = Object.values(doc.tasks).filter((t) => !t.deleted);
    const queue = plan.items.filter((item) => this.matches(item.task));
    const pinned = plan.pinned.filter((item) => this.matches(item.task));
    const backlog = tasks
      .filter((t) => t.status === 'backlog' && this.matches(t))
      .sort((a, b) => b.createdAt - a.createdAt);
    const done = tasks
      .filter((t) => t.status === 'done' && this.matches(t))
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

    const counts = {
      queue: plan.items.length + plan.pinned.length,
      backlog: tasks.filter((t) => t.status === 'backlog').length,
      done: tasks.filter((t) => t.status === 'done').length,
    };
    this.renderTabs(counts);

    const hours = plan.items.reduce((sum, item) => sum + item.remainingMin, 0);
    this.cols.queue.headMeta.textContent = plan.planEnd
      ? `${fmtDur(hours)} · до ${fmtMoment(plan.planEnd, now)}`
      : '';
    this.cols.backlog.headMeta.textContent = counts.backlog ? String(counts.backlog) : '';
    this.cols.done.headMeta.textContent = counts.done ? String(counts.done) : '';

    this.cols.queue.body.replaceChildren(
      ...queue.map((item) => this.queueRow(item, now)),
      pinned.length ? h('div', { class: 'row-group' }, 'На точное время') : '',
      ...pinned.map((item) => this.queueRow(item, now)),
      queue.length || pinned.length ? '' : this.empty(this.query ? 'Ничего не найдено' : 'Здесь появятся задачи с графика'),
    );
    this.cols.backlog.body.replaceChildren(
      ...backlog.map((task) => this.backlogRow(task)),
      backlog.length ? '' : this.empty(this.query ? 'Ничего не найдено' : 'Сюда можно складывать задачи, для которых пока нет времени'),
    );
    this.cols.done.body.replaceChildren(
      ...done.slice(0, this.doneLimit).map((task) => this.doneRow(task, now)),
      done.length > this.doneLimit
        ? h('button', {
          class: 'btn btn-ghost btn-more',
          type: 'button',
          onclick: () => {
            this.doneLimit += DONE_PAGE;
            this.update(this.ctx.store.base());
          },
        }, 'Показать ещё')
        : '',
      done.length ? '' : this.empty(this.query ? 'Ничего не найдено' : 'Здесь будут выполненные задачи'),
    );
  }

  empty(text) {
    return h('div', { class: 'col-empty' }, text);
  }

  renderHello(doc) {
    const { ctx } = this;
    const dismissed = readStorage('potok.syncHint') === 'hidden';
    const showSample = doc.meta?.sample;
    const showSync = !showSample && !ctx.sync.connected && !dismissed;
    this.hello.hidden = !showSample && !showSync;
    if (showSample) {
      this.hello.replaceChildren(
        h('div', { class: 'hello-text' }, h('b', null, 'Это примеры задач. '), 'Потяните любую и посмотрите, как сдвигаются остальные.'),
        h('div', { class: 'hello-actions' },
          h('button', {
            class: 'btn btn-small btn-primary',
            type: 'button',
            onclick: () => ctx.store.clearSamples(),
          }, 'Начать с чистого листа')),
      );
    } else if (showSync) {
      this.hello.replaceChildren(
        h('div', { class: 'hello-text' }, h('b', null, 'Задачи пока только на этом устройстве. '), 'Подключите синхронизацию, чтобы видеть их и на телефоне, и на компьютере.'),
        h('div', { class: 'hello-actions' },
          h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => ctx.openSettings('sync') }, 'Подключить'),
          h('button', {
            class: 'btn btn-small btn-ghost',
            type: 'button',
            onclick: () => {
              writeStorage('potok.syncHint', 'hidden');
              this.update(ctx.store.base());
            },
          }, 'Позже')),
      );
    }
  }

  renderTabs(counts) {
    const names = [['queue', 'Очередь'], ['backlog', 'Без даты'], ['done', 'Готово']];
    this.tabs.replaceChildren(
      ...names.map(([name, label]) => h(
        'button',
        {
          class: `tab${this.tab === name ? ' is-on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': this.tab === name ? 'true' : 'false',
          onclick: () => {
            this.tab = name;
            writeStorage(TAB_KEY, name);
            this.update(this.ctx.store.base());
          },
        },
        label,
        counts[name] ? h('span', { class: 'tab-count' }, String(counts[name])) : null,
      )),
    );
    for (const [name, col] of Object.entries(this.cols)) {
      col.el.classList.toggle('is-active', this.tab === name);
    }
  }

  // ---------- Строки ----------

  queueRow(item, now) {
    const { task } = item;
    const { ctx } = this;
    const sub = [];
    if (item.isOverdue) {
      sub.push(item.overrunMin ? `дольше плана на ${fmtDur(item.overrunMin)}` : 'срок прошёл');
    } else {
      sub.push(fmtDur(item.pinned ? task.dur : item.remainingMin));
      sub.push(item.isCurrent ? 'идёт' : `старт ${fmtMoment(item.start, now)}`);
    }

    const classes = ['row', `c-${task.color}`, item.isCurrent && 'is-current', item.isOverdue && 'is-overdue', item.late > 0 && 'is-late', task.sample && 'is-sample']
      .filter(Boolean).join(' ');

    return h(
      'div',
      { class: classes, data: { id: task.id, index: item.index ?? '' } },
      item.pinned
        ? h('span', { class: 'row-grip is-static', title: 'Закреплена на точное время' }, icon('pin', 15))
        : this.grip(task),
      h(
        'button',
        { class: 'row-main', type: 'button', onclick: () => this.openRow(task.id) },
        h('i', { class: 'dot' }),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, task.title || 'Без названия', task.link ? icon('link', 13) : null),
          h('span', { class: 'row-sub' }, sub.join(' · '), this.tag(task)),
          item.late > 0
            ? h('span', { class: 'row-warn' }, icon('warn', 13), `Позже дедлайна на ${fmtDur(item.late)}`)
            : task.deadline ? h('span', { class: 'row-deadline' }, icon('flag', 12), `до ${fmtMoment(task.deadline, now)}`) : null),
        h('span', { class: 'row-end' }, h('b', null, fmtShortDay(item.end)), h('span', null, fmtTime(item.end))),
      ),
      this.moveButton(task),
    );
  }

  backlogRow(task) {
    return h(
      'div',
      { class: `row c-${task.color}${task.sample ? ' is-sample' : ''}`, data: { id: task.id } },
      this.grip(task),
      h(
        'button',
        { class: 'row-main', type: 'button', onclick: () => this.openRow(task.id) },
        h('i', { class: 'dot' }),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, task.title || 'Без названия', task.link ? icon('link', 13) : null),
          h('span', { class: 'row-sub' }, fmtDur(task.dur), this.tag(task))),
      ),
      h('button', {
        class: 'btn btn-small row-put',
        type: 'button',
        title: 'Поставить в конец очереди',
        onclick: () => moveTask(this.ctx, task.id, { kind: 'end' }),
      }, 'На график'),
      this.moveButton(task),
    );
  }

  doneRow(task, now) {
    return h(
      'div',
      { class: `row is-done c-${task.color}`, data: { id: task.id } },
      h('span', { class: 'row-grip is-static' }, icon('check', 15)),
      h(
        'button',
        { class: 'row-main', type: 'button', onclick: () => this.openRow(task.id) },
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, task.title || 'Без названия'),
          h('span', { class: 'row-sub' }, task.doneAt ? fmtMoment(task.doneAt, now) : '')),
      ),
    );
  }

  // Статус из таблицы: почему задача ждёт.
  tag(task) {
    return task.label ? h('span', { class: 'tag' }, task.label) : null;
  }

  openRow(id) {
    this.ctx.openTask(id);
  }

  moveButton(task) {
    const button = h('button', {
      class: 'icon-btn row-move',
      type: 'button',
      title: 'Перенести',
      'aria-label': `Перенести «${task.title}»`,
      onclick: () => openMoveMenu(this.ctx, button, task.id),
    }, icon('up', 17));
    return button;
  }

  grip(task) {
    return h('span', {
      class: 'row-grip',
      title: 'Перетащите в очереди или на график',
      onpointerdown: (event) => this.startDrag(event, task),
    }, icon('grip', 15));
  }

  // ---------- Перетаскивание из списка ----------

  startDrag(event, task) {
    event.preventDefault();
    const { ctx } = this;
    const { store, timeline } = ctx;
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    const row = grip.closest('.row');
    row.classList.add('is-lifted');
    this.dragging = true;

    const chip = h('div', { class: `drag-chip c-${task.color}` }, task.title || 'Без названия');
    document.body.append(chip);
    const queueBody = this.cols.queue.body;
    let index = null;

    const place = (x, y) => {
      chip.style.transform = `translate(${x + 12}px, ${y - 14}px)`;
    };
    place(event.clientX, event.clientY);

    const clearMarks = () => {
      for (const el of queueBody.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
    };

    const hitQueue = (x, y) => {
      const rect = queueBody.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top - 30 || y > rect.bottom + 30) return null;
      if (this.cols.queue.el.offsetParent === null) return null;
      const rows = [...queueBody.querySelectorAll('.row[data-index]')].filter((el) => el.dataset.id !== task.id && el.dataset.index !== '');
      for (let i = 0; i < rows.length; i += 1) {
        const box = rows[i].getBoundingClientRect();
        if (y < box.top + box.height / 2) {
          rows[i].classList.add('drop-before');
          return i;
        }
      }
      if (rows.length) rows[rows.length - 1].classList.add('drop-after');
      return rows.length;
    };

    const onMove = (e) => {
      place(e.clientX, e.clientY);
      clearMarks();
      if (timeline.containsPoint(e.clientX, e.clientY)) index = timeline.indexAtClient(e.clientX, task.id);
      else index = hitQueue(e.clientX, e.clientY);
      if (index == null) {
        store.clearPreview();
        return;
      }
      const draft = clone(store.doc);
      placeTask(draft, task.id, { kind: 'index', index }, store.now());
      store.setPreview(draft, { dragId: task.id, ghostId: task.id });
    };

    const finish = (commit) => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onCancel);
      chip.remove();
      row.classList.remove('is-lifted');
      clearMarks();
      this.dragging = false;
      if (commit && index != null) {
        const target = index;
        const before = store.doc.plan.order.join();
        store.clearPreview();
        store.commit((draft, now) => placeTask(draft, task.id, { kind: 'index', index: target }, now));
        if (store.doc.plan.order.join() !== before) {
          const { plan, now } = store.base();
          const item = plan.byId.get(task.id);
          if (item) {
            toast(`«${task.title}» закончится ${fmtMoment(item.end, now)}`, { action: { label: 'Отменить', run: () => store.undo() } });
          }
        }
      } else if (store.preview) {
        store.clearPreview();
      } else {
        this.update(store.base());
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
  }
}

