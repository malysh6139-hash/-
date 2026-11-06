import { pathToFileURL } from 'node:url';
import { MaxApi } from './api.js';
import { loadConfig } from './config.js';
import { BetsService, betsCommands } from './bets.js';
import { ChessService } from './chess/game.js';

function normalize(text) {
  return (text ?? '').trim().toLowerCase().replace(/@\w+$/, '').trim();
}

function isCommand(text, commands) {
  const value = normalize(text).replace(/^\//, '');
  return commands.some((command) => command.replace(/^\//, '') === value);
}

async function greet(api, chatId) {
  await api.sendMessage(chatId, {
    text: [
      'Здорово! Я ваш бармен-ведущий, считаю споры на кружку.',
      'Замутить спор: спор Локо-Динамо  или  спор Серёга против Лёхи',
      'Ставка: жми кнопку победителя или пиши счёт — 2:1 (можно 21)',
      'Ставка одна, менять нельзя.',
      'Как сыграли — ответь (свайп) на карточку счётом или напиши: итог Локо / Лёха выиграл',
      'Кто поставил, кто нет: кто.  Кто кому проставляется: beers.',
      'И сделайте меня админом с правом «Читать сообщения», иначе я ничего не слышу.',
    ].join('\n'),
  });
}

async function handleUpdate(api, config, update, bets, chess) {
  const recipient = update.message?.recipient ?? update.callback?.message?.recipient;
  const chatId =
    update.chat_id ??
    recipient?.chat_id ??
    (recipient?.chat_type === 'dialog'
      ? update.sender?.user_id ?? update.callback?.user?.user_id
      : undefined);

  if (!chatId) {
    console.error(`не нашёл chat_id в событии ${update.update_type}`, JSON.stringify(recipient));
    return;
  }

  switch (update.update_type) {
    case 'bot_added':
    case 'bot_started': {
      await greet(api, chatId);
      return;
    }

    case 'message_created': {
      const message = update.message;
      const sender = update.sender ?? message?.sender;
      if (!message || sender?.is_bot) return;
      const text = message.body?.text ?? '';
      bets.remember(sender);

      if (/^\/?(кто|таблица|прогнозы)(\s|$)/i.test(normalize(text))) {
        await bets.listPicks(chatId);
        return;
      }
      if (isCommand(text, betsCommands.debts)) {
        await bets.listDebts(chatId);
        return;
      }
      if (/^\/?(спор|ставка|bet)(\s|$)/i.test(normalize(text))) {
        await bets.openEvent(chatId, text, sender);
        return;
      }
      if (/^\/?(итог|результат)(\s|$)/i.test(normalize(text))) {
        await bets.setResult(chatId, text);
        return;
      }

      if (/^\/?(шахматы|chess)(\s|$)/i.test(normalize(text))) {
        await chess.start(chatId, text, sender);
        return;
      }
      if (/^\/?(доска|board)(\s|$)/i.test(normalize(text))) {
        await chess.inspect(chatId);
        return;
      }
      if (/^\/?(сдаюсь|resign)(\s|$)/i.test(normalize(text))) {
        await chess.resign(chatId, sender);
        return;
      }
      if (/^\/?(играю|join)(\s|$)/i.test(normalize(text))) {
        await chess.join(chatId, sender);
        return;
      }
      if (chess.current(chatId) && /^[a-hа-я][1-8][\s\-–—xх]*[a-hа-я][1-8]/i.test(text.trim())) {
        if (await chess.move(chatId, text, sender)) return;
      }

      const replyMid = message.link?.message?.mid ?? message.link?.mid ?? null;

      const looksLikeMatch =
        /(\d{1,2}\s*[:/xх\-]\s*\d{1,2}|\s\d\d)\s*$/.test(text) || /против|vs/i.test(text);
      if (!bets.openEventOf(chatId) && looksLikeMatch) {
        await bets.openEvent(chatId, text, sender);
        return;
      }

      if (replyMid && (await bets.handleReply(chatId, replyMid, text, sender))) return;

      await bets.tryPickByText(chatId, text, sender);
      return;
    }

    case 'message_callback': {
      const payload = update.callback?.payload ?? '';
      const [kind, eventRaw, optionRaw] = payload.split(':');
      if (kind !== 'pick') return;

      await bets.pick(chatId, Number(eventRaw), Number(optionRaw), update.callback?.user);
      return;
    }

    default:
      return;
  }
}

export async function run() {
  const config = loadConfig();
  const api = new MaxApi(config.token);
  const bets = new BetsService(api, config.betsStatePath);
  const chess = new ChessService(api, config.chessStatePath);

  const bot = await api.me();
  console.log(`Бот на связи: ${bot.name} (@${bot.username ?? 'без ника'})`);
  console.log(`Вопросов в игре: ${config.questionsPerGame}, время на ответ: ${config.answerTimeoutSec} с`);
  console.log('Слушаю чаты. Ctrl+C — выход.');

  let marker = null;
  let failures = 0;

  for (;;) {
    try {
      const response = await api.updates(marker, 30);
      marker = response?.marker ?? marker;
      failures = 0;

      for (const update of response?.updates ?? []) {
        console.log(`событие: ${update.update_type}, chat ${update.chat_id ?? update.message?.recipient?.chat_id ?? '?'}`);
        if (update.update_type === 'message_created' || update.update_type === 'message_callback') {
          console.log('raw:', JSON.stringify(update).slice(0, 1200));
        }
        await handleUpdate(api, config, update, bets, chess).catch((error) =>
          console.error(`update ${update.update_type}:`, error.message)
        );
      }
    } catch (error) {
      failures += 1;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
      console.error(`polling: ${error.message} (повтор через ${delay / 1000} с)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
