// Документ с данными: задачи, порядок, настройки. Его же синхронизируем между устройствами.
// У каждой сущности есть отметка u — время последнего изменения. При слиянии побеждает более свежая.

import { defaultWeek } from './calendar.js';
import { MINUTE } from './time.js';

export const SCHEMA = 1;
export const COLORS = ['sky', 'coral', 'lav', 'mint', 'sun', 'rose', 'olive', 'slate'];
const TOMBSTONE_TTL = 120 * 24 * 60 * MINUTE;

export const clone = (value) => JSON.parse(JSON.stringify(value));

export function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createDoc() {
  return {
    schema: SCHEMA,
    tasks: {},
    plan: { order: [], anchor: null, u: 0 },
    settings: { week: defaultWeek(), holidays: true, u: 0 },
    days: {},
    table: { url: '', u: 0 }, // адрес скрипта Google Таблицы, см. core/table.js
    meta: { sample: false },
  };
}

export function createTask(fields, now) {
  return {
    id: newId(),
    title: '',
    note: '',
    link: '',
    dur: 60, // оценка, минуты рабочего времени
    spent: 0, // уже отработано до прерывания
    lag: 0, // запас перед стартом: на сколько рабочих минут отложено начало
    color: COLORS[0],
    deadline: null,
    status: 'backlog', // 'queue' — на графике, 'backlog' — без даты, 'done' — готово
    pinAt: null, // начало, если задача закреплена на точное время
    label: '', // статус словами таблицы, если задача ждёт кого-то: «на переводе», «нужна инфа»
    sheet: null, // строка в Google Таблице: { tab, text, status } на момент последнего обмена
    history: [], // отрезки, которые уже прошли
    createdAt: now,
    doneAt: null,
    u: 0,
    ...fields,
  };
}

export function nextColor(doc) {
  const active = Object.values(doc.tasks).filter((t) => !t.deleted && t.status !== 'done');
  const uses = new Map(COLORS.map((c) => [c, 0]));
  for (const task of active) uses.set(task.color, (uses.get(task.color) ?? 0) + 1);
  const lastId = doc.plan.order[doc.plan.order.length - 1];
  const last = lastId ? doc.tasks[lastId]?.color : null;
  let best = COLORS.find((c) => c !== last);
  for (const color of COLORS) {
    if (color !== last && uses.get(color) < uses.get(best)) best = color;
  }
  return best;
}

// Приводит порядок в соответствие со статусами задач.
export function normalize(doc) {
  const { tasks, plan } = doc;
  if (!doc.table) doc.table = { url: '', u: 0 };
  const seen = new Set();
  const order = plan.order.filter((id) => {
    const task = tasks[id];
    if (!task || task.deleted || task.status !== 'queue' || task.pinAt != null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const missing = Object.values(tasks)
    .filter((t) => !t.deleted && t.status === 'queue' && t.pinAt == null && !seen.has(t.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => t.id);
  plan.order = [...order, ...missing];
  return doc;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Проставляет время изменения всему, что отличается от предыдущей версии.
export function stamp(prev, next, at) {
  for (const id of Object.keys(next.tasks)) {
    if (!same(prev.tasks[id], next.tasks[id])) next.tasks[id].u = at;
  }
  for (const id of Object.keys(prev.tasks)) {
    if (!next.tasks[id]) next.tasks[id] = { ...prev.tasks[id], deleted: true, u: at };
  }
  for (const key of Object.keys(next.days)) {
    if (!same(prev.days[key], next.days[key])) next.days[key].u = at;
  }
  for (const key of Object.keys(prev.days)) {
    if (!next.days[key]) next.days[key] = { removed: true, u: at };
  }
  if (!same(prev.plan, next.plan)) next.plan.u = at;
  if (!same(prev.settings, next.settings)) next.settings.u = at;
  if (next.table && !same(prev.table, next.table)) next.table.u = at;
  return next;
}

function newest(a, b) {
  if (!a) return b;
  if (!b) return a;
  const diff = (b.u || 0) - (a.u || 0);
  if (diff) return diff > 0 ? b : a;
  // При одинаковом времени выбор должен совпасть на всех устройствах, иначе они будут перезаписывать друг друга.
  return canon(b) > canon(a) ? b : a;
}

export function merge(local, remote, at = Date.now()) {
  const out = clone(local);
  for (const id of new Set([...Object.keys(local.tasks), ...Object.keys(remote.tasks)])) {
    out.tasks[id] = clone(newest(local.tasks[id], remote.tasks[id]));
    if (out.tasks[id].deleted && at - (out.tasks[id].u || 0) > TOMBSTONE_TTL) delete out.tasks[id];
  }
  for (const key of new Set([...Object.keys(local.days), ...Object.keys(remote.days)])) {
    out.days[key] = clone(newest(local.days[key], remote.days[key]));
  }
  out.plan = clone(newest(local.plan, remote.plan));
  out.settings = clone(newest(local.settings, remote.settings));
  const table = newest(local.table, remote.table);
  if (table) out.table = clone(table);
  out.meta = { sample: Boolean(local.meta?.sample && remote.meta?.sample) };
  return normalize(out);
}

// Убирает примеры, чтобы при подключении к существующим данным они не смешались с настоящими.
export function withoutSamples(doc) {
  const out = clone(doc);
  for (const [id, task] of Object.entries(out.tasks)) {
    if (task.sample) delete out.tasks[id];
  }
  out.plan.order = out.plan.order.filter((id) => out.tasks[id]);
  out.plan.u = 0;
  out.settings.u = 0;
  out.meta.sample = false;
  return out;
}

// Каноничный вид без зависимости от порядка ключей: одинаковые данные дают одинаковую строку.
export function canon(value) {
  return JSON.stringify(sortKeys(value), null, 1);
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

export function isValidDoc(doc) {
  return Boolean(doc && doc.schema === SCHEMA && doc.tasks && doc.plan && doc.settings && doc.days);
}
