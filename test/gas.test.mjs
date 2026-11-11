import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeSheet, FakeSpreadsheet, demoSpreadsheet, loadScript, monthSheet } from '../scripts/gas-fake.mjs';

const HEADER = 7;

function november(book) {
  return book.getSheetByName('ноябрь');
}

test('скрипт называет таблицу и листы, где есть шапка с «Описанием»', () => {
  const info = loadScript(demoSpreadsheet()).get();
  assert.equal(info.ok, true);
  assert.equal(info.app, 'potok');
  assert.equal(info.title, 'Учебная таблица');
  assert.deepEqual(info.tabs.map((t) => t.name), ['октябрь', 'ноябрь']);
});

test('строки читаются по названиям столбцов, пустые заготовки пропускаются', () => {
  const data = loadScript(demoSpreadsheet()).get({ action: 'rows', tab: 'ноябрь' });
  assert.equal(data.ok, true);
  assert.equal(data.rows.length, 6);
  assert.deepEqual(data.statuses, ['ждёт', 'у меня', 'на переводе', 'нужна инфа', 'готово']);
  assert.deepEqual(data.loads, ['Малая', 'Средняя', 'Большая', 'Очень большая']);
  assert.deepEqual(data.rows[0], {
    r: HEADER + 1,
    date: '02.11',
    dateShown: '02.11',
    status: 'готово',
    text: '[DEMO-101] Сайт: обновить страницу контактов',
    load: 'Средняя',
    sp: null,
    h: null,
    m: null,
    link: '',
  });
  assert.equal(data.rows[1].link, 'https://tracker.example.com/DEMO-102', 'ссылка, спрятанная в тексте описания');
  assert.equal(data.rows[3].link, 'https://tracker.example.com/DEMO-104', 'адрес в столбце «Ссылка»');
  assert.equal(data.rows[5].text, 'Созвон с командой\nСверить планы на неделю');
});

test('настоящие даты приходят с годом, время и SP числами', () => {
  const sheet = monthSheet('ноябрь', [
    { date: new Date(2026, 10, 5), status: 'готово', text: 'С датой', load: 'Малая', sp: '— 9 sp', h: 2, m: 15 },
  ]);
  const data = loadScript(new FakeSpreadsheet('Т', [sheet])).get({ action: 'rows', tab: 'ноябрь' });
  assert.equal(data.rows[0].date, '2026-11-05');
  assert.equal(data.rows[0].dateShown, '05.11');
  assert.deepEqual([data.rows[0].sp, data.rows[0].h, data.rows[0].m], [9, 2, 15]);
});

test('столбцы можно переставить, статус берётся из «Статуса», если он есть', () => {
  const sheet = new FakeSheet('июль', [
    [],
    ['Дата', 'Задача', 'Статус', 'Описание', 'sp', 'ч.', 'м.', 'Ссылка'],
    ['', '', '', '', 552],
    ['02.07.2026', 'Обучение', 'В работе', 'Вводный курс', '— 19 sp', 4, 45, 'https://tracker.example.com/1'],
  ]);
  const data = loadScript(new FakeSpreadsheet('Т', [sheet])).get({ action: 'rows', tab: 'июль' });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].status, 'В работе');
  assert.equal(data.rows[0].sp, 19);
  assert.equal(data.rows[0].link, 'https://tracker.example.com/1');
});

test('понятные ошибки: нет листа, нет шапки, неизвестное действие', () => {
  const script = loadScript(demoSpreadsheet());
  assert.match(script.get({ action: 'rows', tab: 'декабрь' }).error, /нет листа «декабрь»/);
  assert.match(script.get({ action: 'rows', tab: 'заметки' }).error, /нет шапки/);
  const bad = script.post({ action: 'drop' });
  assert.equal(bad.ok, false);
  assert.equal(bad.app, 'potok');
});

