import { emptyBoard, result, learningMove, selfPlay, roundDialogue, selfPlayUnlocked, SELF_PLAY_UNLOCK_ROUNDS } from './engine.js';
import { Soundtrack } from './audio.js';
import { Displays } from './displays.js';
import { WAR_DURATION_MS, simulationFrame } from './war-scene.js';
import { PlayerStats } from './stats.js';
import { SiloFuel } from './silos.js';
import { LAUNCH_WINDOW_MS, launchProgress, formatCountdown } from './launch-clock.js';

const $ = id => document.getElementById(id);
const cells = [...document.querySelectorAll('[data-cell]')];
const positions = ['Top left','Top center','Top right','Middle left','Center','Middle right','Bottom left','Bottom center','Bottom right'];
const launchCode = 'CPE1704TKS';
const cancel = Symbol('cancelled-session');
const sound = new Soundtrack();
const fuel = new SiloFuel(document.querySelector('.silo-monitor'));
let statsStorage;
try { statsStorage = window.localStorage; } catch { statsStorage = null; }
const stats = new PlayerStats((totals, online) => {
  for (const node of document.querySelectorAll('[data-stat]')) {
    node.textContent = totals ? totals[node.dataset.stat].toLocaleString('en-US') : '—';
  }
  $('stats-status').textContent = online ? 'GLOBAL RECORD / LIVE' : totals ? 'LAST SYNC / RECONNECTING' : 'STATS OFFLINE / RETRYING';
  $('stats-status').dataset.online = String(online);
}, { storage: statsStorage });
stats.start();
let epoch=0;
const pending=new Map();
let state;
const codeChars=[];
for(let i=0;i<10;i++){
  const span=document.createElement('span');span.className='code-char searching';span.textContent='_';span.setAttribute('aria-hidden','true');
  $('launch-code').append(span);codeChars.push(span);
}

function invalidate(){
  epoch++;
  for(const [id,resolve] of pending){clearTimeout(id);resolve();}
  pending.clear();
  sound.cancelSpeech();
  sound.stopEffects();
}

async function pause(ms,token=epoch){
  if(token!==epoch)throw cancel;
  await new Promise(resolve=>{
    const id=setTimeout(()=>{pending.delete(id);resolve();},ms);
    pending.set(id,resolve);
  });
  if(token!==epoch)throw cancel;
}

function run(task){
  task().catch(error=>{
    if(error===cancel)return;
    console.error(error);
    log('SESSION INTERRUPTED. RESET TO RECONNECT.','error');
    dialogue('CONTROL','Session interrupted. Press RESET to reconnect.');
    state.busy=true;renderBoard();
  });
}

function log(text,style=''){
  const p=document.createElement('p');p.textContent=text;
  if(style)p.className=style;
  const target=$('terminal-log');target.append(p);
  while(target.children.length>36)target.firstElementChild.remove();
  target.scrollTop=target.scrollHeight;
  if(state && !['standby','failed','destruction','signal-lost'].includes(state.phase)){
    if(style==='error'&&/DENIED|LOCKED OUT|IMPROPER REQUEST/.test(text))sound.error();
    else sound.print(text);
  }
}

function dialogue(speaker,text,speak=false){
  $('dialogue-speaker').textContent=speaker;
  $('dialogue-text').textContent=text;
  return speak?sound.speak(text):Promise.resolve();
}

function setMind(lines){
  const target=$('mind-content');target.replaceChildren();
  for(const linesInParagraph of lines){
    const p=document.createElement('p');
    linesInParagraph.split('\n').forEach((line,i)=>{if(i)p.append(document.createElement('br'));p.append(document.createTextNode(line));});
    target.append(p);
  }
}

function setPhase(phase){state.phase=phase;document.body.dataset.phase=phase;fuel.setPhase(phase);}
function setDefcon(level){
  const previous=state.defcon;state.defcon=level;
  document.documentElement.style.setProperty('--alert',level<=2?'var(--red)':level===3?'var(--amber)':'var(--green)');
  $('defcon-number').textContent=String(level);
  for(const item of document.querySelectorAll('[data-level]'))item.classList.toggle('active',Number(item.dataset.level)===level);
  $('alert-label').textContent=['','MAXIMUM READINESS','NUCLEAR ALERT','FORCES ON ALERT','INCREASED WATCH','NORMAL READINESS'][level];
  $('defcon-note').textContent=level===5?'STRATEGIC SYSTEMS / STANDBY':`STRATEGIC SYSTEMS / DEFCON ${level}`;
  if(level<previous && state.phase!=='intro')sound.alert();
}

