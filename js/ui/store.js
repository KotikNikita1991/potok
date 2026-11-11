// Состояние приложения: документ, предпросмотр изменений, отмена, сохранение на устройстве.

import { clearSamples, settle } from '../core/ops.js';
import { clone, isValidDoc, normalize, stamp } from '../core/doc.js';
import { computePlan } from '../core/plan.js';
import { sampleDoc } from '../core/sample.js';
import { MINUTE } from '../core/time.js';

const DOC_KEY = 'potok.doc.v1';
const UNDO_LIMIT = 60;

export function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим или переполнение: приложение продолжит работать до закрытия
  }
}

class Store {
  constructor() {
    this.listeners = new Set();
    this.changeListeners = new Set();
    this.preview = null;
    this.previewMeta = {};
    this.undoStack = [];
    this.lastCoalesce = null;
    this.clockOffset = 0;
    this.cache = {};
    this.doc = null;
  }

  init() {
    const debugNow = new URLSearchParams(location.search).get('now');
    if (debugNow && !Number.isNaN(Date.parse(debugNow))) this.clockOffset = Date.parse(debugNow) - Date.now();

    const raw = readStorage(DOC_KEY);
    let doc = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isValidDoc(parsed)) doc = parsed;
      } catch {
        doc = null;
      }
    }
    this.doc = normalize(doc ?? sampleDoc(this.now()));
    this.persist();
    this.settleTime();
  }

  now() {
    return Math.floor((Date.now() + this.clockOffset) / MINUTE) * MINUTE;
  }

  on(fn) {
    this.listeners.add(fn);
  }

  onLocalChange(fn) {
    this.changeListeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  persist() {
    writeStorage(DOC_KEY, JSON.stringify(this.doc));
  }

  planFor(slot, doc, now) {
    const cached = this.cache[slot];
    if (cached?.doc === doc && cached.now === now) return cached.plan;
    const plan = computePlan(doc, now);
    this.cache[slot] = { doc, now, plan };
    return plan;
  }

  // Сохранённое состояние, без предпросмотра.
  base() {
    const now = this.now();
    return { doc: this.doc, plan: this.planFor('base', this.doc, now), now };
  }

  // То, что сейчас показывает график: предпросмотр, если он есть.
  view() {
    if (!this.preview) return { ...this.base(), previewing: false };
    const now = this.now();
    return {
      doc: this.preview,
      plan: this.planFor('preview', this.preview, now),
      now,
      previewing: true,
      ...this.previewMeta,
    };
  }

  setPreview(doc, meta = {}) {
    this.preview = normalize(doc);
    this.previewMeta = meta;
    this.emit();
  }

  clearPreview() {
    if (!this.preview) return;
    this.preview = null;
    this.previewMeta = {};
    this.emit();
  }

  // Любое изменение проходит здесь. coalesce объединяет серию правок в один шаг отмены.
  commit(fn, { undo = true, coalesce = null } = {}) {
    const draft = clone(this.doc);
    const result = fn(draft, this.now());
    normalize(draft);
    stamp(this.doc, draft, Date.now());
    if (undo) {
      if (!coalesce || coalesce !== this.lastCoalesce) {
        this.undoStack.push(JSON.stringify(this.doc));
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      }
      this.lastCoalesce = coalesce;
    }
    this.doc = draft;
    this.preview = null;
    this.previewMeta = {};
    this.persist();
    for (const notify of this.changeListeners) notify();
    this.emit();
    return result;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  undo() {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    const next = normalize(JSON.parse(snapshot));
    stamp(this.doc, next, Date.now());
    this.doc = next;
    this.preview = null;
    this.previewMeta = {};
    this.lastCoalesce = null;
    this.persist();
    for (const notify of this.changeListeners) notify();
    this.emit();
    return true;
  }

  // Данные пришли с другого устройства.
  applyRemote(doc) {
    this.doc = normalize(doc);
    this.persist();
    this.settleTime();
    this.emit();
  }

  replaceAll(doc) {
    this.commit((draft) => {
      draft.tasks = doc.tasks;
      draft.plan = doc.plan;
      draft.settings = doc.settings;
      draft.days = doc.days;
      if (doc.table) draft.table = doc.table;
      draft.meta = doc.meta ?? { sample: false };
    });
  }

  clearSamples() {
    this.commit((draft, now) => clearSamples(draft, now));
  }

  settleTime() {
    const probe = clone(this.doc);
    if (settle(probe, this.now())) this.commit((draft, now) => settle(draft, now), { undo: false });
  }

  // Раз в минуту: время идёт, живой план пересчитывается.
  tick() {
    this.settleTime();
    this.emit();
  }
}

export const store = new Store();
