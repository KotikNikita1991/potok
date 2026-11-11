/**
 * «Поток» ↔ Google Таблица
 *
 * Этот файл даёт приложению «Поток» доступ к листам этой таблицы: читать строки
 * с задачами, дописывать новые строки и менять статус. Остальные файлы проекта
 * (например, SP-генератор) он не трогает. Столбцы SP, «Часы» и «Минуты» скрипт
 * не заполняет: их по-прежнему считает генератор.
 *
 * Установка, удобнее с компьютера:
 *   1. В таблице откройте «Расширения» → «Apps Script».
 *   2. Слева у списка файлов нажмите «+» → «Скрипт», назовите файл «Поток»,
 *      вставьте этот код целиком и сохраните (Ctrl+S).
 *   3. Справа вверху нажмите «Начать развертывание» → «Новое развертывание»,
 *      значок шестерёнки → «Веб-приложение».
 *        Запуск от имени: «Я»
 *        У кого есть доступ: «Все»
 *      Нажмите «Развернуть» и разрешите доступ к таблице.
 *   4. Скопируйте «URL веб-приложения» (заканчивается на /exec) и вставьте его
 *      в «Потоке»: значок таблицы вверху → «Подключить».
 *
 * Если код изменился: «Начать развертывание» → «Управление развертываниями» →
 * карандаш → Версия: «Новая версия» → «Развернуть». Ссылка останется прежней.
 *
 * Ссылку /exec держите при себе: по ней можно читать и дополнять листы с задачами.
 */

var POTOK_VERSION = 1;
var POTOK_HEADER_SCAN = 30; // в скольких верхних строках ищем шапку таблицы

function doGet(e) {
  return potokReply_(function () {
    var params = (e && e.parameter) || {};
    if (params.action === 'rows') return potokRows_(String(params.tab || ''));
    return potokInfo_();
  });
}

function doPost(e) {
  return potokReply_(function () {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'write') return potokWrite_(data);
    throw new Error('Неизвестное действие');
  });
}

function potokReply_(run) {
  var result;
  try {
    result = run();
    result.ok = true;
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  result.app = 'potok';
  result.v = POTOK_VERSION;
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Чтение ----------

function potokInfo_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = book.getSheets();
  var tabs = [];
  for (var i = 0; i < sheets.length; i++) {
    if (potokTable_(sheets[i])) tabs.push({ name: sheets[i].getName() });
  }
  return { title: book.getName(), url: book.getUrl(), tabs: tabs };
}

function potokRows_(name) {
  var table = potokOpen_(name);
  return {
    tab: name,
    statuses: potokChoices_(table, table.cols.status),
    loads: potokChoices_(table, table.cols.load),
    rows: potokRead_(table),
  };
}

function potokOpen_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('В таблице нет листа «' + name + '»');
  var table = potokTable_(sheet);
  if (!table) throw new Error('На листе «' + name + '» нет шапки со столбцом «Описание»');
  return table;
}

// Находит шапку: строку, где есть ячейка «Описание». Столбцы определяются по названиям,
// поэтому их можно менять местами и добавлять свои.
function potokTable_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  var scan = Math.min(lastRow, POTOK_HEADER_SCAN);
  var top = sheet.getRange(1, 1, scan, lastCol).getDisplayValues();
  for (var r = 0; r < scan; r++) {
    var cols = potokColumns_(top[r]);
    if (cols) return { sheet: sheet, header: r + 1, cols: cols, lastRow: lastRow, lastCol: lastCol };
  }
  return null;
}

function potokColumns_(cells) {
  var names = [];
  for (var i = 0; i < cells.length; i++) names.push(String(cells[i]).trim().toLowerCase());
  var find = function (aliases) {
    for (var a = 0; a < aliases.length; a++) {
      var at = names.indexOf(aliases[a]);
      if (at >= 0) return at;
    }
    return -1;
  };
  var text = find(['описание']);
  if (text < 0) return null;
  var status = find(['статус']);
  if (status < 0) status = find(['задача']);
  return {
    date: find(['дата']),
    status: status,
    text: text,
    load: find(['нагрузка']),
    sp: find(['sp', 'сп']),
    hours: find(['часы', 'ч.', 'ч']),
    minutes: find(['минуты', 'м.', 'м', 'мин']),
    link: find(['ссылка', 'ссылки']),
  };
}