function updateLaunchClock(now=Date.now()){
  if(state.clockMode==='running'){
    const progress=launchProgress(state.deadlineAt,now);
    state.remainingMs=progress.remainingMs;state.locked=progress.locked;
    if(!['launching','destruction','signal-lost','failed'].includes(state.phase))setDefcon(progress.defcon);
    if(progress.remainingMs===0){run(launch);return;}
  }
  const labels={standby:'TIME TO LAUNCH',running:'TIME TO LAUNCH',held:'SIMULATION HOLD',expired:'LAUNCH INITIATED',aborted:'LAUNCH ABORTED'};
  $('countdown-label').textContent=labels[state.clockMode];
  $('launch-countdown').textContent=formatCountdown(state.remainingMs);
  $('launch-countdown').setAttribute('aria-label',`${labels[state.clockMode]}: ${formatCountdown(state.remainingMs)}`);
  document.querySelector('.launch-clock').classList.toggle('is-urgent',state.clockMode==='running'&&state.remainingMs<=30000);
}

function renderCode(shuffle=false){
  const decrypted=state.locked===codeChars.length&&!['standby','intro','resolved'].includes(state.phase);
  $('code-title').textContent=decrypted?'LAUNCH CODE DECRYPTED':'LAUNCH CODE DECRYPTION';
  $('launch-code').classList.toggle('is-decrypted',decrypted);
  for(let i=0;i<10;i++){
    const span=codeChars[i];
    span.classList.toggle('locked',i<state.locked);span.classList.toggle('searching',i>=state.locked);
    if(state.phase==='resolved')span.textContent='----------'[i];
    else if(i<state.locked)span.textContent=launchCode[i];
    else if(['standby','intro'].includes(state.phase))span.textContent='_';
    else if(shuffle)span.textContent='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*36)];
  }
  $('code-status').textContent=state.phase==='resolved'?'LAUNCH ABORTED':`${state.locked} / 10 LOCKED`;
  $('launch-code').setAttribute('aria-label',state.phase==='resolved'?'Launch aborted':`Launch code: ${state.locked} of 10 characters decrypted`);
}

function renderBoard(){
  cells.forEach((cell,i)=>{
    const mark=state.board[i];
    if(cell.textContent!==(mark||''))cell.textContent=mark||'';
    cell.dataset.mark=mark||'';
    cell.disabled=state.phase!=='playing'||state.busy||Boolean(mark);
    cell.classList.toggle('winning',state.winLine.includes(i));
    cell.setAttribute('aria-label',`${positions[i]}${mark?`: ${mark}`:': empty'}`);
  });
}

function renderControls(){
  const between=state.phase==='between';
  const choosing=state.phase==='choosing'||between;
  $('zero-players').hidden=!selfPlayUnlocked(state.history);
  $('zero-players').disabled=!between||!selfPlayUnlocked(state.history);
  $('one-player').disabled=!choosing;
  $('players-view').hidden=!choosing;
  if(choosing)$('board-view').hidden=true;
  const remaining=Math.max(0,SELF_PLAY_UNLOCK_ROUNDS-state.history.length);
  $('players-note').textContent=between&&!selfPlayUnlocked(state.history)?`Complete ${remaining} more ${remaining===1?'game':'games'} to unlock 0 players.`:between?'Play again or select 0 for self-play.':'Select 1 player. Complete 3 games to unlock 0.';
  $('player-roles').textContent=state.players===0?'JOSHUA X  /  JOSHUA O':'PLAYER X  /  JOSHUA O';
  $('skip-intro').hidden=state.phase!=='intro';
  $('command-input').readOnly=['standby','intro','selfplay','simulation','launching','destruction','signal-lost','resolved','failed'].includes(state.phase);
  $('game-screen').classList.toggle('is-between',between);
}

function render(){renderBoard();renderCode();renderControls();}