test('новые строки встают в заготовки под последней задачей и не задевают остальное', () => {
  const book = demoSpreadsheet();
  const script = loadScript(book);
  const before = november(book).dump();
  const result = script.post({
    action: 'write',
    tab: 'ноябрь',
    add: [
      { id: 'a', date: '2026-11-09', status: 'готово', text: 'Новая из Потока', load: 'Малая', link: 'https://tracker.example.com/9' },
      { id: 'b', date: '2026-11-10', status: '', text: 'Ещё одна', load: 'Средняя', link: '' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, [{ id: 'a', r: HEADER + 7, status: 'готово' }, { id: 'b', r: HEADER + 8, status: 'ждёт' }]);
  const after = november(book).dump();
  assert.deepEqual(after.slice(0, HEADER + 6), before.slice(0, HEADER + 6), 'существующие строки не изменились');
  assert.deepEqual(after[HEADER + 6].slice(0, 8), ['09.11', 'готово', 'Новая из Потока', 'Малая', '', '', '', 'https://tracker.example.com/9']);
  assert.deepEqual(after[HEADER + 7].slice(0, 4), ['10.11', 'ждёт', 'Ещё одна', 'Средняя'], 'без своего статуса остаётся статус заготовки');
});

test('когда заготовки кончились, лист растёт, а новые строки получают вид и списки строки выше', () => {
  const book = new FakeSpreadsheet('Т', [monthSheet('ноябрь', [{ date: '02.11', status: 'ждёт', text: 'Первая', load: 'Малая' }], { blanks: 1, maxRows: HEADER + 2 })]);
  const script = loadScript(book);
  const add = ['x', 'y', 'z'].map((id) => ({ id, date: '2026-11-12', status: 'готово', text: `Задача ${id}`, load: 'Большая' }));
  const result = script.post({ action: 'write', tab: 'ноябрь', add });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.added.map((a) => a.r), [HEADER + 2, HEADER + 3, HEADER + 4]);
  const sheet = november(book);
  assert.equal(sheet.getMaxRows(), HEADER + 4);
  assert.equal(sheet.cell(HEADER + 4, 2).format, 'row');
  assert.deepEqual(sheet.cell(HEADER + 4, 4).list, ['Малая', 'Средняя', 'Большая', 'Очень большая']);
  assert.deepEqual(sheet.dump()[HEADER + 3].slice(0, 4), ['12.11', 'готово', 'Задача z', 'Большая']);
});

test('в пустом листе первая строка встаёт сразу под шапкой', () => {
  const book = new FakeSpreadsheet('Т', [monthSheet('декабрь', [], { blanks: 2 })]);
  const result = loadScript(book).post({ action: 'write', tab: 'декабрь', add: [{ id: 'a', date: '2026-12-01', status: '', text: 'Первая', load: 'Малая' }] });
  assert.deepEqual(result.added, [{ id: 'a', r: HEADER + 1, status: 'ждёт' }]);
  assert.deepEqual(book.getSheetByName('декабрь').dump()[HEADER].slice(0, 4), ['01.12', 'ждёт', 'Первая', 'Малая']);
});

test('дата пишется с годом, если так принято в листе; текст с «=» не становится формулой', () => {
  const sheet = monthSheet('июль', [{ date: '02.07.2026', status: 'готово', text: 'Старая', load: 'Малая' }], { blanks: 0 });
  const book = new FakeSpreadsheet('Т', [sheet]);
  loadScript(book).post({ action: 'write', tab: 'июль', add: [{ id: 'a', date: '2026-07-03', status: 'готово', text: '=2+2 проверить', load: 'Малая' }] });
  assert.deepEqual(sheet.dump()[HEADER + 1].slice(0, 3), ['03.07.2026', 'готово', "'=2+2 проверить"]);
});

test('статус меняется в нужной строке, даже если строки успели сдвинуться', () => {
  const book = demoSpreadsheet();
  const script = loadScript(book);
  const result = script.post({
    action: 'write',
    tab: 'ноябрь',
    set: [
      { id: 't1', r: HEADER + 2, text: '[DEMO-105] Инструкция для новых сотрудников', status: 'готово' },
      { id: 't2', r: HEADER + 3, text: '[DEMO-103]   баннер для главной страницы', status: 'у меня', link: 'https://tracker.example.com/DEMO-103' },
      { id: 't3', r: HEADER + 4, text: '[DEMO-104] Отчёт: новое название', status: 'готово', link: 'https://example.com/other' },
      { id: 't4', r: HEADER + 1, text: 'Такой строки нет', status: 'готово' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.updated.map((u) => [u.id, u.r, u.status]), [['t1', HEADER + 5, 'готово'], ['t2', HEADER + 3, 'у меня'], ['t3', HEADER + 4, 'готово']]);
  assert.deepEqual(result.missing, ['t4']);
  const rows = november(book).dump();
  assert.equal(rows[HEADER + 4][1], 'готово', 'нашли по тексту, а не по устаревшему номеру строки');
  assert.equal(rows[HEADER + 1][1], 'на переводе', 'строку с устаревшим номером не тронули');
  assert.deepEqual([rows[HEADER + 2][1], rows[HEADER + 2][7]], ['у меня', 'https://tracker.example.com/DEMO-103']);
  assert.deepEqual([rows[HEADER + 3][1], rows[HEADER + 3][7]], ['готово', 'https://tracker.example.com/DEMO-104'], 'нашли по номеру задачи, чужую ссылку не затёрли');
  assert.equal(rows[HEADER][1], 'готово');
});

test('пробный прогон ничего не пишет, но показывает, куда встанут строки', () => {
  const book = demoSpreadsheet();
  const before = november(book).dump();
  const result = loadScript(book).post({
    action: 'write',
    tab: 'ноябрь',
    dry: true,
    add: [{ id: 'a', date: '2026-11-09', status: 'готово', text: 'Проба', load: 'Малая' }],
    set: [{ id: 't1', r: HEADER + 5, text: '[DEMO-105] Инструкция для новых сотрудников', status: 'готово' }],
  });
  assert.equal(result.dry, true);
  assert.deepEqual(result.added, [{ id: 'a', r: HEADER + 7, status: 'готово' }]);
  assert.deepEqual(result.updated.map((u) => u.r), [HEADER + 5]);
  assert.deepEqual(november(book).dump(), before);
});

test('значение не из выпадающего списка даёт ошибку, а не портит лист молча', () => {
  const book = demoSpreadsheet();
  const result = loadScript(book).post({ action: 'write', tab: 'ноябрь', set: [{ id: 't', r: HEADER + 5, text: '[DEMO-105] Инструкция для новых сотрудников', status: 'в отпуске' }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /выпадающий список/);
});
