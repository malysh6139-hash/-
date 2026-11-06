import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';
import { BetsService } from '../src/bets.js';

const config = loadConfig();
const api = new MaxApi(config.token);
const bets = new BetsService(api, config.betsStatePath);

const chatId = Number(process.argv[process.argv.length - 2]);
const text = process.argv[process.argv.length - 1];

await bets.openBet(chatId, text, { user_id: 565350240, first_name: 'Тест-бот' });
console.log('готово');
