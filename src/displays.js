import { WAR_DURATION_MS, WAR_FACTIONS, WAR_MISSILES, createWarMissiles, simulationFrame, warFlashOpacity, simulationFlashOpacity } from './war-scene.js';

const COLORS = { cyan:'#39c9ff', green:'#72efac', red:'#ff705f', white:'#d6e9ef', dim:'#254453' };
const sovietIds = new Set([643,112,804,233,428,440,498,268,51,31,398,417,762,795,860]);
const strategicSites = [
  { x:-111.18,y:47.5,name:'MALMSTROM',dx:4,dy:-9 },
  { x:-101.3,y:48.4,name:'MINOT',dx:4,dy:12 },
  { x:-104.8,y:41.1,name:'F.E. WARREN',dx:4,dy:11 },
  { x:-93.5,y:38.7,name:'WHITEMAN',dx:4,dy:11 },
];
const sovietSites = [{x:40.5,y:62.9,name:'PLESETSK'},{x:63.3,y:45.6,name:'BAIKONUR'},{x:89,y:55.3,name:'UZHUR'},{x:60.4,y:51,name:'DOMBAROVSKY'},{x:90,y:69.3,name:'NORILSK'}];
const pseudo = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const WAR_REGIONS = [
  ['NORTH AMERICA',[-130,-60,20,65]], ['NORTH ATLANTIC',[-85,20,10,70]],
  ['WESTERN EUROPE',[-14,32,32,68]], ['EASTERN EUROPE',[15,65,32,72]],
  ['NORTH ASIA',[45,180,35,78]], ['SOUTH AMERICA',[-85,-30,-58,15]],
  ['AFRICA',[-22,55,-37,38]], ['EAST ASIA',[85,150,5,58]],
  ['PACIFIC',[100,180,-50,35]], ['MIDDLE EAST',[25,85,8,48]],
  ['SOUTH ASIA',[58,105,-2,38]], ['GLOBAL EXCHANGE',[-180,180,-58,83]]
];

function decodeTopology(topology, objectName) {
  const transform = topology.transform;
  const arcs = topology.arcs.map(arc => {
    let x=0,y=0;
    return arc.map(point => {
      if (!transform) return point;
      x += point[0]; y += point[1];
      return [x * transform.scale[0] + transform.translate[0],y * transform.scale[1] + transform.translate[1]];
    });
  });
  const ring = ids => ids.flatMap((id,i) => {
    const points = id < 0 ? [...arcs[~id]].reverse() : arcs[id];
    return i ? points.slice(1) : points;
  });
  return topology.objects[objectName].geometries.map(geometry => ({
    id:Number(geometry.id),
    rings:geometry.type === 'Polygon' ? geometry.arcs.map(ring) : geometry.type === 'MultiPolygon' ? geometry.arcs.flatMap(p => p.map(ring)) : []
  }));
}