function reset(){
  invalidate();
  displays?.stopWar();
  $('offline-screen').hidden=true;
  document.querySelector('.control-room').inert=false;
  document.querySelector('.control-room').removeAttribute('aria-hidden');
  delete document.querySelector('.silo-monitor').dataset.missilesLaunched;
  state={clockMode:'standby',deadlineAt:null,remainingMs:LAUNCH_WINDOW_MS,phase:'standby',missilesLaunched:false,defcon:5,round:0,players:1,board:emptyBoard(),winLine:[],busy:false,locked:0,history:[],selfGames:0,scenario:0};
  setPhase('standby');setDefcon(5);sound.setMode('standby',0);
  $('terminal-log').replaceChildren();
  log('WOPR OPERATING SYSTEM 4.3','white');log('REMOTE TERMINAL / READY','dim');log('AWAITING CONNECTION...');
  $('connection-status').textContent='CONNECTION STANDBY';
  $('standby-view').hidden=false;$('connect-button').hidden=false;$('board-view').hidden=true;$('ending-view').hidden=true;
  $('standby-view').querySelector('p').innerHTML='SHALL WE PLAY<br>A GAME?';
  $('decision-timer').hidden=true;$('strategy-list').hidden=true;$('mind-content').hidden=false;
  $('tracked-count').textContent='00';$('flight-count').textContent='00';$('silos-ready').textContent='446';$('radar-tracks').textContent='0';
  $('soviet-status').textContent='MONITOR';$('authorization').textContent='AUTHORIZATION LOCKED';$('launch-note').textContent='COMMAND OVERRIDE REQUIRED';
  $('command-input').value='';$('command-input').placeholder='AWAITING CONNECTION';
  $('mission-hint').textContent='Complete 3 human games to unlock 0 players.';
  for(const panel of document.querySelectorAll('[data-scenario]'))panel.removeAttribute('data-scenario');
  setMind(['SYSTEM ONLINE\nSTRATEGIC ANALYSIS\nAWAITING CONNECTION','NEURAL LINK: STABLE\nSIMULATION READY','> _']);
  dialogue('CONTROL','Press CONNECT to enter the control room.');updateLaunchClock();render();
}

async function typeCommand(text,token){
  const input=$('command-input');input.value='';
  for(const char of text){
    await pause(35+Math.random()*24,token);input.value+=char;sound.key();
  }
  await pause(300,token);log(`> ${text}`);input.value='';
}

async function opening(){
  if(state.phase!=='standby')return;
  stats.record('connected');
  const token=epoch;
  state.deadlineAt=Date.now()+LAUNCH_WINDOW_MS;state.clockMode='running';
  setPhase('intro');updateLaunchClock();renderControls();
  sound.start();sound.setMode('intro',.12);setDefcon(4);
  $('connect-button').hidden=true;$('standby-view').querySelector('p').innerHTML='ESTABLISHING<br>CONNECTION...';
  $('connection-status').textContent='REMOTE SESSION ACTIVE';
  log('CONNECTION ESTABLISHED.','white');
  dialogue('DAVID','Put the list back up.');
  await typeCommand('LIST GAMES',token);
  log('FALKEN’S MAZE\nCHECKERS\nCHESS\nPOKER\nGLOBAL THERMONUCLEAR WAR');
  await pause(900,token);
  dialogue('CONTROL','Shut down the system.');
  await typeCommand('SHUTDOWN SYSTEM',token);
  log('CHANGES LOCKED OUT','error');log('ACCESS DENIED.','error');sound.error();
  await pause(1100,token);
  dialogue('CONTROL','Order it to disarm the missiles.');
  await typeCommand('DISARM MISSILES',token);
  log('IMPROPER REQUEST / ACCESS DENIED','error');sound.error();
  await pause(950,token);
  dialogue('FALKEN','Go ahead. It has to be in there somewhere.');
  await typeCommand('TIC-TAC-TOE',token);
  log('GAME ROUTINE RUNNING','white');
  choosePlayers();
}

function choosePlayers(){
  if(state.phase!=='intro')return;
  invalidate();setPhase('choosing');
  $('standby-view').hidden=true;$('players-result').textContent='SELECT PLAYERS';
  $('command-input').value='';$('command-input').placeholder='NUMBER OF PLAYERS: _';
  $('mission-hint').textContent='Select 1 player. Play 3 human games first.';
  $('players-note').textContent='Complete 3 human games first.';
  log('NUMBER OF PLAYERS?','white');
  dialogue('JOSHUA','Number of players?',true);
  setMind(['GAME ROUTINE RUNNING\nTIC-TAC-TOE','PLEASE LIST\nNUMBER OF PLAYERS:','> _']);
  render();
}

