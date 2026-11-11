// Панель «Google Таблица»: подключение, загрузка задач из листа и выгрузка обратно.

import { fmtDur, plural } from '../core/format.js';
import { LOADS, MONTH_NAMES, applyExport, applyImport, currentTabs, defaultTab, exportPayload, fmtDayMonth, planExport, planImport, vocabOf } from '../core/table.js';
import { scriptUrl } from '../sync/table.js';
import { h, icon } from './dom.js';
import { menuItem, openMenu, toast } from './overlays.js';
import { openSheet } from './sheet.js';
import { readStorage, writeStorage } from './store.js';

const MODE_KEY = 'potok.table.mode';
const STATUS_KEY = 'potok.table.statuses';
const CODE_PATH = 'apps-script/potok.gs';
const DESTS = [
  ['queue', 'В очередь'],
  ['backlog', 'Без даты'],
  ['done', 'В готовые'],
  ['skip', 'Не загружать'],
];

// Статусы ожидания, которые встречались в таблице: подсказки для поля «Статус» в карточке задачи.
export function knownStatuses() {
  try {
    return JSON.parse(readStorage(STATUS_KEY)) ?? [];
  } catch {
    return [];
  }
}

const ofTasks = (n) => `${n} ${plural(n, 'задачи', 'задач', 'задач')}`;
const rowsWord = (n) => `${n} ${plural(n, 'строка', 'строки', 'строк')}`;

function importSummary(stats) {
  const added = stats.queue + stats.backlog + stats.done;
  const parts = [];
  if (added) {
    const where = [
      stats.queue ? `${stats.queue} в очередь` : '',
      stats.backlog ? `${stats.backlog} без даты` : '',
      stats.done ? `${stats.done} в готовые` : '',
    ].filter(Boolean).join(', ');
    parts.push(`Загружено: ${where}`);
  }
  if (stats.finished) parts.push(`Отмечено готовыми: ${stats.finished}`);
  if (stats.relabeled) parts.push(`Обновлено статусов: ${stats.relabeled}`);
  return `${parts.join('. ')}.`;
}

function exportSummary(result) {
  const parts = [];
  if (result.added.length) parts.push(`Новых строк: ${result.added.length}`);
  if (result.updated.length) parts.push(`Изменено строк: ${result.updated.length}`);
  if (result.missing.length) parts.push(`Не найдено строк: ${result.missing.length}`);
  return parts.length ? `Таблица обновлена. ${parts.join('. ')}.` : 'В таблице ничего не изменилось.';
}

