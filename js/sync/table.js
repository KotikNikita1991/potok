// Обмен с Google Таблицей через небольшой скрипт, установленный в самой таблице (apps-script/potok.gs).
// Приложение обращается к нему по ссылке веб-приложения; ключей и входа в аккаунт не требуется.

const TIMEOUT = 40000;
const SCRIPT_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;
const LOCAL_URL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[\w/-]*$/; // учебная таблица на своём компьютере

export class TableError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Приводит вставленную ссылку к адресу скрипта. Возвращает null, если это не ссылка веб-приложения.
export function scriptUrl(raw) {
  const url = String(raw ?? '').trim().replace(/[?#].*$/, '');
  return SCRIPT_URL.test(url) || LOCAL_URL.test(url) ? url : null;
}

export class TableClient {
  constructor({ fetchImpl, getUrl, isOnline = () => true }) {
    this.fetch = fetchImpl;
    this.getUrl = getUrl;
    this.isOnline = isOnline;
  }

  async request(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    let text;
    try {
      const response = await this.fetch(url, { redirect: 'follow', cache: 'no-store', signal: controller.signal, ...init });
      text = await response.text();
    } catch {
      throw new TableError('network', this.isOnline()
        ? 'Таблица не отвечает. Проверьте, что в развёртывании скрипта выбран доступ «Все», и попробуйте ещё раз.'
        : 'Нет интернета. Таблица будет доступна, когда появится сеть.');
    } finally {
      clearTimeout(timer);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new TableError('access', 'Вместо данных пришла страница Google. Проверьте, что в развёртывании скрипта выбран доступ «Все».');
    }
    if (data?.app !== 'potok') {
      throw new TableError('foreign', 'По этой ссылке отвечает другой скрипт. Нужна ссылка развёртывания, в котором есть файл «Поток».');
    }
    if (!data.ok) throw new TableError('script', data.error || 'Скрипт таблицы сообщил об ошибке.');
    return data;
  }

  // Название таблицы и листы, с которыми можно работать.
  info(url = this.getUrl()) {
    return this.request(`${url}?action=info`);
  }

  rows(tab) {
    return this.request(`${this.getUrl()}?action=rows&tab=${encodeURIComponent(tab)}`);
  }

  // Тип text/plain нужен, чтобы браузер отправил запрос сразу: предварительную проверку Apps Script не понимает.
  write(tab, payload) {
    return this.request(this.getUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'write', tab, ...payload }),
    });
  }
}
