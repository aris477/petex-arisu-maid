import {PetSprite, ANIMATIONS, RandomAnimations, edgeHitBand} from './sprite.js';
import {EdgeDialogue} from './edge-speech.js';
const api=window.pedex,canvas=document.getElementById('pet'),sprite=new PetSprite(canvas);
const bubbleEl=document.getElementById('speech-bubble'),tagEl=document.getElementById('speech-tag'),badgeEl=document.getElementById('speech-badge-text'),metaEl=document.getElementById('speech-meta'),textEl=document.getElementById('speech-text');
const randomAnimations=new RandomAnimations();
const HOLD_MS=550,DRAG_THRESHOLD=6;
let settings,selectedPet,active=false,down=null,dragging=false,lastHit=null,actionUntil=0,holdTimer=null,behaviourTimer=null,socialUntil=0,strokes=[],lastStroke=null,strokeDirection=0;
// Declared up here, not next to the cling handlers: render() reads it, and render can be
// invoked from a promise before the cling section of this module has been evaluated.
let clinging=null;
let clingRequest=0,pendingCling=null,pendingPeek=null;
// Keep a small screen-facing strip easy to grab, in the current edge's direction.
// The strip is limited to the character's extent along the edge.
const CLING_GRAB_BAND=32;
let bubbleTimer=null,bubbleHideTimer=null,lastLine='',welcomed=false;
let bubblePageTimers=[],speechSequence=0,taskSpeechUntil=0,edgePending=[],edgeRetryTimer=null,recentEdgeToss=null;
let currentSpeech=null,speechVisibleUntil=0;
const edgeDialogue=new EdgeDialogue({speak:opts=>showSpeech(opts)});
const DOCK_CATEGORIES=new Set(['edge_dock','edge_night','edge_toss']);

function queueEdgeSpeech(opts){
  // One pending reply per category: cursor jitter must not build a speech backlog.
  if(!edgePending.some(item=>item.edgeCategory===opts.edgeCategory))edgePending.push({...opts});
  const priority=item=>DOCK_CATEGORIES.has(item.edgeCategory)?3:item.manual?2:1;
  edgePending.sort((a,b)=>priority(b)-priority(a));
  retryEdgeSpeech();
}
function retryEdgeSpeech(){
  clearTimeout(edgeRetryTimer);edgeRetryTimer=null;
  if(!edgePending.length)return;
  edgeRetryTimer=setTimeout(()=>{
    edgeRetryTimer=null;
    if(!clinging||!active){edgePending=[];return;}
    if(performance.now()<Math.max(taskSpeechUntil,speechVisibleUntil)){retryEdgeSpeech();return;}
    const next=edgePending.shift();showSpeech(next);
    if(edgePending.length)retryEdgeSpeech();
  },Math.max(0,Math.max(taskSpeechUntil,speechVisibleUntil)-performance.now())+40);
}
function stopEdgeDialogue(){
  edgeDialogue.leave();edgePending=[];clearTimeout(edgeRetryTimer);edgeRetryTimer=null;
}
// Measure with the real font and available width, so small edge bubbles never lose
// the end of a line to the existing three-line clamp. No window/canvas resize.
function edgeSpeechPages(text){
  const pages=[];let page='';
  const maxHeight=parseFloat(getComputedStyle(textEl).lineHeight)*3+1;
  for(const char of text){
    textEl.textContent=page+char;
    if(page&&textEl.scrollHeight>maxHeight){pages.push(page);page=char;}
    else page+=char;
  }
  if(page)pages.push(page);
  return pages.length?pages:[''];
}


