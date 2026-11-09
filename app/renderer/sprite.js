// Codex atlas: eight columns, 192 × 208 cells. Version 2 adds 16 gaze poses.
export const ANIMATIONS = {
  idle: {row: 0, durations: [600,160,160,200,200,680], cycles: 1},
  'running-right': {row: 1, durations: [165,165,165,165,165,165,165,260], cycles: 2},
  'running-left': {row: 2, durations: [165,165,165,165,165,165,165,260], cycles: 2},
  waving: {row: 3, durations: [220,220,220,380], cycles: 3},
  jumping: {row: 4, durations: [200,190,220,190,360], cycles: 2},
  failed: {row: 5, durations: [220,220,240,280,280,260,240,420], cycles: 2},
  waiting: {row: 6, durations: [240,240,260,240,240,400], cycles: 2},
  running: {row: 7, durations: [190,190,190,190,190,320], cycles: 3},
  review: {row: 8, durations: [240,240,260,240,260,420], cycles: 2},
};
export function availableAnimations(pet) {
  return pet?.builtin
    ? ['waving', 'jumping', 'running-left', 'running-right']
    : ['waving', 'jumping', 'failed', 'waiting', 'running', 'review', 'running-left', 'running-right'];
}

// Use a deadline instead of queued timeouts so hidden or paused pets never catch up.
export class RandomAnimations {
  constructor(random = () => Math.random()) { this.random = random; this.reset(); }
  reset() { this.nextAt = null; this.previous = null; }
  delay(behaviour = 'calm') { return behaviour === 'playful' ? 4000 + this.random() * 4000 : 10000 + this.random() * 8000; }
  next(pet, now, enabled, busy = false, behaviour = 'calm') {
    if (!enabled || behaviour === 'quiet') { this.nextAt = null; return null; }
    if (this.nextAt === null || busy) { this.nextAt = now + this.delay(behaviour); return null; }
    if (now < this.nextAt) return null;
    const weights = {waving:2, review:2.5, waiting:2.5, running:2.5, jumping:2.2, failed:1.5, 'running-left':2, 'running-right':2};
    const choices = availableAnimations(pet).filter(name => name !== this.previous);
    let roll = this.random() * choices.reduce((sum,name)=>sum+weights[name],0);
    const name = choices.find(name => (roll -= weights[name]) < 0) || choices.at(-1);
    const cycles = ANIMATIONS[name]?.cycles || 2;
    const duration = ANIMATIONS[name].durations.reduce((a, b) => a + b, 0) * cycles;
    this.previous = name;
    this.nextAt = now + duration + this.delay(behaviour);
    return {name, duration};
  }
}

