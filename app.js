import { Board, parseMove, squareName } from './chess-engine.js';

import { PIECE_IMAGES } from './pieces.js';

const GLYPH_LETTER = {
  '♟': 'p', '♜': 'r', '♞': 'n', '♝': 'b', '♛': 'q', '♚': 'k',
  '♙': 'p', '♖': 'r', '♘': 'n', '♗': 'b', '♕': 'q', '♔': 'k',
};
const GLYPH_IS_WHITE = { '♙': true, '♖': true, '♘': true, '♗': true, '♕': true, '♔': true };

function pieceImage(piece) {
  const white = piece === String(piece).toUpperCase();
  const letter = GLYPH_LETTER[piece] ?? String(piece).toLowerCase();
  const name = `${white ? 'w' : 'b'}${letter.toUpperCase()}`;
  const svg = PIECE_IMAGES[name] ?? PIECE_IMAGES.wP;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return `<img src="${uri}" alt="" draggable="false">`;
}

const boardEl = document.getElementById('board');
const tablesEl = document.getElementById('tables');
const roleEl = document.getElementById('role');
const resultEl = document.getElementById('result');
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
const peopleEl = document.getElementById('people');
const rulesEl = document.getElementById('rules');
const rulesClose = document.getElementById('rulesClose');

const FILE_NAMES = 'abcdefgh';
const APP_VERSION = '24';
const PIECE_FONT = "font-family:'Noto Sans Symbols 2','Noto Sans Symbols','Segoe UI Symbol','DejaVu Sans',serif;font-variant-emoji:text;";
const PIECE_STYLE_WHITE = `${PIECE_FONT}color:#ffffff;-webkit-text-stroke:1.2px #10131a;text-shadow:0 0 2px #000,0 1px 3px rgba(0,0,0,.85)`;
const PIECE_STYLE_BLACK = `${PIECE_FONT}color:#0d1015;-webkit-text-stroke:1.2px #f4f6fa;text-shadow:0 0 2px rgba(255,255,255,.7),0 1px 2px rgba(0,0,0,.5)`;

const MOJIBAKE = /Р[СџЎћ]|С[‚ѓ„…†‡€]|РµР|С‚Р|С‡Р|С€Р|РѕР|РїС|РёР/;

function looksBrokenHtml() {
  const samples = [
    document.querySelector('.title')?.textContent ?? '',
    document.getElementById('takeBlack')?.textContent ?? '',
    document.querySelector('.rules-title')?.textContent ?? '',
    document.getElementById('chatInput')?.getAttribute('placeholder') ?? '',
    document.getElementById('chatHead')?.textContent ?? '',
  ];
  return samples.some((sample) => MOJIBAKE.test(sample));
}

function healStaleHtml() {
  try {
    const meta = document.querySelector('meta[name="chess-version"]');
    const pageVersion = meta?.getAttribute('content') ?? '';
    const stale = looksBrokenHtml() || pageVersion !== APP_VERSION;
    if (!stale) return;
    if (sessionStorage.getItem('chess-heal') === '1') return;
    sessionStorage.setItem('chess-heal', '1');
    const url = new URL(location.href);
    url.searchParams.set('fresh', String(Date.now()));
    location.replace(url.toString());
  } catch {
    /* не смогли — работаем как есть */
  }
}

healStaleHtml();

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
        const white = Boolean(GLYPH_IS_WHITE[raw]);
        const letter = GLYPH_LETTER[raw] ?? 'p';
        inner = `<span class="piece ${white ? 'piece-w' : 'piece-b'}">${pieceImage(white ? letter.toUpperCase() : letter)}</span>`;
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