const ARISU_LINES={
  waving:[
    '“邦邦咔邦～！女仆爱丽丝，随时听候老师差遣！”',
    '“欢迎回来，老师！今天也要一起攻略主线任务吗？”',
    '“爱丽丝已经充好电了！好感度与干劲都是 MAX！”',
    '“老师老师！女仆装爱丽丝的支援技能已经准备就绪啦！”'
  ],
  jumping:[
    '“邦邦咔邦！发现稀有宝箱！会开出什么传奇装备呢？”',
    '“升级啦！爱丽丝的敏捷度与幸运值提升了 10 点！”',
    '“太好啦！和老师组队的时候，暴击率是 100% 哦！”',
    '“耶～！今日份的委托奖励是美味的布丁吗？”'
  ],
  review:[
    '“雷达扫描中……前方区域没有发现 Bug 怪兽！”',
    '“唔……这里的代码迷宫，爱丽丝正在仔细侦察！”',
    '“发现隐藏支线线索！老师，要一起过去看看吗？”',
    '“女仆侦察模式启动！一切细节都逃不过爱丽丝的眼睛～”'
  ],
  waiting:[
    '“待机模式启动……爱丽丝会乖乖守在老师身边的。”',
    '“正在恢复 MP……老师工作累了也要记得喝口水哦！”',
    '“女仆值班时间！有任何需要随时呼唤爱丽丝～”',
    '“存档点休息中……随时准备迎接下一场挑战！”'
  ],
  running:[
    '“光之剑充能中……正在全力帮老师清理杂兵！”',
    '“哒哒哒！女仆大扫除技能发动，报错统统消失吧！”',
    '“正在高速处理委托……爱丽丝干劲十足！”',
    '“全速推进主线进度！请老师拭目以待～！”'
  ],
  failed:[
    '“呜呜……不小心踩到陷阱掉血了，需要老师的治疗术……”',
    '“HP 告急……不过只要老师摸摸头，爱丽丝就能满血复活！”',
    '“唔，刚才的蓄力好像 Miss 了……下次一定会暴击的！”',
    '“女仆修行还不够熟练……爱丽丝会继续努力的！”'
  ],
  'running-left':[
    '“女仆爱丽丝，正在桌面左侧区域巡逻中～！”',
    '“向着下一个存档点前进！出发～！”'
  ],
  'running-right':[
    '“女仆爱丽丝，正在桌面右侧区域巡逻中～！”',
    '“发现新的地图区域！爱丽丝去探探路～”'
  ],
  stroke:[
    '“嘿嘿，被老师摸头了！幸福感经验槽蓄满啦～♪”',
    '“邦邦咔邦！获得老师的鼓励 Buff，全属性大幅提升！”',
    '“呜哇～好温暖！爱丽丝最喜欢和老师一起做任务了！”'
  ]
};

function pickLine(kind='waving'){
  const pool=ARISU_LINES[kind]||ARISU_LINES.waving;
  const candidates=pool.length>1?pool.filter(item=>item!==lastLine):pool;
  const chosen=candidates[Math.floor(Math.random()*candidates.length)];
  lastLine=chosen;
  return chosen;
}

