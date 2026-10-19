import test from 'node:test';
import assert from 'node:assert/strict';
import {WAR_DURATION_MS,WAR_FACTIONS,WAR_MISSILES,warFlashOpacity,simulationFlashOpacity,SIMULATION_FLASH_MS,simulationFrame,createWarMissiles} from '../src/war-scene.js';

test('global exchange includes distinct national origins, retaliation and launches spread through fifteen seconds',()=>{
  assert.equal(WAR_DURATION_MS,15000);
  assert.equal(new Set(WAR_FACTIONS.map(f=>f.color)).size,WAR_FACTIONS.length);
  assert.deepEqual(new Set(WAR_MISSILES.map(m=>m.faction.id)),new Set(['usa','ussr','china','uk','france']));
  assert.ok(WAR_MISSILES.some(m=>m.faction.id==='usa'&&m.to[0]>20));
  assert.ok(WAR_MISSILES.some(m=>m.faction.id==='ussr'&&m.to[0]<-60));
  for(let i=0;i<WAR_MISSILES.length;i++){
    const m=WAR_MISSILES[i];
    assert.ok(m.impactAt>m.launchAt&&m.impactAt<WAR_DURATION_MS);
    assert.ok(m.from[0]!==m.to[0]||m.from[1]!==m.to[1]);
    for(const [lon,lat] of [m.from,m.to])assert.ok(lon>=-180&&lon<=180&&lat>=-90&&lat<=90);
    if(i)assert.ok(m.launchAt-WAR_MISSILES[i-1].launchAt>=80,'Launches must be sequential rather than simultaneous');
  }
  assert.ok(Math.max(...WAR_MISSILES.map(m=>m.launchAt))>11000);
  assert.ok(Math.max(...WAR_MISSILES.map(m=>m.impactAt))>14000);
});

test('wall flashes are bounded, spaced apart, and absent with reduced effects or after the scene',()=>{
  let previous=0;const flashes=[];let maximum=0;
  for(let time=0;time<=16000;time+=10){
    const opacity=warFlashOpacity(time);assert.ok(opacity>=0&&opacity<=.64);
    assert.equal(warFlashOpacity(time,true),0);
    if(opacity>0&&previous===0)flashes.push(time);
    maximum=Math.max(maximum,opacity);previous=opacity;
  }
  assert.ok(flashes.length>=5&&maximum>=.6);
  assert.ok(flashes.slice(1).every((t,i)=>t-flashes[i]>=1200));
  assert.equal(warFlashOpacity(15000),0);
});

test('learning simulation ends with three integrated spaced flashes and suppresses them for reduced effects',()=>{
  assert.equal(SIMULATION_FLASH_MS,3600);
  let previous=0;const starts=[];
  for(let time=0;time<=16000;time+=10){
    const opacity=simulationFlashOpacity(time);
    assert.ok(opacity>=0&&opacity<=.8);
    assert.equal(simulationFlashOpacity(time,true),0);
    if(opacity>0&&previous===0)starts.push(time);
    previous=opacity;
  }
  assert.equal(starts.length,3);
  assert.ok(starts.slice(1).every((time,i)=>time-starts[i]>=1200));
  assert.equal(simulationFlashOpacity(WAR_DURATION_MS),0);
});


test('learning accelerates from readable flights to many different scenarios per second',()=>{
  const slow=simulationFrame(0),middle=simulationFrame(7500),fast=simulationFrame(14999);
  assert.equal(slow.speed,.5);assert.ok(middle.speed>8&&fast.speed>179);
  const virtual=t=>{const f=simulationFrame(t);return f.cycle*WAR_DURATION_MS+f.timeMs;};
  assert.ok(virtual(1000)<1000);assert.ok(virtual(15000)-virtual(14000)>120000);
  assert.ok(fast.cycle>=30);
  const origins=new Set(),destinations=new Set();
  for(let cycle=0;cycle<=fast.cycle;cycle++){
    const missiles=createWarMissiles(cycle);
    origins.add(missiles[0].from.join(','));destinations.add(missiles[0].to.join(','));
    assert.equal(missiles.length,72);assert.ok(missiles.every(m=>m.impactAt<WAR_DURATION_MS));
    if(cycle)assert.notDeepEqual(missiles.map(m=>m.to),createWarMissiles(cycle-1).map(m=>m.to));
  }
  assert.equal(origins.size,3);assert.ok(destinations.size>15);
  assert.deepEqual(simulationFrame(-1),slow);
  assert.deepEqual(simulationFrame(16000),simulationFrame(15000));
  assert.equal(simulationFlashOpacity(15000),0);
});

test('reduced learning uses only three static map stages without acceleration or flashes',()=>{
  const stages=new Set();
  for(let time=0;time<15000;time+=25){
    const frame=simulationFrame(time,true);stages.add(frame.timeMs);
    assert.equal(frame.speed,1);assert.equal(frame.cycle,0);assert.equal(simulationFlashOpacity(time,true),0);
  }
  assert.equal(stages.size,3);
});
