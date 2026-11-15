const api=window.pedex,bubble=document.getElementById('speech-bubble');
const tag=document.getElementById('speech-tag'),badge=document.getElementById('speech-badge-text'),meta=document.getElementById('speech-meta'),text=document.getElementById('speech-text');
document.body.classList.add('speech-window');
let hideTimer=null,leaveTimer=null,sequence=0,tailX=160;
function positionTail(){
  const rect=bubble.getBoundingClientRect();
  bubble.style.setProperty('--speech-tail-left',Math.max(20,Math.min(rect.width-20,tailX-rect.left))+'px');
}
api.onBubbleLayout(layout=>{
  document.body.dataset.edge=layout.edge;tailX=layout.tailX;positionTail();
});
api.onBubbleShow(opts=>{
  const current=++sequence;
  clearTimeout(hideTimer);clearTimeout(leaveTimer);
  text.textContent=opts.text;
  const rawBadge=(opts.badge||'').replace(/^✦\s*/,'').trim();
  const showTag=['done','warn','info'].includes(opts.kind)||!!(rawBadge&&rawBadge!=='天童爱丽丝'&&rawBadge!=='爱丽丝');
  tag.hidden=!showTag;
  badge.textContent=showTag?(rawBadge||(opts.kind==='done'?'任务完成 💙':opts.kind==='warn'?'任务提示':'收到委托')):'';
  meta.textContent=opts.meta||'';meta.hidden=!opts.meta;
  bubble.classList.remove('is-leaving','is-task-done','is-task-warn');
  if(opts.kind==='done')bubble.classList.add('is-task-done');
  else if(opts.kind==='warn')bubble.classList.add('is-task-warn');
  bubble.hidden=false;positionTail();bubble.classList.add('is-entering');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(current===sequence)bubble.classList.remove('is-entering');}));
  hideTimer=setTimeout(()=>{
    bubble.classList.add('is-leaving');
    leaveTimer=setTimeout(()=>{if(current===sequence){bubble.hidden=true;bubble.classList.remove('is-leaving');}},240);
  },opts.duration);
});
api.bubbleReady().catch(()=>{});