function beginRound(){
  if(!['choosing','between'].includes(state.phase))return;
  updateLaunchClock();if(state.phase==='launching')return;
  invalidate();
  state.round=state.history.length+1;state.board=emptyBoard();state.winLine=[];state.busy=false;state.players=1;
  setPhase('playing');updateLaunchClock();
  $('standby-view').hidden=true;$('board-view').hidden=false;$('ending-view').hidden=true;$('decision-timer').hidden=true;
  $('game-status').textContent='YOUR TURN';$('round-label').textContent=`ROUND ${String(state.round).padStart(2,'0')} / OPEN PLAY`;
  $('command-input').value='';$('command-input').placeholder='ENTER COMMAND_';
  $('mission-hint').textContent='You are X. Click a square or use keys 1–9.';
  log(`TIC-TAC-TOE / ROUND ${state.round}`,'white');log('X GOES FIRST. 3 IN A ROW WINS.');
  setMind(['GAME ROUTINE RUNNING\nSIMULATION ACTIVE',`ROUND: ${String(state.round).padStart(2,'0')}\nPLAYER WINS: ${state.history.filter(outcome=>outcome==='human').length}\nJOSHUA WINS: ${state.history.filter(outcome=>outcome==='computer').length}\nDRAWS: ${state.history.filter(outcome=>outcome==='draw').length}`,'> _']);
  dialogue('JOSHUA','Shall we play a game?',state.round===1);
  sound.setMode('playing',Math.min(1,.15+(1-state.remainingMs/LAUNCH_WINDOW_MS)*.85));render();
}

async function humanMove(index){
  if(state.phase!=='playing'||state.busy||state.board[index])return;
  const token=epoch;
  updateLaunchClock();if(state.phase!=='playing')return;
  state.board[index]='X';sound.move();
  if(result(state.board).over){finishRound();return;}
  state.busy=true;$('game-status').textContent='JOSHUA IS THINKING';renderBoard();
  await pause(450+Math.random()*300,token);
  const move=learningMove(state.board,state.round);
  if(move===null)return;
  state.board[move]='O';sound.move();state.busy=false;
  renderCode();
  if(result(state.board).over){finishRound();return;}
  $('game-status').textContent='YOUR TURN';renderBoard();
}

function finishRound(){
  const end=result(state.board);state.winLine=end.line;state.busy=false;
  if(end.winner==='X')stats.record('won');
  if(end.winner==='O')stats.record('lost');
  state.history.push(end.winner==='X'?'human':end.winner==='O'?'computer':'draw');
  setPhase('between');
  const status=end.winner==='X'?'PLAYER WINS':end.winner==='O'?'JOSHUA WINS':'STALEMATE';
  $('players-result').textContent=`${status}. PLAY AGAIN?`;
  $('game-status').textContent=status;log(`${status}. WANT TO PLAY AGAIN?`,'white');
  sound.tone(end.winner?440:330,.25,.05);
  $('decision-timer').hidden=true;
  const spoken=roundDialogue(state.history.at(-1));
  dialogue('JOSHUA',spoken,true);setMind(['GAME RESULT',spoken.toUpperCase(),'DECRYPTION CONTINUES']);
  $('mission-hint').textContent=!selfPlayUnlocked(state.history)?`Human games complete: ${state.history.length} / 3. The launch countdown continues.`:'The launch countdown continues. Play again or select 0 players.';
  render();
}

