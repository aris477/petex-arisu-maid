const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const text=fs.readFileSync(path.join(__dirname,'../../app/renderer/edge-speech.js'),'utf8');
 const {EdgeDialogue}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 let clock=0,next=0,busyUntil=0,checks=0;const timers=new Map(),spoken=[];
 const ok=(value,label)=>{assert.ok(value,label);checks++;};
 const dialogue=new EdgeDialogue({now:()=>clock,hour:()=>12,random:()=>.99,
  setTimer:(fn,ms)=>{timers.set(++next,{fn,at:clock+ms});return next;},clearTimer:id=>timers.delete(id),
  speak:payload=>{if(payload.edgeCategory==='edge_stay'&&clock<busyUntil)return false;spoken.push({...payload,at:clock});busyUntil=clock+4440;return true;}});
 function advance(to){while(true){const entry=[...timers].filter(([,v])=>v.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;clock=entry[1].at;timers.delete(entry[0]);entry[1].fn();}clock=to;}
 dialogue.enter();
 for(let seconds=8;seconds<=712;seconds+=8){advance(seconds*1000);dialogue.peek(false);dialogue.peek(true);}
 advance(719000);dialogue.peek(false);dialogue.peek(true);
 advance(720000);ok(!spoken.some(p=>p.edgeCategory==='edge_stay'),'due stay waits for active bubble');
 advance(725000);const first=spoken.filter(p=>p.edgeCategory==='edge_stay');
 ok(first.length===1,'frequent peeks cannot starve stay');ok(first[0].at>=723440&&first[0].at<=725000,'retry after bubble finishes');
 ok(first[0].text.includes('12')&&!first[0].text.includes('{mins}'),'format actual minutes');
 advance(first[0].at+12*60000);const stays=spoken.filter(p=>p.edgeCategory==='edge_stay');
 ok(stays.length===2,'next stay twelve minutes after previous');ok(stays[1].text.includes('24'),'minutes accumulate across peek cycles');
 dialogue.leave();ok(timers.size===0,'detach cancels stay timer');
 advance(clock+24*60000);ok(spoken.filter(p=>p.edgeCategory==='edge_stay').length===2,'no detached reminder');
 dialogue.enter();advance(clock+6*60000);ok(spoken.filter(p=>p.edgeCategory==='edge_stay').length===2,'no premature stay on new cling');
 dialogue.leave();fs.writeFileSync(path.join(process.argv[2],'qa/stay.json'),JSON.stringify({status:'passed',checks,stays},null,2));
 console.log(checks+' stay timer checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
