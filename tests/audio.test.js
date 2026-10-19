import test from 'node:test';
import assert from 'node:assert/strict';
import { Soundtrack } from '../src/audio.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('electronic speech waits for the actual recording end, without browser voices', async t => {
  const { fulfill } = musicDevice(t);
  Object.defineProperty(window, 'speechSynthesis', { get() { throw new Error('Natural browser speech must not be used'); } });
  const soundtrack = new Soundtrack(); await soundtrack.start();
  let finished = false;
  const completion = soundtrack.speak('A strange game. The only winning move is not to play.');
  completion.then(() => { finished = true; });
  fulfill('conclusion-v1.mp3'); await flush();
  assert.equal(finished, false);
  assert.ok(soundtrack.activeSpeech.source, 'A decoded electronic recording must be playing');
  soundtrack.activeSpeech.source.onended();
  assert.equal(await completion, 'ended');
});

test('RESET during a voice download prevents stale playback and settles the scene', async t => {
  const { fulfill } = musicDevice(t);
  const soundtrack = new Soundtrack(); await soundtrack.start();
  const completion = soundtrack.speak('A strange game. The only winning move is not to play.');
  const cancelled = soundtrack.activeSpeech;
  soundtrack.cancelSpeech();
  assert.equal(await completion, 'cancelled');
  fulfill('conclusion-v1.mp3'); await flush();
  assert.equal(cancelled.source, null);
  assert.equal(soundtrack.activeSpeech, null);
});

test('muting stops the recording, restores music ducking, and releases speech waits', async t => {
  const { fulfill } = musicDevice(t);
  const soundtrack = new Soundtrack(); await soundtrack.start();
  const normal = soundtrack.score.gain.value;
  const completion = soundtrack.speak('How about a nice game of chess?');
  fulfill('chess-v1.mp3'); await flush();
  const source = soundtrack.activeSpeech.source;
  assert.ok(soundtrack.score.gain.value < normal / 2);
  soundtrack.setEnabled(false);
  assert.equal(await completion, 'cancelled');
  assert.equal(source.stopped, true);
  assert.equal(soundtrack.master.gain.value, 0);
  assert.equal(soundtrack.score.gain.value, normal);
  assert.equal(await soundtrack.speak('Number of players?'), 'unavailable');
});

test('speech errors and unavailable audio never stall the game or use a natural fallback', async t => {
  const { fulfill } = musicDevice(t);
  const soundtrack = new Soundtrack();
  assert.equal(await soundtrack.speak('Number of players?'), 'unavailable');
  await soundtrack.start();
  assert.equal(await soundtrack.speak('Unknown dialogue.'), 'unavailable');
  const normal = soundtrack.score.gain.value;
  const completion = soundtrack.speak('Number of players?');
  fulfill('players-v1.mp3', false);
  assert.equal(await completion, 'error');
  assert.equal(soundtrack.score.gain.value, normal);
});

test('a new line cancels the previous recording without letting a late load interrupt it', async t => {
  const { fulfill } = musicDevice(t);
  const soundtrack = new Soundtrack(); await soundtrack.start();
  const first = soundtrack.speak('Number of players?');
  const second = soundtrack.speak('Shall we play a game?');
  assert.equal(await first, 'cancelled');
  fulfill('players-v1.mp3'); fulfill('play-v1.mp3'); await flush();
  assert.equal(soundtrack.activeSpeech.file, 'play-v1.mp3');
  soundtrack.activeSpeech.source.onended();
  assert.equal(await second, 'ended');
});

function musicDevice(t,{webkitOnly=false,initialState='running',noHold=false}={}) {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  const parameter = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    cancelAndHoldAtTime:noHold?undefined:function(){},
    cancelScheduledValues(){this.cancelled=true;}
  });
  const node = () => ({ connect() {}, disconnect() {}, gain: parameter() });
  class Context {
    state = initialState; currentTime = 0; destination = node();
    primed=0;resumes=0;
    createBuffer(){return {silent:true};}
    resume(){this.resumes++;this.state='running';return Promise.resolve();}
    createGain() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), ratio: parameter() }; }
    async decodeAudioData() { return { duration: 40 }; }
    createBufferSource() { const context=this;return { ...node(), start(at=0) {this.startAt=at;if(this.buffer?.silent)context.primed++;}, stop() { this.stopped = true; } }; }
  }
  globalThis.window = { ...originalWindow, AudioContext: webkitOnly?undefined:Context, webkitAudioContext:Context };
  globalThis.fetch = url => new Promise(resolve => requests.push({ url: String(url), resolve }));
  t.after(() => { globalThis.window = originalWindow; globalThis.fetch = originalFetch; });
  const fulfill = (cue, ok = true) => {
    const filename = /\.(mp3|wav)$/.test(cue) ? cue : `${cue}-v2.mp3`;
    const request = requests.find(request => request.url.includes(filename));
    assert.ok(request, `Expected a request for ${cue}`);
    request.resolve({ ok, arrayBuffer: async () => new ArrayBuffer(1) });
  };
  return { requests, fulfill };
}

test('RESET prevents a late music download from starting a stale scene', async t => {
  const { fulfill } = musicDevice(t);
  const soundtrack = new Soundtrack();
  await soundtrack.start();
  soundtrack.mode = 'intro';
  const loading = soundtrack.updateMusic();
  soundtrack.setMode('standby', 0);
  fulfill('intro');
  await loading;
  assert.equal(soundtrack.activeTrack, null);
  assert.equal(soundtrack.tracks.size, 0);
});