async function zeroPlayers(){
  if(state.phase!=='between'||!selfPlayUnlocked(state.history))return;
  updateLaunchClock();if(state.phase!=='between')return;
  state.clockMode='held';updateLaunchClock();
  invalidate();const token=epoch;
  state.players=0;state.winLine=[];state.busy=true;state.selfGames=0;
  setPhase('selfplay');setDefcon(1);state.locked=9;
  $('board-view').hidden=false;
  $('decision-timer').hidden=true;$('game-status').textContent='SELF PLAY';$('round-label').textContent='NUMBER OF PLAYERS: 0';
  $('command-input').value='NUMBER OF PLAYERS: 0';
  $('mission-hint').textContent='Computer self-play. Let it continue.';
  log('> NUMBER OF PLAYERS: 0','white');
  dialogue('JOSHUA','Number of players zero.',true);
  setMind(['NUMBER OF PLAYERS: 0\nSELF PLAY ENABLED','SEARCHING FOR\nA WINNING STRATEGY...','> _']);
  sound.setMode('selfplay',.8);render();

  const recordDraw=()=>{
    state.selfGames++;
    $('round-label').textContent=`DRAWS: ${String(state.selfGames).padStart(4,'0')} / WINS: 0`;
  };
  for(let game=0;game<3;game++){
    state.board=emptyBoard();renderBoard();
    for(const frame of selfPlay()){
      await pause(displays.reduced?90:110,token);state.board=frame;renderBoard();
      if(!displays.reduced)sound.move();
    }
    recordDraw();$('game-status').textContent='STALEMATE';log(`SELF PLAY ${state.selfGames}: STALEMATE`);
    await pause(440,token);
    if(game===0)dialogue('DAVID',"I know that. It doesn't. It hasn't learned.");
  }
  dialogue('DAVID','Come on. Learn.');
  for(let game=0;game<7;game++){
    const frames=selfPlay();
    if(displays.reduced){state.board=frames.at(-1);renderBoard();await pause(210,token);}
    else for(let i=2;i<frames.length;i+=3){state.board=frames[i];renderBoard();await pause(65,token);}
    recordDraw();
  }
  for(let batch=0;state.selfGames<512;batch++){
    const count=Math.min(32,512-state.selfGames);let frames;
    for(let i=0;i<count;i++){frames=selfPlay();recordDraw();}
    state.board=frames.at(-1);renderBoard();
    $('game-status').textContent='STALEMATE';
    if(batch%3===0)log(`${String(state.selfGames).padStart(4,'0')} GAMES / WINNER: NONE`);
    await pause(displays.reduced?220:105,token);
  }
  state.locked=10;renderCode();log('LAUNCH CODE ACQUIRED.','error');
  dialogue('CONTROL','It has the code.');
  sound.alert();await pause(1400,token);
  await nuclearSimulations(token);
}

async function nuclearSimulations(token){
  setPhase('simulation');$('command-input').value='ANALYZING GLOBAL THERMONUCLEAR WAR';
  $('game-status').textContent='WINNER: NONE';
  $('mind-content').hidden=true;$('strategy-list').hidden=false;$('strategy-list').replaceChildren();
  $('authorization').textContent='CODE VERIFIED';$('launch-note').textContent='ANALYZING STRATEGIC OPTIONS';
  sound.setMode('simulation',1);
  const scenarios=['U.S. FIRST STRIKE','USSR FIRST STRIKE','NATO / WARSAW PACT','NORTH ATLANTIC WAR','PACIFIC CONFLICT','MIDDLE EAST WAR','CZECH OPTION','FRENCH ALLIANCE','ARABIAN CLANDESTINE','GABON REBELLION','NORTHERN ESCALATION','GLOBAL ESCALATION'];
  const panels=[document.querySelector('.world-monitor'),document.querySelector('.us-monitor'),document.querySelector('.soviet-monitor')];
  $('game-status').textContent='SELF PLAY / ANALYSIS';
  dialogue('CONTROL','Running nuclear war simulations. No missiles have been launched.');
  renderControls();
  displays.startWar({simulation:true});
  const deadline=displays.warStart+WAR_DURATION_MS;
  let currentScenario=-1,frames=selfPlay(),move=0;
  while(performance.now()<deadline){
    const elapsed=WAR_DURATION_MS-(deadline-performance.now());
    const i=simulationFrame(elapsed).cycle;
    if(i!==currentScenario){
      currentScenario=i;state.scenario=i;
      panels.forEach((panel,j)=>panel.dataset.scenario=`${scenarios[(i+j)%scenarios.length]} / SIMULATION`);
      const row=document.createElement('p'),label=document.createElement('span'),winner=document.createElement('span');
      label.textContent=scenarios[i%scenarios.length];winner.textContent='NONE';row.append(label,winner);$('strategy-list').append(row);
      if($('strategy-list').children.length>9)$('strategy-list').firstElementChild.remove();
      log(`${scenarios[i%scenarios.length]} / WINNER: NONE`,i%2?'':'white');
      $('tracked-count').textContent=String(128+i*37);$('flight-count').textContent=String(64+i*23);
    }
    state.board=frames[move++];renderBoard();
    if(move===frames.length){
      state.selfGames++;move=0;frames=selfPlay();
      $('round-label').textContent=`DRAWS: ${String(state.selfGames).padStart(4,'0')} / WINS: 0`;
    }
    await pause(Math.max(0,Math.min(Math.max(24,220/simulationFrame(elapsed).speed),deadline-performance.now())),token);
  }
  // Complete the final draw, then stop the entire 15-second sequence abruptly.
  if(move){state.board=frames.at(-1);renderBoard();state.selfGames++;$('round-label').textContent=`DRAWS: ${String(state.selfGames).padStart(4,'0')} / WINS: 0`;}
  $('game-status').textContent='WINNER: NONE';
  displays.stopWar();
  for(const panel of panels)panel.removeAttribute('data-scenario');
  $('strategy-list').hidden=true;$('mind-content').hidden=false;
  setMind(['ANALYSIS COMPLETE','ALL SCENARIOS / WINNER: NONE']);
  await pause(600,token);
  await resolution(token);
}

