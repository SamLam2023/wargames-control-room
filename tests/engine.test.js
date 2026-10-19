import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, result, perfectMove, learningMove, selfPlay, nextOutcome, roundDialogue, selfPlayUnlocked, LINES } from '../src/engine.js';

test('all winning lines, draws and unfinished boards are distinguished', () => {
  for (const mark of ['X', 'O']) for (const line of LINES) {
    const board = emptyBoard(); for (const i of line) board[i] = mark;
    assert.equal(result(board).winner, mark);
    assert.deepEqual(result(board).line, line);
  }
  assert.deepEqual(result(['X','O','X','X','O','O','O','X','X']), { over: true, winner: null, line: [] });
  assert.equal(result(emptyBoard()).over, false);
});

test('perfect computer never loses against any possible human path', () => {
  let endings = 0;
  function visit(board) {
    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      const next = [...board]; next[i] = 'X';
      let end = result(next);
      assert.notEqual(end.winner, 'X');
      if (end.over) { endings++; continue; }
      const move = perfectMove(next, 'O', () => 0);
      assert.equal(next[move], null);
      next[move] = 'O'; end = result(next);
      assert.notEqual(end.winner, 'X');
      if (end.over) endings++;
      else visit(next);
    }
  }
  visit(emptyBoard());
  assert.ok(endings > 100);
});

test('varied optimal self-play always draws in nine legal moves', () => {
  let seed = 123456;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const openings = new Set();
  for (let run = 0; run < 150; run++) {
    const frames = selfPlay(random);
    assert.equal(frames.length, 9);
    for (let i = 0; i < frames.length; i++) {
      assert.equal(frames[i].filter(Boolean).length, i + 1);
      if (i) assert.equal(frames[i].filter((v, j) => v !== frames[i - 1][j]).length, 1);
    }
    assert.deepEqual(result(frames.at(-1)), { over: true, winner: null, line: [] });
    openings.add(frames[0].findIndex(Boolean));
  }
  assert.ok(openings.size > 1);
});

test('AI takes an available win, returns legal moves and does not mutate input', () => {
  const board = ['O','O',null,'X','X',null,null,null,null];
  const saved = [...board];
  assert.equal(learningMove(board, 1), 2);
  assert.deepEqual(board, saved);
  assert.equal(perfectMove(['X','X','X',null,'O',null,'O',null,null]), null);
});

test('wins, losses and draws do not launch before the deadline; all histories launch at zero',()=>{
  const visit=history=>{
    for(const remainingMs of [180000,90000,1])assert.equal(nextOutcome({history,players:1,remainingMs}),'next-round');
    for(const remainingMs of [0,-1000])assert.equal(nextOutcome({history,players:1,remainingMs}),'launch');
    assert.equal(nextOutcome({history,players:0}),history.length>=3?'selfplay':'next-round');
    if(history.length<6)for(const outcome of ['human','computer','draw'])visit([...history,outcome]);
  };
  visit([]);
  assert.equal(nextOutcome({history:['draw','draw','draw'],players:0,remainingMs:0}),'launch','Zero must be selected before the deadline');
});

test('draws consume time just like decisive results and do not authorize an early launch',()=>{
  const history=Array(1000).fill('draw');
  assert.equal(nextOutcome({history,players:1,remainingMs:1}),'next-round');
  assert.equal(nextOutcome({history,players:1,remainingMs:0}),'launch');
  assert.equal(nextOutcome({history:['human','human','human','human'],players:1,remainingMs:10000}),'next-round');
});

test('Joshua acknowledges a player victory and invites another round after a player loss',()=>{
  assert.equal(roundDialogue('human'),'You have won the game. But I will win the next game.');
  assert.equal(roundDialogue('computer'),'I have won this round. Shall we play again?');
  assert.equal(roundDialogue('draw'),'Stalemate. No winner in this round.');
  for(const outcome of ['human','computer','draw'])assert.doesNotMatch(roundDialogue(outcome),/goodbye|other things to do/i);
});

test('zero-player mode unlocks before game four only after three completed human rounds of any result',()=>{
  const visit=history=>{
    assert.equal(selfPlayUnlocked(history),history.length>=3);
    assert.equal(nextOutcome({history,players:0}),history.length>=3?'selfplay':'next-round');
    if(history.length<4)for(const outcome of ['human','computer','draw'])visit([...history,outcome]);
  };
  visit([]);
});
