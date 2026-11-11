// Учебная таблица для проверки приложения на своём компьютере: node scripts/mock-table.mjs [порт]
// Отвечает так же, как скрипт в настоящей Google Таблице, но данные придуманы и живут в памяти.
// В «Потоке» её можно подключить по адресу http://localhost:5178/exec

import { createServer } from 'node:http';

import { demoSpreadsheet, loadScript } from './gas-fake.mjs';

const PORT = Number(process.argv[2] ?? 5178);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const book = demoSpreadsheet();
const script = loadScript(book);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (body) => {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type' }).end();
    return;
  }
  // Содержимое всех листов, чтобы посмотреть, что записало приложение.
  if (url.pathname === '/dump') {
    json(Object.fromEntries(book.getSheets().map((sheet) => [sheet.getName(), sheet.dump()])));
    return;
  }
  if (url.pathname !== '/exec') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Учебная таблица «Потока» работает.\nАдрес для подключения: http://localhost:${PORT}/exec\nСодержимое листов: http://localhost:${PORT}/dump`);
    return;
  }
  if (req.method !== 'POST') {
    json(script.get(Object.fromEntries(url.searchParams)));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    json(script.post(JSON.parse(body)));
  } catch {
    json({ ok: false, app: 'potok', error: 'Запрос не разобран' });
  }
}).listen(PORT, () => console.log(`Учебная таблица: http://localhost:${PORT}/exec`));
