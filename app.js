import { Board, parseMove, squareName } from './chess-engine.js';

const GLYPHS = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const gameIdEl = document.getElementById('gameId');
const playersEl = document.getElementById('players');
const movesEl = document.getElementById('moves');
const hintEl = document.getElementById('hint');
const promoEl = document.getElementById('promo');

const webApp = window.WebApp;
const initData = webApp?.initData ?? '';
const unsafe = webApp?.initDataUnsafe ?? null;

let game = null;
let localMode = false;
let board = new Board();
let flipped = false;
let selected = null;
let legal = [];
let pendingPromotion = null;
let busy = false;

function myId() {
  return unsafe?.user?.id ?? Number(new URLSearchParams(location.search).get('user') ?? 0);
}

function myChat() {
  return unsafe?.chat?.id ?? Number(new URLSearchParams(location.search).get('chat') ?? 0);
}

async function api(path, payload) {
  const response = await fetch(path, {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return response.json();
}

function myName() {
  return unsafe?.user?.first_name ?? (new URLSearchParams(location.search).get('name') || 'Игрок');
}

function signedInit() {
  if (initData) return initData;
  const user = { id: myId(), first_name: myName() };
  const chat = { id: myChat(), type: 'CHAT' };
  return `auth_date=${Math.floor(Date.now() / 1000)}&user=${encodeURIComponent(JSON.stringify(user))}&chat=${encodeURIComponent(JSON.stringify(chat))}`;
}

function cellIndex(file, rankFromTop) {
  const rank = flipped ? rankFromTop : 7 - rankFromTop;
  const f = flipped ? 7 - file : file;
  return f + rank * 8;
}

function render() {
  board = new Board(game.fen);
  boardEl.innerHTML = '';

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const index = cellIndex(col, row);
      const piece = board.at(index);
      const isLight = (Math.floor(index / 8) + (index % 8)) % 2 === 1;

      const cell = document.createElement('div');
      cell.className = `cell ${isLight ? 'light' : 'dark'}`;
      cell.dataset.index = String(index);
      cell.textContent = piece ? GLYPHS[piece] : '';

      if (selected === index) cell.classList.add('selected');
      const target = legal.find((move) => move.to === index);
      if (target) cell.classList.add(target.captured ? 'capture' : 'move-target');

      if (game.moves.length) {
        const last = game.moves[game.moves.length - 1];
        const [fromName, toName] = last.replace(/[qrbn]$/, '').split('-');
        if ([fromName, toName].includes(squareName(index))) cell.classList.add('last-move');
      }

      if (row === 7) {
        const label = document.createElement('span');
        label.className = 'coord file';
        const fileLetter = 'abcdefgh'[flipped ? 7 - col : col];
        label.textContent = fileLetter;
        cell.appendChild(label);
      }
      if (col === 0) {
        const label = document.createElement('span');
        label.className = 'coord rank';
        label.textContent = String(flipped ? row + 1 : 8 - row);
        cell.appendChild(label);
      }

      cell.addEventListener('click', () => onCell(index));
      boardEl.appendChild(cell);
    }
  }

  gameIdEl.textContent = `#${game.id}`;
  playersEl.innerHTML = '';

  const entries = [
    { side: 'Чёрные', player: game.black, turn: board.turn === 'b' },
    { side: 'Белые', player: game.white, turn: board.turn === 'w' },
  ];

  for (const entry of entries) {
    const span = document.createElement('span');
    const name = entry.player ? entry.player.name : 'ждём соперника';
    span.textContent = `${entry.side}: ${name}${entry.turn && game.status === 'open' ? ' •' : ''}`;
    if (entry.player?.id === myId()) span.style.fontWeight = '700';
    playersEl.appendChild(span);
  }

  movesEl.textContent = game.moves.length ? game.moves.slice(-10).join('  ') : 'ходов пока нет';

  if (game.status === 'done') {
    const winner = game.winner === 'w' ? game.white?.name : game.winner === 'b' ? game.black?.name : null;
    statusEl.textContent = winner ? `Партия окончена. Победили: ${winner}` : 'Партия окончена. Ничья';
  } else if (!game.black) {
    statusEl.textContent = 'Ждём второго игрока';
  } else {
    statusEl.textContent = game.canMove ? 'Твой ход' : `Ход ${board.turn === 'w' ? 'белых' : 'чёрных'}`;
  }

  hintEl.textContent = game.role === 'spectator'
    ? 'Ты в этой партии зритель: играют двое из этого чата.'
    : 'Тапни фигуру, потом клетку. Ход отправится сразу.';
}