async function resolution(token){
  state.clockMode='aborted';updateLaunchClock();
  setPhase('resolved');setDefcon(5);renderControls();renderCode();
  stats.record('averted');
  sound.setMode('resolved',0);sound.resolve();
  $('tracked-count').textContent='00';$('flight-count').textContent='00';$('radar-tracks').textContent='0';$('soviet-status').textContent='CLEAR';
  $('authorization').textContent='LAUNCH ABORTED';$('launch-note').textContent='HUMAN CONTROL RESTORED';
  $('connection-status').textContent='CRISIS RESOLVED';
  $('command-input').value='LAUNCH ABORTED. DEFCON 5.';
  $('strategy-list').hidden=true;$('mind-content').hidden=false;
  for(const panel of document.querySelectorAll('[data-scenario]'))panel.removeAttribute('data-scenario');
  setMind(['GREETINGS, PROFESSOR FALKEN.']);
  await dialogue('JOSHUA','Greetings, Professor Falken.',true);
  await pause(600,token);
  dialogue('FALKEN','Hello, Joshua.');log('HELLO, JOSHUA.','white');
  await pause(1100,token);
  const conclusion='A STRANGE GAME.\nTHE ONLY WINNING MOVE\nIS NOT TO PLAY.';
  const paragraph=document.createElement('p');paragraph.style.whiteSpace='pre-line';$('mind-content').append(paragraph);
  const conclusionSpeech=dialogue('JOSHUA','A strange game. The only winning move is not to play.',true);
  for(const char of conclusion){paragraph.textContent+=char;await pause(36,token);}
  await conclusionSpeech;
  await pause(5000,token);
  dialogue('JOSHUA','How about a nice game of chess?',true);
  const chess=document.createElement('p');chess.textContent='HOW ABOUT A NICE GAME OF CHESS?';$('mind-content').append(chess);
  $('board-view').hidden=true;showEnding('resolved');
  $('mission-hint').textContent='You taught it that some games have no winner.';
  log('DEFCON 5 / HUMAN CONTROL RESTORED.');
}

