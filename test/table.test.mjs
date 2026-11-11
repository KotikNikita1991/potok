import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDoc, createTask, merge, normalize } from '../js/core/doc.js';
import { completeTask, placeTask } from '../js/core/ops.js';
import { computePlan } from '../js/core/plan.js';
import {
  applyExport,
  applyImport,
  defaultTab,
  exportPayload,
  loadKeyForMinutes,
  loadKeyOf,
  minutesOfRow,
  monthOfTab,
  parseRowDate,
  planExport,
  planImport,
  statusClass,
  trackerKey,
  vocabOf,
} from '../js/core/table.js';
import { atKey } from '../js/core/time.js';
import { demoSpreadsheet, loadScript } from '../scripts/gas-fake.mjs';

const TAB = 'ноябрь';
const NOW = atKey('2026-11-10', 10 * 60); // вторник, рабочее утро
const HOUR = 3600000;

function emptyDoc() {
  const doc = createDoc();
  doc.plan.anchor = NOW;
  return doc;
}

function rowsOf(script) {
  return script.get({ action: 'rows', tab: TAB });
}

function importAll(doc, data, now = NOW) {
  const planned = planImport(doc, TAB, data, now);
  const picks = {
    dest: new Map(),
    finish: new Set(planned.finish.map((item) => item.task.id)),
    relabel: new Set(planned.relabel.map((item) => item.task.id)),
  };
  const stats = applyImport(doc, TAB, planned, picks, now);
  normalize(doc);
  return { planned, stats };
}

function exportAll(doc, script, now = NOW) {
  const planned = planExport(doc, computePlan(doc, now), TAB, rowsOf(script), now);
  const picks = {
    add: new Set(planned.add.map((item) => item.id)),
    set: new Set(planned.set.map((item) => item.id)),
    loads: new Map(),
  };
  const payload = exportPayload(planned, picks);
  const result = script.post({ action: 'write', tab: TAB, ...payload });
  assert.equal(result.ok, true, result.error);
  applyExport(doc, TAB, payload, result);
  return { planned, payload, result };
}

const taskByTitle = (doc, start) => Object.values(doc.tasks).find((task) => task.title.startsWith(start));
const byTitle = (a, b) => (a[0] < b[0] ? -1 : 1);

test('нагрузка и время: границы совпадают с тем, что ставит генератор SP', () => {
  assert.deepEqual(['Малая', 'средняя', 'Большая', 'Очень большая', 'не знаю'].map(loadKeyOf), ['S', 'M', 'L', 'XL', null]);
  assert.deepEqual([45, 135, 150, 285, 300, 525, 540, 900].map(loadKeyForMinutes), ['S', 'S', 'M', 'M', 'L', 'L', 'XL', 'XL']);
  assert.equal(minutesOfRow({ h: 2, m: 15, sp: 9, load: 'Малая' }), 135, 'посчитанное время важнее нагрузки');
  assert.equal(minutesOfRow({ sp: 19, load: 'Средняя' }), 285, '1 SP = 15 минут');
  assert.equal(minutesOfRow({ load: 'Малая' }), 90);
  assert.equal(minutesOfRow({ load: 'Очень большая' }), 630);
  assert.equal(minutesOfRow({}), 120);
});

