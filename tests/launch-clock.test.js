import test from 'node:test';
import assert from 'node:assert/strict';
import {LAUNCH_WINDOW_MS,launchProgress,formatCountdown} from '../src/launch-clock.js';

test('the launch window is exactly three minutes and code progress follows elapsed time',()=>{
  assert.equal(LAUNCH_WINDOW_MS,180000);
  const start=1000000,deadline=start+LAUNCH_WINDOW_MS;
  for(let elapsed=0;elapsed<=180000;elapsed+=1000){
    const clock=launchProgress(deadline,start+elapsed);
    assert.equal(clock.remainingMs,180000-elapsed);
    assert.equal(clock.locked,Math.min(10,Math.floor(elapsed/18000)));
    assert.ok(clock.defcon>=1&&clock.defcon<=5);
  }
  assert.equal(launchProgress(deadline,deadline-1).locked,9);
  assert.deepEqual(launchProgress(deadline,deadline),{remainingMs:0,locked:10,defcon:1});
});

test('background delays cannot extend the deadline, and reset/formatting preserve 03:00',()=>{
  assert.equal(launchProgress(180000,250000).remainingMs,0);
  assert.equal(launchProgress(null).remainingMs,180000);
  assert.equal(formatCountdown(180000),'03:00');assert.equal(formatCountdown(179001),'03:00');
  assert.equal(formatCountdown(179000),'02:59');assert.equal(formatCountdown(1),'00:01');assert.equal(formatCountdown(-1),'00:00');
});
