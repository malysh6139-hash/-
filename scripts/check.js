import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';

const config = loadConfig();
const api = new MaxApi(config.token);

try {
  const me = await api.me();
  console.log(`Токен рабочий. Бот: ${me.name} (@${me.username ?? 'без ника'}), id ${me.user_id}`);
  process.exit(0);
} catch (error) {
  console.log(`Токен не работает: ${error.message}`);
  process.exit(1);
}
