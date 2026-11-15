const fs=require('node:fs'),vm=require('node:vm');
const filename=require('node:path').join(__dirname,'verify_cling.cjs');
const initial=fs.readFileSync(filename,'utf8').split('let pass = 0, fail = 0;')[0];
const tests=String.raw`
const geom=require(path.join(ROOT,'app','renderer','edge-config.js'));
const enabled=process.argv.slice(3).length?process.argv.slice(3):['left','right','bottom','top'];
let passed=0;
function test(name,fn){try{fn();passed++;}catch(e){console.error(name,e.message);throw e;}}
for(const side of enabled)for(const size of [48,120,160,200,240])for(const origin of [[0,0],[-1920,-180]]){
  AREA.x=origin[0];AREA.y=origin[1];
  const e=make({size}),{dp,p,state}=e;
  state.pets=[{...PETS[0],edgeSides:enabled}];
  const width=dp.fitWidth(p),height=dp.fitHeight(p),box=dp.bodyBox(p);
  const normal={x:AREA.x+500,y:AREA.y+200,width,height};
  if(side==='left')normal.x=AREA.x-box.left;
  if(side==='right')normal.x=AREA.x+AREA.width-box.right;
  if(side==='top')normal.y=AREA.y-box.top;
  if(side==='bottom')normal.y=AREA.y+AREA.height-box.bottom;
  p.win.setBounds(normal);
  test(side+' grab',()=>assert.ok(dp.tryGrab(p,normal)));
  const before=p.win.getBounds(),g=geom.SIDES[side];
  test(side+' selects correct side',()=>assert.strictEqual(p.cling.side,side));
  const rim=side==='left'?before.x+before.width/6:side==='right'?before.x+before.width*5/6:side==='top'?before.y+before.height*5/32:before.y+before.height*27/32;
  const target=side==='left'?AREA.x:side==='right'?AREA.x+AREA.width:side==='top'?AREA.y:AREA.y+AREA.height;
  test(side+' rim',()=>assert.ok(Math.abs(rim-target)<=0.51));
  const anchor=g.axis==='x'?before.y+before.height*g.anchor:before.x+before.width*g.anchor;
  const was=g.axis==='x'?normal.y+164+0.499*(height-164):normal.x+(box.left+box.right)/2;
  test(side+' parallel anchor',()=>assert.ok(Math.abs(anchor-was)<1.1));
  cursor.x=g.axis==='x'?target+(side==='left'?3:-3):anchor;
  cursor.y=g.axis==='y'?target+(side==='top'?3:-3):anchor;
  dp.pressStart(p);
  test(side+' click keeps pose and bounds',()=>assert.deepStrictEqual(p.win.getBounds(),before));
  dp.pressEnd(p);
  test(side+' click remains attached',()=>assert.ok(p.cling));
  dp.detachCling(p);
  const detached=p.win.getBounds();
  const contact=side==='left'?detached.x+box.left:side==='right'?detached.x+box.right:side==='top'?detached.y+box.top:detached.y+box.bottom;
  test(side+' detach preserves contact',()=>assert.ok(Math.abs(contact-target)<1));
  const parallel=g.axis==='x'?detached.y+164+0.499*(height-164):detached.x+(box.left+box.right)/2;
  test(side+' detach preserves parallel position',()=>assert.ok(Math.abs(parallel-anchor)<2));
  const w=before.width,h=before.height;
  const localX=g.axis==='x'?g.rim/384*w+(side==='left'?2:-2):(g.bounds[0]+g.bounds[2])/2/384*w;
  const localY=g.axis==='y'?g.rim/512*h+(side==='top'?2:-2):(g.bounds[1]+g.bounds[3])/2/512*h;
  test(side+' screen-facing band is clickable',()=>assert.ok(geom.hitBand(side,localX,localY,w,h)));
  const wrongX=g.axis==='x'?g.rim/384*w+(side==='left'?-3:3):localX;
  const wrongY=g.axis==='y'?g.rim/512*h+(side==='top'?-3:3):localY;
  test(side+' hidden side does not intercept clicks',()=>assert.strictEqual(geom.hitBand(side,wrongX,wrongY,w,h),false));
  test(side+' distant background is not clickable',()=>assert.strictEqual(geom.hitBand(side,0,0,w,h),false));
  // Exercise the real DragTracker/tick/pressEnd path in each direction.
  p.clingLock=null;dp.tryGrab(p,p.win.getBounds());
  const direction=side==='left'?[1,0]:side==='right'?[-1,0]:side==='top'?[0,1]:[0,-1];
  const startCursor={x:cursor.x,y:cursor.y};dp.pressStart(p);
  for(let n=1;n<=35;n++){cursor.x=startCursor.x+direction[0]*n*4;cursor.y=startCursor.y+direction[1]*n*4;dp.tick();}
  const dragged=p.win.getBounds();dp.pressEnd(p);const released=p.win.getBounds();
  test(side+' real drag releases cling',()=>assert.equal(p.cling,null));
  test(side+' release does not snap after real drag',()=>assert.ok(Math.abs(dragged.x-released.x)<2&&Math.abs(dragged.y-released.y)<2));
  dp.dispose();
}
AREA.x=0;AREA.y=0;
// Corner choices remain fixed while the locked edge is still valid, for all corners.
for(const [sx,sy] of [['left','top'],['right','top'],['left','bottom'],['right','bottom']]){
  const {dp,p,state}=make();state.pets=[{...PETS[0],edgeSides:['left','right','bottom','top']}];
  const box=dp.bodyBox(p),b={width:304,height:354,x:sx==='left'?6-box.left:AREA.width-box.right-6,y:sy==='top'?4-box.top:AREA.height-box.bottom-4};
  p.win.setBounds(b);
  test('corner nearest '+sx+sy,()=>assert.strictEqual(dp.clingSideFor(p,b,state.pets[0].edgeSides),sy));
  test('corner lock '+sx+sy,()=>assert.strictEqual(dp.clingSideFor(p,b,state.pets[0].edgeSides,sx),sx));
  dp.dispose();
}
console.log(passed+' four-edge checks passed');process.exit(0);
`;
vm.runInThisContext('(function(require,__dirname){'+initial+tests+'})',{filename})(require,__dirname);
