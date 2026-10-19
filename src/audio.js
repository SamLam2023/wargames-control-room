// Original, locally hosted orchestral recordings and electronic dialogue.
// Console cues use short excerpts from the supplied film, with synth fallbacks.
import { VOICE_LINES } from './voice-lines.js';

const MUSIC_LEVEL = 1.9;
const CUES = ['intro', 'gameplay', 'crisis', 'resolution'];
const SFX = {key:'terminal-key-v1.wav',error:'access-denied-v1.wav'};

function fetchAudio(url){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);timeout.unref?.();
  return fetch(url,{signal:controller.signal}).finally(()=>clearTimeout(timeout));
}

function holdGain(parameter,now){
  if(typeof parameter.cancelAndHoldAtTime==='function')parameter.cancelAndHoldAtTime(now);
  else{const value=parameter.value;parameter.cancelScheduledValues(now);parameter.setValueAtTime(value,now);}
}

export class Soundtrack {
  constructor() {
    this.enabled = true;
    this.intensity = 0;
    this.mode = 'standby';
    this.buffers = new Map();
    this.loads = new Map();
    this.tracks = new Set();
    this.musicRequest = 0;
    this.voiceBuffers = new Map();
    this.voiceLoads = new Map();
    this.effectBuffers=new Map();this.effectLoads=new Map();this.effects=new Set();
    this.consoleCursor=0;this.lastError=-Infinity;
  }

  unlock(){
    try{
      // iPad browsers share WebKit's audio session and user-gesture restrictions.
      // Select playback routing when available, then prime and resume synchronously
      // inside the tap, before any network request or awaited promise.
      const session=globalThis.navigator?.audioSession;
      if(session){try{session.type='playback';}catch{/* Older iPadOS can reject session changes. */}}
      if(!this.ctx||this.ctx.state==='closed'){
        const Context=window.AudioContext||window.webkitAudioContext;
        if(!Context)return Promise.resolve(false);
        this.ctx=new Context();this.primed=false;this.activeTrack=null;this.tracks.clear();
        this.master=this.ctx.createGain();this.master.gain.value=this.enabled ? .38 : 0;
        const compressor=this.ctx.createDynamicsCompressor();compressor.threshold.value=-6;compressor.ratio.value=2;
        this.master.connect(compressor);compressor.connect(this.ctx.destination);
        this.score=this.ctx.createGain();this.score.gain.value=MUSIC_LEVEL;this.score.connect(this.master);
        this.ctx.addEventListener?.('statechange',()=>this.onStatusChange?.());
      }
      if((!this.primed||this.ctx.state!=='running')&&this.ctx.createBuffer){
        const prime=this.ctx.createBufferSource();prime.buffer=this.ctx.createBuffer(1,1,22050);
        prime.connect(this.ctx.destination);prime.onended=()=>prime.disconnect();prime.start(0);this.primed=true;
      }
      const resume=this.ctx.state!=='running'?this.ctx.resume():Promise.resolve();
      this.onStatusChange?.();
      return Promise.resolve(resume).then(()=>{this.onStatusChange?.();return this.ctx.state==='running';}).catch(()=>{this.onStatusChange?.();return false;});
    }catch{this.onStatusChange?.();return Promise.resolve(false);}
  }