export function animationFrame(state, elapsed) {
  const animation = ANIMATIONS[state] || ANIMATIONS.idle;
  let time = elapsed % animation.durations.reduce((a,b) => a+b, 0);
  let frame = 0;
  while (time >= animation.durations[frame] && frame < animation.durations.length-1) time -= animation.durations[frame++];
  return {row: animation.row, frame};
}
export function gazeFrame(x, y) {
  const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
  const direction = Math.round(angle / (Math.PI / 8)) % 16;
  return {row: 9 + Math.floor(direction / 8), frame: direction % 8};
}
function ellipse(ctx, x,y,rx,ry, fill) {ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fillStyle=fill;ctx.fill();}
function shape(ctx, data, color) {ctx.fillStyle=color;ctx.fill(new Path2D(data));}
export function drawMiso(ctx, time = 0, state = 'idle', gaze = null, motion = true, actionTime = time) {
  const breathe = motion ? Math.sin(time / 800) : 0;
  const hopping = state === 'jumping' ? -Math.sin(Math.min(1, actionTime / 840) * Math.PI) * 22 : 0;
  const walking = state.startsWith('running-');
  const sway = walking ? Math.sin(time/85)*3 : 0;
  ctx.save(); ctx.translate(0, breathe + hopping);
  if (state === 'running-left') {ctx.translate(192,0);ctx.scale(-1,1);}
  // Original vector companion. It is independent of the imported Codex artwork.
  const fur='#aaa9a5', cream='#fff4e1', stripe='#7e7e7b', ink='#50514f';
  ctx.save();ctx.translate(120,158);ctx.rotate((motion ? Math.sin(time/650)*0.09 : 0) + (walking ? .3 : 0));
  ctx.beginPath();ctx.moveTo(0,9);ctx.bezierCurveTo(27,13,34,-8,23,-27);ctx.strokeStyle=fur;ctx.lineWidth=9;ctx.lineCap='round';ctx.stroke();ctx.restore();
  ellipse(ctx,96,143,28,39,fur);
  ellipse(ctx,96,147,18,28,cream);
  ellipse(ctx,81,178+sway,10,10,fur);ellipse(ctx,111,178-sway,10,10,fur);
  if (state === 'waving') {
    ctx.save();ctx.translate(124,127);ctx.rotate(Math.sin(time/100)*.3-.5);ellipse(ctx,0,-13,7,23,fur);ctx.restore();
  } else {ellipse(ctx,122,146+sway,7,21,fur);}
  ellipse(ctx,70,146-sway,7,21,fur);
  shape(ctx,'M 49 76 L 47 26 Q 47 15 56 20 L 79 42 Q 96 38 113 42 L 136 20 Q 145 15 145 26 L 143 76 Z',fur);
  shape(ctx,'M 55 52 L 54 29 L 72 46 Z M 120 46 L 138 29 L 137 52 Z',cream);
  ellipse(ctx,96,79,48,40,fur);
  shape(ctx,'M 80 41 Q 81 58 86 58 Q 90 56 89 40 Z M 92 39 Q 93 62 98 62 Q 103 60 101 39 Z M 105 40 Q 106 58 111 57 Q 116 54 114 42 Z',stripe);
  ellipse(ctx,96,96,34,22,cream);
  const eyeX = gaze ? Math.max(-5,Math.min(5,gaze.x/45)) : 0;
  const eyeY = gaze ? Math.max(-4,Math.min(4,gaze.y/55)) : 0;
  const blink = motion && time % 4700 > 4520;
  for (const x of [78,114]) {
    ellipse(ctx,x+eyeX,77+eyeY,6,blink?1.3:8.5,ink);
    if (!blink) ellipse(ctx,x+eyeX+1.5,74+eyeY,1.8,2,cream);
  }
  ctx.strokeStyle=ink;ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(88,95);ctx.quadraticCurveTo(96,104,104,95);ctx.stroke();
  ctx.restore();
}
export class PetSprite {
  constructor(canvas) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});
    this.pet=null;this.image=null;this.state='idle';this.started=performance.now();
    this._motion=true;this._gaze=null;this._active=true;this.timer=null;this.stopped=false;
    canvas.width=384;canvas.height=416;
    this.visibility=()=>this.refresh();
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',this.visibility);
  }
  get motion(){return this._motion;}
  set motion(value){if(this._motion!==!!value){this._motion=!!value;this.started=performance.now();this.refresh();}}
  get gaze(){return this._gaze;}
  set gaze(value){
    const prev=this._gaze;this._gaze=value;
    if(!value){this._smoothAngle=null;this._gazeIdx=null;if(prev)this.refresh();return;}
    this._targetAngle=(Math.atan2(value.x,-value.y)+Math.PI*2)%(Math.PI*2);
    if(this._smoothAngle===undefined||this._smoothAngle===null)this._smoothAngle=this._targetAngle;
    if(!this._gazeRaf)this._stepGaze();
  }
  _stepGaze(){
    this._gazeRaf=null;
    if(!this._gaze||this.stopped||!this._active)return;
    const twoPi=Math.PI*2,sector=Math.PI/8;
    let diff=((this._targetAngle-this._smoothAngle+Math.PI)%twoPi+twoPi)%twoPi-Math.PI;
    const maxStep=0.24;
    const step=Math.abs(diff)>maxStep?Math.sign(diff)*maxStep:diff*0.42;
    this._smoothAngle=(this._smoothAngle+step+twoPi)%twoPi;
    if(this._gazeIdx===undefined||this._gazeIdx===null){
      this._gazeIdx=Math.round(this._smoothAngle/sector)%16;
    }else{
      const cAng=this._gazeIdx*sector;
      const dSec=((this._smoothAngle-cAng+Math.PI)%twoPi+twoPi)%twoPi-Math.PI;
      if(Math.abs(dSec)>sector*0.5+0.061){
        this._gazeIdx=Math.round(this._smoothAngle/sector)%16;
      }
    }
    this.tick(performance.now());
    if(Math.abs(diff)>0.006){
      this._gazeRaf=requestAnimationFrame(()=>this._stepGaze());
    }
  }
  get active(){return this._active;}
  set active(value){if(this._active!==!!value){this._active=!!value;this.started=performance.now();this.refresh();}}
  async setPet(pet) {
    if(this.pet?.id===pet.id)return;
    this.pet=pet;this.image=null;this.started=performance.now();this.refresh();
    if(!pet.builtin){
      const image=new Image();image.crossOrigin='anonymous';image.src=pet.assetUrl;
      await image.decode();
      if(this.pet.id===pet.id){this.image=image;this.refresh();}
    }
  }
  action(state){this.state=state;this.started=performance.now();this.refresh();}
  refresh(){clearTimeout(this.timer);this.timer=null;this.tick(performance.now());}
  tick(now) {
    if(this.stopped||!this._active||(typeof document!=='undefined'&&document.hidden))return;
    const elapsed=this.motion?now-this.started:0;
    const gazing=this.motion&&this.gaze&&this.pet?.spriteVersionNumber===2&&this.state==='idle';
    const ang=gazing?(this._smoothAngle??(Math.atan2(this.gaze.x,-this.gaze.y)+Math.PI*2)%(Math.PI*2)):0;
    const dirIdx=gazing?(this._gazeIdx??Math.round(ang/(Math.PI/8))%16):0;
    const ox=gazing?Math.round(Math.sin(ang)*3)/2:0,oy=gazing?Math.round(-Math.cos(ang)*2)/2:0;
    const pose=gazing?{row:9+Math.floor(dirIdx/8),frame:dirIdx%8,ox,oy}:animationFrame(this.motion?this.state:'idle',elapsed);
    const renderKey=JSON.stringify([this.pet?.id,!!this.image,this.pet?.builtin&&this.motion?Math.floor(now/40):0,pose,this.motion,this.pet?.builtin?this.gaze:null]);
    if(this.renderKey!==renderKey){
      this.renderKey=renderKey;
      const ctx=this.ctx;ctx.clearRect(0,0,384,416);ctx.save();ctx.scale(2,2);
      if(this.pet?.builtin)drawMiso(ctx,this.motion?now:0,this.motion?this.state:'idle',this.motion?this.gaze:null,this.motion,elapsed);
      else if(this.image){
        const s=this.image.naturalWidth===3072?2:1;
        ctx.drawImage(this.image,pose.frame*192*s,pose.row*208*s,192*s,208*s,ox,oy,192,208);
      }
      ctx.restore();
    }
    // Static cards and paused/hidden pets have no recurring drawing task.
    if(!this.motion||!this.pet||(!this.pet.builtin&&(!this.image||gazing)))return;
    const animation=ANIMATIONS[this.state]||ANIMATIONS.idle;
    const cycle=animation.durations.reduce((a,b)=>a+b,0);
    const used=animation.durations.slice(0,pose.frame).reduce((a,b)=>a+b,0);
    const delay=this.pet.builtin?40:Math.max(16,animation.durations[pose.frame]-(elapsed%cycle-used));
    this.timer=setTimeout(()=>{this.timer=null;this.tick(performance.now());},delay);
  }
  stop(){this.stopped=true;clearTimeout(this.timer);this.timer=null;if(typeof document!=='undefined')document.removeEventListener('visibilitychange',this.visibility);}
}
