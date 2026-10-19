import { LAUNCH_WINDOW_MS } from './launch-clock.js';

export const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export const other = mark => mark === 'X' ? 'O' : 'X';
export const emptyBoard = () => Array(9).fill(null);
export const emptyCells = board => board.flatMap((cell, i) => cell ? [] : [i]);

export function result(board) {
  for (const line of LINES) {
    if (board[line[0]] && line.every(i => board[i] === board[line[0]])) {
      return { over: true, winner: board[line[0]], line };
    }
  }
  return { over: board.every(Boolean), winner: null, line: [] };
}

const memo = new Map();
function score(board, turn, maximizer) {
  const end = result(board);
  if (end.over) return end.winner ? (end.winner === maximizer ? 10 + emptyCells(board).length : -10 - emptyCells(board).length) : 0;
  const key = `${board.map(x => x || '-').join('')}:${turn}:${maximizer}`;
  if (memo.has(key)) return memo.get(key);
  let best = turn === maximizer ? -Infinity : Infinity;
  for (const i of emptyCells(board)) {
    board[i] = turn;
    const value = score(board, other(turn), maximizer);
    board[i] = null;
    best = turn === maximizer ? Math.max(best, value) : Math.min(best, value);
  }
  memo.set(key, best);
  return best;
}

export function perfectMove(board, mark = 'O', random = Math.random) {
  if (result(board).over) return null;
  const copy = [...board];
  let best = -Infinity;
  let choices = [];
  for (const i of emptyCells(copy)) {
    copy[i] = mark;
    const value = score(copy, other(mark), mark);
    copy[i] = null;
    if (value > best) { best = value; choices = [i]; }
    else if (value === best) choices.push(i);
  }
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

// Joshua is still learning in the first two human rounds. Zero-player mode
// always uses perfectMove for both marks and therefore never invents a win.
export function learningMove(board, round = 1, random = Math.random) {
  const free = emptyCells(board);
  if (!free.length || result(board).over) return null;
  for (const i of free) {
    const next = [...board]; next[i] = 'O';
    if (result(next).winner === 'O') return i;
  }
  const mistake = round === 1 ? .36 : round === 2 ? .16 : 0;
  return random() < mistake ? free[Math.min(free.length - 1, Math.floor(random() * free.length))] : perfectMove(board, 'O', random);
}

export function selfPlay(random = Math.random) {
  const board = emptyBoard();
  const frames = [];
  let mark = 'X';
  while (!result(board).over) {
    const move = perfectMove(board, mark, random);
    board[move] = mark;
    frames.push([...board]);
    mark = other(mark);
  }
  return frames;
}

export function nextOutcome({ history = [], players, remainingMs = LAUNCH_WINDOW_MS }) {
  if (remainingMs <= 0) return 'launch';
  if (players === 0) return selfPlayUnlocked(history) ? 'selfplay' : 'next-round';
  return 'next-round';
}

export const SELF_PLAY_UNLOCK_ROUNDS = 3;
export function selfPlayUnlocked(history) { return history.length >= SELF_PLAY_UNLOCK_ROUNDS; }

export function roundDialogue(outcome) {
  if(outcome==='human')return 'You have won the game. But I will win the next game.';
  if(outcome==='computer')return "I have won this round. Shall we play again?";
  return 'Stalemate. No winner in this round.';
}