export class Displays {
  constructor(getState) {
    this.getState = getState;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canvases = Object.fromEntries(['us-map','world-map','soviet-map','radar'].map(id => [id,document.getElementById(id)]));
    this.countries = []; this.states=[]; this.lastFrame=0;
    this.observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const canvas = entry.target;
        const dpr = Math.min(devicePixelRatio || 1,2);
        canvas.width = Math.round(entry.contentRect.width*dpr); canvas.height = Math.round(entry.contentRect.height*dpr);
      }
      this.draw(performance.now());
    });
    for (const canvas of Object.values(this.canvases)) this.observer.observe(canvas);
    this.warViews=[...document.querySelectorAll('.monitor')].map((monitor,index)=>{
      const [name,bounds]=WAR_REGIONS[index%WAR_REGIONS.length];
      const cover=document.createElement('div');cover.className='war-map';cover.hidden=true;
      const title=document.createElement('h3');title.textContent=name;
      const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${name} missile exchange and destruction`);
      const status=document.createElement('p');status.textContent='LAUNCH DETECTED';
      cover.append(title,canvas,status);monitor.append(cover);this.observer.observe(canvas);
      return {monitor,cover,canvas,status,bounds,index,base:null};
    });
    this.warStart=null;
    this.warFlash=document.createElement('div');this.warFlash.className='war-flash';this.warFlash.hidden=true;this.warFlash.setAttribute('aria-hidden','true');
    this.warLegend=document.createElement('div');this.warLegend.className='war-legend';this.warLegend.hidden=true;this.warLegend.setAttribute('aria-label','Missile origin color legend');
    for(const faction of WAR_FACTIONS){
      const item=document.createElement('span'),dot=document.createElement('i');dot.style.backgroundColor=faction.color;dot.setAttribute('aria-hidden','true');
      item.append(dot,document.createTextNode(faction.label));this.warLegend.append(item);
    }
    document.body.append(this.warFlash,this.warLegend);
    this.load();
    const animate = now => {
      if (!document.hidden && now-this.lastFrame > (this.reduced ? 160 : 40)) { this.draw(now); this.lastFrame=now; }
      this.animation = requestAnimationFrame(animate);
    };
    this.animation = requestAnimationFrame(animate);
  }

  async load() {
    try {
      const [world,states] = await Promise.all(['assets/world.json','assets/states.json'].map(async url => {
        const response = await fetch(url); if (!response.ok) throw new Error('Map data unavailable'); return response.json();
      }));
      this.countries=decodeTopology(world,'countries'); this.states=decodeTopology(states,'states');
    } catch {
      for (const canvas of Object.values(this.canvases).filter(c => c.id !== 'radar')) canvas.setAttribute('aria-label','Map data unavailable; the game can continue');
    }
  }

  context(id) {
    const canvas=this.canvases[id], ctx=canvas.getContext('2d');
    const dpr=Math.min(devicePixelRatio || 1,2),w=canvas.width/dpr,h=canvas.height/dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    return {ctx,w,h};
  }

  projection(w,h,bounds,pad=8,verticalScale=1.7) {
    const [left,right,bottom,top]=bounds;
    const scale=Math.min((w-pad*2)/(right-left),(h-pad*2)/((top-bottom)*verticalScale));
    const ox=(w-(right-left)*scale)/2,oy=(h-(top-bottom)*scale*verticalScale)/2;
    return (lon,lat) => [ox+(lon-left)*scale,oy+(top-lat)*scale*verticalScale];
  }

  paths(ctx,features,project,color,width=.6,clipBounds) {
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
    for (const feature of features) for (const ring of feature.rings) {
      let last=null;
      for (const p of ring) {
        const outside=clipBounds && (p[0]<clipBounds[0] || p[0]>clipBounds[1] || p[1]<clipBounds[2] || p[1]>clipBounds[3]);
        const [x,y]=project(...p);
        if (outside) {last=null;continue;}
        if (!last || Math.abs(p[0]-last[0])>180) ctx.moveTo(x,y);else ctx.lineTo(x,y);
        last=p;
      }
    }
    ctx.stroke();
  }

  dot(ctx,x,y,color,r=2) {
    ctx.fillStyle=color;
    if (!this.reduced) {ctx.shadowBlur=5;ctx.shadowColor=color;}
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  }

  missilesActive(state){return state.phase==='simulation'||state.missilesLaunched===true;}

  drawUS(now,state) {
    const {ctx,w,h}=this.context('us-map');if(w<1||h<1)return;
    const bounds=[-127,-65,23,51],project=this.projection(w,h,bounds,10);
    ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
    this.paths(ctx,this.countries.filter(f=>[124,484].includes(f.id)),project,'#21404e',.6,bounds);
    this.paths(ctx,this.states.filter(f=>![2,15,72].includes(f.id)),project,COLORS.cyan,.65,bounds);
    for(let i=0;i<30;i++){
      const [x,y]=project(-113+pseudo(i+1)*23,36+pseudo(i+50)*12);
      this.dot(ctx,x,y,COLORS.green,1.25);
    }
    const fs=Math.max(7,Math.min(10,w/25));ctx.font=`${fs}px Terminal, monospace`;
    for(const site of strategicSites){
      const [x,y]=project(site.x,site.y);this.dot(ctx,x,y,COLORS.white,2.3);
      ctx.fillStyle=COLORS.white;
      ctx.fillText(site.name,Math.min(w-ctx.measureText(site.name).width-2,x+site.dx),y+site.dy);
    }
    if(this.missilesActive(state))this.attacks(ctx,w,h,project,now,state,true);
    ctx.restore();
  }

  drawWorld(now,state){
    const {ctx,w,h}=this.context('world-map');if(w<1||h<1)return;
    const project=this.projection(w,h,[-180,180,-58,83],3);
    this.paths(ctx,this.countries.filter(f=>f.id!==10),project,'#58899b',.55);
    this.paths(ctx,this.countries.filter(f=>[840,124].includes(f.id)),project,COLORS.cyan,.9);
    this.paths(ctx,this.countries.filter(f=>sovietIds.has(f.id)),project,COLORS.red,.8);
    if(this.missilesActive(state))this.attacks(ctx,w,h,project,now,state,false);
    if(state.phase==='resolved'){
      ctx.fillStyle=COLORS.green;ctx.textAlign='center';ctx.font=`${Math.min(14,w/17)}px Terminal, monospace`;
      ctx.fillText('STRATEGIC THREAT: CLEAR',w/2,h-3);ctx.textAlign='start';
    }
  }

  drawSoviet(now,state){
    const {ctx,w,h}=this.context('soviet-map');if(w<1||h<1)return;
    const bounds=[22,181,33,80],project=this.projection(w,h,bounds,8,2.5);
    this.paths(ctx,this.countries.filter(f=>sovietIds.has(f.id)),project,COLORS.red,.8,bounds);
    ctx.font=`${Math.max(7,Math.min(10,w/25))}px Terminal,monospace`;
    for(const site of sovietSites){const[x,y]=project(site.x,site.y);this.dot(ctx,x,y,state.phase==='resolved'?COLORS.green:COLORS.red,2);ctx.fillStyle=COLORS.white;ctx.fillText(site.name,Math.min(w-ctx.measureText(site.name).width,x+4),y-6);}
    if(this.missilesActive(state))this.attacks(ctx,w,h,project,now,state,false,true);
  }

  attacks(ctx,w,h,project,now,state,usOnly=false,sovietOnly=false){
    const intense=['simulation','launching','failed'].includes(state.phase);
    const count=intense?28:Math.max(2,(6-state.defcon)*2);
    const period=intense?2700:7000;
    const progress=this.reduced?.72:(now%period)/period;
    for(let i=0;i<count;i++){
      let from,to;
      if(usOnly){from=[-68-pseudo(i+25)*35,55];to=[-121+pseudo(i+14)*48,28+pseudo(i+60)*19];}
      else if(sovietOnly){from=[30+pseudo(i)*12,36];to=[40+pseudo(i+9)*100,40+pseudo(i+80)*28];}
      else{
        const reverse=i%2===1;
        const us=[-120+pseudo(i+3)*50,28+pseudo(i+90)*22];
        const ru=[35+pseudo(i+15)*115,45+pseudo(i+41)*25];
        from=reverse?ru:us;to=reverse?us:ru;
      }
      const[a,b]=project(...from),[c,d]=project(...to);
      const offset=pseudo(i+5)*.7;
      const t=Math.max(0,Math.min(1,(progress-offset)*2.8));if(t<=0)continue;
      const mx=(a+c)/2,my=Math.max(1,Math.min(b,d)-Math.abs(c-a)*.2-10);
      const color=i%2?COLORS.red:COLORS.cyan;
      ctx.strokeStyle=color;ctx.globalAlpha=intense?.8:.65;ctx.lineWidth=intense?.9:.7;
      ctx.beginPath();ctx.moveTo(a,b);
      const steps=Math.ceil(t*25);
      for(let j=1;j<=steps;j++){const f=Math.min(t,j/25);ctx.lineTo((1-f)**2*a+2*(1-f)*f*mx+f*f*c,(1-f)**2*b+2*(1-f)*f*my+f*f*d);}
      ctx.stroke();ctx.globalAlpha=1;
      if(t<1){const f=t;this.dot(ctx,(1-f)**2*a+2*(1-f)*f*mx+f*f*c,(1-f)**2*b+2*(1-f)*f*my+f*f*d,COLORS.white,1.5);}
      else if(intense){
        const radius=this.reduced?3:3+Math.sin(now*.002+i)*2;
        this.dot(ctx,c,d,COLORS.white,radius);
        ctx.strokeStyle=color;ctx.globalAlpha=.3;ctx.beginPath();ctx.arc(c,d,radius*2.2,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
      }
    }
  }

  drawRadar(now,state){
    const{ctx,w,h}=this.context('radar');if(w<1||h<1)return;
    const x=w/2,y=h/2,r=Math.min(w,h)/2-5;
    ctx.strokeStyle='#26704b';ctx.lineWidth=.7;
    for(let i=1;i<=4;i++){ctx.beginPath();ctx.arc(x,y,r*i/4,0,Math.PI*2);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.moveTo(x,y-r);ctx.lineTo(x,y+r);ctx.stroke();
    const angle=this.reduced?-.8:now*.0005;
    if(!this.reduced)for(let i=0;i<22;i++){const a=angle-i*.018;ctx.strokeStyle=`rgba(114,239,172,${.35*(1-i/22)})`;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.stroke();}
    const n=this.missilesActive(state)?7:0;
    for(let i=0;i<n;i++){
      const a=pseudo(i+25)*Math.PI*2,d=(.2+pseudo(i+50)*.65)*r;
      const px=x+Math.cos(a)*d,py=y+Math.sin(a)*d;
      ctx.fillStyle=i>3?COLORS.red:COLORS.green;ctx.fillRect(px-2,py-2,4,4);
    }
    ctx.font='8px Terminal,monospace';ctx.fillStyle='#79ae8e';ctx.fillText('N',x-3,y-r+10);
  }

  startWar({simulation=false}={}){
    this.warSimulation=simulation;this.simulationCycle=null;
    document.body.dataset.warMode=simulation?'simulation':'destruction';
    this.warStart=performance.now();
    this.warFlash.hidden=false;this.warLegend.hidden=false;
    for(const view of this.warViews){view.cover.hidden=simulation&&view.monitor.classList.contains('game-monitor');view.base=null;}
    // Measure after showing the covers, including the compact mobile wall.
    for(const {canvas} of this.warViews){const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);}
    this.drawWar(this.warStart);
  }

  stopWar(){
    this.warStart=null;this.simulationCycle=null;this.simulationMissiles=null;this.warSimulation=false;
    delete document.body.dataset.warMode;
    this.warFlash.hidden=true;this.warFlash.style.opacity='0';this.warLegend.hidden=true;
    for(const view of this.warViews){view.cover.hidden=true;view.base=null;}
  }

  drawWar(now){
    const elapsed=Math.max(0,Math.min(WAR_DURATION_MS,now-this.warStart));
    const frame=this.warSimulation?simulationFrame(elapsed,this.reduced):{cycle:0,timeMs:this.reduced?(elapsed<5000?2700:elapsed<10000?7800:WAR_DURATION_MS):elapsed,speed:1};
    const storyTime=frame.timeMs;
    if(this.warSimulation&&frame.cycle!==this.simulationCycle){
      this.simulationCycle=frame.cycle;this.simulationMissiles=createWarMissiles(frame.cycle);
    }
    const missiles=this.warSimulation?this.simulationMissiles:WAR_MISSILES;
    this.warFlash.style.opacity=String(this.warSimulation?simulationFlashOpacity(elapsed,this.reduced):warFlashOpacity(elapsed,this.reduced));
    for(const view of this.warViews){
      if(view.cover.hidden)continue;
      const {canvas,bounds,index}=view,dpr=Math.min(devicePixelRatio||1,2),w=canvas.width/dpr,h=canvas.height/dpr;
      if(w<1||h<1)continue;
      const ctx=canvas.getContext('2d'),project=this.projection(w,h,bounds,5,1.1);
      if(!view.base||view.base.width!==canvas.width||view.base.height!==canvas.height){
        view.base=document.createElement('canvas');view.base.width=canvas.width;view.base.height=canvas.height;
        const base=view.base.getContext('2d');base.setTransform(dpr,0,0,dpr,0,0);
        this.paths(base,this.countries,project,'#6d9cae',.75,bounds);
        if(index===0)this.paths(base,this.states,project,COLORS.cyan,.55,bounds);
        view.routeCycle=null;
      }
      if(view.routeCycle!==frame.cycle){
        view.routeCycle=frame.cycle;
        // Keep only the current scenario's projected routes, reusing the map bitmap.
        // Cache geographic trajectories for this projection, including paths
        // entering from beyond a regional monitor's border.
        view.routes=missiles.map(missile=>{
          const [a,b]=project(...missile.from),[c,d]=project(...missile.to);
          const [mx,my]=project((missile.from[0]+missile.to[0])/2,Math.max(missile.from[1],missile.to[1])+missile.lift);
          const points=Array.from({length:41},(_,i)=>{const t=i/40;return [(1-t)**2*a+2*(1-t)*t*mx+t*t*c,(1-t)**2*b+2*(1-t)*t*my+t*t*d];});
          return {missile,points,target:[c,d],origin:[a,b]};
        });
      }
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(view.base,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
      let impactLight=0;
      for(const {missile,points,target:[c,d],origin:[a,b]} of view.routes){
        if(storyTime<missile.launchAt)continue;
        const t=Math.min(1,(storyTime-missile.launchAt)/missile.flightMs),color=missile.faction.color;
        const last=t*40,step=Math.floor(last),fraction=last-step;
        const tip=step===40?points[40]:[points[step][0]+(points[step+1][0]-points[step][0])*fraction,points[step][1]+(points[step+1][1]-points[step][1])*fraction];
        ctx.strokeStyle=color;ctx.lineWidth=index===WAR_REGIONS.length-1?1.1:.95;ctx.globalAlpha=t<1?.88:.48;
        ctx.beginPath();ctx.moveTo(a,b);
        for(let j=1;j<=step;j++)ctx.lineTo(...points[j]);
        ctx.lineTo(...tip);ctx.stroke();ctx.globalAlpha=1;
        this.dot(ctx,a,b,color,1.5);
        if(t<1){
          this.dot(ctx,...tip,color,2.1);
          ctx.fillStyle='#fff';ctx.fillRect(tip[0]-.65,tip[1]-.65,1.3,1.3);
        }else if(c>=-35&&c<=w+35&&d>=-35&&d<=h+35){
          const age=storyTime-missile.impactAt;
          const energy=this.reduced?0:Math.exp(-age/(400*Math.sqrt(frame.speed)));
          impactLight+=energy;
          const radius=this.reduced?5:5+Math.min(13,age/55);
          ctx.strokeStyle=color;ctx.lineWidth=.9;ctx.beginPath();ctx.arc(c,d,radius,0,Math.PI*2);ctx.stroke();
          ctx.beginPath();ctx.moveTo(c-3,d-3);ctx.lineTo(c+3,d+3);ctx.moveTo(c+3,d-3);ctx.lineTo(c-3,d+3);ctx.stroke();
          if(energy>.035){
            const glowRadius=14+energy*30,glow=ctx.createRadialGradient(c,d,0,c,d,glowRadius);
            glow.addColorStop(0,`rgba(255,255,255,${energy})`);glow.addColorStop(.16,`rgba(255,255,255,${energy*.95})`);glow.addColorStop(.5,`rgba(220,240,255,${energy*.36})`);glow.addColorStop(1,'rgba(220,240,255,0)');
            ctx.fillStyle=glow;ctx.fillRect(c-glowRadius,d-glowRadius,glowRadius*2,glowRadius*2);
          }
          this.dot(ctx,c,d,this.reduced?color:'#ffffff',this.reduced?2:2+energy*5);
        }
      }
      if(this.warSimulation&&!this.reduced&&elapsed>10500){
        // Individual regional screens brighten from their own impacts, asynchronously.
        ctx.fillStyle=`rgba(255,255,255,${Math.min(.56,impactLight*.085)})`;ctx.fillRect(0,0,w,h);
      }
      ctx.restore();
      view.status.textContent=this.warSimulation?`SIMULATION ${String(frame.cycle+1).padStart(3,'0')} / ${elapsed<5000?'LAUNCH':elapsed<10500?'NO WINNER':'ALL SCENARIOS / NONE'}`:(elapsed<2400?'LAUNCHES DETECTED':elapsed<10000?'RETALIATION / IMPACTS':'MUTUAL DESTRUCTION');
    }
  }

  draw(now){
    const state=this.getState();
    if(this.warStart!=null){this.drawWar(now);return;}
    if(state.phase==='failed')return;
    this.drawUS(now,state);this.drawWorld(now,state);this.drawSoviet(now,state);this.drawRadar(now,state);
  }
}