export function openTableSheet(ctx) {
  const { store, table } = ctx;
  const body = h('div', { class: 'table-panel' });
  const state = {
    mode: readStorage(MODE_KEY) === 'export' ? 'export' : 'import',
    info: null,
    tab: null,
    data: null,
    incoming: null,
    outgoing: null,
    picks: null,
    loading: false,
    busy: false,
    error: '',
  };
  let closed = false;
  let requests = 0;
  let code = '';

  const linked = () => Boolean(store.doc.table?.url);
  const note = (text, kind = '') => h('div', { class: `x-note${kind ? ` is-${kind}` : ''}` }, text);
  const group = (title, count, rows, hint = '') => h('section', { class: 'x-group' },
    h('div', { class: 'x-head' }, title, h('span', null, String(count))),
    hint ? h('div', { class: 'x-hint' }, hint) : null,
    rows);

  // ---------- Код скрипта ----------

  const codeBox = h('textarea', { class: 'input code-box', readOnly: true, hidden: true, 'aria-label': 'Код скрипта' });

  fetch(CODE_PATH)
    .then((response) => (response.ok ? response.text() : ''))
    .then((text) => {
      code = text;
    })
    .catch(() => {});

  async function copyCode() {
    try {
      if (!code) code = await (await fetch(CODE_PATH)).text();
      await navigator.clipboard.writeText(code);
      toast('Код скопирован. Вставьте его в файл «Поток» в редакторе Apps Script.');
    } catch {
      // Буфер обмена недоступен: показываем код, чтобы его можно было выделить и скопировать руками.
      codeBox.value = code || 'Не получилось загрузить код. Он лежит в репозитории проекта: apps-script/potok.gs';
      codeBox.hidden = false;
      if (!body.contains(codeBox)) body.append(codeBox);
      codeBox.focus();
      codeBox.select();
    }
  }

  // ---------- Подключение ----------

  function renderSetup() {
    const problem = h('div', { class: 'x-note is-error', hidden: true, role: 'alert' });
    const input = h('input', {
      id: 'table-url',
      class: 'input',
      type: 'url',
      inputMode: 'url',
      autocapitalize: 'off',
      spellcheck: false,
      placeholder: 'https://script.google.com/macros/s/…/exec',
      'aria-label': 'Ссылка веб-приложения',
    });
    const fail = (message) => {
      problem.textContent = message;
      problem.hidden = false;
    };
    const connect = h('button', {
      class: 'btn btn-primary',
      type: 'button',
      onclick: async () => {
        const url = scriptUrl(input.value);
        if (!url) {
          fail('Нужна ссылка веб-приложения из развёртывания. Она начинается с https://script.google.com и заканчивается на /exec.');
          input.focus();
          return;
        }
        connect.disabled = true;
        connect.textContent = 'Проверяю…';
        try {
          state.info = await table.info(url);
          if (closed) return;
          store.commit((draft) => {
            draft.table = { url };
          }, { undo: false });
          toast(`Таблица «${state.info.title}» подключена`);
          load();
        } catch (error) {
          connect.disabled = false;
          connect.textContent = 'Подключить';
          fail(error.message);
        }
      },
    }, 'Подключить');

    body.replaceChildren(
      h('p', { class: 'set-note' }, 'Свяжите «Поток» с Google Таблицей, где ведётся список задач месяца. Задачи можно будет загружать из листа и выгружать обратно, чтобы потом посчитать SP.'),
      h('ol', { class: 'set-steps' },
        h('li', null, 'Откройте таблицу на компьютере и выберите «Расширения» → «Apps Script».'),
        h('li', null, 'Слева нажмите «+» → «Скрипт», назовите файл «Поток» и вставьте в него код. ',
          h('button', { class: 'btn btn-small btn-inline', type: 'button', onclick: copyCode }, icon('copy', 15), 'Скопировать код')),
        h('li', null, 'Нажмите «Начать развертывание» → «Новое развертывание» и выберите тип «Веб-приложение». Запуск от имени: «Я». У кого есть доступ: «Все». Нажмите «Развернуть» и разрешите доступ к таблице.'),
        h('li', null, 'Скопируйте «URL веб-приложения» и вставьте сюда.')),
      h('div', { class: 'link-row' }, input, connect),
      problem,
      codeBox,
    );
  }

  // ---------- Чтение таблицы ----------

  async function load() {
    if (!linked()) {
      render();
      return;
    }
    requests += 1;
    const ticket = requests;
    Object.assign(state, { loading: true, error: '' });
    render();
    try {
      if (!state.info) state.info = await table.info();
      const { tabs } = state.info;
      if (!tabs.some((tab) => tab.name === state.tab)) state.tab = defaultTab(tabs, store.now());
      if (!state.tab) throw new Error('В таблице нет листов с шапкой, в которой есть столбец «Описание».');
      const data = await table.rows(state.tab);
      if (closed || ticket !== requests) return;
      state.data = data;
      writeStorage(STATUS_KEY, JSON.stringify(vocabOf(data).blocked));
      rebuild();
    } catch (error) {
      if (closed || ticket !== requests) return;
      state.error = error.message;
    }
    state.loading = false;
    render();
  }

  // Кнопка «Прочитать заново»: перечитывает и список листов, вдруг появился новый.
  function reload() {
    state.info = null;
    load();
  }

  // Считает, что изменится в каждую сторону, и отмечает всё предложенное.
  function rebuild() {
    const { doc, plan, now } = store.base();
    const incoming = planImport(doc, state.tab, state.data, now);
    const outgoing = planExport(doc, plan, state.tab, state.data, now);
    Object.assign(state, {
      incoming,
      outgoing,
      picks: {
        dest: new Map(incoming.fresh.map((item) => [item.row.r, item.dest])),
        finish: new Set(incoming.finish.map((item) => item.task.id)),
        relabel: new Set(incoming.relabel.map((item) => item.task.id)),
        add: new Set(outgoing.add.map((item) => item.id)),
        set: new Set(outgoing.set.map((item) => item.id)),
        loads: new Map(),
      },
    });
  }

  // ---------- Списки ----------

  function checkRow(picked, id, title, sub, extra = null) {
    const box = h('input', {
      type: 'checkbox',
      checked: picked.has(id),
      onchange: () => {
        if (box.checked) picked.add(id);
        else picked.delete(id);
        row.classList.toggle('is-off', !box.checked);
        updatePrimary();
      },
    });
    const row = h('div', { class: `x-row${picked.has(id) ? '' : ' is-off'}` },
      h('label', { class: 'x-check' }, box,
        h('span', { class: 'x-text' }, h('span', { class: 'x-title' }, title || 'Без названия'), sub ? h('span', { class: 'x-sub' }, sub) : null)),
      extra);
    return row;
  }

  function freshRow(item) {
    const { dest } = state.picks;
    const select = h('select', {
      class: 'input x-select',
      'aria-label': `Куда загрузить «${item.title}»`,
      onchange: () => {
        dest.set(item.row.r, select.value);
        row.classList.toggle('is-off', select.value === 'skip');
        updatePrimary();
      },
    }, DESTS.map(([value, label]) => h('option', { value }, label)));
    select.value = dest.get(item.row.r);
    const time = item.row.load ? `${item.row.load}, ${fmtDur(item.minutes)}` : fmtDur(item.minutes);
    const row = h('div', { class: `x-row${select.value === 'skip' ? ' is-off' : ''}` },
      h('span', { class: 'x-text' },
        h('span', { class: 'x-title' }, item.title),
        h('span', { class: 'x-sub' }, [item.row.dateShown, item.row.status, time].filter(Boolean).join(' · '))),
      select);
    return row;
  }

  function importList() {
    const { incoming, picks, tab } = state;
    const parts = [];
    if (incoming.fresh.length) {
      parts.push(group('Новые строки в таблице', incoming.fresh.length, incoming.fresh.map(freshRow)));
    }
    if (incoming.finish.length) {
      parts.push(group('В таблице отмечены готовыми', incoming.finish.length,
        incoming.finish.map((item) => checkRow(picks.finish, item.task.id, item.task.title, 'Отметить готовой и в «Потоке»'))));
    }
    if (incoming.relabel.length) {
      parts.push(group('В таблице изменился статус', incoming.relabel.length,
        incoming.relabel.map((item) => checkRow(picks.relabel, item.task.id, item.task.title, `${item.task.label || 'без пометки'} → ${item.label || 'без пометки'}`))));
    }
    if (!parts.length) parts.push(note(`В листе «${tab}» нет ничего нового: все его строки уже есть в «Потоке».`));
    else if (incoming.linked.size) parts.push(note(`Уже в «Потоке»: ${rowsWord(incoming.linked.size)}.`));
    return parts;
  }

  function exportList() {
    const { outgoing, picks, tab } = state;
    const addRow = (item) => {
      const select = h('select', {
        class: 'input x-select',
        'aria-label': `Нагрузка для «${item.title}»`,
        onchange: () => picks.loads.set(item.id, select.value),
      }, LOADS.map((load) => h('option', { value: load.key }, outgoing.voc.loads[load.key])));
      select.value = picks.loads.get(item.id) ?? item.load;
      return checkRow(picks.add, item.id, item.title, [fmtDayMonth(item.date), item.status].filter(Boolean).join(' · '), select);
    };
    const changeText = (item) => [
      item.status != null ? `${item.from || 'без статуса'} → ${item.status}` : '',
      item.link ? 'добавить ссылку' : '',
    ].filter(Boolean).join(', ');

    const parts = [];
    if (outgoing.add.length) parts.push(group('Новые строки для таблицы', outgoing.add.length, outgoing.add.map(addRow)));
    if (outgoing.set.length) {
      parts.push(group('Обновить в таблице', outgoing.set.length,
        outgoing.set.map((item) => checkRow(picks.set, item.id, item.title, changeText(item)))));
    }
    if (outgoing.idle.length) {
      parts.push(group('Ещё не начаты', outgoing.idle.length, outgoing.idle.map(addRow), 'Заведены раньше этого месяца, и за них ещё не брались. Можно добавить в таблицу заранее.'));
    }
    if (!parts.length) parts.push(note(`В листе «${tab}» уже есть всё, что относится к этому месяцу в «Потоке».`));
    if (outgoing.behind) {
      parts.push(note(`В таблице поменяли статус у ${ofTasks(outgoing.behind)}. Эти строки «Поток» не трогает: сначала загрузите изменения из таблицы.`, 'warn'));
    }
    parts.push(note('Столбцы SP, «Часы» и «Минуты» остаются за SP-генератором. «Поток» ставит нагрузку по оценке времени, её можно поправить в списке.'));
    return parts;
  }

  // ---------- Экран ----------

  function count() {
    const { picks } = state;
    if (!picks || state.loading || state.error) return 0;
    if (state.mode === 'export') return picks.add.size + picks.set.size;
    return [...picks.dest.values()].filter((dest) => dest !== 'skip').length + picks.finish.size + picks.relabel.size;
  }

  function updatePrimary() {
    const total = count();
    primary.hidden = !linked();
    primary.disabled = state.busy || total === 0;
    primary.textContent = state.busy ? 'Минуту…' : `${state.mode === 'export' ? 'Выгрузить' : 'Загрузить'}${total ? ` · ${total}` : ''}`;
  }

  function modeButton(mode, label) {
    return h('button', {
      class: `mode-btn${state.mode === mode ? ' is-on' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': state.mode === mode ? 'true' : 'false',
      onclick: () => {
        state.mode = mode;
        writeStorage(MODE_KEY, mode);
        render();
      },
    }, label);
  }

  function renderLinked() {
    const { info } = state;
    const tabSelect = h('select', {
      id: 'table-tab',
      class: 'input',
      onchange: () => {
        state.tab = tabSelect.value;
        load();
      },
    }, (info?.tabs ?? []).map((tab) => h('option', { value: tab.name }, tab.name)));
    if (state.tab) tabSelect.value = state.tab;

    const more = h('button', {
      class: 'icon-btn',
      type: 'button',
      title: 'Ещё',
      'aria-label': 'Ещё',
      onclick: () => openMenu(more, [
        menuItem({ iconName: 'copy', label: 'Скопировать код скрипта', hint: 'если скрипт в таблице нужно обновить', run: copyCode }),
        menuItem({
          iconName: 'close',
          label: 'Отключить таблицу',
          hint: 'задачи останутся и в «Потоке», и в таблице',
          run: () => {
            store.commit((draft) => {
              draft.table = { url: '' };
            });
            Object.assign(state, { info: null, tab: null, data: null, picks: null });
            toast('Таблица отключена', {
              action: {
                label: 'Отменить',
                run: () => {
                  store.undo();
                  if (!closed) load();
                },
              },
            });
            render();
          },
        }),
      ]),
    }, icon('dots'));

    const title = info?.url
      ? h('a', { href: info.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, info.title), icon('external', 14))
      : h('span', null, info?.title ?? 'Google Таблица');

    let content;
    if (state.loading) content = note('Читаю таблицу…');
    else if (state.error) {
      content = h('div', { class: 'x-note is-error', role: 'alert' }, h('span', null, state.error),
        h('button', { class: 'btn btn-small', type: 'button', onclick: load }, 'Повторить'));
    } else if (!state.picks) content = note('Читаю таблицу…');
    else content = state.mode === 'export' ? exportList() : importList();

    // Начался новый месяц, а листа для него ещё нет: без подсказки легко выгрузить не туда.
    const monthName = MONTH_NAMES[new Date(store.now()).getMonth()];
    const noMonthTab = info && !state.loading && !currentTabs(info.tabs, store.now()).length
      ? note(`В таблице пока нет листа «${monthName}». Сделайте копию листа прошлого месяца, назовите её «${monthName}» и прочитайте таблицу заново.`, 'warn')
      : null;

    body.replaceChildren(
      h('div', { class: 'table-bar' },
        h('div', { class: 'table-name' }, title),
        info?.tabs.length ? h('label', { class: 'table-pick', for: 'table-tab' }, 'Лист', tabSelect) : null,
        h('button', { class: 'icon-btn', type: 'button', title: 'Прочитать таблицу заново', 'aria-label': 'Прочитать таблицу заново', onclick: reload }, icon('sync')),
        more),
      h('div', { class: 'modes', role: 'tablist' }, modeButton('import', 'Из таблицы в «Поток»'), modeButton('export', 'Из «Потока» в таблицу')),
      h('div', { class: 'x-list' }, noMonthTab, content),
    );
  }

  function render() {
    if (linked()) renderLinked();
    else renderSetup();
    updatePrimary();
  }

  // ---------- Действия ----------

  function runImport() {
    const { picks, tab, data } = state;
    let stats;
    store.commit((draft, now) => {
      // План пересчитывается по текущим данным: пока панель была открыта, задачи могли измениться.
      const planned = planImport(draft, tab, data, now);
      const dest = new Map(planned.fresh.map((item) => [item.row.r, picks.dest.get(item.row.r) ?? 'skip']));
      stats = applyImport(draft, tab, planned, { ...picks, dest }, now);
    });
    ctx.closeSheet();
    toast(importSummary(stats), { action: { label: 'Отменить', run: () => store.undo() }, timeout: 9000 });
  }

  async function runExport() {
    const { picks, tab, data } = state;
    const { doc, plan, now } = store.base();
    const payload = exportPayload(planExport(doc, plan, tab, data, now), picks);
    if (!payload.add.length && !payload.set.length) {
      load();
      return;
    }
    state.busy = true;
    updatePrimary();
    try {
      const result = await table.write(tab, payload);
      store.commit((draft) => applyExport(draft, tab, payload, result), { undo: false });
      ctx.closeSheet();
      toast(exportSummary(result), { timeout: 9000 });
    } catch (error) {
      state.busy = false;
      toast(error.message, { timeout: 10000 });
      if (!closed) load(); // часть строк могла записаться, перечитываем
    }
  }

  function run() {
    if (state.busy || !count()) return;
    if (state.mode === 'export') runExport();
    else runImport();
  }

  const sheet = openSheet(ctx, {
    title: 'Google Таблица',
    name: 'table',
    content: body,
    cancelLabel: 'Закрыть',
    primaryLabel: 'Загрузить',
    onPrimary: run,
    onClose: () => {
      closed = true;
    },
  });
  const primary = sheet.el.querySelector('.sheet-head .btn-primary');
  load();
}
