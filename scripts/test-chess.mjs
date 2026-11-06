import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Board, parseMove, START } from '../src/chess/engine.js';
import { ChessService } from '../src/chess/game.js';

const results = [];
const check = (name, ok) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}`);

function perft(board, depth) {
  if (depth === 0) return 1;
  let total = 0;
  for (const move of board.legalMoves()) total += perft(board.apply(move, { silent: true }), depth - 1);
  return total;
}

check('старт 20 ходов', perft(new Board(), 1) === 20);
check('глубина 2 — 400', perft(new Board(), 2) === 400);
check('глубина 3 — 8902', perft(new Board(), 3) === 8902);

const castling = new Board('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
const castles = castling.movesFrom(4).filter((move) => move.castle);
check('рокировки доступны', castles.length === 2);

const blocked = new Board('r3k2r/8/8/8/8/8/8/R3K1NR w KQkq - 0 1');
check('рокировка перекрыта конём', !blocked.movesFrom(4).some((move) => move.castle === 'king'));

const ep = new Board('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
const epMove = ep.movesFrom(36).find((move) => move.enPassant);
check('взятие на проходе есть', Boolean(epMove));
check('взятие на проходе убирает пешку', epMove ? ep.apply(epMove).at(35) === null : false);

const promo = new Board('8/P7/8/8/8/8/8/K6k w - - 0 1');
const promos = promo.movesFrom(48).filter((move) => move.promotion);
check('превращение — 4 варианта', promos.length === 4);
const queened = promo.apply(promos.find((move) => move.promotion === 'q'));
check('пешка стала ферзём', queened.at(56) === 'Q');
check('превращение в коня', promo.apply(promos.find((move) => move.promotion === 'n')).at(56) === 'N');

const mate = new Board('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
check('мат распознан', mate.status().over && mate.status().winner === 'b');

const stale = new Board('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
check('пат — ничья без победителя', stale.status().over && stale.status().winner === null);

const checkBoard = new Board('rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2');
check('шаха нет на старте', !checkBoard.inCheck());

check('кириллица е2 е4 понята', Boolean(parseMove(new Board(), 'е2 е4')));
check('латинская запись понята', Boolean(parseMove(new Board(), 'e2-e4')));
check('нелегальный ход отклонён', parseMove(new Board(), 'e2 e5') === null);
check('длинная запись с фигурой понятна', Boolean(parseMove(new Board(START), 'g1 f3')));

const log = [];
let seq = 0;
const api = {
  async sendMessage(chatId, payload) {
    log.push(payload.text);
    return { message: { body: { mid: `m${(seq += 1)}` } } };
  },
  async call() {
    return { members: [{ user_id: 1, first_name: 'Сергей' }, { user_id: 2, first_name: 'Алексей' }] };
  },
};

const svc = new ChessService(api, join(mkdtempSync(join(tmpdir(), 'chess-')), 'games.json'));
const sergey = { user_id: 1, first_name: 'Сергей' };
const alex = { user_id: 2, first_name: 'Алексей' };

await svc.start(-1, 'шахматы с Алексеем', sergey);
check('партия создана с соперником', svc.current(-1)?.black.name === 'Алексей');
check('доска отправлена', log.at(-1).includes('a b c d e f g h'));

await svc.move(-1, 'е2 е4', sergey);
check('ход белых принят', svc.current(-1).moves[0] === 'e2-e4');
await svc.move(-1, 'e7 e5', alex);
check('ход чёрных принят', svc.current(-1).moves[1] === 'e7-e5');

const before = log.length;
await svc.move(-1, 'd7 d5', alex);
check('чужой ход не прошёл', log.slice(before).some((text) => text.includes('Сейчас ход белых')));

const fool = new ChessService(api, join(mkdtempSync(join(tmpdir(), 'chess2-')), 'games.json'));
await fool.start(-1, 'шахматы с Алексеем', sergey);
await fool.move(-1, 'f2 f3', sergey);
await fool.move(-1, 'e7 e5', alex);
await fool.move(-1, 'g2 g4', sergey);
await fool.move(-1, 'd8 h4', alex);
check('мат в партии зафиксирован', fool.state.games.at(-1)?.status === 'done' && fool.state.games.at(-1)?.winner === 'b');
check('победитель назван в чате', log.some((text) => text.includes('Победа: Алексей')));

await svc.resign(-1, sergey);
check('сдача закрывает партию', svc.current(-1) === undefined);

for (const line of results) console.log(line);
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(failed ? `\nпровалов: ${failed}` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
