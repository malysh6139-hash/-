import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetsService } from '../src/bets.js';

const sent = [];
let seq = 0;

const api = {
  async sendMessage(chatId, payload) {
    seq += 1;
    const mid = `mid-${seq}`;
    sent.push({ kind: 'send', mid, text: payload.text });
    return { message: { body: { mid } } };
  },
  async editMessage(mid, payload) {
    sent.push({ kind: 'edit', mid, text: payload.text });
    return {};
  },
  async deleteMessage(mid) {
    sent.push({ kind: 'delete', mid });
    return {};
  },
  async call() {
    return {
      members: [
        { user_id: 5040674, first_name: 'Сергей' },
        { user_id: 431026535, first_name: 'сергей' },
        { user_id: 39028962, first_name: 'Алексей' },
        { user_id: 777, first_name: 'Борис' },
      ],
    };
  },
};

const dir = mkdtempSync(join(tmpdir(), 'bets-'));
const bets = new BetsService(api, join(dir, 'bets.json'));
const chat = -1;
const sergey = { user_id: 5040674, first_name: 'Сергей' };
const sergey2 = { user_id: 431026535, first_name: 'сергей' };
const alex = { user_id: 39028962, first_name: 'Алексей' };

const results = [];
const check = (name, ok) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}`);

await bets.openEvent(chat, 'спор Локо-Динамо', sergey);
const card = bets.openEventOf(chat).messageId;

await bets.handleReply(chat, card, '11', sergey2);
let ev = bets.openEventOf(chat);
check('ответ на карточку без ставки = прогноз', ev.picks.length === 1 && ev.picks[0].pick === '1:1');

await bets.handleReply(chat, card, '22', sergey);
ev = bets.openEventOf(chat);
check('второй игрок тоже ставит прогнозом', ev.picks.length === 2);

const before = sent.length;
const debtsBefore = Object.keys(bets.state.debts).length;
await bets.handleReply(chat, 'mid-999', '2:2', sergey);
ev = bets.state.events.find((item) => item.id === ev.id);
check('ответ на любое сообщение со ставкой = итог', ev.status === 'done' && ev.result === '2:2');
check('итог дал расчёт долгов', Object.keys(bets.state.debts).length > debtsBefore);
check('в чат ушло закрытие спора', sent.slice(before).some((item) => item.text?.includes('закрыт')));

await bets.openEvent(chat, 'спор Локо-Динамо', sergey);
const card2 = bets.openEventOf(chat).messageId;
await bets.handleReply(chat, card2, '1:0', sergey);
await bets.setResult(chat, 'итог 3:1', bets.openEventOf(chat));
ev = bets.openEventOf(chat);
check('итог при одной ставке запомнен', ev.pendingResult === '3:1');
await bets.handleReply(chat, card2, '2:1', alex);
ev = bets.state.events.find((item) => item.id === ev.id);
check('запомненный итог применился со второй ставкой', ev.status === 'done' && ev.result === '3:1');

await bets.openEvent(chat, 'спор Локо-Динамо', sergey);
const card3 = bets.openEventOf(chat).messageId;
await bets.handleReply(chat, card3, '0:0', sergey);
await bets.handleReply(chat, card3, '2:2', alex);
bets.state.names[39028962] = 'Лёха';
await bets.updateCard(bets.openEventOf(chat));
const lastEdit = sent.filter((item) => item.kind === 'edit').pop();
check('карточка берёт актуальное имя', lastEdit.text.includes('Лёха'));

await bets.listPicks(chat);
const firstTable = bets.openEventOf(chat).listMid;
await bets.listPicks(chat);
check('прошлая таблица удалена', sent.some((item) => item.kind === 'delete' && item.mid === firstTable));

await bets.openEvent(chat, 'спор Сергей против Алексея', sergey);
let people = bets.openEventOf(chat);
check('два человека = ставка на победителя', people.mode === 'options' && people.options.length === 2);
await bets.handleReply(chat, people.messageId, 'за Алексея', sergey2);
people = bets.openEventOf(chat);
check('«за Алексея» — ставка на победителя', people.picks[0]?.optionIndex === 1);
await bets.handleReply(chat, people.messageId, 'Сергей', alex);
people = bets.openEventOf(chat);
check('вторая ставка на победителя', people.picks[1]?.optionIndex === 0);
await bets.handleReply(chat, people.messageId, 'Алексей выиграл', sergey);
people = bets.state.events.find((item) => item.id === people.id);
check('итог словами закрыл спор', people.status === 'done' && people.result === 'Алексей');

await bets.openEvent(chat, 'спор Локо-Динамо', sergey);
let match = bets.openEventOf(chat);
check('в футболе тоже есть кнопки победителя', match.mode === 'score' && match.options.length === 2);
await bets.handleReply(chat, match.messageId, 'Локо', sergey);
match = bets.openEventOf(chat);
check('в футболе можно ставить на победителя', match.picks[0]?.optionIndex === 0);
await bets.handleReply(chat, match.messageId, '2:1', alex);
match = bets.openEventOf(chat);
check('и счётом тоже', match.picks[1]?.pick === '2:1');
await bets.handleReply(chat, match.messageId, '2:1', sergey);
match = bets.state.events.find((item) => item.id === match.id);
check('счёт закрыл футбольный спор', match.status === 'done' && match.result === '2:1');
check('угадали и ставка-исход, и точный счёт', match.picks.length === 2);

for (const line of results) console.log(line);
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
