// Связь с Google Таблицей: как строки листа становятся задачами «Потока» и наоборот.
// В таблице одна строка — одна задача: дата, статус, описание, нагрузка, ссылка.
// SP в таблице считает генератор по нагрузке; 1 SP равен 15 минутам.

import { createTask, nextColor } from './doc.js';
import { safeLink } from './format.js';
import { completeTask, placeTask } from './ops.js';
import { STEP, atKey, roundTo, toKey } from './time.js';

export const SP_MINUTES = 15;
const DEFAULT_MINUTES = 120;

// Нагрузка в таблице и время в «Потоке». Границы повторяют то, сколько SP генератор
// обычно ставит каждой нагрузке; typical — середина этого диапазона.
export const LOADS = [
  { key: 'S', word: 'Малая', test: /мал/i, upTo: 135, typical: 90 },
  { key: 'M', word: 'Средняя', test: /средн/i, upTo: 285, typical: 210 },
  { key: 'L', word: 'Большая', test: /больш/i, upTo: 525, typical: 420 },
  { key: 'XL', word: 'Очень большая', test: /очень/i, upTo: Infinity, typical: 630 },
];

export function loadKeyOf(word) {
  const text = String(word ?? '');
  for (let i = LOADS.length - 1; i >= 0; i -= 1) {
    if (LOADS[i].test.test(text)) return LOADS[i].key;
  }
  return null;
}

export function loadKeyForMinutes(minutes) {
  return LOADS.find((load) => minutes <= load.upTo).key;
}

// Сколько времени заложить на задачу из таблицы: точное время, если оно уже посчитано, иначе по нагрузке.
export function minutesOfRow(row) {
  const exact = (row.h || 0) * 60 + (row.m || 0);
  const byLoad = LOADS.find((load) => load.key === loadKeyOf(row.load))?.typical;
  const minutes = exact || (row.sp || 0) * SP_MINUTES || byLoad || DEFAULT_MINUTES;
  return Math.max(STEP, roundTo(minutes));
}

// ---------- Статусы ----------

const DONE_WORDS = /^(готово|готов|готова|сделано|сделана|выполнено|выполнена|закрыто|закрыта|done)$/i;
const ACTIVE_WORDS = /^(у меня|в работе|делаю|в процессе|in progress)$/i;
const TODO_WORDS = /^(жд[её]т|в очереди|очередь|запланировано|в планах|новая|todo|to do)$/i;

// done — сделано, active — в работе, todo — ждёт своей очереди, open — статус не указан,
// blocked — всё остальное: задача ждёт кого-то другого («на переводе», «нужна инфа»).
export function statusClass(status) {
  const word = String(status ?? '').trim();
  if (!word) return 'open';
  if (DONE_WORDS.test(word)) return 'done';
  if (ACTIVE_WORDS.test(word)) return 'active';
  if (TODO_WORDS.test(word)) return 'todo';
  return 'blocked';
}

// Какими словами в этом листе называют готовое, текущее и ожидающее, и как называют нагрузки.
export function vocabOf({ statuses = [], loads = [], rows = [] } = {}) {
  const pool = [...new Set([...statuses, ...rows.map((row) => row.status).filter(Boolean)])];
  const free = statuses.length === 0; // выпадающего списка нет, можно писать свои слова
  const pick = (kind, fallback) => pool.find((word) => statusClass(word) === kind) ?? (free ? fallback : null);
  const loadWords = {};
  for (const load of LOADS) {
    loadWords[load.key] = [...loads, ...rows.map((row) => row.load)].find((word) => loadKeyOf(word) === load.key) ?? load.word;
  }
  return {
    done: pick('done', 'готово'),
    active: pick('active', null),
    todo: pick('todo', null),
    blocked: pool.filter((word) => statusClass(word) === 'blocked'),
    allowed: (word) => word != null && (free || statuses.includes(word)),
    loads: loadWords,
  };
}

// Статус задачи словами таблицы. null — в таблице нет подходящего слова.
export function statusFor(task, isCurrent, voc) {
  const word = task.status === 'done' ? voc.done : task.label || (isCurrent ? voc.active : null) || voc.todo;
  return voc.allowed(word) ? word : null;
}