function showSpeech(opts={}){
  if(!bubbleEl)return false;
  const now=performance.now();
  if(opts.edgeCategory){
    if(taskSpeechUntil>now){
      if(opts.required||opts.manual||DOCK_CATEGORIES.has(opts.edgeCategory))queueEdgeSpeech(opts);
      return false;
    }
    if(clinging&&opts.edgeCategory==='edge_peek'&&currentSpeech?.edgeCategory&&now<speechVisibleUntil){queueEdgeSpeech(opts);return false;}
    if(!opts.required&&!opts.manual&&['edge_peek','edge_stay'].includes(opts.edgeCategory)&&now<speechVisibleUntil)return false;
  }
  if(['done','warn','info'].includes(opts.kind)&&DOCK_CATEGORIES.has(currentSpeech?.edgeCategory)&&now<speechVisibleUntil){
    queueEdgeSpeech({...currentSpeech,duration:Math.max(1000,currentSpeech.duration-(now-currentSpeech.started))});
  }
  const rawText=typeof opts==='string'?opts:(opts.text||pickLine(opts.action||'waving'));
  const text=rawText.replace(/[“”]/g,'');
  const rawBadge=(opts.badge||'').replace(/^✦\s*/,'').trim();
  const showTag=Boolean(opts.kind==='done'||opts.kind==='warn'||opts.kind==='info'||(rawBadge&&rawBadge!=='天童爱丽丝'&&rawBadge!=='爱丽丝'));
  const badge=showTag?(rawBadge||(opts.kind==='done'?'任务完成 💙':opts.kind==='warn'?'任务提示':'收到委托')):'';
  const meta=opts.meta||'';
  let duration=opts.duration||(opts.kind==='done'?7500:3200);
  const sequence=++speechSequence;
  clearTimeout(bubbleTimer);clearTimeout(bubbleHideTimer);
  bubblePageTimers.forEach(clearTimeout);bubblePageTimers=[];
  if(tagEl){
    if(showTag){
      tagEl.hidden=false;
      if(badgeEl)badgeEl.textContent=badge;
      if(meta){metaEl.textContent=meta;metaEl.hidden=false;}else{metaEl.textContent='';metaEl.hidden=true;}
    }else{
      tagEl.hidden=true;
    }
  }
  textEl.textContent=text;
  bubbleEl.classList.remove('is-task-done','is-task-warn','is-leaving');
  if(opts.kind==='done')bubbleEl.classList.add('is-task-done');
  else if(opts.kind==='warn')bubbleEl.classList.add('is-task-warn');
  bubbleEl.hidden=false;
  if(opts.edgeCategory&&!clinging){
    const pages=edgeSpeechPages(text);
    const pageDuration=Math.max(2600,Math.ceil(duration/pages.length));
    textEl.textContent=pages[0];
    pages.slice(1).forEach((page,i)=>bubblePageTimers.push(setTimeout(()=>{
      if(sequence===speechSequence)textEl.textContent=page;
    },pageDuration*(i+1))));
    duration=Math.max(duration,pageDuration*pages.length);
  }
  speechVisibleUntil=now+duration+240;currentSpeech={...opts,text,duration,started:now};
  taskSpeechUntil=['done','warn','info'].includes(opts.kind)?now+duration+240:0;
  if(edgePending.length)retryEdgeSpeech();
  edgeDialogue.recordSpeech();
  if(opts.edgeCategory&&opts.edgeCategory!=='edge_stay')edgeDialogue.history.set(rawText,now);
  if(DOCK_CATEGORIES.has(opts.edgeCategory))edgeDialogue.firstDock=false;
  bubbleEl.classList.add('is-entering');
  requestAnimationFrame(()=>{requestAnimationFrame(()=>{if(sequence===speechSequence)bubbleEl.classList.remove('is-entering');});});
  bubbleTimer=setTimeout(()=>{
    bubbleEl.classList.add('is-leaving');
    bubbleHideTimer=setTimeout(()=>{bubbleEl.hidden=true;bubbleEl.classList.remove('is-leaving');},240);
  },duration);
  if(clinging){
    bubbleEl.hidden=true;
    api.showBubble({...opts,text,duration}).catch(()=>{});
  }
  return true;
}

