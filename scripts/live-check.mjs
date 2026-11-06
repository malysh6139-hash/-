import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';
import { BetsService } from '../src/bets.js';

const chatId = -80966402054178;
const config = loadConfig();
const api = new MaxApi(config.token);

const mids = [];
const original = {
  send: api.sendMessage.bind(api),
  edit: api.editMessage.bind(api),
};
api.sendMessage = async (chatIdArg, payload) => {
  const result = await original.send(chatIdArg, payload);
  const mid = result?.message?.body?.mid;
  if (mid) mids.push(mid);
  console.log(`\n[бот] ${payload.text}`);
  return result;
};
api.editMessage = async (mid, payload) => {
  console.log(`\n[карточка обновлена] ${payload.text}`);
  return original.edit(mid, payload);
};

const bets = new BetsService(api, config.betsStatePath);
const sergey = { user_id: 5040674, first_name: 'Сергей' };
const sergey2 = { user_id: 431026535, first_name: 'сергей' };
const alex = { user_id: 39028962, first_name: 'Алексей' };

console.log('=== 1. шахматы: спор между двумя людьми ===');
await bets.openEvent(chatId, 'спор Сергей против Алексея', sergey);
let event = bets.openEventOf(chatId);
await bets.handleReply(chatId, event.messageId, 'за Алексея', sergey2);
await bets.handleReply(chatId, event.messageId, 'Сергей', alex);
await bets.handleReply(chatId, event.messageId, 'итог Алексей выиграл', sergey);
event = bets.state.events.find((item) => item.id === event.id);
console.log('\nитог:', event.status, event.result, 'долги:', JSON.stringify(bets.state.debts));

console.log('\n=== 2. футбол: кнопки победителя + счёт ===');
await bets.openEvent(chatId, 'спор Локо-Динамо', sergey);
event = bets.openEventOf(chatId);
await bets.handleReply(chatId, event.messageId, '2:1', sergey);
await bets.handleReply(chatId, event.messageId, 'Локо', sergey2);
await bets.handleReply(chatId, event.messageId, 'Динамо', alex);
await bets.handleReply(chatId, event.messageId, '2:1', sergey);
event = bets.state.events.find((item) => item.id === event.id);
console.log('\nитог:', event.status, event.result, 'долги:', JSON.stringify(bets.state.debts));

console.log('\n=== 3. таблица ===');
await bets.listPicks(chatId);

console.log(`\nсообщений для удаления: ${mids.length}`);
console.log(JSON.stringify(mids));
