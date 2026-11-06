import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';

const chatId = Number(process.argv[process.argv.length - 1]);
const config = loadConfig();
const api = new MaxApi(config.token);

const result = await api.call('GET', '/messages', { query: { chat_id: chatId, count: 10 } });
for (const message of result?.messages ?? []) {
  const who = message.sender?.is_bot ? 'бот' : message.sender?.first_name ?? 'кто-то';
  const text = (message.body?.text ?? '').replace(/\n/g, ' / ').slice(0, 90);
  console.log(`${who}: ${text}${message.body?.attachments?.length ? ' [кнопки]' : ''}`);
}