test('статусы таблицы делятся на готово, в работе, в очереди и ожидание других', () => {
  const kinds = ['готово', 'Готово', 'у меня', 'ждёт', 'ждет', 'на переводе', 'нужна инфа', '', 'готовлю ответ'].map(statusClass);
  assert.deepEqual(kinds, ['done', 'done', 'active', 'todo', 'todo', 'blocked', 'blocked', 'open', 'blocked']);

  const voc = vocabOf({ statuses: ['ждёт', 'у меня', 'на переводе', 'нужна инфа', 'готово'], loads: ['Малая', 'Средняя', 'Большая', 'Очень большая'], rows: [] });
  assert.deepEqual([voc.done, voc.active, voc.todo], ['готово', 'у меня', 'ждёт']);
  assert.deepEqual(voc.blocked, ['на переводе', 'нужна инфа']);
  assert.equal(voc.allowed('в отпуске'), false);

  const loose = vocabOf({ statuses: [], loads: [], rows: [{ status: 'Сделано', load: 'малая' }] });
  assert.equal(loose.done, 'Сделано', 'слово берётся из самих строк');
  assert.equal(loose.loads.S, 'малая');
  assert.equal(loose.loads.L, 'Большая');
  assert.equal(vocabOf({}).done, 'готово', 'без списка и без примеров пишем обычное слово');
  assert.equal(vocabOf({ statuses: ['в работе', 'пауза'] }).done, null, 'в строгом списке нет слова для готового');
});

test('месяц листа и даты строк', () => {
  const month = (name, now = NOW) => {
    const found = monthOfTab(name, now);
    return found ? [found.year, found.month] : null;
  };
  assert.deepEqual(month('ноябрь'), [2026, 10]);
  assert.deepEqual(month('октябрь (копия)'), [2026, 9]);
  assert.deepEqual(month('Май'), [2026, 4]);
  assert.deepEqual(month('март'), [2027, 2], 'ближайший к сегодняшнему дню март');
  assert.deepEqual(month('Декабрь 2025'), [2025, 11]);
  assert.equal(month('заметки'), null);
  assert.deepEqual(month('декабрь', atKey('2027-01-10')), [2026, 11]);

  const tabs = [{ name: 'октябрь (копия)' }, { name: 'октябрь' }, { name: 'ноябрь' }];
  assert.equal(defaultTab(tabs, NOW), 'ноябрь');
  assert.equal(defaultTab(tabs, atKey('2026-10-15')), 'октябрь');
  assert.equal(defaultTab(tabs, atKey('2026-12-02')), 'ноябрь', 'листа нового месяца ещё нет');
  assert.equal(defaultTab([], NOW), null);

  const november = monthOfTab('ноябрь', NOW);
  assert.equal(parseRowDate('02.11', november, NOW), '2026-11-02');
  assert.equal(parseRowDate('02.07.2026', november, NOW), '2026-07-02');
  assert.equal(parseRowDate('2026-11-05', november, NOW), '2026-11-05');
  assert.equal(parseRowDate('28.12', null, atKey('2027-01-10')), '2026-12-28');
  assert.equal(parseRowDate('скоро', november, NOW), null);

  assert.equal(trackerKey('[ABC-7] [срочно] Тексты для рассылки'), 'ABC-7');
  assert.equal(trackerKey('Без номера'), '');
});

test('загрузка: готовое пропускается, ожидающее других идёт без даты, остальное в очередь', () => {
  const data = rowsOf(loadScript(demoSpreadsheet()));
  const doc = emptyDoc();
  const planned = planImport(doc, TAB, data, NOW);
  assert.deepEqual(planned.fresh.map((item) => [item.row.status, item.dest, item.minutes]), [
    ['готово', 'skip', 210],
    ['на переводе', 'backlog', 210],
    ['нужна инфа', 'backlog', 210],
    ['у меня', 'queue', 420],
    ['ждёт', 'queue', 420],
    ['ждёт', 'queue', 90],
  ]);

  const { stats } = importAll(doc, data);
  assert.deepEqual(stats, { queue: 3, backlog: 2, done: 0, finished: 0, relabeled: 0 });
  assert.deepEqual(doc.plan.order.map((id) => doc.tasks[id].title), [
    '[DEMO-104] Отчёт по итогам квартала',
    '[DEMO-105] Инструкция для новых сотрудников',
    'Созвон с командой',
  ]);
  const parked = Object.values(doc.tasks).filter((task) => task.status === 'backlog');
  assert.deepEqual(parked.map((task) => task.label).sort(), ['на переводе', 'нужна инфа']);
  assert.equal(taskByTitle(doc, '[DEMO-104]').label, '', 'обычные статусы пометкой не становятся');
  assert.equal(taskByTitle(doc, '[DEMO-102]').link, 'https://tracker.example.com/DEMO-102');

  const call = taskByTitle(doc, 'Созвон');
  assert.equal(call.note, 'Сверить планы на неделю');
  assert.deepEqual(call.sheet, { tab: TAB, text: 'Созвон с командой\nСверить планы на неделю', status: 'ждёт' });
  assert.equal(computePlan(doc, NOW).items[0].start, NOW);
});