function cancelHold(){clearTimeout(holdTimer);holdTimer=null;}
function plan() {
  clearTimeout(behaviourTimer);behaviourTimer=null;
  if(!settings||!active||!settings.motion||down||clinging)return;
  const now=performance.now();
  if(now<socialUntil){behaviourTimer=setTimeout(plan,Math.max(1,socialUntil-now));return;}
  if(now<actionUntil){behaviourTimer=setTimeout(plan,Math.max(1,actionUntil-now));return;}
  if(sprite.state!=='idle'){sprite.action('idle');actionUntil=0;}
  const next=randomAnimations.next(selectedPet,now,settings.randomAnimations,false,settings.behaviour);
  if(next){
    sprite.action(next.name);sprite.gaze=null;actionUntil=now+next.duration;
    if(next.name.startsWith('running-'))api.wander(next.name,next.duration).catch(()=>{});
  }
  const deadline=next?actionUntil:randomAnimations.nextAt;
  if(deadline!==null)behaviourTimer=setTimeout(plan,Math.max(1,deadline-now));
}
function resetBehaviour(){randomAnimations.reset();plan();}
function action(value,fromPress=false,withBubble=true){
  const name=typeof value==='string'?value:value?.name;
  const silent=typeof value==='object'&&value?.silent;
  if(!settings?.motion||!active||!ANIMATIONS[name]||dragging||clinging||(down&&!fromPress))return;
  sprite.action(name);sprite.gaze=null;
  actionUntil=performance.now()+(value?.duration||ANIMATIONS[name].durations.reduce((a,b)=>a+b,0)*(ANIMATIONS[name].cycles||2));
  if(withBubble&&!silent){
    showSpeech({badge:'✦ 爱丽丝',text:pickLine(name),duration:3200});
  }
  resetBehaviour();
}
function render(state){
  document.documentElement.lang=state.locale;canvas.setAttribute('aria-label',globalThis.PetexI18n.translate(state.locale,'petInstructions'));
  const next=state.settings,pet=state.pets.find(p=>p.id===next.petId)||state.pets[0];
  const changed=pet.id!==selectedPet?.id||next.motion!==settings?.motion||state.petActive!==active||next.randomAnimations!==settings?.randomAnimations||next.behaviour!==settings?.behaviour;
  if(down&&(!state.petActive||pet.id!==selectedPet?.id))finishPointer(null,true);
  if(!state.petActive||pet.id!==selectedPet?.id)stopEdgeDialogue();
  settings=next;selectedPet=pet;active=state.petActive;
  edgeDialogue.setStayInterval(next.edgeStayEvery);
  // While clinging the canvas must stay at 100% (see setCanvasSize), so a settings
  // broadcast in the middle of a cling must not re-pin it to pixel sizes.
  if(next?.size&&!clinging)setCanvasSize(next.size);
  sprite.active=active;sprite.motion=settings.motion;
  sprite.setPet(pet).catch(()=>sprite.setPet(state.pets[0]));
  if(changed){actionUntil=0;sprite.action('idle');resetBehaviour();}
  if(active&&!welcomed){
    welcomed=true;
    setTimeout(()=>!clinging&&showSpeech({badge:'✦ 爱丽丝',text:'“邦邦咔邦～！女仆爱丽丝已就位，点击我可以对话，任务完成也会第一时间提醒老师哦！”',duration:5200}),450);
  }
}
api.onState(render);api.getState().then(render);
api.onAction(value=>action(value));
api.onSpeech(payload=>showSpeech(payload));
api.onStroke(()=>{
  canvas.classList.remove('petted');void canvas.offsetWidth;canvas.classList.add('petted');
  showSpeech({badge:'✦ 好感度 UP',text:pickLine('stroke'),duration:3200});
});
canvas.addEventListener('animationend',()=>canvas.classList.remove('petted'));
api.onSocialStart(duration=>{socialUntil=performance.now()+duration;clearTimeout(behaviourTimer);behaviourTimer=setTimeout(plan,duration);});
api.onSocialEnd(()=>{socialUntil=0;sprite.gaze=null;resetBehaviour();});
/* ---- edge cling ---- */
// render() pins the canvas to `size` px with INLINE styles, and an inline declaration
// beats the stylesheet rule `body.clinging canvas{width:100%;height:100%}`. Left in
// place, the cling canvas would stay e.g. 160 x 174 inside a 137 x 182 window: the cell
// no longer maps 1:1 (so the rim stops lining up with the screen edge) and the 384 x 512
// drawing gets squashed into the wrong aspect. Clear the inline size while clinging and
// put it back afterwards.
function setCanvasSize(size){
  if(!size){canvas.style.width='';canvas.style.height='';return;}
  const h=Math.ceil(size*208/192);
  canvas.style.width=size+'px';
  canvas.style.height=h+'px';
  document.documentElement.style.setProperty('--pet-h',h+'px');
}
let edgeToken=0,edgeRevision=0;
sprite.onEdgeSettled=pose=>{
  if(clinging===pose.side)api.edgeSettled({...pose,token:edgeToken,revision:edgeRevision}).catch(()=>{});
};
sprite.onEdgeFrame=pose=>{
  if(clinging===pose.side)api.edgeFrame({...pose,token:edgeToken,revision:edgeRevision}).catch(()=>{});
};
function applyClingPeek(payload){
  const show=typeof payload==='boolean'?payload:!!payload.show;
  edgeRevision=typeof payload==='object'?payload.revision:edgeRevision;
  show?sprite.emergeEdge():sprite.retractEdge();edgeDialogue.peek(show);
}
api.onCling(async({side,token})=>{
  const request=++clingRequest,petId=selectedPet?.id;
  const tossed=!!recentEdgeToss&&performance.now()-recentEdgeToss.at<600;
  recentEdgeToss=null;
  pendingCling=side;pendingPeek=null;
  try{await sprite.edgeReady;}catch{}
  if(request!==clingRequest||petId!==selectedPet?.id)return;
  pendingCling=null;
  edgeToken=token;edgeRevision=0;
  if(!sprite.cling(side)){api.clingFailed().catch(()=>{});return;}
  clinging=side;
  document.body.dataset.edge=side;
  document.body.classList.add('clinging');
  setCanvasSize(null);
  clearTimeout(behaviourTimer);clearTimeout(holdTimer);
  sprite.gaze=null;
  if(currentSpeech&&!currentSpeech.edgeCategory&&performance.now()<currentSpeech.started+currentSpeech.duration)showSpeech({...currentSpeech,duration:currentSpeech.started+currentSpeech.duration-performance.now()});
  edgeDialogue.enter({toss:tossed});
  if(pendingPeek!==null)applyClingPeek(pendingPeek);
});
api.onClingPeek(payload=>{if(pendingCling){pendingPeek=payload;return;}if(clinging)applyClingPeek(payload);});
api.onClingEnd(()=>{
  clingRequest++;pendingCling=null;pendingPeek=null;stopEdgeDialogue();
  if(!clinging)return;
  clinging=null;
  delete document.body.dataset.edge;
  document.body.classList.remove('clinging');
  setCanvasSize(settings?.size);
  sprite.releaseEdge();resetBehaviour();
  if(currentSpeech&&performance.now()<currentSpeech.started+currentSpeech.duration)showSpeech({...currentSpeech,duration:currentSpeech.started+currentSpeech.duration-performance.now()});
});
api.onCursor(cursor=>{
  if(!settings||!active)return;
  const rect=canvas.getBoundingClientRect(),x=cursor.x-rect.x,y=cursor.y-rect.y;
  const isDragging=cursor.dragging&&!!down;
  if(isDragging){
    dragging=true;down.moved=true;cancelHold();actionUntil=0;
    const state=cursor.direction||'idle';
    if(sprite.state!==state)sprite.action(state);
  }
  const gx=x-rect.width/2,gy=y-rect.height*.45;
  if(clinging){sprite.gaze=null;}
  else sprite.gaze=isDragging?cursor.dragGaze:cursor.socialGaze&&!cursor.walking?cursor.socialGaze:!cursor.walking&&settings.followCursor&&settings.motion&&Math.hypot(gx,gy)>35&&Math.hypot(gx,gy)<1100?{x:gx,y:gy}:null;
  let hit=false;
  if(x>=0&&y>=0&&x<rect.width&&y<rect.height){
    const cw=sprite.canvas.width||384, ch=sprite.canvas.height||416;
    try{hit=sprite.ctx.getImageData(Math.floor(x/rect.width*cw),Math.floor(y/rect.height*ch),1,1).data[3]>30;}catch{hit=true;}
    // While clinging almost nothing is left on screen, so pixel-accurate picking makes
    // her impossible to grab. Accept a generous band next to the edge instead.
    if(!hit&&clinging)hit=edgeHitBand(clinging,x,y,rect.width,rect.height,CLING_GRAB_BAND);
  }
  if(hit!==lastHit&&!down){lastHit=hit;api.hit(hit).catch(()=>{});}
});
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||down)return;
  // While clinging she owns the canvas: no idle action may be started, because that
  // would draw the standing sprite over the edge sequence. A click only talks to her —
  // she lets go of the edge on the main-process side once the pointer really moves.
  down={x:event.screenX,y:event.screenY,id:event.pointerId,moved:false,longPressed:false,motion:[{x:event.screenX,y:event.screenY,at:performance.now()}]};
  canvas.setPointerCapture(event.pointerId);clearTimeout(behaviourTimer);actionUntil=0;
  if(!clinging)sprite.action('idle');
  api.pressStart().catch(()=>finishPointer(null,true));cancelHold();
  if(!clinging)holdTimer=setTimeout(()=>{if(!down||down.moved||dragging)return;down.longPressed=true;action('jumping',true,true);},HOLD_MS);
});
canvas.addEventListener('pointermove',event=>{
  if(!down)return;
  const now=performance.now();
  down.motion.push({x:event.screenX,y:event.screenY,at:now});
  down.motion=down.motion.filter(sample=>now-sample.at<=150);
  if(Math.hypot(event.screenX-down.x,event.screenY-down.y)>=DRAG_THRESHOLD){down.moved=true;cancelHold();}
});
canvas.addEventListener('pointermove',event=>{
  if(!settings?.motion||event.buttons||down){lastStroke=null;strokes=[];return;}
  const rect=canvas.getBoundingClientRect(),relY=(event.clientY-rect.top)/Math.max(1,rect.height);
  const inHeadZone=relY>=0.04&&relY<=0.58;
  if(!event.shiftKey&&!inHeadZone){lastStroke=null;strokes=[];return;}
  const now=performance.now();
  if(lastStroke!==null&&Math.abs(event.clientX-lastStroke)>4){const direction=Math.sign(event.clientX-lastStroke);if(direction!==strokeDirection){strokes.push(now);strokeDirection=direction;}strokes=strokes.filter(at=>now-at<1500);if(strokes.length>=3){api.stroke().catch(()=>{});strokes=[];}}
  lastStroke=event.clientX;
});
function finishPointer(event,cancelled=false){
  if(!down)return;
  const press=down,moved=dragging||press.moved;down=null;dragging=false;cancelHold();
  if(canvas.hasPointerCapture(press.id))canvas.releasePointerCapture(press.id);
  recentEdgeToss=null;
  if(moved&&!cancelled&&!clinging&&event&&press.motion.length>=2){
    const first=press.motion[0],last=press.motion.at(-1),elapsed=last.at-first.at;
    const distance=Math.hypot(last.x-first.x,last.y-first.y);
    if(elapsed>=16&&performance.now()-last.at<120&&distance>=80&&distance/elapsed>=1.2)recentEdgeToss={at:performance.now()};
  }
  api.pressEnd().catch(()=>{});lastHit=null;
  if(moved||cancelled){
    // Dragging her away ends the cling: the window code detaches on the first real
    // movement and the next drop decides which edge (if any) she grabs.
    sprite.action('idle');sprite.gaze=null;actionUntil=0;resetBehaviour();
  }
  // A plain click on a clinging pet must not start an action: she is still on the wall
  // and the edge sequence owns the canvas (an action would draw the standing sprite).
  else if(!press.longPressed&&!clinging){const ca=settings?.clickAction||'waving';const pool=['waving','jumping','review','waiting','running','failed'];const chosen=ca==='random'?pool[Math.floor(Math.random()*pool.length)]:ca;action(chosen,false,true);}
  else if(!press.longPressed&&clinging)edgeDialogue.wake();
  else plan();
}
canvas.addEventListener('pointerup',event=>finishPointer(event));
canvas.addEventListener('pointercancel',event=>finishPointer(event,true));
canvas.addEventListener('lostpointercapture',event=>finishPointer(event,true));
window.addEventListener('blur',()=>finishPointer(null,true));
window.addEventListener('pagehide',stopEdgeDialogue);
canvas.addEventListener('contextmenu',event=>{event.preventDefault();finishPointer(null,true);api.menu();});
