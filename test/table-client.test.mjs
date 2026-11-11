import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TableClient, TableError, scriptUrl } from '../js/sync/table.js';
import { demoSpreadsheet, loadScript } from '../scripts/gas-fake.mjs';

const URL_OK = 'https://script.google.com/macros/s/AKfycb_x-1/exec';

function reply(body) {
  return { text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

function clientWith(fetchImpl, { online = true } = {}) {
  return new TableClient({ fetchImpl, getUrl: () => URL_OK, isOnline: () => online });
}

async function errorOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

test('принимается только ссылка веб-приложения, всё лишнее отбрасывается', () => {
  assert.equal(scriptUrl(`  ${URL_OK}?action=info#top `), URL_OK);
  assert.equal(scriptUrl('https://script.google.com/a/macros/example.com/s/AKfy/exec'), 'https://script.google.com/a/macros/example.com/s/AKfy/exec');
  assert.equal(scriptUrl('http://localhost:5178/exec'), 'http://localhost:5178/exec');
  assert.equal(scriptUrl('https://script.google.com/macros/s/AKfy/dev'), null, 'тестовое развёртывание не подходит');
  assert.equal(scriptUrl('https://docs.google.com/spreadsheets/d/abc/edit'), null, 'ссылка на саму таблицу не подходит');
  assert.equal(scriptUrl('http://script.google.com/macros/s/AKfy/exec'), null);
  assert.equal(scriptUrl(''), null);
});

test('сбои связи и чужие ответы превращаются в понятные сообщения', async () => {
  const offline = await errorOf(clientWith(async () => { throw new TypeError('Failed to fetch'); }, { online: false }).info());
  assert.ok(offline instanceof TableError);
  assert.equal(offline.code, 'network');
  assert.match(offline.message, /Нет интернета/);

  const blocked = await errorOf(clientWith(async () => { throw new TypeError('Failed to fetch'); }).info());
  assert.match(blocked.message, /доступ «Все»/, 'при живой сети вероятнее всего закрыт доступ к скрипту');

  const page = await errorOf(clientWith(async () => reply('<!doctype html><title>Вход</title>')).info());
  assert.equal(page.code, 'access');

  const foreign = await errorOf(clientWith(async () => reply({ ok: true, app: 'neuron' })).info());
  assert.equal(foreign.code, 'foreign');

  const script = await errorOf(clientWith(async () => reply({ ok: false, app: 'potok', error: 'В таблице нет листа «декабрь»' })).rows('декабрь'));
  assert.equal(script.code, 'script');
  assert.equal(script.message, 'В таблице нет листа «декабрь»');
});

test('чтение идёт по адресу, запись простым запросом без предварительной проверки', async () => {
  const calls = [];
  const client = clientWith(async (url, init) => {
    calls.push({ url, init });
    return reply({ ok: true, app: 'potok', rows: [], added: [], updated: [], missing: [] });
  });
  await client.rows('ноябрь');
  await client.write('ноябрь', { add: [{ id: 'a', text: 'Задача' }], set: [] });

  assert.equal(calls[0].url, `${URL_OK}?action=rows&tab=${encodeURIComponent('ноябрь')}`);
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[1].url, URL_OK);
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(calls[1].init.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { action: 'write', tab: 'ноябрь', add: [{ id: 'a', text: 'Задача' }], set: [] });
  assert.equal(calls[1].init.redirect, 'follow');
});

test('клиент и скрипт таблицы понимают друг друга', async () => {
  const script = loadScript(demoSpreadsheet());
  // Вместо сети запросы уходят прямо в скрипт, как это делает веб-приложение Google.
  const client = clientWith(async (url, init = {}) => {
    if (init.method === 'POST') return reply(script.post(JSON.parse(init.body)));
    return reply(script.get(Object.fromEntries(new URL(url).searchParams)));
  });
  const info = await client.info();
  assert.deepEqual(info.tabs.map((tab) => tab.name), ['октябрь', 'ноябрь']);
  const data = await client.rows('ноябрь');
  assert.equal(data.rows.length, 6);
  const result = await client.write('ноябрь', { add: [{ id: 'a', date: '2026-11-10', status: 'готово', text: 'Проверка связи', load: 'Малая', link: '' }], set: [] });
  assert.deepEqual(result.added, [{ id: 'a', r: 14, status: 'готово' }]);
  assert.equal((await client.rows('ноябрь')).rows.length, 7);
});
