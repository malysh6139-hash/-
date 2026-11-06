import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetsService } from '../src/bets.js';

const log = [];
const api = {
  async sendMessage(chatId, payload) {
    log.push(payload);
    const buttons = payload.attachments?.[0]?.payload?.buttons?.flat() ?? [];
    console.log(`  бот → ${payload.text.replace(/\n/g, '\n        ')}`);
    if (buttons.length) console.log(`        [кнопки: ${buttons.map((b) => `${b.text}=${b.payload}`).join(' | ')}]`);
    return { message: { body: { mid: `mid-${log.length}` } } };
  },
  async editMessage(messageId, payload) {
    log.push(payload);
    const buttons = payload.attachments?.[0]?.payload?.buttons?.flat() ?? [];
    console.log(`  бот ✎ ${messageId}: ${payload.text.replace(/\n/g, '\n        ')}`);
    if (buttons.length) console.log(`        [кнопки: ${buttons.map((b) => `${b.text}=${b.payload}`).join(' | ')}]`);
    return { success: true };
  },
};

const statePath = join(mkdtempSync(join(tmpdir(), 'bets-')), 'bets.json');
const bets = new BetsService(api, statePath);

const sergey = { user_id: 5040674, first_name: 'Сергей' };
const dima = { user_id: 20, first_name: 'Дима' };
const kolyan = { user_id: 30, first_name: 'Колян' };

console.log('— 1. «спор Локо Динамо» — без счёта, на точный счёт —');
await bets.openEvent(-100, 'спор Локо Динамо', sergey);

console.log('— 2. Отвечают на карточку своими счетами: Сергей 2:1, Дима 2/1, Колян 00 —');
const cardMid = bets.openEventOf(-100).messageId;
await bets.handleReply(-100, cardMid, '2:1', sergey);
await bets.handleReply(-100, cardMid, '2/1', dima);
await bets.handleReply(-100, cardMid, '00', kolyan);
const afterPrognoses = bets.openEventOf(-100).picks.length;

console.log('— 3. Итог ответом на карточку: 2:1 —');
const scoreBet = bets.openEventOf(-100);
await bets.handleReply(-100, cardMid, '2:1', dima);

console.log('— 4. Свои варианты кнопками —');
await bets.openEvent(-200, 'спор Кто забьёт | Зенит | Локо | Никто', sergey);
const optionBet = bets.openEventOf(-200);
const buttonsBefore = log.length;
await bets.pick(-200, optionBet.id, 1, kolyan);
await bets.pick(-200, optionBet.id, 0, dima);
await bets.setResult(-200, 'итог Локо');

console.log('— 5. Повтор и смена счёта —');
await bets.openEvent(-300, 'спор 2 Зенит Локо', sergey);
const stakeBet = bets.openEventOf(-300);
await bets.tryPickByText(-300, '1:0', sergey);
const afterPick = log.length;
await bets.tryPickByText(-300, '1:0', sergey);
const afterSame = log.length;
await bets.tryPickByText(-300, '3:0', sergey);
const afterChange = log.length;

console.log('  долги в состоянии:', JSON.stringify(bets.state.debts));
const checks = [
  ['матч создаётся на счёт', scoreBet.mode === 'score' && JSON.stringify(scoreBet.sides) === '["Локо","Динамо"]'],
  ['ответ без прогноза становится прогнозом', afterPrognoses === 3],
  ['кнопки победителя есть', Array.isArray(log[0].attachments)],
  ['«2/1» понят как 2:1', scoreBet.picks.find((p) => p.name === 'Дима')?.pick === '2:1'],
  ['«00» понят как 0:0', scoreBet.picks.find((p) => p.name === 'Колян')?.pick === '0:0'],
  ['итог 2:1 закрыл спор', scoreBet.status === 'done' && scoreBet.result === '2:1'],
  ['проигравший проставляет угадавшему, встречный долг закрылся', bets.state.debts['30>5040674'] === 1 && bets.state.debts['30>20'] === undefined],
  ['свои варианты дали кнопки', Boolean(log[buttonsBefore - 1].attachments)],
  ['итог по имени закрыл кнопочный спор', optionBet.status === 'done' && optionBet.result === 'Локо'],
  ['ставка 2 учтена', stakeBet.stake === 2],
  ['повтор того же счёта молчит', afterSame === afterPick],
  ['смена счёта — одно предупреждение', afterChange === afterSame + 1],
  ['в тексте есть ✅/❌', log.some((m) => m.text.includes('✅') && m.text.includes('❌'))],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
process.exit(failed ? 1 : 0);
