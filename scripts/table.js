import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { MaxApi } from '../src/api.js';

const chatId = Number(process.argv[process.argv.length - 1]);
const config = loadConfig();
const api = new MaxApi(config.token);

const state = JSON.parse(readFileSync(config.betsStatePath, 'utf8'));
const event = [...state.events]
  .filter((item) => item.chatId === chatId && item.status === 'open')
  .sort((a, b) => b.id - a.id)[0];

if (!event) {
  console.log('Активных споров нет');
  process.exit(0);
}

let members = [];
try {
  const response = await api.call('GET', `/chats/${chatId}/members`, { query: { count: 100 } });
  members = response?.members ?? [];
} catch (error) {
  console.log('не смог получить участников:', error.message);
}

console.log(`Спор #${event.id}: ${event.subject} · на кону ${event.stake}`);
console.log(`Поставили: ${event.picks.length}`);

for (const member of members) {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.username || member.user_id;
  const pick = event.picks.find((item) => item.userId === member.user_id);
  const mark = member.is_bot ? 'бот' : pick ? pick.pick : 'не поставил';
  console.log(`  ${name}: ${mark}`);
}
