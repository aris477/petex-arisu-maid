// Event policy is separate from animation/window geometry. Times are monotonic.
export const EDGE_LINES = {
  "edge_dock": [
    "爱丽丝，进入待机警戒模式。就在屏幕边上守着老师。",
    "收到。爱丽丝缩到角落待机——这样就不会挡住老师的视野了。",
    "要藏起来了哦。像潜行任务一样，只露出一点点。",
    "老师忙的时候，爱丽丝就在边上待机。需要了，点我一下就好。",
    "屏幕边缘，是爱丽丝的临时存档点。呼……稍微休息一下。"
  ],
  "edge_peek": [
    "悄悄——爱丽丝探出头来了。老师，忙完了吗？",
    "待机解除！爱丽丝回来了！",
    "光环先探出来……然后是眼睛。嘻嘻，被发现了。",
    "老师在看这边吗？爱丽丝一直在这里哦。",
    "叮！待机结束。守护光圈，重新点亮！"
  ],
  "edge_stay": [
    "爱丽丝在边上待机 {mins} 分钟了。这个位置，刚好能看到老师的侧脸。",
    "{mins} 分钟了……老师，偶尔也看一眼屏幕边角嘛。",
    "边缘待机 {mins} 分钟。爱丽丝没有偷懒，真的在守护。",
    "呼叫老师。屏幕边缘有人待机 {mins} 分钟了，需要支援吗？",
    "……爱丽丝一直在这里。{mins} 分钟了，一直。"
  ],
  "edge_wake": [
    "哇！被点到了。爱丽丝从边缘探出头来了！",
    "收到呼叫！待机解除，爱丽丝归队！",
    "被发现了……还以为能多藏一会儿。",
    "老师叫我了吗？爱丽丝在这里，随时支援！",
    "从角落回应老师——邦邦咔邦！"
  ],
  "edge_toss": [
    "呜哇——被甩到边缘了。爱丽丝的头还有点晕……",
    "重力加速度！这是新的移动技能吗，老师？",
    "滑、滑过去了……边界碰撞检测，通过。"
  ],
  "edge_night": [
    "夜深了。爱丽丝小声待机，不吵老师。",
    "边缘待机中……老师，早点睡哦。"
  ]
};
export const EDGE_SPEECH_TIMING = Object.freeze({repeat:30*60_000,peek:2*60_000,stay:12*60_000});

export class EdgeDialogue {
  constructor({speak,now=()=>performance.now(),hour=()=>new Date().getHours(),random=Math.random,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}) {
    Object.assign(this,{speak,now,hour,random,setTimer,clearTimer});
    this.history=new Map();this.lastSpeech=-Infinity;this.firstDock=true;
    this.since=null;this.peeked=false;this.timer=null;this.stayEvery=EDGE_SPEECH_TIMING.stay;this.lastStayAt=null;
  }
  setStayInterval(value){
    const interval=Number.isFinite(value)?(value<=0?0:Math.max(60000,Math.min(7200000,Math.round(value/60000)*60000))):EDGE_SPEECH_TIMING.stay;
    if(interval===this.stayEvery)return;
    this.stayEvery=interval;this.clearTimer(this.timer);this.timer=null;
    if(this.since!==null&&interval>0)this.scheduleStay(Math.max(1,interval-(this.now()-(this.lastStayAt??this.since))));
  }
  recordSpeech(){this.lastSpeech=this.now();}
  say(category,mandatory=false){
    const now=this.now(),pool=EDGE_LINES[category]||[];
    let choices=pool.filter(text=>now-(this.history.get(text)??-Infinity)>=EDGE_SPEECH_TIMING.repeat);
    // Repeated manual clicks must still receive feedback after all five lines are used.
    // Rotate the least recently used line; automatic chatter stays silent on exhaustion.
    if(!choices.length){
      if(!mandatory&&category!=='edge_stay')return false;
      const oldest=Math.min(...pool.map(text=>this.history.get(text)??-Infinity));
      choices=pool.filter(text=>(this.history.get(text)??-Infinity)===oldest);
    }
    if(!choices.length)return false;
    const template=choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))];
    const mins=Math.max(0,Math.floor((now-(this.since??now))/60_000));
    if(this.speak({text:template.replaceAll('{mins}',String(mins)),edgeCategory:category,manual:category==='edge_wake',required:mandatory,duration:3200})===false)return false;
    this.history.set(template,now);this.recordSpeech();return true;
  }
  enter({toss=false}={}){
    this.leave();this.since=this.now();
    const hour=this.hour(),category=hour>=23||hour<6?'edge_night':toss?'edge_toss':'edge_dock';
    if(this.say(category,true))this.firstDock=false;
    this.scheduleStay();
  }
  scheduleStay(delay=this.stayEvery){
    this.clearTimer(this.timer);this.timer=null;
    if(this.since===null||this.stayEvery===0)return;
    this.timer=this.setTimer(()=>{
      this.timer=null;if(this.since===null)return;
      // Schedule from now: resuming after sleep never creates a backlog of reminders.
      // Frequent peek replies must not starve a due stay line. The renderer waits
      // for the current bubble/task to finish; retry without interrupting it.
      const spoken=this.say('edge_stay');
      if(spoken)this.lastStayAt=this.now();
      this.scheduleStay(spoken?this.stayEvery:1000);
    },delay);
  }
  peek(show){
    if(this.since===null)return;
    const started=!!show&&!this.peeked;this.peeked=!!show;
    // Every genuine emergence speaks, including timer-driven peeks and a full line pool.
    // Duplicate true events do not represent another emergence.
    if(started)return this.say('edge_peek',true);
  }
  wake(){if(this.since!==null)return this.say('edge_wake',true);return false;}
  leave(){this.clearTimer(this.timer);this.timer=null;this.since=null;this.lastStayAt=null;this.peeked=false;}
}
