// Карточка задачи: создание и редактирование. Изменения сразу видны на графике.

import { dayPlan, calendarOf, workMinutes } from '../core/calendar.js';
import { COLORS, createTask, nextColor } from '../core/doc.js';
import { fmtDur, fmtMoment, fmtShort, parseDur, plural } from '../core/format.js';
import { deleteTask, placeTask } from '../core/ops.js';
import { STEP, atKey, formatHM, minutesOfDay, parseHM, roundTo, toKey } from '../core/time.js';
import { impactOf, simulate, suggestIndex } from '../core/whatif.js';
import { h, icon, isTouch, safeLink } from './dom.js';
import { finishTask, openFinishedAtMenu } from './actions.js';
import { toast } from './overlays.js';
import { closeSheet, openSheet } from './sheet.js';
import { knownStatuses } from './table-sheet.js';

const DRAFT_ID = '__draft__';
const DEFAULT_DUR = 120;

const COLOR_NAMES = {
  sky: 'Голубой',
  coral: 'Коралловый',
  lav: 'Лавандовый',
  mint: 'Мятный',
  sun: 'Жёлтый',
  rose: 'Розовый',
  olive: 'Оливковый',
  slate: 'Серый',
};

function deadlineValue(date, time, doc) {
  if (!date) return null;
  if (time) return atKey(date, parseHM(time));
  const plan = dayPlan(date, calendarOf(doc));
  return atKey(date, parseHM(plan.on ? plan.end : '18:00'));
}

