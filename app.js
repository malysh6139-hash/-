import { Board, parseMove, squareName } from './chess-engine.js';

const SOLID_GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const OUTLINE_TO_SOLID = { '♔': '♚', '♕': '♛', '♖': '♜', '♗': '♝', '♘': '♞', '♙': '♟' };

function glyphFor(piece) {
  return SOLID_GLYPHS[String(piece).toLowerCase()] ?? '';
}

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const gameIdEl = document.getElementById('gameId');
const playersEl = document.getElementById('players');
const movesEl = document.getElementById('moves');
const hintEl = document.getElementById('hint');
const promoEl = document.getElementById('promo');
const seatsEl = document.getElementById('seats');
const seatsTextEl = document.getElementById('seatsText');
const takeBlackEl = document.getElementById('takeBlack');
const watchOnlyEl = document.getElementById('watchOnly');
const menuBtn = document.getElementById('menuBtn');
const rulesEl = document.getElementById('rules');
const rulesClose = document.getElementById('rulesClose');

const FILE_NAMES = 'abcdefgh';

function paintDiagrams() {
  for (const el of document.querySelectorAll('[data-diagram]')) {
    if (el.dataset.painted) continue;
    el.dataset.painted = '1';
    let pieces = {};
    try {
      pieces = JSON.parse(el.dataset.pieces || '{}');
    } catch {
      pieces = {};
    }
    const marks = new Set((el.dataset.marks || '').split(/\s+/).filter(Boolean));
    const hits = new Set((el.dataset.hits || '').split(/\s+/).filter(Boolean));
    const cells = [];
    for (let index = 0; index < 64; index += 1) {
      const file = index % 8;
      const rank = Math.floor(index / 8);
      const name = `${FILE_NAMES[file]}${rank + 1}`;
      const isLight = (rank + file) % 2 === 1;
      const classes = ['dg-sq', isLight ? 'light' : 'dark'];
      const raw = pieces[name];
      if (raw) classes.push('src');
      if (!raw && marks.has(name)) classes.push('mark');
      if (!raw && hits.has(name)) classes.push('hit');
      let inner = '';
      if (raw) {
        const solid = OUTLINE_TO_SOLID[raw] ?? raw;
        const white = Boolean(OUTLINE_TO_SOLID[raw]);
        inner = `<span class="piece ${white ? 'piece-w' : 'piece-b'}">${solid}</span>`;
      }
      cells.push(`<div class="${classes.join(' ')}">${inner}</div>`);
    }
    el.innerHTML = cells.join('');
  }
}

function openRules() {
  paintDiagrams();
  rulesEl.classList.remove('hidden');
  rulesEl.querySelector('.rules-body').scrollTop = 0;
}

function closeRules() {
  rulesEl.classList.add('hidden');
}

menuBtn.addEventListener('click', openRules);
rulesClose.addEventListener('click', closeRules);
rulesEl.addEventListener('click', (event) => {
  if (event.target === rulesEl) closeRules();
});

let myRole = 'free';
let roleOrientation = null;
let offerSeat = false;

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

const SAVE_PREFIX = 'chess-max-save-v1';

function saveSlot() {
  return `${SAVE_PREFIX}:${myChat() || 'local'}:${myId() || 0}`;
}

function saveGame() {
  if (!game || !game.fen) return;
  try {
    localStorage.setItem(saveSlot(), JSON.stringify({
      game,
      flipped,
      mode: localMode ? 'local' : 'server',
      savedAt: Date.now(),
    }));
  } catch {
    /* приватный режим или переполнение — играем без сохранения */
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(saveSlot());
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.game?.fen) return null;
    new Board(saved.game.fen);
    if (!Array.isArray(saved.game.moves)) saved.game.moves = [];
    return saved;
  } catch {
    return null;
  }
}

function clearGame() {
  try {
    localStorage.removeItem(saveSlot());
  } catch {
    /* нечего чистить */
  }
}

const CFG = window.CHESS_CONFIG ?? {};
let supabaseClient = null;
let gameRowId = null;
let cloudMode = false;
let cloudChannel = null;