// Строки с задачами: всё, что ниже шапки и где заполнено «Описание».
function potokRead_(table) {
  var count = table.lastRow - table.header;
  if (count <= 0) return [];
  var range = table.sheet.getRange(table.header + 1, 1, count, table.lastCol);
  var values = range.getValues();
  var shown = range.getDisplayValues();
  var formulas = range.getFormulas();
  var rich = range.getRichTextValues();
  var zone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var c = table.cols;
  var rows = [];
  for (var i = 0; i < count; i++) {
    var text = potokCell_(shown[i], c.text);
    if (!text) continue;
    var dateShown = potokCell_(shown[i], c.date);
    rows.push({
      r: table.header + 1 + i,
      date: potokDate_(c.date < 0 ? '' : values[i][c.date], dateShown, zone),
      dateShown: dateShown,
      status: potokCell_(shown[i], c.status),
      text: text,
      load: potokCell_(shown[i], c.load),
      sp: potokNumber_(potokCell_(shown[i], c.sp)),
      h: potokNumber_(potokCell_(shown[i], c.hours)),
      m: potokNumber_(potokCell_(shown[i], c.minutes)),
      link: potokLink_(rich[i], formulas[i], shown[i], c.link, true) || potokLink_(rich[i], formulas[i], shown[i], c.text, false),
    });
  }
  return rows;
}

function potokCell_(row, col) {
  if (col < 0) return '';
  return String(row[col] == null ? '' : row[col]).trim();
}

function potokNumber_(text) {
  var found = /\d+(?:[.,]\d+)?/.exec(text);
  return found ? Number(found[0].replace(',', '.')) : null;
}

function potokDate_(value, shown, zone) {
  var isDate = Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
  return isDate ? Utilities.formatDate(value, zone, 'yyyy-MM-dd') : shown;
}

// Ссылка может быть вставлена в ячейку по-разному: как ссылка на тексте, формулой или просто адресом.
function potokLink_(richRow, formulaRow, shownRow, col, plainToo) {
  if (col < 0) return '';
  var url = '';
  var rich = richRow[col];
  if (rich) {
    url = rich.getLinkUrl() || '';
    if (!url) {
      var runs = rich.getRuns();
      for (var i = 0; i < runs.length && !url; i++) url = runs[i].getLinkUrl() || '';
    }
  }
  if (!url) {
    var formula = /HYPERLINK\(\s*"([^"]+)"/i.exec(formulaRow[col] || '');
    if (formula) url = formula[1];
  }
  if (!url && plainToo) {
    var plain = /https?:\/\/[^\s"<>]+/.exec(shownRow[col] || '');
    if (plain) url = plain[0];
  }
  return url;
}

// Варианты из выпадающего списка в первой строке под шапкой.
function potokChoices_(table, col) {
  if (col < 0) return [];
  try {
    var rule = table.sheet.getRange(table.header + 1, col + 1).getDataValidation();
    if (!rule) return [];
    var kinds = SpreadsheetApp.DataValidationCriteria;
    var type = rule.getCriteriaType();
    var args = rule.getCriteriaValues();
    var raw = [];
    if (type === kinds.VALUE_IN_LIST) {
      raw = args[0];
    } else if (type === kinds.VALUE_IN_RANGE) {
      var cells = args[0].getDisplayValues();
      for (var r = 0; r < cells.length; r++) raw = raw.concat(cells[r]);
    }
    var list = [];
    for (var i = 0; i < raw.length; i++) {
      var word = String(raw[i]).trim();
      if (word && list.indexOf(word) < 0) list.push(word);
    }
    return list;
  } catch (err) {
    return [];
  }
}

// ---------- Запись ----------

function potokWrite_(data) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Таблица сейчас занята, попробуйте ещё раз через минуту');
  try {
    var table = potokOpen_(String(data.tab || ''));
    var rows = potokRead_(table);
    var dry = data.dry === true; // пробный прогон: считаем, что изменится, но ничего не пишем
    var result = { tab: data.tab, dry: dry, updated: [], missing: [], added: [] };
    potokUpdate_(table, rows, data.set || [], dry, result);
    potokAppend_(table, rows, data.add || [], dry, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// Меняет статус и дописывает ссылку в уже существующих строках. Остальные ячейки не трогает.
function potokUpdate_(table, rows, items, dry, result) {
  var sheet = table.sheet;
  var c = table.cols;
  var taken = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var row = potokFind_(rows, item, taken);
    if (!row) {
      result.missing.push(item.id);
      continue;
    }
    taken[row.r] = true;
    if (!dry) {
      if (c.status >= 0 && typeof item.status === 'string' && item.status !== row.status) {
        sheet.getRange(row.r, c.status + 1).setValue(item.status);
      }
      if (c.link >= 0 && item.link && !row.link) {
        var cell = sheet.getRange(row.r, c.link + 1);
        if (String(cell.getDisplayValue()).trim() === '') cell.setValue(item.link);
      }
    }
    var status = typeof item.status === 'string' && c.status >= 0 ? item.status : row.status;
    result.updated.push({ id: item.id, r: row.r, text: row.text, status: status });
  }
}

// Строку ищем по тексту «Описания», а не только по номеру: за время между чтением
// и записью строки могли отсортировать или сдвинуть. Чужую строку так не испортить.
function potokFind_(rows, item, taken) {
  var want = potokNorm_(item.text);
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].r === item.r && !taken[rows[i].r] && potokNorm_(rows[i].text) === want) return rows[i];
  }
  for (i = 0; i < rows.length; i++) {
    if (!taken[rows[i].r] && potokNorm_(rows[i].text) === want) return rows[i];
  }
  var key = potokKey_(item.text);
  if (!key) return null;
  var found = null;
  for (i = 0; i < rows.length; i++) {
    if (taken[rows[i].r] || potokKey_(rows[i].text) !== key) continue;
    if (found) return null; // номер задачи встречается дважды, угадывать не будем
    found = rows[i];
  }
  return found;
}

