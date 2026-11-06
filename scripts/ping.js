import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';

const chatId = Number(process.argv[process.argv.length - 1]);
const api = new MaxApi(loadConfig().token);

const started = Date.now();
try {
  const result = await api.sendMessage(chatId, { text: 'тест связи' });
  console.log(`отправлено за ${Date.now() - started} мс, mid ${result?.message?.body?.mid ?? '?'}`);
} catch (error) {
  console.log(`ошибка за ${Date.now() - started} мс: ${error.message}`);
}