// ---------- Даты и листы ----------

export const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTH_TESTS = [/январ/, /феврал/, /март/, /апрел/, /(^|[^а-яё])ма[йя]($|[^а-яё])/, /июн/, /июл/, /август/, /сентябр/, /октябр/, /ноябр/, /декабр/];
const pad = (n) => String(n).padStart(2, '0');

function nearestYear(month, now) {
  const thisYear = new Date(now).getFullYear();
  let best = thisYear;
  let gap = Infinity;
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    const distance = Math.abs(new Date(year, month, 15).getTime() - now);
    if (distance < gap) {
      gap = distance;
      best = year;
    }
  }
  return best;
}

// Месяц, которому посвящён лист: «ноябрь», «Декабрь 2026», «октябрь (копия)».
export function monthOfTab(name, now) {
  const text = String(name ?? '').toLowerCase();
  const month = MONTH_TESTS.findIndex((test) => test.test(text));
  if (month < 0) return null;
  const stated = text.match(/20\d{2}/);
  const year = stated ? Number(stated[0]) : nearestYear(month, now);
  return { year, month, from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

// Листы, посвящённые текущему месяцу.
export function currentTabs(tabs, now) {
  const today = new Date(now);
  return tabs.filter((tab) => {
    const month = monthOfTab(tab.name, now);
    return month && month.month === today.getMonth() && month.year === today.getFullYear();
  });
}

// Лист текущего месяца; если такого нет, самый правый.
export function defaultTab(tabs, now) {
  const hits = currentTabs(tabs, now);
  const plain = hits.find((tab) => /^[а-яё]+$/i.test(tab.name.trim()));
  return (plain ?? hits[hits.length - 1] ?? tabs[tabs.length - 1])?.name ?? null;
}

// Дата из ячейки: «2026-11-02», «02.11» или «02.07.2026». Возвращает ключ дня или null.
export function parseRowDate(raw, tabMonth, now) {
  const text = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const found = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?$/);
  if (!found) return null;
  const day = Number(found[1]);
  const month = Number(found[2]) - 1;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let year;
  if (found[3]) year = found[3].length === 2 ? 2000 + Number(found[3]) : Number(found[3]);
  else year = tabMonth && tabMonth.month === month ? tabMonth.year : nearestYear(month, now);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function fmtDayMonth(key) {
  return key ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : '';
}

// ---------- Соответствие строк и задач ----------

export function normText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Номер задачи в квадратных скобках, например [ABC-123]: он не меняется, даже если текст переписали.
export function trackerKey(text) {
  const found = String(text ?? '').match(/\[([^[\]\s]+-\d+)\]/);
  return found ? found[1].toUpperCase() : '';
}

export function splitText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { title: lines[0] ?? '', note: lines.slice(1).join('\n') };
}

const inMonth = (t, month) => t != null && (!month || (t >= month.from && t < month.to));
const byAge = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

function liveTasks(doc) {
  return Object.values(doc.tasks).filter((task) => !task.deleted && !task.sample).sort(byAge);
}

// Какая задача какой строке соответствует. Номера строк ненадёжны (лист могут отсортировать),
// поэтому сверяем текст: сначала тот, что был в таблице при прошлом обмене, потом номер задачи,
// потом название — на случай, если одну и ту же задачу завели и там, и тут.
export function matchRows(doc, tab, rows, now) {
  const month = monthOfTab(tab, now);
  const free = new Map(rows.map((row) => [row.r, row]));
  const linked = new Map();
  const tasks = liveTasks(doc);

  const take = (task, row) => {
    if (!row) return;
    free.delete(row.r);
    linked.set(task.id, row);
  };
  const byText = (text) => {
    const want = normText(text);
    if (!want) return null;
    for (const row of free.values()) {
      if (normText(row.text) === want) return row;
    }
    return null;
  };
  const byKey = (text) => {
    const key = trackerKey(text);
    if (!key) return null;
    const hits = [...free.values()].filter((row) => trackerKey(row.text) === key);
    return hits.length === 1 ? hits[0] : null;
  };

  const here = tasks.filter((task) => task.sheet?.tab === tab);
  for (const task of here) take(task, byText(task.sheet.text));
  for (const task of here) {
    if (!linked.has(task.id)) take(task, byKey(task.sheet.text));
  }
  for (const task of tasks) {
    if (linked.has(task.id)) continue;
    // Старые выполненные задачи не должны цепляться к одноимённым строкам нового месяца.
    if (task.status === 'done' && !(month && inMonth(task.doneAt, month))) continue;
    take(task, byText(task.title) ?? byKey(task.title));
  }
  return { linked, free: [...free.values()], month };
}

// Статус в таблице изменили после прошлого обмена. Для пары, которая ещё не обменивалась,
// считаем значимым только то, что в «Потоке» само не появится: «готово» и ожидание кого-то.
function sheetAhead(task, tab, row) {
  if (task.sheet?.tab === tab) return row.status !== task.sheet.status;
  const kind = statusClass(row.status);
  return kind === 'done' || kind === 'blocked';
}

// ---------- Из таблицы в «Поток» ----------

export function planImport(doc, tab, data, now) {
  const { linked, free, month } = matchRows(doc, tab, data.rows, now);
  const fresh = free.map((row) => {
    const kind = statusClass(row.status);
    return {
      row,
      kind,
      ...splitText(row.text),
      minutes: minutesOfRow(row),
      date: parseRowDate(row.date, month, now),
      label: kind === 'blocked' ? row.status : '',
      dest: kind === 'done' ? 'skip' : kind === 'blocked' ? 'backlog' : 'queue',
    };
  });

  const finish = [];
  const relabel = [];
  for (const [id, row] of linked) {
    const task = doc.tasks[id];
    if (task.status === 'done' || !sheetAhead(task, tab, row)) continue;
    const kind = statusClass(row.status);
    const label = kind === 'blocked' ? row.status : '';
    if (kind === 'done') finish.push({ task, row });
    else if ((task.label || '') !== label) relabel.push({ task, row, label });
  }
  return { fresh, finish, relabel, linked };
}

// picks: какие новые строки куда поставить (dest: queue | backlog | done) и какие изменения принять.
export function applyImport(draft, tab, planned, picks, now) {
  const stats = { queue: 0, backlog: 0, done: 0, finished: 0, relabeled: 0 };
  const rank = { active: 0, todo: 1, open: 1, blocked: 2, done: 3 };
  const chosen = planned.fresh
    .map((item) => ({ ...item, dest: picks.dest.get(item.row.r) ?? item.dest }))
    .filter((item) => item.dest !== 'skip');
  // В очередь сначала идёт то, что в таблице уже в работе, дальше по порядку строк.
  const queued = chosen.filter((item) => item.dest === 'queue').sort((a, b) => rank[a.kind] - rank[b.kind]);
  const rest = chosen.filter((item) => item.dest !== 'queue');

  for (const item of [...queued, ...rest]) {
    const task = createTask({
      title: item.title,
      note: item.note,
      link: item.row.link || '',
      dur: item.minutes,
      color: nextColor(draft),
      label: item.dest === 'done' ? '' : item.label,
      sheet: { tab, text: item.row.text, status: item.row.status },
    }, now);
    draft.tasks[task.id] = task;
    if (item.dest === 'queue') placeTask(draft, task.id, { kind: 'end' }, now);
    if (item.dest === 'done') Object.assign(task, { status: 'done', doneAt: item.date ? atKey(item.date, 12 * 60) : now });
    stats[item.dest] += 1;
  }

  for (const { task } of planned.finish) {
    if (!picks.finish.has(task.id)) continue;
    completeTask(draft, task.id, now);
    stats.finished += 1;
  }
  for (const { task, label } of planned.relabel) {
    if (!picks.relabel.has(task.id)) continue;
    draft.tasks[task.id].label = label;
    stats.relabeled += 1;
  }
  // Запоминаем, что сейчас стоит в таблице: по этому в следующий раз отличим свежие правки от старых.
  for (const [id, row] of planned.linked) {
    draft.tasks[id].sheet = { tab, text: row.text, status: row.status };
  }
  return stats;
}

// ---------- Из «Потока» в таблицу ----------

// Задача относится к месяцу листа, если в этом месяце её завели, делали или закрыли.
function belongs(task, month, isCurrent, now) {
  if (task.status === 'done') return inMonth(task.doneAt, month);
  if (!month || inMonth(task.createdAt, month)) return true;
  if ((task.history ?? []).some(([s, e]) => e > month.from && s < month.to)) return true;
  return isCurrent && inMonth(now, month);
}

// Дата для новой строки: день, когда задача появилась; для перешедших из прошлого месяца —
// день, когда за неё взялись в этом, либо первый рабочий день месяца.
function exportDate(task, month, plan, now) {
  const moments = [task.createdAt, ...(task.history ?? []).map(([s]) => s), task.doneAt, now];
  const hit = moments.find((t) => inMonth(t, month));
  return toKey(hit ?? plan.clock.next(month.from) ?? month.from);
}

export function planExport(doc, plan, tab, data, now) {
  const voc = vocabOf(data);
  const { linked, month } = matchRows(doc, tab, data.rows, now);
  const currentId = plan.items[0]?.isCurrent ? plan.items[0].id : null;
  const out = { add: [], idle: [], set: [], behind: 0, voc, linked };

  for (const task of liveTasks(doc)) {
    const isCurrent = task.id === currentId;
    const status = statusFor(task, isCurrent, voc);
    const link = safeLink(task.link) ?? '';
    const row = linked.get(task.id);

    if (row) {
      const change = { id: task.id, title: task.title, r: row.r, text: row.text, from: row.status };
      if (status != null && status !== row.status) {
        // Свежую правку в таблице не затираем: её сначала нужно загрузить в «Поток».
        if (sheetAhead(task, tab, row)) out.behind += 1;
        else change.status = status;
      }
      if (link && !row.link) change.link = link;
      if (change.status != null || change.link) out.set.push(change);
      continue;
    }

    const item = {
      id: task.id,
      title: task.title,
      text: normTitle(task.title),
      date: exportDate(task, month, plan, now),
      status: status ?? '',
      load: loadKeyForMinutes(task.dur),
      link,
      done: task.status === 'done',
    };
    if (belongs(task, month, isCurrent, now)) out.add.push(item);
    // Незакрытые задачи прошлых месяцев можно добавить по желанию; заведённым позже в этом листе не место.
    else if (task.status !== 'done' && !(month && task.createdAt >= month.to)) out.idle.push(item);
  }
  return out;
}

function normTitle(title) {
  return String(title ?? '').replace(/\s+/g, ' ').trim();
}

// picks: какие строки добавить (add), какие изменения записать (set) и какую нагрузку поставить (loads).
export function exportPayload(planned, picks) {
  return {
    add: [...planned.add, ...planned.idle]
      .filter((item) => picks.add.has(item.id))
      .map((item) => ({
        id: item.id,
        date: item.date,
        status: item.status,
        text: item.text,
        load: planned.voc.loads[picks.loads.get(item.id) ?? item.load],
        link: item.link,
      })),
    set: planned.set
      .filter((item) => picks.set.has(item.id))
      .map((item) => ({
        id: item.id,
        r: item.r,
        text: item.text,
        ...(item.status != null ? { status: item.status } : {}),
        ...(item.link ? { link: item.link } : {}),
      })),
  };
}

// После записи запоминаем у каждой задачи её строку и статус, который теперь стоит в таблице.
export function applyExport(draft, tab, payload, result) {
  const texts = new Map(payload.add.map((item) => [item.id, item.text]));
  for (const { id, status } of result.added ?? []) {
    const task = draft.tasks[id];
    if (task && texts.has(id)) task.sheet = { tab, text: texts.get(id), status: status ?? '' };
  }
  for (const { id, text, status } of result.updated ?? []) {
    const task = draft.tasks[id];
    if (task) task.sheet = { tab, text, status: status ?? '' };
  }
}