export function openTaskSheet(ctx, { id = null, placement = null } = {}) {
  const { store, timeline } = ctx;
  const { doc: baseDoc, plan: basePlan, now } = store.base();
  const existing = id ? baseDoc.tasks[id] : null;
  const previewId = id ?? DRAFT_ID;
  const typicalDay = workMinutes(baseDoc.settings.week[1]) || 480;

  const form = {
    title: existing?.title ?? '',
    note: existing?.note ?? '',
    link: existing?.link ?? '',
    dur: existing?.dur ?? DEFAULT_DUR,
    color: existing?.color ?? nextColor(baseDoc),
    label: existing?.label ?? '',
    lag: existing?.lag ?? 0,
    deadlineDate: existing?.deadline ? toKey(existing.deadline) : '',
    deadlineTime: existing?.deadline ? formatHM(minutesOfDay(existing.deadline)) : '',
    kind: 'end',
    afterId: '',
    momentDate: toKey(now),
    momentTime: '',
    pinDate: toKey(now),
    pinTime: '15:00',
  };

  const inQueue = existing ? baseDoc.plan.order.includes(id) : false;
  const others = baseDoc.plan.order.filter((x) => x !== id);
  const first = basePlan.items[0];
  const firstIsOther = first && first.id !== id;
  const startsNow = firstIsOther && first.isCurrent;

  if (existing?.pinAt != null) {
    form.kind = 'pin';
    form.pinDate = toKey(existing.pinAt);
    form.pinTime = formatHM(minutesOfDay(existing.pinAt));
  } else if (existing) {
    form.kind = 'keep';
  } else if (!others.length) {
    form.kind = 'end';
  }
  form.afterId = others[others.length - 1] ?? '';

  const applyPlacement = (p) => {
    if (!p) return;
    form.kind = p.kind;
    if (p.kind === 'after') form.afterId = p.id;
    if (p.kind === 'moment') {
      form.momentDate = toKey(p.at);
      form.momentTime = formatHM(minutesOfDay(p.at));
    }
  };
  applyPlacement(placement);

  const currentPlacement = (kind = form.kind) => {
    switch (kind) {
      case 'after':
        return form.afterId ? { kind: 'after', id: form.afterId } : { kind: 'end' };
      case 'moment': {
        if (!form.momentDate) return { kind: 'end' };
        const minutes = form.momentTime ? parseHM(form.momentTime) : 0;
        return { kind: 'moment', at: atKey(form.momentDate, minutes) };
      }
      case 'pin':
        return form.pinDate && form.pinTime
          ? { kind: 'pin', at: atKey(form.pinDate, parseHM(form.pinTime)) }
          : { kind: 'end' };
      default:
        return { kind };
    }
  };

  const fields = (draftDoc) => ({
    title: form.title.trim() || 'Новая задача',
    note: form.note.trim(),
    link: form.link.trim(),
    label: form.label.trim(),
    dur: form.dur,
    color: form.color,
    deadline: deadlineValue(form.deadlineDate, form.deadlineTime, draftDoc),
  });

  const applyTo = (draft, t, placementValue, taskId = previewId) => {
    let task = draft.tasks[taskId];
    if (!task) {
      task = createTask({ id: taskId }, t);
      draft.tasks[taskId] = task;
    }
    Object.assign(task, fields(draft));
    placeTask(draft, task.id, placementValue, t);
    if (!['moment', 'pin', 'backlog'].includes(placementValue.kind)) task.lag = form.lag;
    return task.id;
  };

  const simulateFor = (placementValue) => simulate(baseDoc, now, (draft, t) => applyTo(draft, t, placementValue));

  // ---------- Поля ----------

  const titleInput = h('input', {
    id: 'task-title',
    class: 'input input-title',
    type: 'text',
    placeholder: 'Что нужно сделать',
    value: form.title,
    'aria-label': 'Название',
    enterKeyHint: 'done',
    oninput: () => {
      form.title = titleInput.value;
      titleInput.classList.remove('is-invalid');
      refresh();
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    },
  });

  const growNote = () => {
    noteInput.style.height = 'auto';
    noteInput.style.height = `${noteInput.scrollHeight + 2}px`;
  };
  const noteInput = h('textarea', {
    id: 'task-note',
    class: 'input',
    rows: 1,
    placeholder: 'Описание',
    'aria-label': 'Описание',
    value: form.note,
    oninput: () => {
      form.note = noteInput.value;
      growNote();
      refresh();
    },
  });

  const openLink = h('a', {
    class: 'btn btn-small link-open',
    target: '_blank',
    rel: 'noopener noreferrer',
  }, icon('external', 15), 'Открыть');

  const linkInput = h('input', {
    id: 'task-link',
    class: 'input',
    type: 'url',
    inputMode: 'url',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: false,
    placeholder: 'Ссылка',
    'aria-label': 'Ссылка',
    value: form.link,
    oninput: () => {
      form.link = linkInput.value;
      syncLink();
    },
  });

  // Статус словами таблицы: нужен, когда задача ждёт кого-то другого. Показываем, если таблица подключена.
  const labelInput = h('input', {
    id: 'task-label',
    class: 'input',
    type: 'text',
    list: 'task-label-options',
    placeholder: 'Статус, если задача кого-то ждёт: на переводе, нужна инфа',
    'aria-label': 'Статус в таблице',
    value: form.label,
    oninput: () => {
      form.label = labelInput.value;
    },
  });
  const labelField = baseDoc.table?.url || form.label
    ? [labelInput, h('datalist', { id: 'task-label-options' }, knownStatuses().map((word) => h('option', { value: word })))]
    : null;

  const syncLink = () => {
    const href = safeLink(form.link);
    openLink.hidden = !href;
    if (href) openLink.href = href;
  };

  // Длительность
  const durInput = h('input', {
    id: 'task-dur',
    class: 'dur-input',
    type: 'text',
    inputMode: 'text',
    'aria-label': 'Сколько времени',
    value: fmtDur(form.dur),
    onchange: () => {
      const parsed = parseDur(durInput.value);
      if (parsed) setDur(parsed);
      else durInput.value = fmtDur(form.dur);
    },
    onfocus: () => durInput.select(),
  });

  const presets = [
    [30, '30 мин'],
    [60, '1 ч'],
    [120, '2 ч'],
    [180, '3 ч'],
    [240, '4 ч'],
    [typicalDay, `День (${fmtDur(typicalDay)})`],
    [typicalDay * 2, '2 дня'],
  ];
  const presetButtons = presets.map(([minutes, label]) => h('button', {
    class: 'chip',
    type: 'button',
    data: { minutes },
    onclick: () => setDur(minutes),
  }, label));

  const setDur = (minutes) => {
    form.dur = Math.max(STEP, roundTo(minutes));
    durInput.value = fmtDur(form.dur);
    for (const button of presetButtons) button.classList.toggle('is-on', Number(button.dataset.minutes) === form.dur);
    refresh();
  };

  const stepper = (delta, name, label) => h('button', {
    class: 'step',
    type: 'button',
    'aria-label': label,
    onclick: () => setDur(form.dur + delta),
  }, icon(name, 16));

  const durField = h('div', { class: 'field' },
    h('div', { class: 'field-label' }, 'Сколько времени'),
    h('div', { class: 'dur-row' }, stepper(-STEP, 'minus', 'Меньше на 15 минут'), durInput, stepper(STEP, 'plus', 'Больше на 15 минут')),
    h('div', { class: 'chips' }, presetButtons),
    existing?.spent ? h('div', { class: 'field-hint' }, `Уже отработано ${fmtDur(existing.spent)}`) : null);

  // Запас перед стартом
  const lagValue = h('span', { class: 'lag-value' });
  const setLag = (value) => {
    form.lag = Math.max(0, value);
    lagValue.textContent = form.lag ? `+${fmtDur(form.lag)}` : 'нет';
    refresh();
  };
  const lagField = h('div', { class: 'lag-row' },
    h('div', { class: 'lag-text' },
      h('span', { class: 'lag-title' }, 'Отложить старт'),
      h('span', { class: 'field-hint' }, 'Запас перед задачей, едет вместе с ней')),
    h('div', { class: 'lag-controls' },
      h('button', { class: 'step', type: 'button', 'aria-label': 'Меньше на час', onclick: () => setLag(form.lag - 60) }, '−1 ч'),
      h('button', { class: 'step', type: 'button', 'aria-label': 'Меньше на 15 минут', onclick: () => setLag(form.lag - STEP) }, '−15'),
      lagValue,
      h('button', { class: 'step', type: 'button', 'aria-label': 'Больше на 15 минут', onclick: () => setLag(form.lag + STEP) }, '+15'),
      h('button', { class: 'step', type: 'button', 'aria-label': 'Больше на час', onclick: () => setLag(form.lag + 60) }, '+1 ч')));

  // Куда поставить
  const optionEl = (kind, label, hint) => {
    const eta = h('span', { class: 'opt-eta' });
    const el = h('button', {
      class: 'opt',
      type: 'button',
      role: 'radio',
      data: { kind },
      onclick: () => {
        form.kind = kind;
        refresh();
        timeline.revealTask(previewId);
      },
    }, h('span', { class: 'opt-text' }, h('span', { class: 'opt-label' }, label), hint ? h('span', { class: 'opt-hint' }, hint) : null), eta);
    return { el, eta, kind };
  };

  const order = baseDoc.plan.order;
  const options = [];
  if (existing && existing.pinAt == null) {
    const keepLabel = existing.status === 'done' ? 'Оставить в готовых' : inQueue ? 'Оставить на месте' : 'Оставить без даты';
    options.push(optionEl('keep', keepLabel));
  }
  if (firstIsOther) {
    options.push(optionEl('now', startsNow ? 'Начать сейчас' : 'Поставить первой', startsNow ? `«${first.task.title}» прервётся, остаток уйдёт после` : null));
  }
  if (others.length >= 2 && order[1] !== id) {
    options.push(optionEl('next', 'Следующей', `после «${baseDoc.tasks[others[0]].title}»`));
  }
  if (others.length && order[order.length - 1] !== id) {
    options.push(optionEl('end', 'В конец очереди'));
  } else if (!others.length && !inQueue) {
    options.push(optionEl('end', 'На график'));
  }

  const chipEls = {};
  const chip = (kind, label) => {
    chipEls[kind] = h('button', {
      class: 'chip',
      type: 'button',
      onclick: () => {
        form.kind = kind;
        refresh();
        timeline.revealTask(previewId);
      },
    }, label);
    return chipEls[kind];
  };

  const afterSelect = h('select', {
    id: 'task-after',
    class: 'input',
    'aria-label': 'После какой задачи',
    onchange: () => {
      form.afterId = afterSelect.value;
      refresh();
      timeline.revealTask(previewId);
    },
  }, others.map((otherId) => h('option', { value: otherId }, baseDoc.tasks[otherId].title)));
  if (form.afterId) afterSelect.value = form.afterId;

  const momentDate = h('input', { id: 'task-moment-date', class: 'input', type: 'date', 'aria-label': 'Дата', value: form.momentDate, onchange: () => { form.momentDate = momentDate.value; refresh(); timeline.revealTask(previewId); } });
  const momentTime = h('input', { id: 'task-moment-time', class: 'input', type: 'time', step: 900, 'aria-label': 'Время', value: form.momentTime, onchange: () => { form.momentTime = momentTime.value; refresh(); timeline.revealTask(previewId); } });
  const pinDate = h('input', { id: 'task-pin-date', class: 'input', type: 'date', 'aria-label': 'Дата', value: form.pinDate, onchange: () => { form.pinDate = pinDate.value; refresh(); timeline.revealTask(previewId); } });
  const pinTime = h('input', { id: 'task-pin-time', class: 'input', type: 'time', step: 900, 'aria-label': 'Время', value: form.pinTime, onchange: () => { form.pinTime = pinTime.value; refresh(); timeline.revealTask(previewId); } });

  const panels = {
    after: h('div', { class: 'place-panel' }, afterSelect),
    moment: h('div', { class: 'place-panel' },
      h('div', { class: 'input-pair' }, momentDate, momentTime),
      h('div', { class: 'field-hint' }, 'Встанет на ближайшее свободное место в очереди, свободное время до неё станет запасом.')),
    pin: h('div', { class: 'place-panel' },
      h('div', { class: 'input-pair' }, pinDate, pinTime),
      h('div', { class: 'field-hint' }, 'Задача не двигается, остальные обходят её, как обед. Подходит для созвонов и встреч.')),
    backlog: h('div', { class: 'place-panel' },
      h('div', { class: 'field-hint' }, 'Задача останется в списке и не займёт время на графике.')),
  };

  const impactEl = h('div', { class: 'impact', role: 'status' });

  const placeField = h('div', { class: 'field' },
    h('div', { class: 'field-label' }, 'Куда поставить'),
    h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Куда поставить' }, options.map((o) => o.el)),
    h('div', { class: 'chips' },
      others.length ? chip('after', 'После задачи…') : null,
      chip('moment', 'На дату…'),
      chip('pin', 'Точное время…'),
      chip('backlog', 'Без даты')),
    panels.after, panels.moment, panels.pin, panels.backlog,
    impactEl);

  // Дедлайн
  const deadlineDate = h('input', { id: 'task-deadline-date', class: 'input', type: 'date', 'aria-label': 'Дата дедлайна', value: form.deadlineDate, onchange: () => { form.deadlineDate = deadlineDate.value; refresh(); } });
  const deadlineTime = h('input', { id: 'task-deadline-time', class: 'input', type: 'time', step: 900, 'aria-label': 'Время дедлайна', value: form.deadlineTime, onchange: () => { form.deadlineTime = deadlineTime.value; refresh(); } });
  const deadlineClear = h('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'Убрать дедлайн',
    'aria-label': 'Убрать дедлайн',
    onclick: () => {
      form.deadlineDate = '';
      form.deadlineTime = '';
      deadlineDate.value = '';
      deadlineTime.value = '';
      refresh();
    },
  }, icon('close', 16));
  const deadlineField = h('div', { class: 'field' },
    h('div', { class: 'field-label' }, 'Дедлайн, если есть'),
    h('div', { class: 'input-pair' }, deadlineDate, deadlineTime, deadlineClear));

  // Цвет
  const swatches = COLORS.map((color) => h('button', {
    class: `swatch c-${color}`,
    type: 'button',
    title: COLOR_NAMES[color],
    'aria-label': COLOR_NAMES[color],
    data: { color },
    onclick: () => {
      form.color = color;
      refresh();
    },
  }));
  const colorField = h('div', { class: 'field' },
    h('div', { class: 'field-label' }, 'Цвет на графике'),
    h('div', { class: 'swatches' }, swatches));

  // ---------- Сводка и действия для существующей задачи ----------

  const statusBlock = () => {
    if (!existing) return null;
    if (existing.status === 'done') {
      return h('div', { class: 'status' }, h('b', null, 'Готово '), existing.doneAt ? fmtMoment(existing.doneAt, now) : '', existing.spent ? `, потрачено ${fmtDur(existing.spent)}` : '');
    }
    const item = basePlan.byId.get(id);
    if (!item) return h('div', { class: 'status' }, 'Без даты, на графике не показывается');
    return h('div', { class: 'status' },
      h('span', null, h('b', null, 'Старт '), fmtMoment(item.start, now)),
      h('span', null, h('b', null, 'Конец '), fmtMoment(item.end, now)),
      item.isCurrent ? h('span', null, `Отработано ${fmtDur(item.elapsedMin + (existing.spent || 0))}`) : null);
  };

  const footer = existing
    ? h('div', { class: 'sheet-actions' },
      existing.status !== 'done'
        ? h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => {
            closeSheet();
            finishTask(ctx, id);
          },
        }, icon('check', 16), 'Готово')
        : h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => {
            form.kind = 'end';
            save();
          },
        }, icon('undo', 16), 'Вернуть в очередь'),
      inQueue && first?.id === id && first.isCurrent
        ? h('button', {
          class: 'btn',
          type: 'button',
          onclick: (event) => openFinishedAtMenu(ctx, event.currentTarget, id),
        }, 'Закончилось раньше…')
        : null,
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onclick: () => {
          const title = existing.title;
          closeSheet();
          store.commit((draft, t) => deleteTask(draft, id, t));
          toast(`«${title}» удалена`, { action: { label: 'Отменить', run: () => store.undo() } });
        },
      }, icon('trash', 16), 'Удалить'))
    : null;

  const content = h('div', { class: 'task-form' },
    statusBlock(),
    h('div', { class: 'sheet-grid' },
      h('div', { class: 'sheet-col' },
        h('div', { class: 'field' }, titleInput, noteInput, h('div', { class: 'link-row' }, linkInput, openLink), labelField),
        durField),
      h('div', { class: 'sheet-col' },
        placeField,
        lagField,
        deadlineField,
        colorField)),
    footer);

  // ---------- Обновление и предпросмотр ----------

  function refresh() {
    const value = currentPlacement();
    const sim = simulate(baseDoc, now, (draft, t) => applyTo(draft, t, value));
    store.setPreview(sim.doc, { ghostId: previewId });

    for (const option of options) {
      option.el.classList.toggle('is-on', option.kind === form.kind);
      option.el.setAttribute('aria-checked', option.kind === form.kind ? 'true' : 'false');
      const item = simulateFor(currentPlacement(option.kind)).plan.byId.get(previewId);
      option.eta.textContent = item ? fmtShort(item.end, now) : '';
    }
    for (const [kind, el] of Object.entries(chipEls)) el.classList.toggle('is-on', kind === form.kind);
    for (const [kind, el] of Object.entries(panels)) el.hidden = kind !== form.kind;
    lagField.hidden = ['moment', 'pin', 'backlog'].includes(form.kind) || existing?.status === 'done';
    for (const el of swatches) el.classList.toggle('is-on', el.dataset.color === form.color);
    deadlineClear.hidden = !form.deadlineDate && !form.deadlineTime;

    renderImpact(sim);
  }

  function renderImpact(sim) {
    const item = sim.plan.byId.get(previewId);
    const lines = [];
    if (sim.plan.stuck) {
      lines.push(h('div', { class: 'impact-warn' }, icon('warn', 15), 'В расписании не хватает рабочего времени. Проверьте настройки недели.'));
    }
    if (item) {
      lines.push(h('div', { class: 'impact-main' }, 'Закончится ', h('b', null, fmtMoment(item.end, now))));
      const impact = impactOf(basePlan, sim.plan, previewId);
      if (impact.moved) {
        lines.push(h('div', { class: 'impact-sub' }, `Сдвинет ${impact.moved} ${plural(impact.moved, 'задачу', 'задачи', 'задач')}, максимум на ${fmtDur(impact.maxShift)}`));
      } else if (basePlan.items.length && form.kind !== 'keep') {
        lines.push(h('div', { class: 'impact-sub' }, 'Остальные задачи не сдвинутся'));
      }
      if (item.late > 0) {
        lines.push(h('div', { class: 'impact-warn' }, icon('warn', 15), `Позже дедлайна на ${fmtDur(item.late)}`));
      }
      for (const task of impact.newlyLate) {
        lines.push(h('div', { class: 'impact-warn' }, icon('warn', 15), `«${task.title}» не успеет к дедлайну`));
      }
      if ((item.late > 0 || impact.newlyLate.length) && !item.pinned) {
        lines.push(adviceLine());
      }
    }
    impactEl.replaceChildren(...lines);
    impactEl.hidden = !lines.length;
  }

  // Подсказка: куда поставить, чтобы все дедлайны остались в силе.
  function adviceLine() {
    const count = others.length;
    const best = suggestIndex(baseDoc, now, count, (draft, index, t) => applyTo(draft, t, { kind: 'index', index }));
    if (best == null) return h('div', { class: 'impact-sub' }, 'Ни одно место в очереди не спасает все дедлайны.');
    const target = best === 0 ? 'первой' : `после «${baseDoc.tasks[others[best - 1]].title}»`;
    return h('div', { class: 'impact-advice' },
      h('span', null, `Успеет всё, если поставить ${target}`),
      h('button', {
        class: 'btn btn-small',
        type: 'button',
        onclick: () => {
          if (best === 0) {
            form.kind = 'now';
          } else {
            form.kind = 'after';
            form.afterId = others[best - 1];
            afterSelect.value = form.afterId;
          }
          refresh();
          timeline.revealTask(previewId);
        },
      }, 'Поставить'));
  }

  function save() {
    if (!form.title.trim()) {
      titleInput.classList.add('is-invalid');
      titleInput.focus();
      toast('Напишите, что нужно сделать');
      return;
    }
    const value = currentPlacement();
    let newId = id;
    closeSheet();
    store.commit((draft, t) => {
      if (id) {
        applyTo(draft, t, value, id);
        return;
      }
      const task = createTask({ color: form.color }, t);
      draft.tasks[task.id] = task;
      newId = task.id;
      applyTo(draft, t, value, task.id);
    });
    const { plan, now: current, doc } = store.base();
    const item = plan.byId.get(newId);
    const title = doc.tasks[newId].title;
    const undoAction = { label: 'Отменить', run: () => store.undo() };
    if (item) {
      toast(`«${title}» закончится ${fmtMoment(item.end, current)}`, { action: undoAction });
      timeline.revealTask(newId);
    } else if (value.kind === 'backlog') {
      toast(`«${title}» в списке без даты`, { action: undoAction });
    } else if (id) {
      toast('Сохранено', { action: undoAction, timeout: 3000 });
    }
  }

  const sheet = openSheet(ctx, {
    title: existing ? 'Задача' : 'Новая задача',
    name: 'task',
    content,
    primaryLabel: existing ? 'Сохранить' : 'Добавить',
    onPrimary: save,
    onClose: () => {
      store.clearPreview();
      ctx.taskSheet = null;
    },
  });
  sheet.data.dirtyBase = JSON.stringify(form);

  ctx.taskSheet = {
    setPlacement(next) {
      applyPlacement(next);
      if (next.kind === 'after') afterSelect.value = next.id;
      if (next.kind === 'moment') {
        momentDate.value = form.momentDate;
        momentTime.value = form.momentTime;
      }
      refresh();
      timeline.revealTask(previewId);
    },
    isDirty: () => JSON.stringify(form) !== sheet.data.dirtyBase,
    isNew: !existing,
  };

  syncLink();
  growNote();
  lagValue.textContent = form.lag ? `+${fmtDur(form.lag)}` : 'нет';
  for (const button of presetButtons) button.classList.toggle('is-on', Number(button.dataset.minutes) === form.dur);
  refresh();
  timeline.revealTask(previewId, false);
  if (!existing && (!isTouch() || placement == null)) titleInput.focus({ preventScroll: true });
}
