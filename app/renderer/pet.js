import {PetSprite, ANIMATIONS, RandomAnimations} from './sprite.js';
const api=window.pedex,canvas=document.getElementById('pet'),sprite=new PetSprite(canvas);
const bubbleEl=document.getElementById('speech-bubble'),tagEl=document.getElementById('speech-tag'),badgeEl=document.getElementById('speech-badge-text'),metaEl=document.getElementById('speech-meta'),textEl=document.getElementById('speech-text');
const randomAnimations=new RandomAnimations();
const HOLD_MS=550,DRAG_THRESHOLD=6;
let settings,selectedPet,active=false,down=null,dragging=false,lastHit=null,actionUntil=0,holdTimer=null,behaviourTimer=null,socialUntil=0,strokes=[],lastStroke=null,strokeDirection=0;
let bubbleTimer=null,bubbleHideTimer=null,lastLine='',welcomed=false;

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
  if(!bubbleEl)return;
  const rawText=typeof opts==='string'?opts:(opts.text||pickLine(opts.action||'waving'));
  const text=rawText.replace(/[“”]/g,'');
  const rawBadge=(opts.badge||'').replace(/^✦\s*/,'').trim();
  const showTag=Boolean(opts.kind==='done'||opts.kind==='warn'||opts.kind==='info'||(rawBadge&&rawBadge!=='天童爱丽丝'&&rawBadge!=='爱丽丝'));
  const badge=showTag?(rawBadge||(opts.kind==='done'?'任务完成 💙':opts.kind==='warn'?'任务提示':'收到委托')):'';
  const meta=opts.meta||'';
  const duration=opts.duration||(opts.kind==='done'?7500:4200);
  clearTimeout(bubbleTimer);clearTimeout(bubbleHideTimer);
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
  bubbleEl.classList.add('is-entering');
  requestAnimationFrame(()=>{requestAnimationFrame(()=>{bubbleEl.classList.remove('is-entering');});});
  bubbleTimer=setTimeout(()=>{
    bubbleEl.classList.add('is-leaving');
    bubbleHideTimer=setTimeout(()=>{bubbleEl.hidden=true;bubbleEl.classList.remove('is-leaving');},240);
  },duration);
}

function cancelHold(){clearTimeout(holdTimer);holdTimer=null;}
function plan() {
  clearTimeout(behaviourTimer);behaviourTimer=null;
  if(!settings||!active||!settings.motion||down)return;
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
  if(!settings?.motion||!active||!ANIMATIONS[name]||dragging||(down&&!fromPress))return;
  sprite.action(name);sprite.gaze=null;
  actionUntil=performance.now()+(value?.duration||ANIMATIONS[name].durations.reduce((a,b)=>a+b,0)*(ANIMATIONS[name].cycles||2));
  if(withBubble&&!silent){
    showSpeech({badge:'✦ 爱丽丝',text:pickLine(name),duration:4200});
  }
  resetBehaviour();
}
function render(state){
  document.documentElement.lang=state.locale;canvas.setAttribute('aria-label',globalThis.PetexI18n.translate(state.locale,'petInstructions'));
  const next=state.settings,pet=state.pets.find(p=>p.id===next.petId)||state.pets[0];
  const changed=pet.id!==selectedPet?.id||next.motion!==settings?.motion||state.petActive!==active||next.randomAnimations!==settings?.randomAnimations||next.behaviour!==settings?.behaviour;
  if(down&&(!state.petActive||pet.id!==selectedPet?.id))finishPointer(null,true);
  settings=next;selectedPet=pet;active=state.petActive;
  if(next?.size){
    const h=Math.ceil(next.size*208/192);
    canvas.style.width=next.size+'px';
    canvas.style.height=h+'px';
    document.documentElement.style.setProperty('--pet-h',h+'px');
  }
  sprite.active=active;sprite.motion=settings.motion;
  sprite.setPet(pet).catch(()=>sprite.setPet(state.pets[0]));
  if(changed){actionUntil=0;sprite.action('idle');resetBehaviour();}
  if(active&&!welcomed){
    welcomed=true;
    setTimeout(()=>showSpeech({badge:'✦ 爱丽丝',text:'“邦邦咔邦～！女仆爱丽丝已就位，点击我可以对话，任务完成也会第一时间提醒老师哦！”',duration:5200}),450);
  }
}
api.onState(render);api.getState().then(render);
api.onAction(value=>action(value));
api.onSpeech(payload=>showSpeech(payload));
api.onStroke(()=>{
  canvas.classList.remove('petted');void canvas.offsetWidth;canvas.classList.add('petted');
  showSpeech({badge:'✦ 好感度 UP',text:pickLine('stroke'),duration:4200});
});
canvas.addEventListener('animationend',()=>canvas.classList.remove('petted'));
api.onSocialStart(duration=>{socialUntil=performance.now()+duration;clearTimeout(behaviourTimer);behaviourTimer=setTimeout(plan,duration);});
api.onSocialEnd(()=>{socialUntil=0;sprite.gaze=null;resetBehaviour();});
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
  sprite.gaze=isDragging?cursor.dragGaze:cursor.socialGaze&&!cursor.walking?cursor.socialGaze:!cursor.walking&&settings.followCursor&&settings.motion&&Math.hypot(gx,gy)>35&&Math.hypot(gx,gy)<1100?{x:gx,y:gy}:null;
  let hit=false;
  if(x>=0&&y>=0&&x<rect.width&&y<rect.height){try{hit=sprite.ctx.getImageData(Math.floor(x/rect.width*384),Math.floor(y/rect.height*416),1,1).data[3]>30;}catch{hit=true;}}
  if(hit!==lastHit&&!down){lastHit=hit;api.hit(hit).catch(()=>{});}
});
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||down)return;
  down={x:event.screenX,y:event.screenY,id:event.pointerId,moved:false,longPressed:false};
  canvas.setPointerCapture(event.pointerId);clearTimeout(behaviourTimer);actionUntil=0;sprite.action('idle');
  api.pressStart().catch(()=>finishPointer(null,true));cancelHold();
  holdTimer=setTimeout(()=>{if(!down||down.moved||dragging)return;down.longPressed=true;action('jumping',true,true);},HOLD_MS);
});
canvas.addEventListener('pointermove',event=>{if(down&&Math.hypot(event.screenX-down.x,event.screenY-down.y)>=DRAG_THRESHOLD){down.moved=true;cancelHold();}});
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
  api.pressEnd().catch(()=>{});lastHit=null;
  if(moved||cancelled){sprite.action('idle');sprite.gaze=null;actionUntil=0;resetBehaviour();}
  else if(!press.longPressed){const ca=settings?.clickAction||'waving';const pool=['waving','jumping','review','waiting','running','failed'];const chosen=ca==='random'?pool[Math.floor(Math.random()*pool.length)]:ca;action(chosen,false,true);}else plan();
}
canvas.addEventListener('pointerup',event=>finishPointer(event));
canvas.addEventListener('pointercancel',event=>finishPointer(event,true));
canvas.addEventListener('lostpointercapture',event=>finishPointer(event,true));
window.addEventListener('blur',()=>finishPointer(null,true));
canvas.addEventListener('contextmenu',event=>{event.preventDefault();finishPointer(null,true);api.menu();});