function potokNorm_(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Номер задачи в квадратных скобках, например [ABC-123].
function potokKey_(text) {
  var found = /\[([^\[\]\s]+-\d+)\]/.exec(String(text == null ? '' : text));
  return found ? found[1].toUpperCase() : '';
}

// Дописывает новые строки сразу под последней заполненной, как при вводе руками.
function potokAppend_(table, rows, items, dry, result) {
  if (!items.length) return;
  var sheet = table.sheet;
  var c = table.cols;
  var last = potokLastUsed_(table);
  var start = last + 1;
  var end = start + items.length - 1;
  // В заготовленных строках статус уже может стоять по умолчанию; без своего значения его не стираем.
  var max = sheet.getMaxRows();
  var preset = c.status < 0 || start > max ? [] : sheet.getRange(start, c.status + 1, Math.min(end, max) - start + 1, 1).getValues();
  var statuses = [];
  for (var i = 0; i < items.length; i++) {
    var status = items[i].status || (preset[i] ? String(preset[i][0]) : '');
    statuses.push([status]);
    result.added.push({ id: items[i].id, r: start + i, status: status });
  }
  if (dry) return;

  if (end > max) sheet.insertRowsAfter(max, end - max);

  // Строкам ниже заполненной части нужен тот же вид и те же выпадающие списки, что у строки выше.
  var blankFrom = Math.max(start, table.lastRow + 1);
  if (last > table.header && blankFrom <= end) {
    var sample = sheet.getRange(last, 1, 1, table.lastCol);
    var target = sheet.getRange(blankFrom, 1, end - blankFrom + 1, table.lastCol);
    sample.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sample.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }

  var withYear = potokDatesWithYear_(rows);
  potokFill_(sheet, start, c.date, items, function (item) { return potokDateText_(item.date, withYear); });
  potokFill_(sheet, start, c.text, items, function (item) { return potokPlain_(item.text); });
  potokFill_(sheet, start, c.load, items, function (item) { return item.load; });
  potokFill_(sheet, start, c.link, items, function (item) { return item.link; });
  if (c.status >= 0) sheet.getRange(start, c.status + 1, items.length, 1).setValues(statuses);
}

// Последняя строка, где есть дата, описание, нагрузка или ссылка. Столбцы SP и времени
// не считаются: в них бывают формулы, протянутые далеко вниз.
function potokLastUsed_(table) {
  var count = table.lastRow - table.header;
  if (count <= 0) return table.header;
  var shown = table.sheet.getRange(table.header + 1, 1, count, table.lastCol).getDisplayValues();
  var c = table.cols;
  var cols = [c.date, c.text, c.load, c.link];
  for (var i = count - 1; i >= 0; i--) {
    for (var j = 0; j < cols.length; j++) {
      if (cols[j] >= 0 && String(shown[i][cols[j]]).trim() !== '') return table.header + 1 + i;
    }
  }
  return table.header;
}

function potokFill_(sheet, start, col, items, pick) {
  if (col < 0) return;
  var values = [];
  for (var i = 0; i < items.length; i++) {
    var value = pick(items[i]);
    values.push([value == null ? '' : value]);
  }
  sheet.getRange(start, col + 1, items.length, 1).setValues(values);
}

// Дату пишем так же, как её вводят руками: «05.11», а если в листе принято с годом, то «05.11.2026».
function potokDatesWithYear_(rows) {
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].dateShown) return /\d{4}/.test(rows[i].dateShown);
  }
  return false;
}

function potokDateText_(iso, withYear) {
  var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!parts) return '';
  return parts[3] + '.' + parts[2] + (withYear ? '.' + parts[1] : '');
}

// Текст, который начинается с «=» или «+», таблица приняла бы за формулу.
function potokPlain_(text) {
  var value = String(text == null ? '' : text);
  return /^[=+]/.test(value) ? "'" + value : value;
}