function onCell(index) {
  if (!game || game.status !== 'open' || busy) return;
  if (!game.canMove) {
    statusEl.textContent = 'Сейчас не твой ход';
    return;
  }

  const piece = board.at(index);
  const color = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null;

  if (selected === null) {
    if (!piece || color !== board.turn) return;
    selected = index;
    legal = board.movesFrom(index);
    render();
    return;
  }

  if (index === selected) {
    selected = null;
    legal = [];
    render();
    return;
  }

  const candidate = legal.find((move) => move.to === index);
  if (!candidate) {
    if (piece && color === board.turn) {
      selected = index;
      legal = board.movesFrom(index);
      render();
      return;
    }
    selected = null;
    legal = [];
    render();
    return;
  }

  const sameTarget = legal.filter((move) => move.to === index);
  if (sameTarget.some((move) => move.promotion)) {
    pendingPromotion = { from: selected, to: index };
    promoEl.classList.remove('hidden');
    return;
  }

  sendMove(selected, index);
}

async function sendMove(from, to, promo) {
  if (localMode) {
    const options = board.movesFrom(from).filter((m) => m.to === to);
    const move = options.find((m) => m.promotion === promo) ?? options[0];
    if (move) {
      const next = board.apply(move);
      game.fen = next.fen();
      game.moves.push(from + '-' + to);
      board = next;
    }
    selected = null;
    legal = [];
    render();
    return;
  }
  busy = true;
  try {
    const result = await api('/api/move', { initData: signedInit(), from, to, promo });
    if (result.error) {
      statusEl.textContent = result.error;
    } else if (result.game) {
      game = result.game;
    }
    selected = null;
    legal = [];
    render();
  } catch (error) {
    statusEl.textContent = 'Нет связи с сервером';
  } finally {
    busy = false;
  }
}

promoEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-piece]');
  if (!button || !pendingPromotion) return;
  const { from, to } = pendingPromotion;
  pendingPromotion = null;
  promoEl.classList.add('hidden');
  sendMove(from, to, button.dataset.piece);
});

document.getElementById('flip').addEventListener('click', () => {
  flipped = !flipped;
  render();
});

document.getElementById('copyInvite').addEventListener('click', async () => {
  const text = `Шахматы, партия #${game.id}: ${game.white?.name ?? ''} — ${game.black?.name ?? 'нужен соперник'}. Открывай мини-приложение и играй.`;
  try {
    await navigator.clipboard.writeText(text);
    hintEl.textContent = 'Текст скопирован — вставь в чат.';
  } catch {
    hintEl.textContent = text;
  }
});

async function enter() {
  if (!myChat() || !myId()) {
    startLocal();
    return;
  }
  try {
    const result = await api('/api/enter', { initData: signedInit() });
    if (result?.error || !result?.game) {
      startLocal();
      return;
    }
    game = result.game;
    flipped = game.role === 'black';
    render();
    poll();
  } catch {
    startLocal();
  }
}

async function poll() {
  try {
    const result = await api(`/api/state?chat=${myChat()}&user=${myId()}`);
    if (result.game && result.game.id === game?.id) {
      const changed = result.game.moves.length !== game.moves.length || result.game.status !== game.status;
      game = result.game;
      if (changed) render();
    }
  } catch {
    /* тихо: попробуем в следующий раз */
  }
  setTimeout(poll, 2500);
}

enter().catch((error) => {
  statusEl.textContent = `Ошибка: ${error.message}`;
});

function startLocal() {
  localMode = true;
  board = new Board();
  game = { id: 0, fen: board.fen(), moves: [], status: 'open', winner: null, white: { id: myId(), name: 'Первый' }, black: { name: 'второй игрок' }, role: 'white', canMove: true };
  render();
  hintEl.textContent = 'Без сервера: ходят оба по очереди на этом экране. Ходы в чат не уходят.';
}
