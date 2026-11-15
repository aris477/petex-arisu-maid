const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../app/renderer/edge-speech.js'),'utf8');
 const {EdgeDialogue}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let clock=0,id=0,blocked=false,checks=0;const timers=new Map(),stays=[];
 const ok=(value,label)=>{assert.ok(value,label);checks++;};
 const d=new EdgeDialogue({now:()=>clock,hour:()=>12,random:()=>.99,
  setTimer:(fn,ms)=>{timers.set(++id,{fn,at:clock+ms});return id;},clearTimer:key=>timers.delete(key),
  speak:p=>{if(p.edgeCategory==='edge_stay'){if(blocked)return false;stays.push({...p,at:clock});}return true;}});
 function advance(to){for(;;){const t=[...timers].filter(([,v])=>v.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!t)break;clock=t[1].at;timers.delete(t[0]);t[1].fn();}clock=to;}
 d.setStayInterval(60000);d.enter();advance(59999);ok(stays.length===0,'wait full custom minute');
 advance(60000);ok(stays.length===1&&stays[0].text.includes('1'),'one minute works before old five minute guard');
 advance(6*60000);ok(stays.length===6,'short interval still speaks when five-line pool is used');
 d.setStayInterval(0);ok(timers.size===0,'zero disables timer');advance(26*60000);ok(stays.length===6,'disabled stays silent');
 d.setStayInterval(120000);advance(clock+1);ok(stays.length===7&&stays.at(-1).text.includes('26'),'reenable preserves accumulated stay time');
 const last=stays.at(-1).at;d.setStayInterval(10*60000);advance(last+2*60000);ok(stays.length===7,'longer interval takes effect');
 d.setStayInterval(60000);advance(clock+1);ok(stays.length===8,'shorter overdue interval takes effect immediately');
 d.setStayInterval(60000);ok(timers.size===1,'same setting does not duplicate timer');
 blocked=true;advance(clock+61000);ok(stays.length===8,'active speech blocks due line');
 d.setStayInterval(0);blocked=false;advance(clock+10000);ok(stays.length===8&&timers.size===0,'off cancels pending retry');
 d.setStayInterval(999999999);ok(d.stayEvery===7200000,'clamp upper bound');
 d.setStayInterval(1);ok(d.stayEvery===60000,'clamp positive lower bound');
 d.setStayInterval(NaN);ok(d.stayEvery===720000,'invalid restores twelve minute default');
 d.leave();d.setStayInterval(120000);const start=clock;d.enter();advance(start+119999);ok(stays.length===8,'new cling resets custom deadline');
 advance(start+120000);ok(stays.length===9&&stays.at(-1).text.includes('2'),'custom two minute line formats actual stay');
 d.leave();ok(timers.size===0,'leave cancels custom timer');
 fs.writeFileSync(path.join(process.argv[2],'qa/stay-custom.json'),JSON.stringify({status:'passed',checks,stays},null,2));console.log(checks+' configurable stay checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