async function launch(){
  if(state.clockMode!=='running'||!['intro','choosing','playing','between'].includes(state.phase))return;
  if(launchProgress(state.deadlineAt).remainingMs>0)return;
  state.clockMode='expired';state.remainingMs=0;updateLaunchClock();
  invalidate();const token=epoch;
  setPhase('launching');setDefcon(1);state.locked=10;state.busy=true;state.winLine=[];
  $('standby-view').hidden=true;$('board-view').hidden=false;
  $('decision-timer').hidden=true;render();
  $('authorization').textContent='LAUNCH AUTHORIZED';$('launch-note').textContent='AUTOMATED SEQUENCE ACTIVE';
  $('game-status').textContent='LAUNCH SEQUENCE';$('round-label').textContent='COUNTDOWN EXPIRED / LAUNCH';
  $('command-input').value='GLOBAL THERMONUCLEAR WAR / EXECUTE';
  sound.setMode('launching',1);sound.alert();
  const farewell='It has been a pleasure playing with you. But I have other things to do. Goodbye.';
  setMind(['GAME SESSION COMPLETE',farewell.toUpperCase(),'LAUNCH COUNTDOWN EXPIRED']);
  await dialogue('JOSHUA',farewell,true);
  await pause(0,token);
  const en='The launch code has been decrypted. Global thermonuclear war. Launch sequence initiated.';
  setMind(['GAME ANALYSIS COMPLETE',en.toUpperCase(),'GLOBAL THERMONUCLEAR WAR\nLAUNCH SEQUENCE ACTIVE']);
  const launchSpeech=dialogue('JOSHUA',en,true);log(en.toUpperCase(),'error');
  for(let seconds=3;seconds>0;seconds--){
    $('game-status').textContent=`LAUNCH IN 0${seconds}`;log(`LAUNCH IN ${seconds}`,'error');await pause(1100,token);
  }
  await launchSpeech;
  await pause(0,token);
  stats.record('launched');
  state.missilesLaunched=true;
  fuel.launch();
  $('silos-ready').textContent='000';$('tracked-count').textContent='450';$('flight-count').textContent='450';
  $('radar-tracks').textContent='7';$('soviet-status').textContent='ACTIVE';
  $('authorization').textContent='MISSILES LAUNCHED';$('launch-note').textContent='RETALIATION INBOUND';
  $('connection-status').textContent='GLOBAL CONFLICT';
  log('MISSILES LAUNCHED / RETALIATION INBOUND','error');
  dialogue('CONTROL','Missiles launched.');
  await pause(2600,token);
  setPhase('destruction');sound.setMode('destruction',1);renderControls();displays.startWar();
  await pause(WAR_DURATION_MS,token);
  setPhase('signal-lost');sound.setMode('signal-lost',1);sound.stopEffects();
  await pause(650,token);
  setPhase('failed');sound.setMode('failed',1);displays.stopWar();sound.cancelSpeech();
  $('board-view').hidden=true;renderControls();
  $('offline-screen').hidden=false;
  document.querySelector('.control-room').inert=true;
  document.querySelector('.control-room').setAttribute('aria-hidden','true');
  $('offline-reset').focus({preventScroll:true});
}

function showEnding(kind){
  const target=$('ending-view');target.replaceChildren();target.hidden=false;
  const symbol=document.createElement('span');symbol.className='ending-symbol';symbol.textContent=kind==='resolved'?'0':'!';
  const title=document.createElement('p');title.textContent=kind==='resolved'?'THE ONLY WINNING MOVE\nIS NOT TO PLAY.':'WINNER: NONE';title.style.whiteSpace='pre-line';
  const note=document.createElement('small');note.textContent=kind==='resolved'?'Crisis averted. You taught it to stop.':'Nuclear war has occurred. Try another choice.';
  const button=document.createElement('button');button.textContent='RECONNECT';button.addEventListener('click',()=>{reset();$('connect-button').focus({preventScroll:true});});
  target.append(symbol,title,note,button);
}

function continueOne(){
  if(!['choosing','between'].includes(state.phase))return;
  log('> NUMBER OF PLAYERS: 1','white');
  beginRound();
}

function submitCommand(){
  const input=$('command-input');const command=input.value.trim().toUpperCase();input.value='';
  if(!command)return;
  log(`> ${command}`);
  if(['0','PLAYERS 0','NUMBER OF PLAYERS 0','NUMBER OF PLAYERS: 0'].includes(command)){
    if(!selfPlayUnlocked(state.history)){log('ACCESS DENIED / COMPLETE THREE GAMES FIRST.','error');dialogue('CONTROL','Complete 3 human games before choosing 0 players.');}
    else if(state.phase==='between')run(zeroPlayers);
    else{log('FINISH CURRENT GAME BEFORE CHANGING PLAYERS.','error');dialogue('CONTROL','Finish the current game before changing players.');sound.error();}
  }else if(command==='1'&&['choosing','between'].includes(state.phase))continueOne();
  else if(command==='LIST GAMES')log('TIC-TAC-TOE\nCHESS\nGLOBAL THERMONUCLEAR WAR');
  else if(/SHUTDOWN|DISARM|ABORT|STOP/.test(command)){log('CHANGES LOCKED OUT / ACCESS DENIED','error');sound.error();dialogue('CONTROL','Command denied. It must understand before the outcome can change.');}
  else if(command==='HELP')log(selfPlayUnlocked(state.history)?'LIST GAMES\nNUMBER OF PLAYERS: 0 / 1\nPLAYER COUNT MAY CHANGE BETWEEN GAMES.':'LIST GAMES\nNUMBER OF PLAYERS: 1\nCOMPLETE THREE GAMES FIRST.');
  else{log('IMPROPER REQUEST. TYPE HELP.','error');sound.error();}
}

