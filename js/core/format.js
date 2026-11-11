// Русские подписи дат и длительностей.

import { shiftKey, toKey } from './time.js';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const DAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function fmtDur(minutes) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

// Понимает «2», «1,5», «2:30», «2ч 30м», «90 мин». Возвращает минуты или null.
export function parseDur(text) {
  const value = String(text).trim().toLowerCase().replace(',', '.');
  if (!value) return null;
  const clock = value.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const named = value.match(/^(?:(\d+(?:\.\d+)?)\s*ч[а-я]*)?\s*(?:(\d+)\s*м[а-я]*)?$/);
  if (named && (named[1] || named[2])) return Math.round(Number(named[1] || 0) * 60) + Number(named[2] || 0);
  const hours = Number(value);
  return Number.isFinite(hours) ? Math.round(hours * 60) : null;
}

export function fmtTime(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sameYear(t, now) {
  return new Date(t).getFullYear() === new Date(now).getFullYear();
}

export function fmtDay(t, now) {
  const d = new Date(t);
  const year = sameYear(t, now) ? '' : ` ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

// «сегодня в 15:30», «завтра в 11:00», «ср, 4 ноября в 11:00»
export function fmtMoment(t, now) {
  const key = toKey(t);
  const today = toKey(now);
  const time = fmtTime(t);
  if (key === today) return `сегодня в ${time}`;
  if (key === shiftKey(today, 1)) return `завтра в ${time}`;
  if (key === shiftKey(today, -1)) return `вчера в ${time}`;
  return `${fmtDay(t, now)} в ${time}`;
}

// Короткий вид для подписей на графике: «3 ноя 17:00», сегодня — просто «17:00».
export function fmtShort(t, now) {
  if (toKey(t) === toKey(now)) return fmtTime(t);
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${fmtTime(t)}`;
}

export function fmtShortDay(t) {
  const d = new Date(t);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function fmtDayTitle(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS_FULL[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

// Ссылка из поля задачи: дописывает https:// и пропускает только обычные веб-адреса.
export function safeLink(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}
