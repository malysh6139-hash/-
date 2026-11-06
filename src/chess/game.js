import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Board, START, parseMove, squareName } from './engine.js';
import { describeMove, renderBoard } from './render.js';

function nameOfUser(user) {
  if (!user) return 'Игрок';
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.user_id);
}

function key(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е');
}

function similar(a, b) {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return 0;
  if (x === y) return x.length + 3;
  let common = 0;
  while (common < x.length && common < y.length && x[common] === y[common]) common += 1;
  return common >= 3 ? common : 0;
}

export class ChessService {
  constructor(api, statePath) {
    this.api = api;
    this.statePath = statePath;
    this.state = this.load();
  }

  load() {
    if (!existsSync(this.statePath)) return { nextId: 1, games: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
      return { nextId: parsed.nextId ?? 1, games: parsed.games ?? [] };
    } catch {
      return { nextId: 1, games: [] };
    }
  }

  save() {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  current(chatId) {
    return this.state.games
      .filter((game) => game.chatId === chatId && game.status === 'open')
      .sort((a, b) => b.id - a.id)[0];
  }

  async members(chatId) {
    try {
      const response = await this.api.call('GET', `/chats/${chatId}/members`, { query: { count: 100 } });
      return (response?.members ?? []).filter((member) => !member.is_bot);
    } catch (error) {
      console.error('members:', error.message);
      return [];
    }
  }

  findMember(name, members) {
    let best = null;
    let score = 0;
    for (const member of members) {
      const variants = [nameOfUser(member), member.first_name].filter(Boolean);
      for (const variant of variants) {
        const value = similar(name, variant);
        if (value > score) {
          best = member;
          score = value;
        }
      }
    }
    return score >= 3 ? best : null;
  }

  async start(chatId, text, user) {
    if (!user?.user_id) return;

    const existing = this.current(chatId);
    if (existing) {
      await this.api.sendMessage(chatId, {
        text: `Партия #${existing.id} ещё идёт: ${existing.white.name} (белые) против ${existing.black.name} (чёрные).\nСдавайтесь или доиграйте: сдаюсь`,
      });
      return;
    }

    const body = String(text).replace(/^\/?(шахматы|chess)(\s+|$)/i, '').trim();
    const members = await this.members(chatId);
    const opponentName = body.replace(/^(с|против)\s+/i, '').trim();
    const opponent = opponentName ? this.findMember(opponentName, members) : null;

    if (body && !opponent) {
      await this.api.sendMessage(chatId, {
        text: `Не нашёл «${opponentName}» в этом чате.\nНапиши так: шахматы с Сергеем`,
      });
      return;
    }

    if (opponent && opponent.user_id === user.user_id) {
      await this.api.sendMessage(chatId, { text: 'Сам с собой играть будешь? Позови второго.' });
      return;
    }

    const game = {
      id: this.state.nextId,
      chatId,
      white: { id: user.user_id, name: nameOfUser(user) },
      black: opponent ? { id: opponent.user_id, name: nameOfUser(opponent) } : { id: 0, name: 'второй игрок' },
      fen: START,
      moves: [],
      status: 'open',
      winner: null,
      messageId: null,
      createdAt: Date.now(),
    };

    this.state.nextId += 1;
    this.state.games.push(game);
    this.save();

    const hint = opponent
      ? `${game.white.name} играет белыми, ${game.black.name} — чёрными.`
      : `${game.white.name} играет белыми. Второй игрок пусть напишет: играю`;

    await this.sendBoard(chatId, game, `♔ Партия #${game.id}. ${hint}\nХод белых. Пиши ход так: e2 e4`);
  }

  async sendBoard(chatId, game, intro) {
    const board = new Board(game.fen);
    const payload = {
      text: [intro, '', renderBoard(board), '', game.moves.length ? `Последние ходы: ${game.moves.slice(-4).join(', ')}` : 'Ходов пока нет'].join('\n'),
    };
    const sent = await this.api.sendMessage(chatId, payload);
    game.messageId = sent?.message?.body?.mid ?? null;
    this.save();
  }

  canPlay(game, userId) {
    return game.white.id === userId || game.black.id === userId;
  }

  async move(chatId, text, user) {
    const game = this.current(chatId);
    if (!game) return false;

    const board = new Board(game.fen);
    const isWhiteTurn = board.turn === 'w';
    const expected = isWhiteTurn ? game.white : game.black;

    if (!game.black.id && !isWhiteTurn) {
      game.black = { id: user.user_id, name: nameOfUser(user) };
      this.save();
    }

    const player = isWhiteTurn ? game.white : game.black;
    if (!player.id || player.id !== user.user_id) {
      await this.api.sendMessage(chatId, {
        text: `Сейчас ход ${isWhiteTurn ? 'белых' : 'чёрных'} — ${player.name}.`,
      });
      return true;
    }

    const move = parseMove(board, text);
    if (!move) {
      await this.api.sendMessage(chatId, {
        text: 'Так не пойдёт. Ход пиши как e2 e4 или e2-e4. Превращение: e7 e8q',
      });
      return true;
    }

    const description = describeMove(board, move);
    const next = board.apply(move);
    game.fen = next.fen();
    game.moves.push(`${squareName(move.from)}-${squareName(move.to)}`);

    const status = next.status();
    if (status.over) {
      game.status = 'done';
      game.winner = status.winner;
      this.save();

      const result = status.winner
        ? `${status.winner === 'w' ? 'Белые' : 'Чёрные'} поставили мат. Победа: ${status.winner === 'w' ? game.white.name : game.black.name}`
        : 'Пат. Ничья.';

      await this.sendBoard(chatId, game, `${description}\n\n${result}`);
      return true;
    }

    this.save();
    const tail = status.check ? `\nШах! Ход ${next.turn === 'w' ? 'белых' : 'чёрных'}: ${next.turn === 'w' ? game.white.name : game.black.name}` : `\nХод ${next.turn === 'w' ? 'белых' : 'чёрных'}: ${next.turn === 'w' ? game.white.name : game.black.name}`;
    await this.sendBoard(chatId, game, `${description}${tail}`);
    return true;
  }

  async inspect(chatId) {
    const game = this.current(chatId);
    if (!game) {
      await this.api.sendMessage(chatId, { text: 'Партий нет. Начни: шахматы с Сергеем' });
      return;
    }
    const board = new Board(game.fen);
    await this.sendBoard(chatId, game, `♔ Партия #${game.id}: ${game.white.name} — ${game.black.name}. Ход ${board.turn === 'w' ? 'белых' : 'чёрных'}.`);
  }

  async resign(chatId, user) {
    const game = this.current(chatId);
    if (!game) {
      await this.api.sendMessage(chatId, { text: 'Активной партии нет.' });
      return false;
    }
    if (!this.canPlay(game, user?.user_id)) {
      await this.api.sendMessage(chatId, { text: 'Ты не в этой партии.' });
      return true;
    }

    const loserIsWhite = game.white.id === user.user_id;
    game.status = 'done';
    game.winner = loserIsWhite ? 'b' : 'w';
    this.save();

    const winner = loserIsWhite ? game.black : game.white;
    await this.api.sendMessage(chatId, {
      text: `${nameOfUser(user)} сдался. Победил ${winner.name} — партия #${game.id}.`,
    });
    return true;
  }

  async join(chatId, user) {
    const game = this.current(chatId);
    if (!game) {
      await this.api.sendMessage(chatId, { text: 'Активной партии нет. Начни: шахматы с Сергеем' });
      return true;
    }
    if (game.black.id) {
      await this.api.sendMessage(chatId, { text: `Оба места заняты: ${game.white.name} и ${game.black.name}.` });
      return true;
    }
    if (game.white.id === user.user_id) {
      await this.api.sendMessage(chatId, { text: 'Ты уже за белых. Жди соперника.' });
      return true;
    }

    game.black = { id: user.user_id, name: nameOfUser(user) };
    this.save();
    await this.sendBoard(game.chatId, game, `${game.black.name} сел за чёрных. Партия #${game.id}. Ход белых: ${game.white.name}`);
    return true;
  }
}

export const chessCommands = {
  start: ['/шахматы', '/chess'],
  board: ['/доска', '/board'],
  resign: ['/сдаюсь', '/resign'],
  join: ['/играю', '/join'],
};
