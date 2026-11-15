const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const filename=path.join(__dirname,'verify_cling.cjs');
const setup=fs.readFileSync(filename,'utf8').split('let pass = 0, fail = 0;')[0];
const tests=String.raw`
const fs=require('node:fs'),geometry=require(path.join(ROOT,'app/renderer/edge-config.js'));
DesktopPets.prototype.schedule=function(){};
let checks=0;
function ok(value,label){assert.ok(value,label);checks++;}
for(const origin of [[0,0],[-1920,-180]])for(const size of [48,120,160,240])for(const side of Object.keys(geometry.SIDES)){
  AREA.x=origin[0];AREA.y=origin[1];
  const {dp,p,S,state}=make({size,edgePeekEvery:0});state.pets=[{...PETS[0],edgeSides:[side]}];
  const box=dp.bodyBox(p),b={x:AREA.x+500,y:AREA.y+200,width:dp.fitWidth(p),height:dp.fitHeight(p)};
  if(side==='left')b.x=AREA.x-box.left;
  if(side==='right')b.x=AREA.x+AREA.width-box.right;
  if(side==='top')b.y=AREA.y-box.top;
  if(side==='bottom')b.y=AREA.y+AREA.height-box.bottom;
  p.win.setBounds(b);ok(dp.tryGrab(p,b),'grab');const pet=p.win.getBounds(),g=geometry.SIDES[side];
  const along=g.axis==='x'?pet.y+pet.height*(g.bounds[1]+g.bounds[3])/1024:pet.x+pet.width*(g.bounds[0]+g.bounds[2])/768;
  function point(distance){
    return g.axis==='x'?{x:side==='left'?AREA.x:AREA.x+AREA.width,y:along+distance}:{x:along+distance,y:side==='top'?AREA.y:AREA.y+AREA.height};
  }
  Object.assign(cursor,point(0));dp.tick();ok(p.clingPeek===true,'near character emerges');
  // On the same edge and in the old 120 DIP stripe, but far along that edge.
  for(const distance of [-250,250]){Object.assign(cursor,point(distance));dp.tick();ok(p.clingPeek===false,'far along same edge retracts');}
  Object.assign(cursor,point(0));dp.tick();ok(p.clingPeek===true,'returning nearby emerges again');
  Object.assign(cursor,point(0));cursor[g.axis]+=side==='left'||side==='top'?300:-300;dp.tick();ok(p.clingPeek===false,'too far inward retracts');
  S.edgeAutoPeek=false;Object.assign(cursor,point(0));dp.tick();ok(p.clingPeek===false,'setting still disables mouse emergence');
  const payload={side,token:p.cling.token,revision:p.cling.revision,frame:7};
  ok(dp.edgeFrame(p,payload),'accept current frame');ok(p.cling.frame===7,'store actual frame');
  for(const bad of [{token:0},{revision:-1},{frame:-1},{frame:32},{frame:NaN},{frame:7.5},{side:'invalid'}])ok(!dp.edgeFrame(p,{...payload,...bad}),'reject stale/invalid frame');
  dp.dispose();
}
fs.writeFileSync(path.join(ROOT,'qa/cursor.json'),JSON.stringify({status:'passed',checks,sizes:[48,120,160,240],sides:4,origins:2,padding:24},null,2));
console.log(checks+' nearby cursor and pose checks passed');process.exit(0);
`;
vm.runInThisContext('(function(require){'+setup+tests+'\n})',{filename})(require);
