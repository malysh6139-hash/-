const GLYPHS = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

const NAMES = {
  K: 'король',
  Q: 'ферзь',
  R: 'ладья',
  B: 'слон',
  N: 'конь',
  P: 'пешка',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function pieceName(piece) {
  return NAMES[piece.toUpperCase()] ?? 'фигура';
}

function renderBoard(board) {
  const rows = ['   a b c d e f g h'];
  for (let rank = 7; rank >= 0; rank -= 1) {
    const cells = [];
    for (let file = 0; file < 8; file += 1) {
      const piece = board.at(file + rank * 8);
      cells.push(piece ? GLYPHS[piece] : '·');
    }
    rows.push(`${rank + 1}  ${cells.join(' ')}  ${rank + 1}`);
  }
  rows.push('   a b c d e f g h');
  return rows.join('\n');
}

function describeMove(board, move) {
  const from = `${FILES[move.from % 8]}${Math.floor(move.from / 8) + 1}`;
  const to = `${FILES[move.to % 8]}${Math.floor(move.to / 8) + 1}`;
  const who = board.turn === 'w' ? 'Белые' : 'Чёрные';
  const parts = [`${who}: ${pieceName(move.piece)} ${from}→${to}`];

  if (move.castle === 'king') parts.push('рокировка в короткую сторону');
  if (move.castle === 'queen') parts.push('рокировка в длинную сторону');
  if (move.enPassant) parts.push('взятие на проходе');
  if (move.captured) parts.push(`съедена ${pieceName(move.captured)}`);
  if (move.promotion) parts.push(`превращение в ${pieceName(move.promotion.toUpperCase())}`);

  return parts.join(', ');
}

export { GLYPHS, FILES, pieceName, renderBoard, describeMove };
