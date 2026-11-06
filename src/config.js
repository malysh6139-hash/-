import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'bot.config.json');

export function loadConfig() {
  const config = {
    token: process.env.MAX_BOT_TOKEN ?? '',
    autostart: false,
    questionsPerGame: 10,
    answerTimeoutSec: 25,
    betsStatePath: join(ROOT, 'data', 'bets.json'),
    chessStatePath: join(ROOT, 'data', 'chess.json'),
  };

  if (existsSync(CONFIG_PATH)) {
    const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    Object.assign(config, file);
  }

  if (!config.token) {
    throw new Error(
      'Нет токена. Создайте bot.config.json с полем "token" (токен берётся в business.max.ru → Чат-боты → ⋮ → Настройки) ' +
        'или задайте переменную окружения MAX_BOT_TOKEN.'
    );
  }

  return config;
}