function cloudReady() {
  return Boolean(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
}

function roomName() {
  return myChat() ? `chat-${myChat()}` : 'demo';
}

function rowToGame(row) {
  return {
    id: 0,
    fen: row.board_state,
    moves: Array.isArray(row.moves) ? row.moves : [],
    status: row.status === 'done' ? 'done' : 'open',
    winner: null,
    white: { id: Number(row.white_id ?? 0), name: row.white_name ?? 'Белые' },
    black: { id: Number(row.black_id ?? 0), name: row.black_name ?? 'Чёрные' },
    role: 'white',
    canMove: true,
  };
}

function roleOf(row) {
  const me = myId();
  if (!me) return 'free';
  const whiteId = Number(row.white_id ?? 0);
  const blackId = Number(row.black_id ?? 0);
  if (whiteId && me === whiteId) return 'white';
  if (blackId && me === blackId) return 'black';
  return 'spectator';
}

function canMoveNow() {
  if (!game || game.status !== 'open' || busy) return false;
  if (myRole === 'free') return true;
  if (myRole === 'spectator') return false;
  return (myRole === 'white') === (board.turn === 'w');
}

function applyRow(row) {
  if (!row?.board_state) return;
  try {
    new Board(row.board_state);
  } catch {
    return;
  }
  const role = roleOf(row);
  if (role !== roleOrientation) {
    roleOrientation = role;
    if (role === 'black') flipped = true;
    else if (role === 'white') flipped = false;
  }
  myRole = role;
  offerSeat = role === 'spectator' && !Number(row.black_id ?? 0);
  game = rowToGame(row);
  render();
  saveGame();
}

async function cloudStart() {
  if (!cloudReady()) return false;
  supabaseClient = supabaseClient ?? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const table = supabaseClient.from(CFG.table || 'games');
  const room = roomName();

  const found = await table.select('*').eq('room', room).limit(1);
  if (found.error) throw new Error(found.error.message);
  let row = found.data?.[0];

  if (!row) {
    const fresh = new Board();
    const created = await table
      .insert([{ room, board_state: fresh.fen(), is_white_turn: true, moves: [] }])
      .select()
      .single();
    if (created.error) {
      const retry = await table.select('*').eq('room', room).limit(1);
      if (retry.error) throw new Error(created.error.message);
      row = retry.data?.[0] ?? null;
    } else {
      row = created.data;
    }
  }
  if (!row) throw new Error('партия не создалась');

  if (!Number(row.white_id ?? 0) && myId()) {
    const claim = await table
      .update({ white_id: myId(), white_name: myName(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('white_id', null)
      .select();
    if (!claim.error && claim.data?.[0]) row = claim.data[0];
  }

  gameRowId = row?.id ?? null;
  cloudMode = true;
  localMode = true;
  applyRow(row);
  cloudSubscribe();
  return true;
}

function cloudSubscribe() {
  if (!supabaseClient || !gameRowId) return;
  if (cloudChannel) supabaseClient.removeChannel(cloudChannel);
  cloudChannel = supabaseClient
    .channel(`chess-${roomName()}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: CFG.table || 'games', filter: `room=eq.${roomName()}` },
      (payload) => {
        if (payload?.new?.id === gameRowId) applyRow(payload.new);
      },
    )
    .subscribe();
}

async function cloudWrite(fields) {
  const table = supabaseClient.from(CFG.table || 'games');
  const res = await table
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', gameRowId)
    .select()
    .single();
  if (res.error) throw new Error(res.error.message);
  applyRow(res.data);
}

async function cloudMove(from, to, promo) {
  if (!game || busy) return;
  if (!canMoveNow()) {
    statusEl.textContent = myRole === 'spectator' ? 'Ты зритель — ходить нельзя' : 'Сейчас не твой ход';
    return;
  }
  busy = true;
  try {
    const position = new Board(game.fen);
    const options = position.movesFrom(from).filter((move) => move.to === to);
    const move = options.find((item) => item.promotion === promo) ?? options[0];
    if (!move) {
      statusEl.textContent = 'Так нельзя';
      return;
    }
    const next = position.apply(move);
    const moves = [...(game.moves ?? []), `${squareName(from)}-${squareName(to)}`];
    await cloudWrite({ board_state: next.fen(), is_white_turn: next.turn === 'w', moves });
    selected = null;
    legal = [];
  } catch (error) {
    statusEl.textContent = `Облако недоступно: ${error.message}`;
  } finally {
    busy = false;
  }
}

async function cloudReset() {
  try {
    const fresh = new Board();
    await cloudWrite({ board_state: fresh.fen(), is_white_turn: true, moves: [] });
  } catch (error) {
    statusEl.textContent = `Облако недоступно: ${error.message}`;
  }
}

const CHAT_TABLE = 'chess_messages';
const chatHeadEl = document.getElementById('chatHead');
const chatListEl = document.getElementById('chatList');
const chatFormEl = document.getElementById('chatForm');
const chatInputEl = document.getElementById('chatInput');

let chatMessages = [];
let chatChannel = null;
let chatReady = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function chatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderChat() {
  if (!chatListEl) return;
  if (!chatReady) {
    chatListEl.innerHTML = '<div class="chat-empty">Чат включится после запуска SQL в Supabase.</div>';
    return;
  }
  if (!chatMessages.length) {
    chatListEl.innerHTML = '<div class="chat-empty">Сообщений пока нет</div>';
    return;
  }
  chatListEl.innerHTML = chatMessages
    .map((message) => {
      const mine = Number(message.user_id ?? 0) === myId() ? ' mine' : '';
      const name = escapeHtml(message.name || 'Гость');
      const text = escapeHtml(message.text);
      return `<div class="chat-msg${mine}"><span class="chat-name">${name}</span><span class="chat-text">${text}</span><span class="chat-time">${chatTime(message.created_at)}</span></div>`;
    })
    .join('');
  chatListEl.scrollTop = chatListEl.scrollHeight;
}

function addChatMessage(message) {
  if (!message?.id) return;
  if (chatMessages.some((item) => item.id === message.id)) return;
  chatMessages.push(message);
  if (chatMessages.length > 60) chatMessages = chatMessages.slice(-60);
  renderChat();
}

function subscribeChat() {
  if (!supabaseClient || chatChannel) return;
  chatChannel = supabaseClient
    .channel(`chat-${roomName()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: CHAT_TABLE, filter: `room=eq.${roomName()}` },
      (payload) => addChatMessage(payload?.new),
    )
    .subscribe();
}

async function loadChat() {
  if (!cloudReady() || !chatFormEl) return;
  supabaseClient = supabaseClient ?? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const res = await supabaseClient
    .from(CHAT_TABLE)
    .select('*')
    .eq('room', roomName())
    .order('created_at', { ascending: false })
    .limit(50);
  if (res.error) {
    chatReady = false;
    if (chatHeadEl) chatHeadEl.textContent = 'Чат недоступен';
    renderChat();
    return;
  }
  chatReady = true;
  chatMessages = (res.data ?? []).slice().reverse();
  renderChat();
  subscribeChat();
}

async function sendChat() {
  if (!chatInputEl) return;
  const text = chatInputEl.value.trim();
  if (!text) return;
  chatInputEl.value = '';
  if (!chatReady) {
    if (chatHeadEl) chatHeadEl.textContent = 'Чат ещё не включён — нужна таблица в Supabase';
    return;
  }
  const res = await supabaseClient
    .from(CHAT_TABLE)
    .insert([{ room: roomName(), user_id: myId() || null, name: myName(), text: text.slice(0, 200) }])
    .select()
    .single();
  if (res.error) {
    if (chatHeadEl) chatHeadEl.textContent = `Чат: ${res.error.message}`;
    return;
  }
  addChatMessage(res.data);
}

if (chatFormEl) {
  chatFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    sendChat().catch(() => {});
  });
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
      if (piece) {
        const glyph = document.createElement('span');
        const white = piece === piece.toUpperCase();
        glyph.className = white ? 'piece piece-w' : 'piece piece-b';
        glyph.textContent = glyphFor(piece);
        cell.appendChild(glyph);
      }

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
    const name = entry.player?.name || 'место свободно';
    span.textContent = `${entry.side}: ${name}${entry.turn && game.status === 'open' ? ' •' : ''}`;
    if (entry.player?.id && entry.player.id === myId()) span.style.fontWeight = '700';
    playersEl.appendChild(span);
  }

  movesEl.textContent = game.moves.length ? game.moves.slice(-10).join('  ') : 'ходов пока нет';

  seatsEl.classList.toggle('hidden', !offerSeat);
  if (offerSeat) seatsTextEl.textContent = 'Чёрные свободны: играть или просто смотреть?';

  const turnText = board.turn === 'w' ? 'белых' : 'чёрных';
  if (game.status === 'done') {
    const winner = game.winner === 'w' ? game.white?.name : game.winner === 'b' ? game.black?.name : null;
    statusEl.textContent = winner ? `Партия окончена. Победили: ${winner}` : 'Партия окончена. Ничья';
  } else if (!game.black?.id) {
    statusEl.textContent = myRole === 'white' ? 'Ждём соперника' : `Ход ${turnText}`;
  } else if (myRole === 'spectator') {
    statusEl.textContent = `Зритель. Ход ${turnText}`;
  } else if (myRole === 'white' || myRole === 'black') {
    statusEl.textContent = canMoveNow() ? 'Твой ход' : `Ход ${turnText}`;
  } else {
    statusEl.textContent = `Ход ${turnText}`;
  }

  if (myRole === 'spectator') {
    hintEl.textContent = 'Ты зритель: играют двое. Их ходы появляются сами.';
  } else if (myRole === 'white' || myRole === 'black') {
    hintEl.textContent = `Ты играешь ${myRole === 'white' ? 'белыми' : 'чёрными'}. Тапни фигуру, потом клетку.`;
  } else {
    hintEl.textContent = 'Тапни фигуру, потом клетку. Ход отправится сразу.';
  }
}

function onCell(index) {
  if (!game || game.status !== 'open' || busy) return;
  if (!canMoveNow()) {
    statusEl.textContent = myRole === 'spectator' ? 'Ты зритель — ходить нельзя' : 'Сейчас не твой ход';
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
  if (cloudMode) {
    await cloudMove(from, to, promo);
    return;
  }
  if (localMode) {
    const options = board.movesFrom(from).filter((m) => m.to === to);
    const move = options.find((m) => m.promotion === promo) ?? options[0];
    if (move) {
      const next = board.apply(move);
      game.fen = next.fen();
      game.moves.push(`${squareName(from)}-${squareName(to)}`);
      board = next;
    }
    selected = null;
    legal = [];
    render();
    saveGame();
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
    saveGame();
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
  saveGame();
});

document.getElementById('reset').addEventListener('click', () => {
  clearGame();
  selected = null;
  legal = [];
  pendingPromotion = null;
  promoEl.classList.add('hidden');
  flipped = false;
  if (cloudMode) {
    cloudReset();
    return;
  }
  if (localMode || !myChat() || !myId()) {
    localMode = true;
    startLocal();
    return;
  }
  game = null;
  enter();
});

watchOnlyEl.addEventListener('click', () => {
  offerSeat = false;
  seatsEl.classList.add('hidden');
  render();
});

takeBlackEl.addEventListener('click', async () => {
  if (!cloudMode || !supabaseClient || !gameRowId) return;
  offerSeat = false;
  seatsEl.classList.add('hidden');
  try {
    const res = await supabaseClient
      .from(CFG.table || 'games')
      .update({ black_id: myId(), black_name: myName(), updated_at: new Date().toISOString() })
      .eq('id', gameRowId)
      .is('black_id', null)
      .select()
      .single();
    if (res.error) throw new Error(res.error.message);
    myRole = 'black';
    flipped = true;
    applyRow(res.data);
    saveGame();
  } catch {
    statusEl.textContent = 'Место за чёрных уже заняли — ты зритель';
    render();
  }
});

window.addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame();
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
  if (cloudReady()) {
    try {
      if (await cloudStart()) {
        loadChat().catch(() => {});
        return;
      }
    } catch (error) {
      cloudMode = false;
      statusEl.textContent = `Облако не отвечает: ${error.message}`;
    }
  }
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
    saveGame();
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
      if (changed) {
        render();
        saveGame();
      }
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
  const saved = loadGame();
  if (saved?.game) {
    game = { ...saved.game, role: 'white', canMove: saved.game.status !== 'done' };
    flipped = Boolean(saved.flipped);
  } else {
    board = new Board();
    game = { id: 0, fen: board.fen(), moves: [], status: 'open', winner: null, white: { id: myId(), name: 'Первый' }, black: { name: 'второй игрок' }, role: 'white', canMove: true };
    flipped = false;
  }
  selected = null;
  legal = [];
  render();
  saveGame();
  hintEl.textContent = saved?.game
    ? 'Партия сохранена на этом телефоне: продолжаем с того же хода.'
    : 'Без сервера: ходят оба по очереди на этом экране. Ходы в чат не уходят.';
}
