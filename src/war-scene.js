// Fictional, accelerated global exchange for the cinematic ending.
// Coordinates are illustrative national/region locations, not operational sites.
export const WAR_DURATION_MS = 15000;
export const SIMULATION_FLASH_MS = 3600;
export const WAR_FACTIONS = [
  {id:'usa',label:'USA',color:'#39c9ff',sites:[[-112,44],[-101,39],[-89,42]]},
  {id:'ussr',label:'USSR',color:'#ff705f',sites:[[42,55],[68,56],[105,53]]},
  {id:'china',label:'CHINA',color:'#ffce69',sites:[[103,36],[112,38]]},
  {id:'uk',label:'UK',color:'#72efac',sites:[[-3,56],[-2,52]]},
  {id:'france',label:'FRANCE',color:'#ce9bff',sites:[[2,47],[4,46]]}
];
const targets = [
  ['ussr',38,56],['usa',-100,40],['china',113,35],['uk',-2,54],['france',3,47],
  ['canada',-105,54],['germany',10,51],['ussr',70,57],['japan',138,37],
  ['brazil',-48,-16],['argentina',-64,-34],['south-africa',25,-29],['egypt',30,27],
  ['india',78,23],['pakistan',69,30],['iran',53,33],['turkey',34,39],
  ['australia',136,-26],['indonesia',116,-2],['ussr',115,59],['usa',-120,37],
  ['mexico',-102,24],['spain',-4,40],['poland',20,52]
];
const noise=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
export function createWarMissiles(variant=0){return Array.from({length:72},(_,i)=>{
  const faction=WAR_FACTIONS[i%WAR_FACTIONS.length];
  let target=targets[(i+variant*7)%targets.length];
  if(target[0]===faction.id)target=targets[(i+variant*7+1)%targets.length];
  const launchAt=1.5*(i===0?120:850+(i-1)*89+Math.floor((i-1)/12)*125);
  const flightMs=Math.min(1.5*(1250+noise(i+variant*73+9)*1050),WAR_DURATION_MS-launchAt-80);
  return {id:i,faction,from:faction.sites[(Math.floor(i/5)+variant)%faction.sites.length],
    to:target.slice(1),launchAt,flightMs,impactAt:launchAt+flightMs,lift:8+noise(i+variant*73+41)*16};
});}
export const WAR_MISSILES = createWarMissiles();

// Integrate an exponential playback rate: half speed initially, 180x at the end.
// The same clock drives maps, scenario names and the central self-play board.
export function simulationFrame(elapsed,reduced=false){
  const time=Math.max(0,Math.min(WAR_DURATION_MS,elapsed));
  if(reduced)return {cycle:0,timeMs:time<5000?2700:time<10000?7800:WAR_DURATION_MS,speed:1};
  const exponent=Math.log(360),progress=time/WAR_DURATION_MS;
  const virtualTime=WAR_DURATION_MS*.5*Math.expm1(exponent*progress)/exponent;
  return {cycle:Math.floor(virtualTime/WAR_DURATION_MS),timeMs:virtualTime%WAR_DURATION_MS,speed:.5*Math.exp(exponent*progress)};
}

// One authored wall-wide flash at a time; impacts retain their own local glow.
// Reduced effects preserves impact markers without any flashing.
export function warFlashOpacity(elapsed,reduced=false){
  if(reduced||elapsed<2800||elapsed>=WAR_DURATION_MS)return 0;
  const age=(elapsed-2800)%1300;
  if(age>=420)return 0;
  return .64*(age<70?age/70:1-(age-70)/350);
}

// Overload is inside the final 3.6 seconds, with no extra recovery tail.
// Rapid regional impacts supply the finer flicker; whole-wall pulses stay spaced.
export function simulationFlashOpacity(elapsed,reduced=false){
  const tail=elapsed-(WAR_DURATION_MS-SIMULATION_FLASH_MS);
  if(reduced||tail<0||elapsed>=WAR_DURATION_MS)return 0;
  const age=tail%1200;
  if(age>=500)return 0;
  return .8*(age<80?age/80:1-(age-80)/420);
}