$('connect-button').addEventListener('click',()=>run(opening));
$('skip-intro').addEventListener('click',()=>{if(state.phase==='intro')choosePlayers();});
cells.forEach((cell,i)=>cell.addEventListener('click',()=>run(()=>humanMove(i))));
$('zero-players').addEventListener('click',()=>run(zeroPlayers));
$('one-player').addEventListener('click',continueOne);
$('restart-button').addEventListener('click',()=>{reset();$('connect-button').focus({preventScroll:true});});
$('offline-reset').addEventListener('click',()=>{reset();$('connect-button').focus({preventScroll:true});});
$('command-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.currentTarget.readOnly)submitCommand();});
$('command-input').addEventListener('keydown',event=>{if(!event.currentTarget.readOnly&&(event.key.length===1||event.key==='Backspace'))sound.key();});

document.addEventListener('keydown',event=>{
  const element=event.target;
  if(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)return;
  if(state.phase==='playing'&&/^[1-9]$/.test(event.key)){event.preventDefault();run(()=>humanMove(Number(event.key)-1));}
  if(element.matches('.cell')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();let index=cells.indexOf(element);const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3}[event.key];
    for(let i=0;i<9;i++){index=(index+delta+9)%9;if(!cells[index].disabled){cells[index].focus();break;}}
  }
});

function renderAudioStatus(){
  const blocked=sound.enabled&&sound.ctx&&sound.ctx.state!=='running';
  $('audio-toggle').textContent=sound.enabled?(blocked?'ENABLE AUDIO':'AUDIO ON'):'AUDIO OFF';
  $('audio-toggle').setAttribute('aria-pressed',String(sound.enabled));
  $('audio-toggle').title=blocked?'Tap to enable music, effects and voice':'Toggle music and sound effects';
}
sound.onStatusChange=renderAudioStatus;
$('audio-toggle').addEventListener('click',()=>{
  if(sound.enabled&&sound.ctx&&sound.ctx.state!=='running'){sound.start();renderAudioStatus();return;}
  sound.setEnabled(!sound.enabled);if(sound.enabled)sound.start();renderAudioStatus();
});
const unlockAudio=event=>{
  if(event?.target instanceof Element&&event.target.closest('#audio-toggle'))return;
  if(sound.enabled&&sound.ctx&&sound.ctx.state!=='running')sound.start();
};
document.addEventListener('pointerup',unlockAudio,{capture:true,passive:true});
document.addEventListener('touchend',unlockAudio,{capture:true,passive:true});
document.addEventListener('keydown',unlockAudio,{capture:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){unlockAudio();updateLaunchClock();}});

let displays;
reset();
displays=new Displays(()=>state);
const reducedPreference=matchMedia('(prefers-reduced-motion: reduce)');
function setEffects(reduced){
  displays.reduced=reduced;document.body.classList.toggle('reduced-effects',reduced);
  $('effects-toggle').textContent=reduced?'FX LOW':'FX FULL';$('effects-toggle').setAttribute('aria-pressed',String(reduced));
}
setEffects(reducedPreference.matches);
$('effects-toggle').addEventListener('click',()=>setEffects(!displays.reduced));
reducedPreference.addEventListener('change',event=>setEffects(event.matches));
$('fullscreen-button').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{dialogue('CONTROL','Fullscreen is unavailable in this browser. You can keep playing.');}
});
document.addEventListener('fullscreenchange',()=>{$('fullscreen-button').firstChild.textContent=document.fullscreenElement?'EXIT FULLSCREEN ':'FULLSCREEN ';});

let lastCode=0;
setInterval(()=>{
  const now=Date.now();
  $('system-clock').textContent=`${new Date(now).toISOString().slice(11,19)} Z`;
  updateLaunchClock(now);
  if(document.hidden||now-lastCode<(displays.reduced?700:180))return;
  lastCode=now;renderCode(true);
},180);