test('при загрузке можно поменять, куда пойдёт каждая строка', () => {
  const data = rowsOf(loadScript(demoSpreadsheet()));
  const doc = emptyDoc();
  const planned = planImport(doc, TAB, data, NOW);
  const dest = new Map([[8, 'done'], [9, 'queue'], [11, 'skip']]);
  const stats = applyImport(doc, TAB, planned, { dest, finish: new Set(), relabel: new Set() }, NOW);
  normalize(doc);
  assert.deepEqual(stats, { queue: 3, backlog: 1, done: 1, finished: 0, relabeled: 0 });
  const done = taskByTitle(doc, '[DEMO-101]');
  assert.equal(done.status, 'done');
  assert.equal(done.doneAt, atKey('2026-11-02', 12 * 60));
  assert.equal(taskByTitle(doc, '[DEMO-104]'), undefined);
  assert.equal(taskByTitle(doc, '[DEMO-102]').label, 'на переводе', 'пометка остаётся и в очереди');
  assert.equal(doc.tasks[doc.plan.order[2]].title.startsWith('[DEMO-102]'), true, 'ожидающая задача встаёт после обычных');
});

test('повторная загрузка: дублей нет, а правки в таблице распознаются', () => {
  const book = demoSpreadsheet();
  const script = loadScript(book);
  const doc = emptyDoc();
  importAll(doc, rowsOf(script));

  const again = planImport(doc, TAB, rowsOf(script), NOW);
  assert.deepEqual(again.fresh.map((item) => item.dest), ['skip'], 'осталась только готовая строка, которую не загружали');
  assert.equal(again.finish.length + again.relabel.length, 0);

  const sheet = book.getSheetByName(TAB);
  sheet.cell(9, 2).v = 'нужна инфа'; // была «на переводе»
  sheet.cell(9, 3).v = '[DEMO-102] Рассылка: письмо про новый тариф и оплату'; // текст переписали
  sheet.cell(12, 2).v = 'готово'; // закрыли прямо в таблице
  sheet.cell(13, 2).v = 'на переводе';
  const data = rowsOf(script);
  const planned = planImport(doc, TAB, data, NOW);
  assert.equal(planned.fresh.length, 1, 'переписанная строка узнана по номеру задачи');
  assert.deepEqual(planned.finish.map((item) => item.task.title), ['[DEMO-105] Инструкция для новых сотрудников']);
  assert.deepEqual(planned.relabel.map((item) => [item.task.title, item.label]).sort(byTitle), [
    ['[DEMO-102] Рассылка: письмо про новый тариф', 'нужна инфа'],
    ['Созвон с командой', 'на переводе'],
  ]);

  const { stats } = importAll(doc, data);
  assert.deepEqual([stats.finished, stats.relabeled], [1, 2]);
  assert.equal(taskByTitle(doc, '[DEMO-105]').status, 'done');
  assert.equal(taskByTitle(doc, 'Созвон').label, 'на переводе');

  // Готовая задача больше никого не ждёт.
  completeTask(doc, taskByTitle(doc, 'Созвон').id, NOW);
  assert.equal(taskByTitle(doc, 'Созвон').label, '');
  const settled = planImport(doc, TAB, data, NOW);
  assert.equal(settled.finish.length + settled.relabel.length, 0);
});

