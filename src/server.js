import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Board, START, parseMove, squareName } from './chess/engine.js';
import { loadConfig } from './config.js';
import { MaxApi } from './api.js';
import { run as runBot } from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const STATE_PATH = join(ROOT, 'data', 'webgames.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function loadState() {
  if (!existsSync(STATE_PATH)) return { nextId: 1, games: [] };
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return { nextId: parsed.nextId ?? 1, games: parsed.games ?? [] };
  } catch {
    return { nextId: 1, games: [] };
  }
}

const state = loadState();

function saveState() {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function initDataOf(body) {
  const raw = body?.initData ?? '';
  const params = new URLSearchParams(raw);
  const user = JSON.parse(params.get('user') ?? 'null');
  const chat = JSON.parse(params.get('chat') ?? 'null');
  return {
    user,
    chat,
    raw: Boolean(raw),
    authDate: Number(params.get('auth_date') ?? 0),
  };
}

function currentGame(chatId) {
  return state.games
    .filter((game) => game.chatId === chatId && game.status === 'open')
    .sort((a, b) => b.id - a.id)[0];
}

function publicGame(game, userId) {
  const board = new Board(game.fen);
  const role =
    game.white?.id === userId ? 'white' : game.black?.id === userId ? 'black' : 'spectator';
  return {
    id: game.id,
    fen: game.fen,
    turn: board.turn,
    status: game.status,
    winner: game.winner,
    moves: game.moves,
    white: game.white,
    black: game.black,
    role,
    canMove:
      game.status === 'open' &&
      ((board.turn === 'w' && game.white?.id === userId) || (board.turn === 'b' && game.black?.id === userId)),
  };
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function enterGame(init) {
  const userId = init.user?.id;
  const chatId = init.chat?.id;
  if (!userId || !chatId) return null;

  let game = currentGame(chatId);

  if (!game) {
    game = {
      id: state.nextId,
      chatId,
      white: { id: userId, name: init.user.first_name ?? 'белый' },
      black: null,
      fen: START,
      moves: [],
      status: 'open',
      winner: null,
      createdAt: Date.now(),
    };
    state.nextId += 1;
    state.games.push(game);
    saveState();
    return game;
  }

  const mine = game.white?.id === userId || game.black?.id === userId;
  if (!mine && !game.black && game.white.id !== userId) {
    game.black = { id: userId, name: init.user.first_name ?? 'чёрный' };
    saveState();
  }
  return game;
}

function applyMove(game, userId, from, to, promo) {
  if (game.status !== 'open') return { error: 'Партия закончена' };

  const board = new Board(game.fen);
  const isWhite = board.turn === 'w';
  const player = isWhite ? game.white : game.black;

  if (!player || player.id !== userId) return { error: 'Сейчас не твой ход' };

  const fromName = squareName(from);
  const toName = squareName(to);
  const input = `${fromName} ${toName}${promo ?? ''}`;
  const move = parseMove(board, input);
  if (!move) return { error: 'Так нельзя' };

  const next = board.apply(move);
  game.fen = next.fen();
  game.moves.push(`${fromName}-${toName}${move.promotion ? move.promotion : ''}`);

  const status = next.status();
  if (status.over) {
    game.status = 'done';
    game.winner = status.winner;
  }

  saveState();
  return { ok: true };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
      });
      response.end();
      return;
    }

    if (url.pathname === '/api/enter' && request.method === 'POST') {
      const body = await readBody(request);
      const init = initDataOf(body);
      const game = enterGame(init);
      if (!game) return send(response, 400, { error: 'Нет данных пользователя' });
      return send(response, 200, { game: publicGame(game, init.user.id), user: init.user });
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      const chatId = Number(url.searchParams.get('chat'));
      const userId = Number(url.searchParams.get('user'));
      const game = currentGame(chatId);
      if (!game) return send(response, 200, { game: null });
      return send(response, 200, { game: publicGame(game, userId) });
    }

    if (url.pathname === '/api/move' && request.method === 'POST') {
      const body = await readBody(request);
      const init = initDataOf(body);
      const game = currentGame(init.chat?.id);
      if (!game) return send(response, 404, { error: 'Партии нет' });

      const result = applyMove(game, init.user?.id, Number(body.from), Number(body.to), body.promo);
      if (result.error) return send(response, 400, { error: result.error });
      return send(response, 200, { game: publicGame(game, init.user.id) });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const body = await readBody(request);
      const init = initDataOf(body);
      const game = currentGame(init.chat?.id);
      if (!game) return send(response, 404, { error: 'Партии нет' });

      const board = new Board(game.fen);
      const config = loadConfig();
      const api = new MaxApi(config.token);
      const lines = [`♟ Шахматы #${game.id}: ${game.white.name} — ${game.black?.name ?? 'ждём соперника'}`];
      lines.push(`Ход ${board.turn === 'w' ? 'белых' : 'чёрных'}. Ходов: ${game.moves.length}`);
      lines.push(game.moves.slice(-6).join(', ') || 'ходов пока нет');
      await api.sendMessage(init.chat.id, { text: lines.join('\n') });
      return send(response, 200, { ok: true });
    }

    return send(response, 404, { error: 'Нет такого метода' });
  }

  let filePath = join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (!filePath.startsWith(PUBLIC) || !existsSync(filePath)) {
    filePath = join(PUBLIC, 'index.html');
  }

  if (url.pathname === '/health') {
    return send(response, 200, { ok: true, games: state.games.length });
  }

  const content = readFileSync(filePath);
  response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  response.end(content);
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Мини-приложение: http://localhost:${port}`);
});

if (process.env.NO_BOT !== '1') {
  runBot().catch((error) => console.error('бот:', error.message));
}