function myPhoto() {
  const user = unsafe?.user;
  const fromUrl = new URLSearchParams(location.search).get('photo') ?? '';
  return user?.photo_url ?? user?.photo?.url ?? fromUrl;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

const AVATAR_COLORS = ['#3b6ea5', '#8a5a2b', '#4a7c59', '#7a4f8a', '#a5503c', '#3f7d8c', '#8a7a2b', '#5a5a8a'];

function avatarColor(name) {
  let hash = 0;
  for (const ch of String(name || '?')) hash = (hash * 31 + ch.codePointAt(0)) % 9973;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarHtml(name, photo, extraClass = '') {
  const cls = `avatar${extraClass ? ` ${extraClass}` : ''}`;
  if (photo) return `<img class="${cls}" src="${escapeHtml(photo)}" alt="">`;
  const letter = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="${cls} avatar-letter" style="background:${avatarColor(name)}">${escapeHtml(letter)}</span>`;
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
let tables = [];

function cloudReady() {
  return Boolean(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
}

function roomName() {
  return myChat() ? `chat-${myChat()}` : 'demo';
}

function rowToGame(row) {
  const raw = row.status ?? 'open';
  const done = raw === 'done' || raw === 'white_won' || raw === 'black_won';
  const status = raw === 'closed' ? 'closed' : done ? 'done' : 'open';
  const winner = raw === 'white_won' || (raw === 'done' && row.winner === 'w')
    ? 'w'
    : raw === 'black_won' || (raw === 'done' && row.winner === 'b')
      ? 'b'
      : null;
  return {
    id: 0,
    fen: row.board_state,
    moves: Array.isArray(row.moves) ? row.moves : [],
    status,
    winner,
    white: { id: Number(row.white_id ?? 0), name: row.white_name ?? 'Белые', photo: row.white_photo ?? '' },
    black: { id: Number(row.black_id ?? 0), name: row.black_name ?? 'Чёрные', photo: row.black_photo ?? '' },
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
  setChatLocked(game.status !== 'open');
  if ((game.status === 'done' || game.status === 'closed') && clearedForGame !== gameRowId) {
    clearedForGame = gameRowId;
    clearChat();
  }
  if (game.status === 'open' && clearedForGame === gameRowId) clearedForGame = null;
  saveGame();
}

function tableSlot() {
  return `${SAVE_PREFIX}:table:${myChat() || 'local'}:${myId() || 0}`;
}

function savedTableId() {
  try {
    return localStorage.getItem(tableSlot());
  } catch {
    return null;
  }
}

function rememberTable(id) {
  try {
    if (id) localStorage.setItem(tableSlot(), String(id));
  } catch {
    /* без сохранения выбора */
  }
}

async function loadTables() {
  const name = CFG.table || 'games';
  const byNo = await supabaseClient
    .from(name)
    .select('*')
    .eq('room', roomName())
    .order('game_no', { ascending: false });
  if (!byNo.error) return byNo.data ?? [];

  const byTime = await supabaseClient
    .from(name)
    .select('*')
    .eq('room', roomName())
    .order('updated_at', { ascending: false });
  if (byTime.error) throw new Error(byNo.error.message);
  return byTime.data ?? [];
}

function pickTable(rows) {
  if (!rows?.length) return null;
  const open = rows.filter((row) => row.status === 'open');
  const pool = open.length ? open : rows;
  const saved = savedTableId();
  const bySaved = saved ? pool.find((row) => row.id === saved) : null;
  if (bySaved) return bySaved;
  const me = myId();
  const mine = me
    ? pool.find((row) => Number(row.white_id ?? 0) === me || Number(row.black_id ?? 0) === me)
    : null;
  if (mine) return mine;
  return pool[0];
}

function renderTables() {
  if (!tablesEl) return;
  const open = tables.filter((row) => row.status === 'open');
  if (open.length < 2) {
    tablesEl.classList.add('hidden');
    tablesEl.innerHTML = '';
    return;
  }
  tablesEl.classList.remove('hidden');
  const me = myId();
  tablesEl.innerHTML = open
    .map((row) => {
      const active = row.id === gameRowId ? ' active' : '';
      const mine = me && (Number(row.white_id ?? 0) === me || Number(row.black_id ?? 0) === me) ? ' •' : '';
      return `<button type="button" class="table-chip${active}" data-table="${row.id}">Стол ${row.game_no ?? 1}${mine}</button>`;
    })
    .join('');
}

async function switchTable(id) {
  if (!id || id === gameRowId) return;
  const row = tables.find((item) => item.id === id);
  if (!row) return;
  gameRowId = id;
  rememberTable(id);
  selected = null;
  legal = [];
  applyRow(row);
  renderTables();
  resetChatForGame();
}

if (tablesEl) {
  tablesEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-table]');
    if (!button) return;
    switchTable(button.dataset.table).catch(() => {});
  });
}

async function cloudStart() {
  if (!cloudReady()) return false;
  supabaseClient = supabaseClient ?? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const table = supabaseClient.from(CFG.table || 'games');

  tables = await loadTables();
  let row = pickTable(tables);

  if (!row) {
    const fresh = new Board();
    const base = { room: roomName(), board_state: fresh.fen(), is_white_turn: true, moves: [] };
    let created = await table.insert([{ ...base, game_no: 1 }]).select().single();
    if (created.error) {
      created = await table.insert([base]).select().single();
    }
    if (created.error) {
      tables = await loadTables();
      row = pickTable(tables);
    } else {
      row = created.data;
      tables = [row, ...tables];
    }
  }
  if (!row) throw new Error('партия не создалась');

  if (!Number(row.white_id ?? 0) && myId()) {
    const base = { white_id: myId(), white_name: myName(), updated_at: new Date().toISOString() };
    const photo = myPhoto();
    let claim = photo
      ? await table.update({ ...base, white_photo: photo }).eq('id', row.id).is('white_id', null).select()
      : null;
    if (!claim || claim.error) {
      claim = await table.update(base).eq('id', row.id).is('white_id', null).select();
    }
    if (!claim.error && claim.data?.[0]) row = claim.data[0];
  }

  gameRowId = row?.id ?? null;
  if (gameRowId) rememberTable(gameRowId);
  cloudMode = true;
  localMode = true;
  applyRow(row);
  renderTables();
  syncMyPhoto();
  cloudSubscribe();
  startPeople();
  return true;
}

let peopleChannel = null;

async function syncMyPhoto() {
  const photo = myPhoto();
  if (!supabaseClient || !gameRowId || !photo) return;
  const me = myId();
  const patch = {};
  if (myRole === 'white' && Number(game?.white?.id ?? 0) === me && game.white.photo !== photo) {
    patch.white_photo = photo;
  }
  if (myRole === 'black' && Number(game?.black?.id ?? 0) === me && game.black.photo !== photo) {
    patch.black_photo = photo;
  }
  if (!Object.keys(patch).length) return;
  const res = await supabaseClient
    .from(CFG.table || 'games')
    .update(patch)
    .eq('id', gameRowId)
    .select()
    .single();
  if (!res.error && res.data) applyRow(res.data);
}

function startPeople() {
  if (!supabaseClient || !peopleEl) return;
  if (peopleChannel) supabaseClient.removeChannel(peopleChannel);
  peopleChannel = supabaseClient.channel(`people-${roomName()}`, {
    config: { presence: { key: String(myId() || Math.random().toString(36).slice(2)) } },
  });
  peopleChannel.on('presence', { event: 'sync' }, () => {
    const count = Object.keys(peopleChannel.presenceState()).length;
    peopleEl.textContent = count > 0 ? `За доской: ${count}` : '';
  });
  peopleChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') peopleChannel.track({ id: myId() || 0, at: Date.now() });
  });
}

function cloudSubscribe() {
  if (!supabaseClient) return;
  if (cloudChannel) supabaseClient.removeChannel(cloudChannel);
  cloudChannel = supabaseClient
    .channel(`chess-${roomName()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: CFG.table || 'games', filter: `room=eq.${roomName()}` },
      (payload) => {
        const row = payload?.new;
        if (!row?.id) return;
        const index = tables.findIndex((item) => item.id === row.id);
        if (index >= 0) tables[index] = row;
        else tables.unshift(row);
        tables.sort((a, b) => Number(b.game_no ?? 0) - Number(a.game_no ?? 0));
        if (row.id === gameRowId) applyRow(row);
        renderTables();
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
    await cloudWrite({ board_state: fresh.fen(), is_white_turn: true, moves: [], status: 'open' });
    await clearChat();
  } catch (error) {
    statusEl.textContent = `Облако недоступно: ${error.message}`;
  }
}

async function cloudResign() {
  if (!cloudMode || !gameRowId) {
    statusEl.textContent = 'Сдаться можно в партии из чата';
    return;
  }
  if (game?.status !== 'open') {
    statusEl.textContent = 'Партия уже закончена';
    return;
  }
  if (myRole !== 'white' && myRole !== 'black') {
    statusEl.textContent = 'Ты зритель — сдаваться некому';
    return;
  }
  try {
    await cloudWrite({ status: myRole === 'white' ? 'black_won' : 'white_won' });
  } catch (error) {
    statusEl.textContent = `Не получилось: ${error.message}`;
  }
}

async function cloudCloseTable() {
  if (!cloudMode || !gameRowId) {
    statusEl.textContent = 'Закрывать можно партию из чата';
    return;
  }
  const seated = myRole === 'white' || myRole === 'black';
  if (!seated && Number(game?.white?.id ?? 0)) {
    statusEl.textContent = 'Закрыть стол может только игрок этого стола';
    return;
  }
  try {
    await cloudWrite({ status: 'closed' });
  } catch (error) {
    statusEl.textContent = `Не получилось: ${error.message}`;
    return;
  }
  const next = tables.find((row) => row.id !== gameRowId && row.status === 'open');
  if (next) {
    gameRowId = next.id;
    rememberTable(next.id);
    applyRow(next);
    renderTables();
    return;
  }
  await openFreshTable();
}

async function openFreshTable() {
  const table = supabaseClient.from(CFG.table || 'games');
  const nextNo = tables.reduce((max, row) => Math.max(max, Number(row.game_no ?? 0)), 0) + 1;
  const fresh = new Board();
  const base = {
    room: roomName(),
    board_state: fresh.fen(),
    is_white_turn: true,
    moves: [],
    white_id: myId() || null,
    white_name: myName(),
    black_id: null,
    black_name: null,
    status: 'open',
    updated_at: new Date().toISOString(),
  };
  let created = await table.insert([{ ...base, game_no: nextNo }]).select().single();
  if (created.error) created = await table.insert([base]).select().single();
  if (created.error) {
    statusEl.textContent = `Не получилось открыть новый стол: ${created.error.message}`;
    return;
  }
  const row = created.data;
  tables = [row, ...tables];
  gameRowId = row.id;
  rememberTable(row.id);
  applyRow(row);
  renderTables();
  resetChatForGame();
}

const CHAT_TABLE = 'chess_messages';
const chatHeadEl = document.getElementById('chatHead');
const chatListEl = document.getElementById('chatList');
const chatFormEl = document.getElementById('chatForm');
const chatInputEl = document.getElementById('chatInput');
const chatSendEl = document.getElementById('chatSend');

let clearedForGame = null;

function setChatLocked(locked) {
  if (chatInputEl) {
    chatInputEl.disabled = locked;
    chatInputEl.placeholder = locked ? 'Партия окончена — чат закрыт' : 'Написать всем за доской…';
  }
  if (chatSendEl) chatSendEl.disabled = locked;
}

let chatMessages = [];
let chatChannel = null;
let chatReady = false;

function chatRoom() {
  return `${roomName()}#${gameRowId || 'lobby'}`;
}

function resetChatForGame() {
  chatMessages = [];
  renderChat();
  if (chatReady) loadChat();
}

async function clearChat() {
  const room = chatRoom();
  chatMessages = [];
  renderChat();
  if (!supabaseClient) return;
  await supabaseClient.from(CHAT_TABLE).delete().eq('room', room);
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
      const avatar = avatarHtml(message.name, message.photo ?? '', 'avatar-sm');
      return `<div class="chat-msg${mine}">${avatar}<span class="chat-name">${name}</span><span class="chat-text">${text}</span><span class="chat-time">${chatTime(message.created_at)}</span></div>`;
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
    .channel(`chat-${chatRoom()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: CHAT_TABLE, filter: `room=eq.${chatRoom()}` },
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
    .eq('room', chatRoom())
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
  const base = { room: chatRoom(), user_id: myId() || null, name: myName(), text: text.slice(0, 200) };
  const photo = myPhoto();
  let res = photo
    ? await supabaseClient.from(CHAT_TABLE).insert([{ ...base, photo }]).select().single()
    : null;
  if (!res || res.error) {
    res = await supabaseClient.from(CHAT_TABLE).insert([base]).select().single();
  }
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
        glyph.innerHTML = pieceImage(piece);
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

  gameIdEl.textContent = game.id ? `#${game.id}` : '';

  if (roleEl) {
    if (myRole === 'white') {      roleEl.className = 'role white';
      roleEl.textContent = 'Ты играешь белыми';
    } else if (myRole === 'black') {
      roleEl.className = 'role black';
      roleEl.textContent = 'Ты играешь чёрными';
    } else if (myRole === 'spectator') {
      roleEl.className = 'role spectator';
      roleEl.textContent = 'Ты смотришь';
    } else {
      roleEl.className = 'role hidden';
      roleEl.textContent = '';
    }
  }

  playersEl.innerHTML = '';

  const entries = [
    { side: 'Чёрные', player: game.black, turn: board.turn === 'b' },
    { side: 'Белые', player: game.white, turn: board.turn === 'w' },
  ];

  for (const entry of entries) {
    const span = document.createElement('span');
    const name = entry.player?.id ? entry.player.name : 'свободно';
    const mine = Boolean(entry.player?.id) && entry.player.id === myId();
    const label = `${entry.side}: ${escapeHtml(name)}${mine ? ' (вы)' : ''}${entry.turn && game.status === 'open' ? ' •' : ''}`;
    span.className = `player${mine ? ' mine' : ''}`;
    const avatar = entry.player?.id ? avatarHtml(name, entry.player?.photo ?? '') : '';
    span.innerHTML = `${avatar}<span class="player-label">${label}</span>`;
    playersEl.appendChild(span);
  }

  movesEl.textContent = game.moves.length ? game.moves.slice(-10).join('  ') : 'ходов пока нет';

  seatsEl.classList.toggle('hidden', !offerSeat);
  if (offerSeat) seatsTextEl.textContent = 'Чёрные свободны: играть или просто смотреть?';

  const turnText = board.turn === 'w' ? 'белых' : 'чёрных';

  if (resultEl) {
    const won = game.status === 'done' ? game.winner : null;
    const draw = game.status === 'done' && !won;
    if (won) {
      const sideName = won === 'w' ? 'Белые' : 'Чёрные';
      const iAmWinner = myRole === (won === 'w' ? 'white' : 'black');
      const iAmLoser = (myRole === 'white' || myRole === 'black') && !iAmWinner;
      const text = iAmWinner ? 'Вы выиграли' : iAmLoser ? 'Вы проиграли' : `${sideName} победили`;
      resultEl.className = `result ${iAmWinner ? 'win' : iAmLoser ? 'lose' : 'draw'}`;
      resultEl.textContent = text;
    } else if (draw) {
      resultEl.className = 'result draw';
      resultEl.textContent = 'Ничья';
    } else {
      resultEl.className = 'result hidden';
      resultEl.textContent = '';
    }
  }
  if (game.status === 'closed') {
    statusEl.textContent = 'Стол закрыт';
  } else if (game.status === 'done') {
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

document.getElementById('resign').addEventListener('click', () => {
  cloudResign().catch(() => {});
});

document.getElementById('closeTable').addEventListener('click', () => {
  cloudCloseTable().catch(() => {});
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
    const base = { black_id: myId(), black_name: myName(), updated_at: new Date().toISOString() };
    const photo = myPhoto();
    let res = photo
      ? await supabaseClient
        .from(CFG.table || 'games')
        .update({ ...base, black_photo: photo })
        .eq('id', gameRowId)
        .is('black_id', null)
        .select()
        .single()
      : null;
    if (!res || res.error) {
      res = await supabaseClient
        .from(CFG.table || 'games')
        .update(base)
        .eq('id', gameRowId)
        .is('black_id', null)
        .select()
        .single();
    }
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


const floatBtnEl = document.getElementById('floatBtn');
const floatMenuEl = document.getElementById('floatMenu');
const FLOAT_KEY = 'chess-float-pos';
const BOT_LEVEL_NAMES = { easy: 'Лёгкий', mid: 'Средний', hard: 'Гроссмейстер' };

let floatStep = 'root';
let floatLevel = 'easy';
let dragState = null;

function placeFloat(left, top) {
  if (!floatBtnEl) return { x: 8, y: 8 };
  const size = floatBtnEl.offsetWidth || 44;
  const x = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - size - 8));
  const y = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - size - 8));
  floatBtnEl.style.left = `${x}px`;
  floatBtnEl.style.top = `${y}px`;
  floatBtnEl.style.right = 'auto';
  return { x, y };
}

function loadFloatPosition() {
  if (!floatBtnEl) return;
  try {
    const saved = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      placeFloat(saved.x, saved.y);
      return;
    }
  } catch {
    /* позиция по умолчанию */
  }
  placeFloat(window.innerWidth - 60, 10);
}

function closeFloatMenu() {
  if (!floatMenuEl) return;
  floatMenuEl.classList.add('hidden');
  floatStep = 'root';
}

function openFloatMenuAt() {
  if (!floatMenuEl || !floatBtnEl) return;
  const rect = floatBtnEl.getBoundingClientRect();
  renderFloatMenu();
  floatMenuEl.classList.remove('hidden');
  const menuRect = floatMenuEl.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuRect.width - 8));
  const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - menuRect.height - 8));
  floatMenuEl.style.left = `${left}px`;
  floatMenuEl.style.top = `${top}px`;
}

