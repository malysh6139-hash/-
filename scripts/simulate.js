import { QuizGame } from '../src/games/quiz.js';

const chatId = 0;
const log = [];

const fakeApi = {
  async sendMessage(target, payload) {
    log.push(payload);
    const buttons = payload.attachments?.[0]?.payload?.buttons?.flat() ?? [];
    console.log(`  бот → ${payload.text.replace(/\n/g, '\n        ')}`);
    if (buttons.length) console.log(`        [кнопки: ${buttons.map((b) => b.text).join(' | ')}]`);
  },
};

const alice = { user_id: 1, first_name: 'Алиса' };
const bob = { user_id: 2, first_name: 'Борис' };

const game = new QuizGame({
  api: fakeApi,
  chatId,
  questionsPerGame: 2,
  answerTimeoutSec: 30,
  pauseMs: 60,
});

function optionText(index, optionIndex) {
  return game.questions[index].options[optionIndex].text;
}

await game.start();
console.log('\n— раунд 1 —');
await game.handleAnswer({ index: 0, optionIndex: (game.questions[0].correctIndex + 1) % 4, user: bob });
await game.handleAnswer({ index: 0, optionIndex: game.questions[0].correctIndex, user: alice });

await new Promise((resolve) => setTimeout(resolve, 120));

console.log('\n— раунд 2 —');
await game.handleAnswer({ index: 1, optionIndex: game.questions[1].correctIndex, user: bob });

await new Promise((resolve) => setTimeout(resolve, 120));

console.log('\n— проверки —');
const checks = [
  ['всего сообщений', log.length === 7],
  ['первый вопрос содержит 4 кнопки', log[1].attachments[0].payload.buttons.length === 4],
  ['очко Алисе за верный ответ', game.scores.get(alice.user_id)?.score === 1],
  ['Борису очко во втором раунде', game.scores.get(bob.user_id)?.score === 1],
  ['игра закончилась', game.finished === true],
  ['итог содержит имена', /Алиса|Борис/.test(log[log.length - 1].text)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
console.log(`\nПравильные ответы: ${game.questions.map((q) => optionText(game.questions.indexOf(q), q.correctIndex)).join(' / ')}`);
process.exit(failed ? 1 : 0);
