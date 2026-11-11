// Упрощённая копия Google Apps Script, чтобы проверять apps-script/potok.gs без настоящей таблицы.
// Повторяет только то, чем пользуется скрипт: диапазоны, значения, ссылки, выпадающие списки.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = new URL('../apps-script/potok.gs', import.meta.url);
const pad = (n) => String(n).padStart(2, '0');

function display(value) {
  if (value instanceof Date) return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}`;
  return value == null ? '' : String(value);
}

// Ячейку можно задать значением или объектом { v, link, formula, list, format }.
function toCell(source) {
  if (source && typeof source === 'object' && !(source instanceof Date)) {
    return { v: source.v ?? '', link: source.link ?? null, formula: source.formula ?? '', list: source.list ?? null, format: source.format ?? null };
  }
  return { v: source ?? '', link: null, formula: '', list: null, format: null };
}

export class FakeSheet {
  constructor(name, grid, { maxRows } = {}) {
    this.name = name;
    this.rows = grid.map((row) => row.map(toCell));
    this.maxRows = maxRows ?? this.rows.length + 5;
  }

  cell(r, c) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push(toCell(''));
    return row[c - 1];
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    for (let r = this.rows.length; r >= 1; r -= 1) {
      if (this.rows[r - 1].some((cell) => display(cell.v) !== '')) return r;
    }
    return 0;
  }

  getLastColumn() {
    let last = 0;
    for (const row of this.rows) {
      row.forEach((cell, index) => {
        if (display(cell.v) !== '') last = Math.max(last, index + 1);
      });
    }
    return last;
  }

  getMaxRows() {
    return this.maxRows;
  }

  insertRowsAfter(position, count) {
    if (position !== this.maxRows) throw new Error('Проверочная таблица умеет добавлять строки только в конец');
    this.maxRows += count;
  }

  getRange(r, c, rowCount = 1, colCount = 1) {
    if (r < 1 || c < 1 || rowCount < 1 || colCount < 1 || r + rowCount - 1 > this.maxRows) {
      throw new Error(`Диапазон за пределами листа: строка ${r}, строк ${rowCount}`);
    }
    return new FakeRange(this, r, c, rowCount, colCount);
  }

  // Содержимое листа для проверок: отображаемый текст без пустых ячеек в конце строк.
  dump() {
    return this.rows.map((row) => {
      const shown = row.map((cell) => display(cell.v));
      while (shown.length && shown[shown.length - 1] === '') shown.pop();
      return shown;
    });
  }
}

class FakeRange {
  constructor(sheet, r, c, rowCount, colCount) {
    Object.assign(this, { sheet, r, c, rowCount, colCount });
  }

  map(fn) {
    const out = [];
    for (let i = 0; i < this.rowCount; i += 1) {
      const row = [];
      for (let j = 0; j < this.colCount; j += 1) row.push(fn(this.sheet.cell(this.r + i, this.c + j), i, j));
      out.push(row);
    }
    return out;
  }

  getValues() {
    return this.map((cell) => cell.v);
  }

  getDisplayValues() {
    return this.map((cell) => display(cell.v));
  }

  getDisplayValue() {
    return display(this.sheet.cell(this.r, this.c).v);
  }

  getFormulas() {
    return this.map((cell) => cell.formula);
  }

  // Как в настоящих таблицах: для чисел и дат форматированного текста нет.
  getRichTextValues() {
    return this.map((cell) => {
      if (typeof cell.v !== 'string') return null;
      const run = { getLinkUrl: () => cell.link, getText: () => cell.v };
      return { getLinkUrl: () => cell.link, getText: () => cell.v, getRuns: () => [run] };
    });
  }

  getDataValidation() {
    const { list } = this.sheet.cell(this.r, this.c);
    if (!list) return null;
    return { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [list, true] };
  }

  setValues(values) {
    if (values.length !== this.rowCount || values.some((row) => row.length !== this.colCount)) {
      throw new Error('Размер данных не совпадает с размером диапазона');
    }
    this.map((cell, i, j) => {
      const value = values[i][j];
      if (cell.list && value !== '' && !cell.list.includes(value)) {
        throw new Error(`Значение «${value}» не входит в выпадающий список`);
      }
      cell.v = value;
      cell.formula = '';
      cell.link = null;
    });
  }

  setValue(value) {
    this.setValues([[value]]);
  }

  copyTo(target, type) {
    target.map((cell, i, j) => {
      const source = this.sheet.cell(this.r + (i % this.rowCount), this.c + (j % this.colCount));
      if (type === 'PASTE_FORMAT') cell.format = source.format;
      if (type === 'PASTE_DATA_VALIDATION') cell.list = source.list;
    });
  }
}

export class FakeSpreadsheet {
  constructor(title, sheets) {
    this.title = title;
    this.sheets = sheets;
  }

  getName() {
    return this.title;
  }

  getUrl() {
    return 'https://docs.google.com/spreadsheets/d/example/edit';
  }

  getSheets() {
    return this.sheets;
  }

  getSheetByName(name) {
    return this.sheets.find((sheet) => sheet.name === name) ?? null;
  }

  getSpreadsheetTimeZone() {
    return 'Europe/Moscow';
  }
}

// Запускает potok.gs рядом с проверочной таблицей и отдаёт те же две точки входа, что и веб-приложение.
export function loadScript(spreadsheet) {
  const context = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', VALUE_IN_RANGE: 'VALUE_IN_RANGE' },
      CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT', PASTE_DATA_VALIDATION: 'PASTE_DATA_VALIDATION' },
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      formatDate: (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    },
  });
  vm.runInContext(readFileSync(SCRIPT, 'utf8'), context, { filename: 'potok.gs' });
  return {
    get: (parameter = {}) => JSON.parse(context.doGet({ parameter }).getContent()),
    post: (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
    raw: context,
  };
}

const STATUSES = ['ждёт', 'у меня', 'на переводе', 'нужна инфа', 'готово'];
const LOADS = ['Малая', 'Средняя', 'Большая', 'Очень большая'];

// Лист месяца в том же виде, что и настоящий: итоги сверху, шапка в седьмой строке,
// внизу несколько заготовленных строк со статусом по умолчанию.
export function monthSheet(name, tasks, { blanks = 3, maxRows } = {}) {
  const status = (v) => ({ v, list: STATUSES, format: 'row' });
  const load = (v) => ({ v, list: LOADS, format: 'row' });
  const grid = [
    [],
    ['', '', '', 'Цель', 480, 120],
    ['', '', '', '% выполнения', '0,00%'],
    ['', '', '', 'Разница', 480, 120],
    ['', '', '', 'Факт выполнения', 0, 0],
    [],
    ['Дата', 'Задача', 'Описание', 'Нагрузка', 'SP', 'Часы', 'Минуты', 'Ссылка'],
    ...tasks.map((t) => [
      { v: t.date ?? '', format: 'row' },
      status(t.status ?? ''),
      { v: t.text, link: t.textLink ?? null, format: 'row' },
      load(t.load ?? ''),
      t.sp ?? '',
      t.h ?? '',
      t.m ?? '',
      { v: t.link ?? '', link: t.linkUrl ?? null, format: 'row' },
    ]),
    ...Array.from({ length: blanks }, () => ['', status('ждёт'), '', load('')]),
  ];
  return new FakeSheet(name, grid, { maxRows });
}

export function demoSpreadsheet() {
  const november = monthSheet('ноябрь', [
    { date: '02.11', status: 'готово', text: '[DEMO-101] Сайт: обновить страницу контактов', load: 'Средняя' },
    { date: '02.11', status: 'на переводе', text: '[DEMO-102] Рассылка: письмо про новый тариф', load: 'Средняя', textLink: 'https://tracker.example.com/DEMO-102' },
    { date: '02.11', status: 'нужна инфа', text: '[DEMO-103] Баннер для главной страницы', load: 'Средняя' },
    { date: '05.11', status: 'у меня', text: '[DEMO-104] Отчёт по итогам квартала', load: 'Большая', link: 'https://tracker.example.com/DEMO-104' },
    { date: '06.11', status: 'ждёт', text: '[DEMO-105] Инструкция для новых сотрудников', load: 'Большая' },
    { date: '06.11', status: 'ждёт', text: 'Созвон с командой\nСверить планы на неделю', load: 'Малая' },
  ]);
  const october = monthSheet('октябрь', [
    { date: '01.10', status: '', text: '[DEMO-090] Прайс-лист на осень', load: 'Средняя', sp: 12, h: 3, m: 0 },
    { date: '02.10', status: '', text: '[DEMO-091] Каталог: описания товаров', load: 'Большая', sp: 27, h: 6, m: 45 },
  ], { blanks: 0 });
  const notes = new FakeSheet('заметки', [['Просто текст без таблицы']]);
  return new FakeSpreadsheet('Учебная таблица', [october, notes, november]);
}