test('выгрузка: новые задачи становятся строками, статусы пишутся словами таблицы', () => {
  const book = demoSpreadsheet();
  const script = loadScript(book);
  const doc = emptyDoc();
  importAll(doc, rowsOf(script));

  // Срочная задача из «Потока»: сделана за час. Потом закрыта и та, что была в работе.
  const urgent = createTask({ title: 'Срочный   макет', dur: 300, link: 'tracker.example.com/M-1' }, NOW);
  doc.tasks[urgent.id] = urgent;
  placeTask(doc, urgent.id, { kind: 'now' }, NOW);
  completeTask(doc, urgent.id, NOW + HOUR);
  completeTask(doc, taskByTitle(doc, '[DEMO-104]').id, NOW + 1.5 * HOUR);
  normalize(doc);
  const now = NOW + 1.5 * HOUR;

  const { planned, result } = exportAll(doc, script, now);
  assert.deepEqual(planned.add.map((item) => [item.text, item.date, item.status, item.load, item.link]), [
    ['Срочный макет', '2026-11-10', 'готово', 'L', 'https://tracker.example.com/M-1'],
  ]);
  assert.deepEqual(planned.set.map((item) => [item.title, item.from, item.status]).sort(byTitle), [
    ['[DEMO-104] Отчёт по итогам квартала', 'у меня', 'готово'],
    ['[DEMO-105] Инструкция для новых сотрудников', 'ждёт', 'у меня'],
  ]);
  assert.deepEqual([planned.idle.length, planned.behind], [0, 0]);
  assert.deepEqual(result.added, [{ id: urgent.id, r: 14, status: 'готово' }]);

  const rows = book.getSheetByName(TAB).dump();
  assert.deepEqual(rows[13], ['10.11', 'готово', 'Срочный макет', 'Большая', '', '', '', 'https://tracker.example.com/M-1']);
  assert.deepEqual([rows[10][1], rows[11][1], rows[12][1]], ['готово', 'у меня', 'ждёт']);
  assert.deepEqual([rows[7][1], rows[8][1], rows[9][1]], ['готово', 'на переводе', 'нужна инфа'], 'чужие строки не тронуты');
  assert.deepEqual(doc.tasks[urgent.id].sheet, { tab: TAB, text: 'Срочный макет', status: 'готово' });

  const second = exportAll(doc, script, now);
  assert.deepEqual([second.planned.add.length, second.planned.set.length], [0, 0], 'повторная выгрузка ничего не меняет');
});

test('выгрузка не затирает свежую правку в таблице и не дублирует задачи, заведённые в двух местах', () => {
  const book = demoSpreadsheet();
  const script = loadScript(book);
  const doc = emptyDoc();
  importAll(doc, rowsOf(script));
  book.getSheetByName(TAB).cell(13, 2).v = 'нужна инфа'; // статус поменяли руками, в «Потоке» об этом ещё не знают

  const same = createTask({ title: '[demo-101] Сайт — страница контактов', status: 'done', doneAt: NOW - HOUR }, NOW);
  doc.tasks[same.id] = same;
  const planned = planExport(doc, computePlan(doc, NOW), TAB, rowsOf(script), NOW);
  assert.equal(planned.behind, 1);
  assert.deepEqual(planned.set, []);
  assert.deepEqual(planned.add, [], 'задача с тем же номером уже есть в таблице');
});

