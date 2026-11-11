// Все изменения плана. Функции меняют переданный черновик документа.

import { computePlan, mergeSegments, remainingOf, totalMinutes } from './plan.js';
import { MINUTE, STEP, clamp, roundTo } from './time.js';

function others(doc, id) {
  return doc.plan.order.filter((x) => x !== id);
}

function recordWork(task, segments) {
  if (!segments.length) return;
  task.history = mergeSegments([...(task.history ?? []), ...segments]);
  task.spent = (task.spent || 0) + totalMinutes(segments);
}

// Первая задача перестаёт быть первой: то, что уже отработано, остаётся на графике,
// а новый отсчёт начинается с текущего момента.
function freezeFirst(doc, now) {
  const firstId = doc.plan.order[0];
  if (firstId) {
    const plan = computePlan(doc, now);
    const item = plan.items[0];
    if (item && item.start < now) {
      recordWork(doc.tasks[firstId], plan.clock.slice(item.start, now));
      doc.tasks[firstId].lag = 0;
    }
  }
  doc.plan.anchor = now;
}

function detach(doc, id, now) {
  const at = doc.plan.order.indexOf(id);
  if (at < 0) return;
  if (at === 0) freezeFirst(doc, now);
  doc.plan.order = others(doc, id);
}

function insert(doc, id, index, now, lag = 0) {
  const task = doc.tasks[id];
  const current = doc.plan.order;
  const next = others(doc, id);
  next.splice(clamp(index, 0, next.length), 0, id);
  const unchanged = task.status === 'queue' && task.pinAt == null && next.join() === current.join();
  if (unchanged && lag === 0) return;

  if (!current.length) doc.plan.anchor = now;
  else if (next[0] !== current[0]) freezeFirst(doc, now);

  doc.plan.order = next;
  Object.assign(task, { status: 'queue', pinAt: null, doneAt: null, lag });

  // Новая задача сначала расходует запас следующей, и только потом сдвигает её.
  const follower = doc.tasks[next[next.indexOf(id) + 1]];
  if (follower?.lag > 0) follower.lag = Math.max(0, follower.lag - (lag + remainingOf(task)));
}

function placeAtMoment(doc, id, at, now) {
  detach(doc, id, now);
  const plan = computePlan(doc, now);
  const first = plan.items[0];
  if (first && at <= now && first.start <= now) {
    insert(doc, id, 1, now);
    return;
  }
  let index = 0;
  let prevEnd = now;
  for (const item of plan.items) {
    if (item.end <= at) {
      index += 1;
      prevEnd = item.end;
      continue;
    }
    if (item.start < at && item.end - at < at - item.start) {
      index += 1;
      prevEnd = item.end;
    }
    break;
  }
  const lag = prevEnd < at ? roundTo(plan.clock.between(prevEnd, at)) : 0;
  insert(doc, id, index, now, lag);
}

// Куда поставить задачу. Варианты: now, next, end, after, before, index, moment, pin, backlog, keep.
export function placeTask(doc, id, placement, now) {
  const task = doc.tasks[id];
  const rest = others(doc, id);
  switch (placement.kind) {
    case 'keep':
      return;
    case 'backlog':
      detach(doc, id, now);
      Object.assign(task, { status: 'backlog', pinAt: null, doneAt: null, lag: 0 });
      return;
    case 'pin':
      detach(doc, id, now);
      Object.assign(task, { status: 'queue', pinAt: placement.at, doneAt: null, lag: 0 });
      return;
    case 'now':
      if (doc.plan.order[0] === id) restartFirst(doc, now);
      else insert(doc, id, 0, now);
      return;
    case 'next':
      insert(doc, id, Math.min(1, rest.length), now);
      return;
    case 'end':
      insert(doc, id, rest.length, now);
      return;
    case 'after': {
      const at = rest.indexOf(placement.id);
      insert(doc, id, at < 0 ? rest.length : at + 1, now);
      return;
    }
    case 'before': {
      const at = rest.indexOf(placement.id);
      insert(doc, id, at < 0 ? rest.length : at, now);
      return;
    }
    case 'index':
      insert(doc, id, placement.index, now);
      return;
    case 'moment':
      placeAtMoment(doc, id, placement.at, now);
      return;
    default:
      throw new Error(`Неизвестное размещение: ${placement.kind}`);
  }
}

export function completeTask(doc, id, now, at = now) {
  const task = doc.tasks[id];
  const finished = Math.min(at, now);
  if (task.pinAt != null) {
    const end = task.pinAt + task.dur * MINUTE;
    if (task.pinAt < finished) recordWork(task, [[task.pinAt, Math.min(end, finished)]]);
  } else if (doc.plan.order[0] === id) {
    const plan = computePlan(doc, now);
    const item = plan.items[0];
    if (item && item.start < finished) recordWork(task, plan.clock.slice(item.start, finished));
    doc.plan.anchor = finished;
  }
  doc.plan.order = others(doc, id);
  Object.assign(task, { status: 'done', doneAt: finished, pinAt: null, lag: 0, label: '' });
}

export function deleteTask(doc, id, now) {
  detach(doc, id, now);
  doc.tasks[id].deleted = true;
}

// Работа над первой задачей ещё не начиналась: отсчёт идёт с этого момента.
export function restartFirst(doc, now) {
  const first = doc.tasks[doc.plan.order[0]];
  if (!first) return;
  first.lag = 0;
  doc.plan.anchor = now;
}

// Добавляет время. Если срок уже прошёл, прибавляем от текущего момента, а не от плановой даты.
export function extendTask(doc, id, minutes, now) {
  const task = doc.tasks[id];
  const plan = computePlan(doc, now);
  const item = plan.byId.get(id);
  if (item?.isOverdue) task.dur = (task.spent || 0) + plan.clock.between(item.start, now) + minutes;
  else task.dur += minutes;
}

export function setRemaining(doc, id, minutes) {
  const task = doc.tasks[id];
  task.dur = (task.spent || 0) + Math.max(STEP, minutes);
}

// Закреплённые события после их окончания считаются прошедшими.
export function settle(doc, now) {
  let changed = false;
  for (const task of Object.values(doc.tasks)) {
    if (task.deleted || task.status !== 'queue' || task.pinAt == null) continue;
    const end = task.pinAt + task.dur * MINUTE;
    if (end > now) continue;
    task.history = mergeSegments([...(task.history ?? []), [task.pinAt, end]]);
    task.spent = task.dur;
    Object.assign(task, { status: 'done', doneAt: end, pinAt: null });
    changed = true;
  }
  return changed;
}

export function clearSamples(doc, now) {
  for (const task of Object.values(doc.tasks)) {
    if (task.sample) {
      doc.plan.order = others(doc, task.id);
      task.deleted = true;
    }
  }
  if (!doc.plan.order.length) doc.plan.anchor = now;
  doc.meta.sample = false;
}
