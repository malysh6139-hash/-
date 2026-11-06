import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetsService } from '../src/bets.js';

const log = [];
const api = {
  async sendMessage(chatId, payload) {
    log.push(payload.text);
    console.log(`  бот → ${payload.text.replace(/\n/g, '\n        ')}\n`);
  },
};

const statePath = join(mkdtempSync(join(tmpdir(), 'predictions-')), 'bets.json');
const bets = new BetsService(api, statePath);

const sergey = { user_id: 5040674, first_name: 'Сергей' };
const dima = { user_id: 20, first_name: 'Дима' };
const kolyan = { user_id: 30, first_name: 'Колян' };

console.log('— 1. Сергей предлагает спор на 2 кружки —');
await bets.openEvent(-100, 'спор 2 Зенит-Локо', sergey);

console.log('— 2. Прогнозы —');
await bets.addPick(-100, 'прогноз 2:1', sergey);
await bets.addPick(-100, 'прогноз 1:0', dima);
await bets.addPick(-100, 'мой 3 : 2', kolyan);

console.log('— 3. Итог матча 2:1 —');
await bets.setResult(-100, 'итог 2:1');

console.log('— 4. Долги —');
await bets.listDebts(-100);

console.log('— 5. Проверка: итог без прогнозов —');
await bets.openEvent(-200, 'спор Барселона-Реал', sergey);
await bets.setResult(-200, 'итог 1:1');

const checks = [
  ['Сергей угадал, долг Димы 2 кружки', bets.state.debts['20>5040674'] === 2],
  ['долг Коляна 2 кружки', bets.state.debts['30>5040674'] === 2],
  ['спор закрыт', bets.state.events[0].status === 'done'],
  ['имена сохранены', bets.state.names[20] === 'Дима'],
  ['событие без прогнозов не закрылось', bets.state.events[1].status === 'open'],
  ['в ответе есть разметка ✅/❌', log.some((text) => text.includes('✅') && text.includes('❌'))],
  ['в ответе объяснено, кто выиграл', log.some((text) => text.includes('Факт: 2:1'))],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
process.exit(failed ? 1 : 0);
