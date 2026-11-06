const BASE_URL = 'https://platform-api2.max.ru';

export class MaxApi {
  constructor(token) {
    if (!token) throw new Error('Не передан токен бота');
    this.token = token;
  }

  async call(method, path, { query, body } = {}) {
    const url = new URL(BASE_URL + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { raw };
      }
    }

    if (!response.ok) {
      const detail = raw ? raw.slice(0, 300) : response.statusText;
      throw new Error(`${method} ${path} → ${response.status}: ${detail}`);
    }
    return data;
  }

  me() {
    return this.call('GET', '/me');
  }

  updates(marker, timeout = 30) {
    return this.call('GET', '/updates', { query: { marker, timeout, limit: 100 } });
  }

  sendMessage(chatId, payload) {
    return this.call('POST', '/messages', { query: { chat_id: chatId }, body: payload });
  }

  editMessage(messageId, payload) {
    return this.call('PUT', '/messages', { query: { message_id: messageId }, body: payload });
  }

  deleteMessage(messageId) {
    return this.call('DELETE', '/messages', { query: { message_id: messageId } });
  }

  chat(chatId) {
    return this.call('GET', `/chats/${chatId}`);
  }
}