test('снятая в «Потоке» пометка и возвращённая в работу задача уходят в таблицу', () => {
  const book = demoSpreadsheet();
  const script = loadScript(book);
  const doc = emptyDoc();
  importAll(doc, rowsOf(script));
  const waiting = taskByTitle(doc, '[DEMO-103]');
  waiting.label = ''; // информация пришла
  placeTask(doc, waiting.id, { kind: 'end' }, NOW);
  const first = taskByTitle(doc, '[DEMO-104]');
  completeTask(doc, first.id, NOW + HOUR);
  normalize(doc);
  exportAll(doc, script, NOW + HOUR);
  let rows = book.getSheetByName(TAB).dump();
  assert.deepEqual([rows[9][1], rows[10][1]], ['ждёт', 'готово']);

  // Оказалось, что задача не доделана: после обеда её вернули в работу.
  placeTask(doc, first.id, { kind: 'now' }, NOW + 3 * HOUR);
  normalize(doc);
  exportAll(doc, script, NOW + 3 * HOUR);
  rows = book.getSheetByName(TAB).dump();
  assert.equal(rows[10][1], 'у меня', 'статус «готово» сняли, потому что его ставил сам «Поток»');
});

test('в выгрузку по умолчанию идут задачи этого месяца, старые нетронутые ждут отдельно', () => {
  const script = loadScript(demoSpreadsheet());
  const doc = emptyDoc();
  const october = atKey('2026-10-20', 10 * 60);
  const add = (fields, createdAt) => {
    const task = createTask(fields, createdAt);
    doc.tasks[task.id] = task;
    return task;
  };
  add({ title: 'Старая без движения', status: 'backlog' }, october);
  add({ title: 'Закрыта в октябре', status: 'done', doneAt: october + HOUR }, october);
  add({ title: 'Начата в октябре, продолжена в ноябре', status: 'backlog', history: [[october, october + HOUR], [atKey('2026-11-05', 9 * 60), atKey('2026-11-05', 11 * 60)]], spent: 180 }, october);
  add({ title: 'Перешла из октября и закрыта', status: 'done', doneAt: atKey('2026-11-03', 15 * 60) }, october);
  add({ title: 'Новая ноябрьская', status: 'backlog', dur: 630 }, atKey('2026-11-09', 9 * 60));
  add({ title: 'Пример', sample: true, status: 'backlog' }, NOW);
  normalize(doc);

  const planned = planExport(doc, computePlan(doc, NOW), TAB, rowsOf(script), NOW);
  assert.deepEqual(planned.add.map((item) => [item.title, item.date, item.status, item.load]).sort(byTitle), [
    ['Начата в октябре, продолжена в ноябре', '2026-11-05', 'ждёт', 'S'],
    ['Новая ноябрьская', '2026-11-09', 'ждёт', 'XL'],
    ['Перешла из октября и закрыта', '2026-11-03', 'готово', 'S'],
  ]);
  assert.deepEqual(planned.idle.map((item) => item.title), ['Старая без движения']);

  // В листе прошлого месяца нет места задачам, заведённым позже.
  const past = planExport(doc, computePlan(doc, NOW), 'октябрь', { rows: [], statuses: [], loads: [] }, NOW);
  assert.deepEqual(past.add.map((item) => item.title).sort(), ['Закрыта в октябре', 'Начата в октябре, продолжена в ноябре', 'Старая без движения']);
  assert.deepEqual(past.idle, []);

  const picks = { add: new Set([planned.idle[0].id]), set: new Set(), loads: new Map([[planned.idle[0].id, 'M']]) };
  const payload = exportPayload(planned, picks);
  assert.deepEqual(payload.add.map((item) => [item.text, item.date, item.load]), [['Старая без движения', '2026-11-10', 'Средняя']]);
});

test('адрес таблицы синхронизируется между устройствами', () => {
  const phone = createDoc();
  const laptop = createDoc();
  laptop.table = { url: 'https://script.google.com/macros/s/abc/exec', u: 500 };
  assert.equal(merge(phone, laptop, 1000).table.url, laptop.table.url);
  assert.equal(merge(laptop, phone, 1000).table.url, laptop.table.url);

  const old = createDoc();
  delete old.table; // данные, сохранённые прежней версией приложения
  assert.equal(merge(laptop, old, 1000).table.url, laptop.table.url);
  assert.deepEqual(merge(old, old, 1000).table, { url: '', u: 0 });
});
