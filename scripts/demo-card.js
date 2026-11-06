import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';
import { BetsService } from '../src/bets.js';

const config = loadConfig();
const api = new MaxApi(config.token);
const bets = new BetsService(api, config.betsStatePath);

const chatId = Number(process.argv[process.argv.length - 1]);
const test = { user_id: 565350240, first_name: 'Тест-бот' };
const second = { user_id: 5040674, first_name: 'Тест-2' };

await bets.openEvent(chatId, 'спор 2 Барселона-Реал', test);
const event = bets.openEventOf(chatId);
console.log('карточка создана, mid:', event.messageId);

await bets.pick(chatId, event.id, 0, test);
await bets.pick(chatId, event.id, 2, second);
console.log('выборы записаны:', JSON.stringify(event.picks));

await bets.setResult(chatId, 'итог Барселона');
console.log('спор закрыт:', event.status, event.result);
console.log('долги:', JSON.stringify(bets.state.debts));