test('console samples are bounded, permission denial interrupts typing, and reset/mute stop queued effects',async t=>{
  const oldDocument=globalThis.document;globalThis.document={hidden:false};t.after(()=>{globalThis.document=oldDocument;});
  const {fulfill}=musicDevice(t);const soundtrack=new Soundtrack();await soundtrack.start();
  fulfill('terminal-key-v1.wav');fulfill('access-denied-v1.wav');await flush();
  for(let i=0;i<20;i++)soundtrack.print('A VERY LONG CONSOLE OUTPUT LINE');
  const typing=[...soundtrack.effects];
  assert.ok(typing.length>0&&typing.length<30,'Console output cannot queue many seconds of audio');
  assert.ok(typing.every(effect=>effect.source.startAt<=soundtrack.ctx.currentTime+.9));
  soundtrack.error();
  assert.ok(typing.every(effect=>effect.source.stopped));
  assert.equal(soundtrack.effects.size,1);
  assert.equal([...soundtrack.effects][0].kind,'error');
  soundtrack.error();assert.equal(soundtrack.effects.size,1,'Repeated denial lines must not stack the same buzzer');
  soundtrack.stopEffects();assert.equal(soundtrack.effects.size,0);
  soundtrack.key();assert.equal(soundtrack.effects.size,1);
  soundtrack.setEnabled(false);assert.equal(soundtrack.effects.size,0);
  soundtrack.key();assert.equal(soundtrack.effects.size,0);
});

test('out-of-order downloads play only the current scene and share cached music', async t => {
  const { fulfill, requests } = musicDevice(t);
  const soundtrack = new Soundtrack();
  await soundtrack.start();
  soundtrack.mode = 'intro';
  const intro = soundtrack.updateMusic();
  soundtrack.mode = 'selfplay';
  const crisis = soundtrack.updateMusic();
  fulfill('intro'); await intro;
  assert.equal(soundtrack.tracks.size, 0);
  fulfill('crisis'); await crisis;
  const track = soundtrack.activeTrack;
  assert.equal(track.cue, 'crisis');
  soundtrack.setMode('simulation', 1);
  await soundtrack.updateMusic();
  assert.equal(soundtrack.activeTrack, track, 'Related scenes must not restart the cue');
  assert.equal(requests.filter(r => r.url.includes('crisis-v2.mp3')).length, 1);
  soundtrack.setMode('standby', 0);
  assert.equal(track.source.stopped, true);
  assert.equal(soundtrack.activeTrack, null);
});


test('crisis music plays continuously through destruction, signal loss and offline until RESET',async t=>{
  const {fulfill}=musicDevice(t),soundtrack=new Soundtrack();await soundtrack.start();
  soundtrack.mode='launching';const loading=soundtrack.updateMusic();fulfill('crisis');await loading;
  const track=soundtrack.activeTrack;
  for(const mode of ['destruction','signal-lost','failed']){
    soundtrack.setMode(mode,1);await soundtrack.updateMusic();
    assert.equal(soundtrack.activeTrack,track,'The same recording must continue across the ending');
    assert.equal(track.source.stopped,undefined,'Offline must not fade or stop the music');
    assert.equal(track.source.loop,true);
  }
  soundtrack.setEnabled(false);assert.equal(soundtrack.master.gain.value,0);
  soundtrack.setEnabled(true);assert.ok(soundtrack.master.gain.value>0);
  soundtrack.setMode('standby',0);assert.equal(track.source.stopped,true);assert.equal(soundtrack.activeTrack,null);
});

test('iPad-style WebKit context primes and resumes synchronously on the initiating tap, then recovers interruption',async t=>{
  musicDevice(t,{webkitOnly:true,initialState:'suspended'});
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const audioSession={type:'auto'};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{audioSession}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
  const soundtrack=new Soundtrack(),opening=soundtrack.start();
  assert.equal(audioSession.type,'playback');
  assert.equal(soundtrack.ctx.primed,1,'A silent sample must start before awaiting resume or audio downloads');
  assert.equal(soundtrack.ctx.resumes,1);assert.equal(await opening,true);
  soundtrack.ctx.state='interrupted';assert.equal(await soundtrack.start(),true);
  assert.equal(soundtrack.ctx.resumes,2);assert.equal(soundtrack.ctx.primed,2);
});

test('older WebKit fades music without cancelAndHoldAtTime and loads audio without AbortSignal.timeout',async t=>{
  const {fulfill}=musicDevice(t,{noHold:true});
  const descriptor=Object.getOwnPropertyDescriptor(AbortSignal,'timeout');Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:undefined});
  t.after(()=>Object.defineProperty(AbortSignal,'timeout',descriptor));
  const soundtrack=new Soundtrack();await soundtrack.start();
  soundtrack.mode='intro';const loading=soundtrack.updateMusic();fulfill('intro');await loading;
  const first=soundtrack.activeTrack;
  soundtrack.mode='launching';const next=soundtrack.updateMusic();fulfill('crisis');await next;
  assert.equal(soundtrack.activeTrack.cue,'crisis');assert.equal(first.source.stopped,true);assert.equal(first.gain.gain.cancelled,true);
  fulfill('terminal-key-v1.wav');await flush();assert.ok(soundtrack.effectBuffers.has('terminal-key-v1.wav'));
});