function menuItem(text, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', () => action().catch(() => {}));
  return button;
}

async function createBotTable(side, level) {
  if (!cloudReady() || !supabaseClient) {
    statusEl.textContent = 'Без связи нельзя позвать бота';
    return;
  }
  const botId = Number(CFG.botId ?? 0);
  if (!botId) {
    statusEl.textContent = 'Бот не настроен';
    return;
  }
  const botName = `Бот · ${BOT_LEVEL_NAMES[level] ?? BOT_LEVEL_NAMES.easy}`;
  const human = { id: myId() || 0, name: myName() };
  const machine = { id: botId, name: botName };
  const white = side === 'w' ? human : machine;
  const black = side === 'w' ? machine : human;

  const table = supabaseClient.from(CFG.table || 'games');
  const nextNo = tables.reduce((max, row) => Math.max(max, Number(row.game_no ?? 0)), 0) + 1;
  const fresh = new Board();
  const base = {
    room: roomName(),
    board_state: fresh.fen(),
    is_white_turn: true,
    moves: [],
    white_id: white.id || null,
    white_name: white.name,
    black_id: black.id || null,
    black_name: black.name,
    status: 'open',
    updated_at: new Date().toISOString(),
  };

  let created = await table.insert([{ ...base, game_no: nextNo }]).select().single();
  if (created.error) created = await table.insert([base]).select().single();
  if (created.error) {
    statusEl.textContent = `Бот не сел: ${created.error.message}`;
    return;
  }
  const row = created.data;
  tables = [row, ...tables];
  gameRowId = row.id;
  rememberTable(row.id);
  applyRow(row);
  renderTables();
  resetChatForGame();
  closeFloatMenu();
  statusEl.textContent = `Стол с ботом (${BOT_LEVEL_NAMES[level] ?? ''}) готов`;
}

