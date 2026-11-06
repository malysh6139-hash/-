const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const BISHOP = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const KING = [...BISHOP, ...ROOK];

function isWhite(piece) {
  return Boolean(piece) && piece === piece.toUpperCase();
}

function colorOf(piece) {
  if (!piece) return null;
  return isWhite(piece) ? 'w' : 'b';
}

function squareName(index) {
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}`;
}

function squareIndex(name) {
  const clean = String(name).toLowerCase().trim().replace(/ё/g, 'е');
  const file = 'abcdefgh'.indexOf(clean[0]);
  const rank = Number(clean[1]);
  if (file < 0 || !rank || rank < 1 || rank > 8) return -1;
  return file + (rank - 1) * 8;
}

export class Board {
  constructor(fen = START) {
    this.load(fen);
  }

  load(fen) {
    const [placement, turn, castling, enPassant, halfmove, fullmove] = String(fen).trim().split(/\s+/);
    this.squares = new Array(64).fill(null);

    let index = 56;
    let file = 0;
    for (const char of placement) {
      if (char === '/') {
        index -= 16;
        file = 0;
        continue;
      }
      if (/\d/.test(char)) {
        file += Number(char);
        index += Number(char);
        continue;
      }
      this.squares[index] = char;
      index += 1;
      file += 1;
    }

    this.turn = turn === 'b' ? 'b' : 'w';
    this.castling = castling && castling !== '-' ? castling : '';
    this.enPassant = enPassant && enPassant !== '-' ? squareIndex(enPassant) : -1;
    this.halfmove = Number(halfmove ?? 0);
    this.fullmove = Number(fullmove ?? 1);
  }

  clone() {
    const copy = new Board(START);
    copy.squares = this.squares.slice();
    copy.turn = this.turn;
    copy.castling = this.castling;
    copy.enPassant = this.enPassant;
    copy.halfmove = this.halfmove;
    copy.fullmove = this.fullmove;
    return copy;
  }

  at(index) {
    return this.squares[index] ?? null;
  }

  kingIndex(color) {
    const target = color === 'w' ? 'K' : 'k';
    return this.squares.indexOf(target);
  }

  attacked(index, byColor) {
    const [file, rank] = [index % 8, Math.floor(index / 8)];

    for (const [df, dr] of KNIGHT) {
      const f = file + df;
      const r = rank + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const piece = this.at(f + r * 8);
      if (piece && colorOf(piece) === byColor && piece.toLowerCase() === 'n') return true;
    }

    const pawnDir = byColor === 'w' ? -1 : 1;
    for (const df of [-1, 1]) {
      const f = file + df;
      const r = rank + pawnDir;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const piece = this.at(f + r * 8);
      if (piece && colorOf(piece) === byColor && piece.toLowerCase() === 'p') return true;
    }

    for (const [df, dr] of KING) {
      const f = file + df;
      const r = rank + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const piece = this.at(f + r * 8);
      if (piece && colorOf(piece) === byColor && piece.toLowerCase() === 'k') return true;
    }

    const slider = (directions, types) => {
      for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;
        while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
          const piece = this.at(f + r * 8);
          if (piece) {
            if (colorOf(piece) === byColor && types.includes(piece.toLowerCase())) return true;
            break;
          }
          f += df;
          r += dr;
        }
      }
      return false;
    };

    return slider(BISHOP, ['b', 'q']) || slider(ROOK, ['r', 'q']);
  }

  inCheck(color = this.turn) {
    const king = this.kingIndex(color);
    if (king < 0) return false;
    return this.attacked(king, color === 'w' ? 'b' : 'w');
  }

  movesFrom(index, { ignoreCheck = false } = {}) {
    const piece = this.at(index);
    if (!piece) return [];
    const color = colorOf(piece);
    const type = piece.toLowerCase();
    const moves = [];
    const [file, rank] = [index % 8, Math.floor(index / 8)];

    const push = (target, extra = {}) => {
      const captured = this.at(target);
      if (captured && colorOf(captured) === color) return false;
      moves.push({ from: index, to: target, piece, captured, ...extra });
      return !captured;
    };

    if (type === 'p') {
      const dir = color === 'w' ? 1 : -1;
      const startRank = color === 'w' ? 1 : 6;
      const promoRank = color === 'w' ? 7 : 0;

      const one = index + dir * 8;
      if (rank + dir >= 0 && rank + dir <= 7 && !this.at(one)) {
        if (Math.floor(one / 8) === promoRank) {
          for (const promo of ['q', 'r', 'b', 'n']) moves.push({ from: index, to: one, piece, captured: null, promotion: promo });
        } else {
          moves.push({ from: index, to: one, piece, captured: null });
          const two = index + dir * 16;
          if (rank === startRank && !this.at(two)) moves.push({ from: index, to: two, piece, captured: null });
        }
      }

      for (const df of [-1, 1]) {
        const f = file + df;
        if (f < 0 || f > 7) continue;
        const target = f + (rank + dir) * 8;
        const victim = this.at(target);
        if (victim && colorOf(victim) !== color) {
          if (Math.floor(target / 8) === promoRank) {
            for (const promo of ['q', 'r', 'b', 'n']) moves.push({ from: index, to: target, piece, captured: victim, promotion: promo });
          } else {
            moves.push({ from: index, to: target, piece, captured: victim });
          }
        } else if (!victim && target === this.enPassant) {
          moves.push({ from: index, to: target, piece, captured: color === 'w' ? 'p' : 'P', enPassant: true });
        }
      }
    } else if (type === 'n' || type === 'k') {
      const steps = type === 'n' ? KNIGHT : KING;
      for (const [df, dr] of steps) {
        const f = file + df;
        const r = rank + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        push(f + r * 8);
      }

      if (type === 'k') {
        const right = color === 'w' ? 'K' : 'k';
        const queenSide = color === 'w' ? 'Q' : 'q';
        const homeRank = color === 'w' ? 0 : 7;

        if (this.castling.includes(right) && index === homeRank * 8 + 4) {
          const rook = color === 'w' ? 'R' : 'r';
          if (
            this.at(homeRank * 8 + 5) === null &&
            this.at(homeRank * 8 + 6) === null &&
            this.at(homeRank * 8 + 7) === rook &&
            !this.attacked(homeRank * 8 + 4, color === 'w' ? 'b' : 'w') &&
            !this.attacked(homeRank * 8 + 5, color === 'w' ? 'b' : 'w') &&
            !this.attacked(homeRank * 8 + 6, color === 'w' ? 'b' : 'w')
          ) {
            moves.push({ from: index, to: homeRank * 8 + 6, piece, captured: null, castle: 'king' });
          }
        }

        if (this.castling.includes(queenSide) && index === homeRank * 8 + 4) {
          const rook = color === 'w' ? 'R' : 'r';
          if (
            this.at(homeRank * 8 + 3) === null &&
            this.at(homeRank * 8 + 2) === null &&
            this.at(homeRank * 8 + 1) === null &&
            this.at(homeRank * 8) === rook &&
            !this.attacked(homeRank * 8 + 4, color === 'w' ? 'b' : 'w') &&
            !this.attacked(homeRank * 8 + 3, color === 'w' ? 'b' : 'w') &&
            !this.attacked(homeRank * 8 + 2, color === 'w' ? 'b' : 'w')
          ) {
            moves.push({ from: index, to: homeRank * 8 + 2, piece, captured: null, castle: 'queen' });
          }
        }
      }
    } else {
      const directions = type === 'b' ? BISHOP : type === 'r' ? ROOK : KING;
      for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;
        while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
          const target = f + r * 8;
          const stopped = !push(target);
          if (stopped) break;
          f += df;
          r += dr;
        }
      }
    }

    if (ignoreCheck) return moves;
    return moves.filter((move) => {
      const next = this.apply(move, { silent: true });
      return !next.inCheck(color);
    });
  }

  legalMoves(color = this.turn) {
    const moves = [];
    for (let index = 0; index < 64; index += 1) {
      const piece = this.at(index);
      if (!piece || colorOf(piece) !== color) continue;
      moves.push(...this.movesFrom(index));
    }
    return moves;
  }

  apply(move, { silent = false } = {}) {
    const next = silent ? this.clone() : this;
    const { from, to, piece, promotion, enPassant } = move;
    const color = colorOf(piece);

    next.squares[to] = promotion ? (color === 'w' ? promotion.toUpperCase() : promotion) : piece;
    next.squares[from] = null;

    if (enPassant) {
      const victimIndex = color === 'w' ? to - 8 : to + 8;
      next.squares[victimIndex] = null;
    }

    if (move.castle === 'king') {
      next.squares[from + 1] = next.squares[from + 3];
      next.squares[from + 3] = null;
    } else if (move.castle === 'queen') {
      next.squares[from - 1] = next.squares[from - 4];
      next.squares[from - 4] = null;
    }

    if (piece.toLowerCase() === 'p' && Math.abs(to - from) === 16) {
      next.enPassant = (from + to) / 2;
    } else {
      next.enPassant = -1;
    }

    const strip = (flag) => {
      next.castling = next.castling.replace(flag, '');
    };

    if (piece === 'K') {
      strip('K');
      strip('Q');
    } else if (piece === 'k') {
      strip('k');
      strip('q');
    }
    if (piece === 'R' && from === 0) strip('Q');
    if (piece === 'R' && from === 7) strip('K');
    if (piece === 'r' && from === 56) strip('q');
    if (piece === 'r' && from === 63) strip('k');
    if (to === 0) strip('Q');
    if (to === 7) strip('K');
    if (to === 56) strip('q');
    if (to === 63) strip('k');

    next.halfmove = piece.toLowerCase() === 'p' || move.captured ? 0 : next.halfmove + 1;
    if (color === 'b') next.fullmove += 1;
    next.turn = color === 'w' ? 'b' : 'w';
    return next;
  }

  status() {
    const legal = this.legalMoves();
    const check = this.inCheck(this.turn);

    if (!legal.length) {
      return { over: true, winner: check ? (this.turn === 'w' ? 'b' : 'w') : null, check, reason: check ? 'mate' : 'stalemate' };
    }
    return { over: false, winner: null, check, reason: check ? 'check' : null };
  }

  fen() {
    const rows = [];
    for (let rank = 7; rank >= 0; rank -= 1) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const piece = this.at(file + rank * 8);
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += piece;
      }
      if (empty) row += empty;
      rows.push(row);
    }

    const castling = this.castling || '-';
    const enPassant = this.enPassant >= 0 ? squareName(this.enPassant) : '-';
    return `${rows.join('/')} ${this.turn} ${castling} ${enPassant} ${this.halfmove} ${this.fullmove}`;
  }
}

export function parseMove(board, input) {
  const text = String(input)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[её]/g, 'e')
    .replace(/[т]/g, 't')
    .replace(/[хx×]/g, 'x')
    .replace(/[–—−]/g, '-')
    .replace(/[^a-h0-9\-=knrqбокс/]/g, '')
    .replace(/\s+/g, '');

  const latin = String(input)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[а]/g, 'a')
    .replace(/[б]/g, 'b')
    .replace(/[ц]/g, 'c')
    .replace(/[д]/g, 'd')
    .replace(/[её]/g, 'e')
    .replace(/[ф]/g, 'f')
    .replace(/[г]/g, 'g')
    .replace(/[х]/g, 'h')
    .replace(/\s+/g, '');

  const clean = text || latin;
  const match = clean.match(/^([a-h][1-8])[-x]?([a-h][1-8])([qrbn])?$/);
  if (!match) return null;

  const from = squareIndex(match[1]);
  const to = squareIndex(match[2]);
  if (from < 0 || to < 0) return null;

  const candidates = board.movesFrom(from).filter((move) => move.to === to);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const promotion = match[3];
  if (promotion) return candidates.find((move) => move.promotion === promotion) ?? candidates[0];
  return candidates.find((move) => move.promotion === 'q') ?? candidates[0];
}

export { START, squareName, squareIndex, isWhite, colorOf };