  async start() {
    const unlocked=await this.unlock();
    if(!this.ctx)return false;
    this.updateMusic();
    if(!this.voicesPreloaded){
      this.voicesPreloaded=true;Promise.allSettled(Object.values(VOICE_LINES).map(file=>this.loadVoice(file)));
    }
    if(!this.effectsPreloaded){this.effectsPreloaded=true;Promise.allSettled(Object.values(SFX).map(file=>this.loadEffect(file)));}
    return unlocked;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.ctx) this.master.gain.setTargetAtTime(enabled ? .38 : 0, this.ctx.currentTime, .08);
    if (!enabled) {this.cancelSpeech();this.stopEffects();}
    this.onStatusChange?.();
  }

  setMode(mode, intensity = this.intensity) {
    this.mode = mode; this.intensity = intensity;
    this.updateMusic();
  }

  cueForMode() {
    if (this.mode === 'intro') return 'intro';
    if (this.mode === 'playing') return this.intensity >= .6 ? 'crisis' : 'gameplay';
    if (['selfplay', 'simulation', 'launching', 'destruction', 'signal-lost', 'failed'].includes(this.mode)) return 'crisis';
    if (this.mode === 'resolved') return 'resolution';
    return null;
  }

  loadCue(cue) {
    if (this.buffers.has(cue)) return Promise.resolve(this.buffers.get(cue));
    if (this.loads.has(cue)) return this.loads.get(cue);
    const url = new URL(`../assets/music/${cue}-v2.mp3`, import.meta.url);
    const loading = fetchAudio(url).then(response => {
      if (!response.ok) throw new Error(`Music ${cue}: HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then(bytes => this.ctx.decodeAudioData(bytes)).then(buffer => {
      this.buffers.set(cue, buffer);
      return buffer;
    }).finally(() => this.loads.delete(cue));
    this.loads.set(cue, loading);
    return loading;
  }

  async updateMusic() {
    if (!this.ctx) return;
    const request = ++this.musicRequest;
    const cue = this.cueForMode();
    if (!cue) {
      for (const track of this.tracks) this.fadeTrack(track, .45);
      this.activeTrack = null;
      return;
    }
    if (this.activeTrack?.cue === cue) return;
    try {
      const buffer = await this.loadCue(cue);
      // Fetch/decode may finish after RESET or a scene change. Never let an
      // obsolete request start playing over the current scene.
      if (request !== this.musicRequest || cue !== this.cueForMode()) return;
      const now = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer; source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + 1.2);
      source.connect(gain); gain.connect(this.score);
      const track = { cue, source, gain };
      this.tracks.add(track);
      source.onended = () => { source.disconnect(); gain.disconnect(); this.tracks.delete(track); };
      source.start(now);
      this.fadeTrack(this.activeTrack, 1.2);
      this.activeTrack = track;
      if (!this.preloaded) {
        this.preloaded = true;
        // Start the requested cue first; cache the rest for instant scene changes.
        Promise.allSettled(CUES.filter(name => name !== cue).map(name => this.loadCue(name)));
      }
    } catch (error) {
      console.warn('Background music unavailable:', error.message);
    }
  }

  fadeTrack(track, seconds) {
    if (!track) return;
    const now = this.ctx.currentTime;
    const stopAt = now + seconds + .03;
    if (track.stopAt && track.stopAt <= stopAt) return;
    track.stopAt = stopAt;
    holdGain(track.gain.gain,now);
    track.gain.gain.linearRampToValueAtTime(0, now + seconds);
    track.source.stop(stopAt);
  }

  updateMusicLevel() {
    if (!this.ctx) return;
    // Dialogue stays intelligible without making the score permanently quiet.
    this.score.gain.setTargetAtTime(MUSIC_LEVEL * (this.activeSpeech ? .28 : 1), this.ctx.currentTime, .18);
  }

  tone(frequency = 700, duration = .06, volume = .06, type = 'sine', target = this.master, delay = 0, kind = 'effect') {
    if (!this.ctx || !target) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.type = type; osc.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain); gain.connect(target); osc.start(now); osc.stop(now + duration + .02);
    const effect={source:osc,gain,kind};this.effects.add(effect);
    osc.onended = () => { osc.disconnect(); gain.disconnect();this.effects.delete(effect); };
  }

  loadEffect(file){
    if(this.effectBuffers.has(file))return Promise.resolve(this.effectBuffers.get(file));
    if(this.effectLoads.has(file))return this.effectLoads.get(file);
    const loading=fetchAudio(new URL(`../assets/sfx/${file}`,import.meta.url))
      .then(response=>{if(!response.ok)throw Error('Effect unavailable');return response.arrayBuffer();})
      .then(bytes=>this.ctx.decodeAudioData(bytes)).then(buffer=>{this.effectBuffers.set(file,buffer);return buffer;})
      .finally(()=>this.effectLoads.delete(file));
    this.effectLoads.set(file,loading);return loading;
  }

  playEffect(file,delay=0,kind='console',volume=.55){
    if(!this.ctx||!this.enabled)return false;
    const buffer=this.effectBuffers.get(file);if(!buffer)return false;
    const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();
    source.buffer=buffer;gain.gain.value=volume;source.connect(gain);gain.connect(this.master);
    const effect={source,gain,kind};this.effects.add(effect);
    source.onended=()=>{source.disconnect();gain.disconnect();this.effects.delete(effect);};
    source.start(this.ctx.currentTime+delay);return true;
  }

  stopEffects(kind){
    for(const effect of this.effects){
      if(kind&&effect.kind!==kind)continue;
      effect.source.onended=null;
      try{effect.source.stop();}catch{/* A scheduled or finished effect is already silent. */}
      effect.source.disconnect();effect.gain.disconnect();this.effects.delete(effect);
    }
    this.consoleCursor=this.ctx?.currentTime||0;
    if(!kind)this.lastError=-Infinity;
  }

  key(delay=0) {
    if(!this.enabled)return;
    if(!this.playEffect(SFX.key,delay))this.tone(1140,.032,.15,'triangle',this.master,delay,'console');
  }

  print(text){
    if(!this.ctx||!this.enabled||document.hidden)return;
    const now=this.ctx.currentTime,start=Math.max(now,this.consoleCursor);
    if(start-now>.65)return;
    const count=Math.min(18,text.replace(/\s/g,'').length);
    for(let i=0;i<count&&start+i*.038<now+.9;i++)this.key(start-now+i*.038);
    this.consoleCursor=Math.min(now+.9,start+count*.038);
  }

  move() { this.tone(650, .07, .055); }
  error() {
    if(!this.ctx||!this.enabled||this.ctx.currentTime-this.lastError<1.5)return;
    this.lastError=this.ctx.currentTime;this.stopEffects('console');
    if(!this.playEffect(SFX.error,0,'error',1.4))this.tone(220,1.4,.16,'sawtooth');
  }
  alert() { this.tone(700, .25, .065); this.tone(520, .3, .065, 'sine', this.master, .3); }
  resolve() { [293.66,369.99,440,587.33].forEach((n,i) => this.tone(n, 2.8, .04, 'sine', this.master, i * .25)); }

  loadVoice(file) {
    if (this.voiceBuffers.has(file)) return Promise.resolve(this.voiceBuffers.get(file));
    if (this.voiceLoads.has(file)) return this.voiceLoads.get(file);
    const url = new URL(`../assets/voice/${file}`, import.meta.url);
    const loading = fetchAudio(url).then(response => {
      if (!response.ok) throw new Error(`Voice: HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then(bytes => this.ctx.decodeAudioData(bytes)).then(buffer => {
      this.voiceBuffers.set(file, buffer);
      return buffer;
    }).finally(() => this.voiceLoads.delete(file));
    this.voiceLoads.set(file, loading);
    return loading;
  }

  speak(text) {
    this.cancelSpeech();
    const file = VOICE_LINES[text.trim().replace(/\s+/g, ' ').toLowerCase()];
    if (!this.enabled || !this.ctx || !file) return Promise.resolve('unavailable');
    return new Promise(resolve => {
      let settled = false;
      const speech = { text, file, finish: null, source: null, gain: null };
      const finish = status => {
        if (settled) return;
        settled = true;
        if (speech.source) {
          speech.source.onended = null;
          try { speech.source.stop(); } catch { /* A failed start has no playback to stop. */ }
          speech.source.disconnect(); speech.gain.disconnect();
        }
        if (this.activeSpeech === speech) {
          this.activeSpeech = null;
          this.updateMusicLevel();
        }
        resolve(status);
      };
      speech.finish = finish;
      this.activeSpeech = speech;
      this.updateMusicLevel();
      this.loadVoice(file).then(buffer => {
        // RESET/mute/another line can cancel while a recording downloads.
        if (settled || this.activeSpeech !== speech) return;
        const source = this.ctx.createBufferSource();
        const gain = this.ctx.createGain(); gain.gain.value = 2.2;
        speech.source = source; speech.gain = gain;
        source.buffer = buffer; source.connect(gain); gain.connect(this.master);
        source.onended = () => finish('ended');
        source.start();
      }).catch(() => finish('error'));
      // Completion is the actual audio-buffer end, including the final word.
      // No estimated speech timer can truncate a sentence or advance the scene.
    });
  }

  cancelSpeech() {
    this.activeSpeech?.finish('cancelled');
  }
}