function renderFloatMenu() {
  if (!floatMenuEl) return;
  floatMenuEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'float-menu-title';
  title.textContent = 'Меню';
  floatMenuEl.appendChild(title);

  if (floatStep === 'root') {
    floatMenuEl.appendChild(menuItem('♟ Игра', async () => { floatStep = 'mode'; renderFloatMenu(); }));
    floatMenuEl.appendChild(menuItem('🎲 Предложить спор', async () => {
      closeFloatMenu();
      hintEl.textContent = 'Напиши в чат: спор Локо-Динамо — бот соберёт ставки';
    }));
    floatMenuEl.appendChild(menuItem('🍺 Долги', async () => {
      closeFloatMenu();
      hintEl.textContent = 'Напиши в чат: долги — бот покажет, кто кому проставляется';
    }));
    floatMenuEl.appendChild(menuItem('ℹ Правила', async () => { closeFloatMenu(); openRules(); }));
    return;
  }

  if (floatStep === 'mode') {
    floatMenuEl.appendChild(menuItem('👤 Соперник', async () => {
      await openFreshTable();
      closeFloatMenu();
      hintEl.textContent = 'Стол создан. Позови соперника в чате';
    }));
    floatMenuEl.appendChild(menuItem('🤖 Бот', async () => { floatStep = 'level'; renderFloatMenu(); }));
    floatMenuEl.appendChild(menuItem('← Назад', async () => { floatStep = 'root'; renderFloatMenu(); }));
    return;
  }

  if (floatStep === 'level') {
    floatMenuEl.appendChild(menuItem('Лёгкий', async () => { floatLevel = 'easy'; floatStep = 'side'; renderFloatMenu(); }));
    floatMenuEl.appendChild(menuItem('Средний', async () => { floatLevel = 'mid'; floatStep = 'side'; renderFloatMenu(); }));
    floatMenuEl.appendChild(menuItem('Гроссмейстер', async () => { floatLevel = 'hard'; floatStep = 'side'; renderFloatMenu(); }));
    floatMenuEl.appendChild(menuItem('← Назад', async () => { floatStep = 'mode'; renderFloatMenu(); }));
    return;
  }

  if (floatStep === 'side') {
    floatMenuEl.appendChild(menuItem('♔ Я белые', async () => createBotTable('w', floatLevel)));
    floatMenuEl.appendChild(menuItem('♚ Я чёрные', async () => createBotTable('b', floatLevel)));
    floatMenuEl.appendChild(menuItem('← Назад', async () => { floatStep = 'level'; renderFloatMenu(); }));
    return;
  }
}

if (floatBtnEl) {
  floatBtnEl.addEventListener('pointerdown', (event) => {
    const rect = floatBtnEl.getBoundingClientRect();
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      x: rect.left,
      y: rect.top,
      moved: false,
      last: { x: rect.left, y: rect.top },
    };
    try { floatBtnEl.setPointerCapture(event.pointerId); } catch { /* старые браузеры */ }
  });

  floatBtnEl.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragState.moved = true;
    dragState.last = placeFloat(dragState.x + dx, dragState.y + dy);
  });

  floatBtnEl.addEventListener('pointerup', () => {
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    if (state.moved) {
      try { localStorage.setItem(FLOAT_KEY, JSON.stringify(state.last)); } catch { /* без сохранения */ }
      return;
    }
    if (floatMenuEl && !floatMenuEl.classList.contains('hidden')) closeFloatMenu();
    else openFloatMenuAt();
  });

  loadFloatPosition();
  window.addEventListener('resize', () => {
    if (!floatBtnEl) return;
    const rect = floatBtnEl.getBoundingClientRect();
    placeFloat(rect.left, rect.top);
    if (floatMenuEl && !floatMenuEl.classList.contains('hidden')) openFloatMenuAt();
  });
}
