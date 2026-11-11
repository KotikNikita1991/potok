// Небольшие помощники для работы с DOM.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'spellcheck') {
        el.setAttribute('spellcheck', String(value));
        continue;
      }
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'data') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in el && !key.startsWith('aria') && key !== 'list' && key !== 'form') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child);
  }
}

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  sliders: 'M4 7h9M19 7h1M4 17h1M11 17h9M13 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  external: 'M14 5h5v5M19 5l-8 8M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5',
  pin: 'M12 16v5M8 3h8l-1 7 3 4H6l3-4z',
  flag: 'M6 21V4M6 4h11l-2.5 4.5L17 13H6',
  cloud: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z',
  cloudCheck: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18zM9.5 13.5l2 2 3.5-3.5',
  cloudOff: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18zM4 4l16 16',
  sync: 'M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  up: 'M12 20V5M6 11l6-6 6 6',
  down: 'M12 4v15M6 13l6 6 6-6',
  next: 'M4 12h13M12 6l6 6-6 6M21 5v14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  undo: 'M8 5L4 9l4 4M4 9h10a6 6 0 0 1 0 12h-3',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4-4',
  calendar: 'M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  target: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  inbox: 'M4 13l2.5-8h11L20 13M4 13v6h16v-6M4 13h5l1.5 2.5h3L15 13h5',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  play: 'M8 5l11 7-11 7z',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  copy: 'M9 9h10v11H9zM15 9V5H5v11h4',
};

export function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'grip' || name === 'dots' ? '2.6' : '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ic');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.append(path);
  return svg;
}

export { safeLink } from '../core/format.js';

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
