const {BrowserWindow,screen,powerMonitor}=require('electron');
const path=require('node:path');
const EdgeGeometry=require('./renderer/edge-config.js');
const {SpeechWindow}=require('./speech-window.cjs');
const {DragTracker}=require('./drag.cjs');
const {snapPosition}=require('./placement.cjs');
const {resting}=require('./preferences.cjs');
const {centre,clamp,freeTarget,planInteraction}=require('./social.cjs');

// Cling atlas geometry (mirrors app/renderer/sprite.js). Kept here too because the
// window has to be positioned so the cell's rim lands exactly on the screen edge.
const EDGE_CELL=EdgeGeometry.CELL;
const EDGE_SIDES=EdgeGeometry.SIDES;
// The cling artwork is a head-and-shoulders close-up, while the normal atlas draws her
// full body. Drawn at the same per-atlas-pixel scale her head therefore comes out much
// bigger than in the idle pose, which reads as "she grew" the moment she grabs an edge.
// Measured from the atlases (idle headband 158 atlas px, cling 185): at 1.0 her head is
// 17.1% wider than in the idle pose. The requested 0.75 scale makes the head about
// 87.8% of the idle head size. Shrink the cling window (and with it the cell, which
// maps 1:1 onto the window by CSS) by 25% to use this smaller edge pose.
// This only changes the window size — the rim fraction is unchanged, so the artwork
// still lines up with the screen edge.
const EDGE_CLING_SCALE=0.75;
if(EDGE_CLING_SCALE!==EdgeGeometry.SCALE)throw new Error("Cling scale configuration mismatch");
// Per-atlas-pixel scale for the cling window, derived from the normal canvas height the
// same way the idle pose is sized. Shared by tryGrab() and validateCling() so a resize
// or settings change never leaves a window at the wrong scale stuck to the edge.
function clingScale(size){return (Math.ceil(size*208/192)/416)*EDGE_CLING_SCALE;}
// Body centre as a fraction of the cell height: 0.499 for the normal 384×416 cell,
// 0.622 for the cling cell (the artwork sits lower in a taller canvas). Used to keep
// her body in place instead of her window centre.
const BODY_CY_NORMAL=0.499;
const BODY_CY_CLING=0.622;
// The normal canvas starts this far below the window top (pet.css body padding).
const PET_TOP_PADDING=164;
// Drop within this many DIP of an edge and she grabs it.
const EDGE_GRAB=48;
// She may also be dragged so her body is already past the edge; that still counts.
const EDGE_OVERSHOOT=64;
// How long a self-triggered peek remains requested. The interval starts only
// after the renderer confirms retraction and the previous speech has disappeared.
const EDGE_SELF_PEEK_MS=1800;
const MOP_MS=4000;
// Keep the accepted rightward distance while preserving the source cadence.
const MOP_SPEED={left:137.6,right:148};

// One native window per pet, one cursor poll and one movement clock for the group.
class DesktopPets {
  constructor(options) {
    Object.assign(this,options);this.instances=new Map();this.timer=null;this.interval=0;this.social=null;this.nextSocial=0;this.lastAmbient=0;this.routineResting=false;this.toy=null;this.disposed=false;
    this.create('primary');
  }
  get primary(){return this.instances.get('primary');}
  get windows(){return [...this.instances.values()].map(p=>p.win);}
  fromWindow(win){return [...this.instances.values()].find(p=>p.win===win);}
  config(p) {
    const {settings}=this.getState();
    if(p.id==='primary')return {...settings,visible:settings.visible&&(!settings.features.multiPet||settings.primaryVisible),...(this.routineResting?{behaviour:'quiet',randomAnimations:false}:{})};
    const item=settings.companions.find(c=>c.id===p.id)||{};
    const custom=settings.features.personalities?{size:item.size,behaviour:item.behaviour,followCursor:item.followCursor,randomAnimations:item.behaviour!=='quiet'}:{};
    return {...settings,...custom,petId:item.petId||'miso',position:item.position,visible:settings.visible&&item.visible!==false,...(this.routineResting?{behaviour:'quiet',randomAnimations:false}:{})};
  }
  active(p) {
    if(!p||!p.loaded||p.win.isDestroyed())return false;
    const state=this.getState(),config=this.config(p);
    const hidden=state.fullscreenDisplays?.has(String(screen.getDisplayMatching(p.win.getBounds()).id))||false;
    return config.visible&&state.screenAwake&&!(config.hideFullscreen&&hidden);
  }
  create(id) {
    const p={id,loaded:false,drag:null,walking:null,busyUntil:0,lastCursor:null,lastPetting:-Infinity,activity:null};
    const config=this.config(p),width=Math.max(config.size+72,304),height=Math.ceil(config.size*208/192)+180;
    p.win=new BrowserWindow({width,height,minWidth:width,maxWidth:width,minHeight:height,maxHeight:height,useContentSize:true,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,skipTaskbar:true,show:false,title:id==='primary'?'Petex pet':`Petex pet · ${id}`,webPreferences:this.windowOptions()});
    this.secure(p.win);p.win.setIgnoreMouseEvents(true,{forward:true});this.instances.set(id,p);
    p.win.on('close',e=>{if(!this.disposed){e.preventDefault();this.hide(p);}});
    p.ready=p.win.loadFile(path.join(__dirname,'renderer','pet.html')).then(()=>{if(!this.disposed&&!p.win.isDestroyed()){p.loaded=true;this.place(p);this.refresh();}});
    return p;
  }
  area(p) {
    const {settings}=this.getState(),bounds=p.win.getBounds();
    const zone=settings.features.roaming?settings.roamArea:null;
    const display=zone?screen.getAllDisplays().find(d=>String(d.id)===zone.displayId):null;
    const work=(display||screen.getDisplayMatching(bounds)).workArea;
    if(!zone?.rect||!display)return work;
    const r=zone.rect,config=this.config(p),width=Math.min(work.width,Math.max(Math.max(config.size+72,304),Math.round(work.width*r.width))),height=Math.min(work.height,Math.max(Math.ceil(config.size*208/192)+180,Math.round(work.height*r.height)));
    return {x:Math.min(Math.round(work.x+work.width*r.x),work.x+work.width-width),y:Math.min(Math.round(work.y+work.height*r.y),work.y+work.height-height),width,height};
  }
  place(p,reflow=false) {
    // A clinging pet owns its own geometry; re-placing it would undo the rim alignment.
    if(p.cling)return;
    const {settings}=this.getState(),config=this.config(p),width=Math.max(config.size+72,304),height=Math.ceil(config.size*208/192)+180;
    let position=config.position;
    const anchor=settings.placements[p.id];
    if((reflow||!position)&&anchor){const display=screen.getAllDisplays().find(d=>String(d.id)===anchor.displayId)||screen.getPrimaryDisplay();position={x:display.workArea.x+anchor.x*(display.workArea.width-width),y:display.workArea.y+anchor.y*(display.workArea.height-height)};}
    if(!position){const area=screen.getPrimaryDisplay().workArea;const offset=[...this.instances.keys()].indexOf(p.id);position={x:area.x+area.width-width-64-offset*(width+16),y:area.y+area.height-height-24};}
    p.win.setMinimumSize(width,height);p.win.setMaximumSize(width,height);const cb=clamp({...position,width,height},this.area(p));p.win.setBounds({x:Math.round(cb.x),y:Math.round(cb.y),width,height});
    p.win.setAlwaysOnTop(config.alwaysOnTop,'floating');
    if(process.platform==='darwin')p.win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    this.remember(p,false);
  }
  remember(p,anchor=true) {
    // Never persist the cling geometry: on restart she should come back as a normal
    // pet in the spot she was dropped, not as a half-off-screen window.
    if(p.cling)return;
    const {settings}=this.getState(),bounds=p.win.getBounds(),pos={x:bounds.x,y:bounds.y};
    if(p.id==='primary')settings.position=pos;else{const item=settings.companions.find(c=>c.id===p.id);if(item)item.position=pos;}
    if(anchor){const d=screen.getDisplayMatching(bounds),a=d.workArea;settings.placements[p.id]={displayId:String(d.id),x:Math.max(0,Math.min(1,(bounds.x-a.x)/Math.max(1,a.width-bounds.width))),y:Math.max(0,Math.min(1,(bounds.y-a.y)/Math.max(1,a.height-bounds.height)))};}
  }
  apply(reflow=false) {
    if(this.disposed)return;
    const {settings,pets}=this.getState();
    if(!reflow)for(const p of this.instances.values())if(p.walking||p.drag)this.remember(p);
    this.cancelSocial();
    const ids=settings.features.multiPet?settings.companions.filter(c=>pets.some(p=>p.id===c.petId)).map(c=>c.id):[];
    for(const [id,p] of this.instances)if(id!=='primary'&&!ids.includes(id)){this.instances.delete(id);p.bubble?.destroy();p.win.destroy();}
    for(const id of ids)if(!this.instances.has(id))this.create(id);
    for(const p of this.instances.values()){this.cancelMop(p);p.walking=null;p.drag=null;if(!p.cling)this.place(p,reflow);}
    if(!settings.features.toys||!settings.motion||!settings.visible)this.closeToy();
    this.routineResting=settings.features.routines&&resting(settings.routine,new Date(),powerMonitor.getSystemIdleTime());
    this.refresh();
  }
  refresh() {
    if(this.disposed)return;
    for(const p of this.instances.values()){
      // A cling that no longer matches the settings (effect off, another pet, another
      // size) would leave a window at the wrong scale stuck to the edge for ever.
      this.validateCling(p);
      if(!this.active(p)){if(p.walking||p.drag)this.remember(p);p.walking=null;p.drag=null;p.win.hide();}
      else if(!p.win.isVisible())p.win.showInactive();
      p.bubble?.update();
    }
    if(this.social&&this.social.ids.some(id=>!this.active(this.instances.get(id))))this.cancelSocial();
    if(this.toy&&!this.active(this.instances.get(this.toy.hostId)))this.closeToy();
    if(!this.getState().screenAwake||!this.getState().settings.visible){this.cancelSocial();this.closeToy();}
    this.schedule();this.onChange();
  }
  constrain() {
    if(this.disposed)return;
    const now=performance.now();
    for(const p of this.instances.values()){
      if(p.cling)continue;
      const bounds=p.win.getBounds(),area=this.area(p),position=clamp(bounds,area);
      if(position.x!==bounds.x||position.y!==bounds.y){const cfg=this.config(p),winW=Math.max(cfg.size+72,304),winH=Math.ceil(cfg.size*208/192)+180;p.win.setBounds({x:Math.round(position.x),y:Math.round(position.y),width:winW,height:winH});}
      if(p.walking?.mopping)this.cancelMop(p);
      else if(p.walking){const walk=p.walking;p.walking={origin:{...bounds,...position},target:clamp({...bounds,...walk.target},area),started:now,duration:Math.max(1,walk.duration-(now-walk.started))};}
      this.remember(p,false);
    }
    this.refresh();this.onSave();
  }
  schedule() {
    if(this.disposed){clearInterval(this.timer);this.timer=null;this.interval=0;return;}
    const active=[...this.instances.values()].filter(p=>this.active(p));
    const interval=!active.length?0:active.some(p=>p.drag)?16:active.some(p=>p.walking)||this.toy?33:active.some(p=>this.config(p).motion)?16:120;
    if(interval===this.interval)return;clearInterval(this.timer);this.interval=interval;this.timer=interval?setInterval(()=>this.tick(),interval):null;
  }
  tick() {
    if(this.disposed)return;
    const now=performance.now(),cursor=screen.getCursorScreenPoint();
    for(const p of this.instances.values()){
      if(!this.active(p))continue;
      let movement=null;
      if(p.drag){
        movement=p.drag.update(cursor,now);
        // A press that began on a clinging pet only turns into a real detach once the
        // pointer has actually moved. A plain click has to leave her hanging on the wall.
        if(movement.dragging&&p.clingPress){
          p.clingPress=false;
          if(p.cling){this.detachCling(p,true);const nb=p.win.getBounds();p.drag.offset={x:cursor.x-nb.x,y:cursor.y-nb.y};p.dragStart={...nb};}
        }
        if(movement.dragging){
          const cfg=this.config(p),winW=Math.max(cfg.size+72,304),winH=Math.ceil(cfg.size*208/192)+180;
          // A normal clamp would pin the window inside the work area, and since her body
          // starts ~113 px in from the window's left edge, her body could then never get
          // closer than 113 px to the screen edge — the cling could never trigger. So let
          // the window travel off-screen by its own body padding while dragging.
          const box=this.bodyBox(p),area=this.area(p);
          const slack={left:box.left,right:winW-box.right,top:box.top,bottom:winH-box.bottom};
          const dragArea={x:area.x-slack.left,y:area.y-slack.top,width:area.width+slack.left+slack.right,height:area.height+slack.top+slack.bottom};
          const pos=clamp({x:cursor.x-p.drag.offset.x,y:cursor.y-p.drag.offset.y,width:winW,height:winH},dragArea);
          p.win.setBounds({x:Math.round(pos.x),y:Math.round(pos.y),width:winW,height:winH});
          // Keep the first eligible direction while dragging through a corner.
          p.clingLock=this.clingSideFor(p,p.win.getBounds(),this.edgeSides(p),p.clingLock);
        }
      }
      if(p.walking){
        const w=p.walking,progress=Math.min(1,(now-w.started)/w.duration),eased=w.mopping?progress:progress*progress*(3-2*progress),bounds=p.win.getBounds();
        const candidate={x:Math.round(w.origin.x+(w.target.x-w.origin.x)*eased),y:Math.round(w.origin.y+(w.target.y-w.origin.y)*eased)};
        const cfg=this.config(p),winW=Math.max(cfg.size+72,304),winH=Math.ceil(cfg.size*208/192)+180,target=freeTarget({x:bounds.x,y:bounds.y,width:winW,height:winH},candidate,this.obstacles(p),this.area(p));p.win.setBounds({x:Math.round(target.x),y:Math.round(target.y),width:winW,height:winH});
        const blocked=target.x!==candidate.x||target.y!==candidate.y;
        if(progress>=1||blocked){
          if(w.mopping&&blocked)this.cancelMop(p);
          p.walking=null;this.remember(p);this.onSave();this.schedule();
        }
      }
      p.bubble?.update();
      const b=p.win.getBounds(),inside=cursor.x>=b.x&&cursor.y>=b.y&&cursor.x<b.x+b.width&&cursor.y<b.y+b.height;
      // A clinging pet hides by retracting. Three ways to bring her back:
      //   edgeAutoPeek  — the cursor approaching her edge;
      //   edgePeekEvery — she peeks out on her own every few seconds;
      //   a click       — delivers manual wake dialogue without detaching.
      if(p.cling&&!p.drag){
        const area=this.area(p),settings=this.getState().settings;
        let show=false;
        if(settings.edgeAutoPeek!==false){
          show=EdgeGeometry.nearPet(p.cling.side,b,cursor,area);
        }
        const cling=p.cling;
        if(show)cling.selfPeekUntil=0;
        else if(cling.selfPeekUntil>now)show=true;
        else if(settings.edgePeekEvery>0&&cling.retractedAt!==null&&!p.bubble?.payload){
          const quietSince=Math.max(cling.retractedAt,p.bubble?.hiddenAt||0);
          if(now-quietSince>=Math.max(2000,settings.edgePeekEvery)){
            show=true;cling.selfPeekUntil=now+EDGE_SELF_PEEK_MS;
          }
        }
        if(show!==p.clingPeek)this.edgePeek(p,show);
      }
      let socialGaze=null;
      if(this.social?.ids.includes(p.id)){const friend=this.instances.get(this.social.ids.find(id=>id!==p.id));if(friend){const c=centre(friend.win.getBounds());socialGaze={x:c.x-b.x-b.width/2,y:c.y-b.y-b.height/2};}}
      if(!p.drag&&!p.walking&&!inside&&!socialGaze&&p.lastCursor?.x===cursor.x&&p.lastCursor?.y===cursor.y)continue;
      p.lastCursor=cursor;p.win.webContents.send('pet:cursor',{x:cursor.x-b.x,y:cursor.y-b.y,dragging:movement?.dragging||false,direction:movement?.direction||null,dragGaze:movement?.gaze||null,walking:!!p.walking,socialGaze,socialUntil:this.social?now+250:0});
    }
    if(this.social){
      while(this.social.steps.length&&now-this.social.started>=this.social.steps[0].at){const step=this.social.steps.shift(),p=this.instances.get(step.id);if(p&&this.active(p)&&!p.drag){if(step.target)this.move(p,step.target,step.duration,step.name);else this.action(p,step.name,true);}}
      if(now>=this.social.until)this.cancelSocial();
    }
    if(this.toy)this.tickToy(now,cursor);
    if(now-this.lastAmbient>=1000){this.lastAmbient=now;this.ambient(now);}
  }
  obstacles(p){return [...this.instances.values()].filter(other=>other!==p&&this.active(other)).map(other=>other.win.getBounds());}
  mopUrl(p,direction){
    return direction==='left'?this.pet(p)?.mopLeftUrl:direction==='right'?this.pet(p)?.mopRightUrl:null;
  }
  requestMop(p,direction,automatic=false){
    if(!this.active(p)||!this.config(p).motion||p.drag||p.cling||!this.mopUrl(p,direction)||p.walking?.mopping)return;
    if(automatic&&!this.allowsAutomaticMop(p,direction))return;
    if(p.mopRequest?.expires>performance.now())return;
    this.cancelSocial();p.walking=null;
    const token=(p.mopToken??0)+1;
    p.mopToken=token;
    p.mopRequest={token,direction,automatic,expires:performance.now()+5000};
    p.win.webContents.send('pet:action',{name:'mop-'+direction,token,automatic});
    this.schedule();
  }
  allowsAutomaticMop(p,direction){
    const config=this.config(p);
    return config.randomAnimations&&config.behaviour!=='quiet'&&config.randomActionWeights?.['mop-'+direction]>0;
  }
  startMop(p,token){
    const request=p?.mopRequest;
    if(!request||request.token!==token)return 0;
    p.mopRequest=null;
    const {direction,automatic}=request;
    if(request.expires<performance.now()||!this.active(p)||!this.config(p).motion||p.drag||p.cling||!this.mopUrl(p,direction))return 0;
    if(automatic&&!this.allowsAutomaticMop(p,direction))return 0;
    const sign=direction==='left'?-1:1;
    const origin=p.win.getBounds(),speed=MOP_SPEED[direction]*this.config(p).size/384;
    const end=freeTarget(origin,{x:origin.x+sign*Math.round(speed*MOP_MS/1000),y:origin.y},this.obstacles(p),this.area(p));
    const duration=Math.min(MOP_MS,sign*(end.x-origin.x)*1000/speed);
    if(end.y!==origin.y||duration<240)return 0;
    const started=performance.now();
    p.walking={origin,target:end,started,duration,mopping:true};
    p.busyUntil=started+duration;p.activity='mop-'+direction;this.schedule();
    return duration;
  }
  cancelMop(p){
    p.mopRequest=null;
    if(!p.walking?.mopping)return;
    p.walking=null;p.busyUntil=0;
    p.win.webContents.send('pet:action',{name:'idle',silent:true});
  }
  move(p,target,duration,name) {
    if(!this.active(p)||p.drag||!this.config(p).motion)return;
    if(p.walking?.mopping)return;
    const origin=p.win.getBounds(),end=freeTarget(origin,target,this.obstacles(p),this.area(p));
    if(end.x===origin.x&&end.y===origin.y)return;
    p.walking={origin,target:end,started:performance.now(),duration};p.busyUntil=performance.now()+duration;
    if(name)this.action(p,name,true,duration);this.schedule();
  }
  wander(p,name,duration) {
    const config=this.config(p);
    if(!this.active(p)||!config.motion||!config.randomAnimations||p.drag||p.cling||!['running-left','running-right'].includes(name)||!Number.isFinite(duration)||duration<250||duration>3600)throw Object.assign(new Error(),{key:'walkError'});
    if(this.social?.ids.includes(p.id))return;
    const b=p.win.getBounds();this.move(p,{x:b.x+(name==='running-left'?-1:1)*Math.max(24,Math.min(96,config.size*.65)),y:b.y},duration);
  }
  action(p,name,coordinated=false,duration) {
    // While clinging she is tucked into the edge and the renderer refuses to draw
    // actions, so performing one would only yank her off the edge for nothing.
    if(!p||!this.active(p)||!this.config(p).motion||p.drag||p.cling)return;
    p.mopRequest=null;
    if(!coordinated){this.cancelSocial();p.walking=null;}
    p.busyUntil=performance.now()+(duration||3600);p.activity=name;p.win.webContents.send('pet:action',duration?{name,duration}:name);this.schedule();
  }
  speech(p,payload) {
    const target=p||this.primary;
    if(!target||!this.active(target))return;
    if(payload?.action&&!target.drag&&!target.cling&&this.config(target).motion){
      target.mopRequest=null;
      this.cancelSocial();target.walking=null;
      target.busyUntil=performance.now()+(payload.actionDuration||3600);
      target.activity=payload.action;
      target.win.webContents.send('pet:action',{name:payload.action,duration:payload.actionDuration,silent:true});
      this.schedule();
    }
    target.win.webContents.send('pet:speech',payload);
  }
  showBubble(p,payload){
    if(!p?.cling||!this.active(p)||!payload||typeof payload.text!=='string')return false;
    const clean={text:payload.text.slice(0,4000),duration:Math.max(500,Math.min(30000,Number(payload.duration)||3200))};
    for(const key of ['badge','meta','kind'])if(typeof payload[key]==='string')clean[key]=payload[key].slice(0,100);
    if(!p.bubble||p.bubble.destroyed)p.bubble=new SpeechWindow({owner:p,windowOptions:this.windowOptions,secure:this.secure,isActive:()=>this.active(p),getArea:()=>this.area(p),getConfig:()=>this.config(p)});
    p.bubble.show(clean);return true;
  }
  bubbleReady(win){
    const p=[...this.instances.values()].find(p=>p.bubble?.win===win);
    p?.bubble.rendererReady();
  }
  pressStart(p) {
    if(!this.active(p))return;
    this.cancelSocial();p.mopRequest=null;p.walking=null;
    // While clinging this press might still turn out to be a plain click ("呼びかけ"),
    // which must NOT move her. So do not detach here: the first real drag movement
    // does it (see tick), keeping her body exactly where it was.
    p.clingPress=!!p.cling;
    // A new drag is a new decision: forget the side chosen during the previous one.
    p.clingLock=null;
    p.drag=new DragTracker(screen.getCursorScreenPoint(),p.win.getBounds(),performance.now());
    // Where she started, so pressEnd can tell "carried away" from "dropped at the edge".
    p.dragStart={...p.win.getBounds()};
    p.win.setIgnoreMouseEvents(false);this.schedule();
  }
  // Leave the cling state without moving her far: resize to the normal window shape and
  // keep her visible body roughly where it was, so she does not teleport when grabbed.
  // This is the only way out of a cling — pressing her, or any action interrupting it.
  // `withAnchor` records where the cursor sat inside the resized window, so a drag that
  // starts right after does not jump.
  detachCling(p,withAnchor=false){
    if(!p?.cling)return;
    const area=this.area(p),cfg=this.config(p),b=p.win.getBounds();
    const width=Math.max(cfg.size+72,304),height=Math.ceil(cfg.size*208/192)+180;
    const cursor=screen.getCursorScreenPoint();
    const sideName=p.cling.side;
    const box=this.bodyBox(p);
    const restored=EdgeGeometry.detach(sideName,b,{width,height},box,area);
    p.cling=null;p.clingPeek=undefined;p.bubble?.clear();
    if(!p.win.isDestroyed())p.win.webContents.send('pet:cling-end');
    if(p.win.isDestroyed())return;
    p.win.setMinimumSize(width,height);p.win.setMaximumSize(width,height);
    // Keep her body exactly where it was and allow the window to hang off the screen by
    // its own padding — clamping to the work area here would shove her ~72 px inward the
    // instant you touch her, and the drag that follows is what pulls her out anyway.
    // pressEnd puts her back inside if the press turns out to be a plain click.
    const {x,y}=restored;
    p.win.setBounds(restored);
    // Keep the cursor on the spot of the window it was actually over, so the drag that
    // follows does not start with a jump.
    if(withAnchor)p.grabAnchor={x:Math.round(Math.max(0,Math.min(width-1,cursor.x-x))),y:Math.round(Math.max(0,Math.min(height-1,cursor.y-y)))};
    this.remember(p);
  }
  pressEnd(p) {
    if(p.drag){
      const wasDragging=p.drag.dragging;p.drag=null;
      const fromCling=p.clingPress;p.clingPress=false;
      // A click on a clinging pet just talks to her: she keeps hanging on the wall.
      if(fromCling&&!wasDragging){p.busyUntil=performance.now()+3000;this.refresh();this.onSave();return;}
      const cfg=this.config(p),winW=Math.max(cfg.size+72,304),winH=Math.ceil(cfg.size*208/192)+180;
      const bNow=p.win.getBounds(),start=p.dragStart||bNow;
      p.dragStart=null;
      const bounds={x:bNow.x,y:bNow.y,width:winW,height:winH};
      // Detaching from a cling keeps her body flush with the edge, so she is *always*
      // inside the grab threshold right after. Without this check she could never be
      // taken off the wall: every drop would immediately re-cling. Only a drag that
      // really starts from the cling counts — a normal drag toward the edge ends up
      // right of where it began too, and must still be allowed to grab.
      const derivedFromCling=fromCling&&wasDragging;
      // Try the grab on the raw drop position first. Clamping first would pull the window
      // back inside the screen and destroy the "her body is at the edge" state.
      const grabbed=wasDragging&&!derivedFromCling&&this.tryGrab(p,bounds);
      if(!grabbed){
        // Clamp against the drag area, not the work area. During the drag the window is
        // allowed to hang off the screen by her own body padding (see tick), so a plain
        // clamp here would snap her body back inside the moment you let go — that is the
        // "jump" you feel when pulling her off an edge, ~97 px at size 240. The drag area
        // still keeps her whole body on screen, only the empty window margin may overhang.
        const box=this.bodyBox(p),area=this.area(p);
        const slack={left:box.left,right:winW-box.right,top:box.top,bottom:winH-box.bottom};
        const dragArea={x:area.x-slack.left,y:area.y-slack.top,width:area.width+slack.left+slack.right,height:area.height+slack.top+slack.bottom};
        const position=wasDragging&&this.getState().settings.snapEdges?snapPosition(bounds,dragArea):clamp(bounds,dragArea);
        p.win.setBounds({x:Math.round(position.x),y:Math.round(position.y),width:winW,height:winH});
        this.remember(p);
      }
      // The drop is decided; the next press must be free to pick a different edge.
      p.clingLock=null;
    }
    p.clingPress=false;
    p.busyUntil=performance.now()+3000;this.refresh();this.onSave();
  }
  hit(p,value){if(!p.drag)p.win.setIgnoreMouseEvents(value!==true,{forward:true});}

  /* ---------------- edge cling (抓边探头) ---------------- */
  // Where the character's silhouette sits inside its window, in window pixels. The
  // window is much wider than she is: for size=160 it is 304 px wide but the drawn
  // body only spans ~77 px starting 113.5 px in from the left. Grabbing has to be
  // measured against the BODY, not the window, otherwise "she is at the screen edge"
  // never registers (the window is already at x=-113 by then).
  bodyBox(p){
    const cfg=this.config(p),width=Math.max(cfg.size+72,304),height=Math.ceil(cfg.size*208/192)+180;
    const padL=24,padR=24,padT=164,padB=16;
    const boxW=width-padL-padR,boxH=height-padT-padB;
    // The canvas is a 384 × 416 atlas cell scaled to fit the padded box (object-fit:
    // contain), then centred. Note the atlas pixel dimensions, not the 192 × 208
    // "logical" ones — using those halves the offsets.
    const k=Math.min(boxW/384,boxH/416);
    const offX=padL+(boxW-384*k)/2, offY=padT+(boxH-416*k)/2;
    // Body bbox inside a 384 × 416 cell, measured from the atlas: x 98..286, y 14..402.
    return {
      left:offX+98*k, right:offX+286*k,
      top:offY+14*k, bottom:offY+402*k,
    };
  }
  // Which edge, if any, the character herself was just dropped against.
  // `bounds` lets the caller pass the raw drop position (before clamping).
  // `only` restricts the choice to the sides this pet actually has artwork for: in a
  // corner the nearest edge may not be covered yet, and picking it would leave her
  // clinging to nothing at all.
  // `locked` is the side chosen a moment ago at this same corner. In a corner two edges
  // are both within the threshold, so without honouring the lock a few pixels of jitter
  // would flip her between them — she would visibly hop from one wall to the other.
  clingSideFor(p,bounds,only,locked){
    const b=bounds||p.win.getBounds(),area=this.area(p),box=this.bodyBox(p);
    const gaps={
      left:  (b.x+box.left)-area.x,
      right: area.x+area.width-(b.x+box.right),
      top:   (b.y+box.top)-area.y,
      bottom:area.y+area.height-(b.y+box.bottom),
    };
    const allowed=Array.isArray(only)&&only.length?only:null;
    const fits=gap=>gap<=EDGE_GRAB&&gap>=-EDGE_OVERSHOOT;
    // Stay on the locked edge while it is still a legitimate choice.
    if(locked&&gaps[locked]!==undefined&&fits(gaps[locked])&&(!allowed||allowed.includes(locked)))return locked;
    let best=null,bestGap=Infinity;
    for(const [side,gap] of Object.entries(gaps)){
      if(allowed&&!allowed.includes(side))continue;
      // Accept both "close to the edge" and "already past it" (negative gap).
      if(fits(gap)&&Math.abs(gap)<Math.abs(bestGap)){best=side;bestGap=gap;}
    }
    return best;
  }
  edgeSides(p){const pet=this.pet(p);return Array.isArray(pet?.edgeSides)?pet.edgeSides:[];}
  // Drop a cling that the current settings no longer justify. Called from refresh(),
  // which runs on every settings change, pet switch and size change.
  validateCling(p){
    if(!p?.cling)return;
    const cfg=this.config(p);
    const wantW=Math.round(EDGE_CELL.w*clingScale(cfg.size));
    if(this.getState().settings.edgeCling===false||!this.edgeSides(p).includes(p.cling.side)||Math.abs(p.cling.width-wantW)>1||!this.active(p)){
      this.detachCling(p);
      const position=clamp({...p.win.getBounds(),width:this.fitWidth(p),height:this.fitHeight(p)},this.area(p));
      p.win.setBounds({x:Math.round(position.x),y:Math.round(position.y),width:this.fitWidth(p),height:this.fitHeight(p)});
      this.remember(p);
    }
  }
  fitWidth(p){return Math.max(this.config(p).size+72,304);}
  fitHeight(p){return Math.ceil(this.config(p).size*208/192)+180;}
  // Grab the edge she was dropped near: resize the window to the cling cell's aspect,
  // then place it so the cell's rim lands exactly on the screen edge.
  tryGrab(p,bounds){
    if(p.drag||!this.active(p)||!this.config(p).motion)return false;
    if(this.getState().settings.edgeCling===false)return false;
    // Only consider edges this pet has artwork for, so a corner drop picks the nearest
    // *supported* edge instead of bailing out on an unsupported one. The press's locked
    // side (if any) is honoured first, which is what stops a corner from oscillating.
    const sides=this.edgeSides(p);
    const side=this.clingSideFor(p,bounds,sides,p.clingLock);
    if(!side||!sides.includes(side))return false;
    // Remember the choice for the rest of this drag so re-evaluating it cannot flip sides.
    p.clingLock=side;
    const cfg=this.config(p),area=this.area(p),b=bounds||p.win.getBounds();
    const placed=EdgeGeometry.place(side,cfg.size,b,this.bodyBox(p),area);
    const {width:clingW,height:winH}=placed;
    p.cling={side,width:clingW,height:winH,since:performance.now(),token:(p.clingToken||0)+1,revision:0,frame:0,bubbleFollow:0,retractedAt:null,selfPeekUntil:0,restore:{x:b.x,y:b.y,width:b.width,height:b.height}};
    p.clingToken=p.cling.token;p.clingPeek=false;
    p.walking=null;p.activity=null;
    p.win.setMinimumSize(clingW,winH);p.win.setMaximumSize(clingW,winH);
    p.win.setBounds(placed);
    p.win.webContents.send('pet:cling',{side,token:p.cling.token});
    this.schedule();
    return true;
  }
  // Mouse reached a retracted pet: peek out. Leaving retracts again.
  edgePeek(p,show){
    if(!p?.cling||p.drag)return;
    if(!show)p.cling.selfPeekUntil=0;
    p.clingPeek=!!show;p.cling.retractedAt=null;
    p.win.webContents.send('pet:cling-peek',{show:!!show,revision:++p.cling.revision});
  }
  edgeSettled(p,payload){
    const cling=p?.cling;
    if(!cling||payload?.token!==cling.token||payload.revision!==cling.revision||payload.side!==cling.side||payload.show!==p.clingPeek)return false;
    if(!payload.show&&cling.retractedAt===null)cling.retractedAt=performance.now();
    return true;
  }
  edgeFrame(p,payload){
    const cling=p?.cling;
    if(!cling||payload?.token!==cling.token||payload.revision!==cling.revision||payload.side!==cling.side||!Number.isInteger(payload.frame)||payload.frame<0||payload.frame>EDGE_SIDES[cling.side].retracted)return false;
    // Move the bubble 1.5x as fast, preserving its position on mid-animation reversals.
    cling.bubbleFollow=Math.max(0,Math.min(1,(cling.bubbleFollow??cling.frame/31)+(payload.frame-cling.frame)*1.5/31));
    const extent=payload.extent;
    if(extent&&Number.isInteger(extent.min)&&Number.isInteger(extent.max)&&extent.min>=0&&extent.max<=512&&extent.min<extent.max)cling.extent={min:extent.min,max:extent.max};
    else cling.extent=null;
    cling.frame=payload.frame;p.bubble?.update();return true;
  }
  hide(p) {const {settings}=this.getState();if(p.id==='primary'){if(settings.features.multiPet)settings.primaryVisible=false;else settings.visible=false;}else{const item=settings.companions.find(c=>c.id===p.id);if(item)item.visible=false;}this.refresh();this.onSave();}
  pet(p) {const {pets}=this.getState();return pets.find(pet=>pet.id===this.config(p).petId)||pets[0];}
  petting(p) {
    if(!p||p.drag||!this.active(p)||!this.config(p).motion)return false;
    const pet=this.pet(p), now=performance.now();
    const duration=pet?.pettingUrl&&!p.cling?5250:2500;
    if(now-p.lastPetting<(p.pettingCooldown??2500))return false;
    p.lastPetting=now;p.pettingCooldown=duration;
    if(pet?.pettingV4){
      if(!p.cling)this.action(p,'petting3',false,pet.pettingUrl?duration:undefined);
    }else this.action(p,'waving');
    p.win.webContents.send('pet:stroke',{sway:!pet?.pettingV4});
    return true;
  }
  cancelSocial() {if(this.social){for(const id of this.social.ids){const p=this.instances.get(id);if(p){if(p.walking)this.remember(p);p.walking=null;p.activity=null;p.win.webContents.send('pet:social-end');}}this.social=null;}this.nextSocial=performance.now()+25000+Math.random()*35000;}
  socialPlan(kind,force=false) {
    const {settings}=this.getState(),now=performance.now();
    if(!settings.features.interactions||!settings.features.multiPet||!settings.motion||this.routineResting||this.social)return false;
    const candidates=[...this.instances.values()].filter(p=>this.active(p)&&!p.drag&&!p.walking&&this.config(p).behaviour!=='quiet'&&(force||p.busyUntil<=now));
    let pair=null,best=Infinity;
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){const a=candidates[i],b=candidates[j];if(screen.getDisplayMatching(a.win.getBounds()).id!==screen.getDisplayMatching(b.win.getBounds()).id)continue;const ac=centre(a.win.getBounds()),bc=centre(b.win.getBounds()),distance=Math.hypot(ac.x-bc.x,ac.y-bc.y);if(distance<best&&distance<800){pair=[a,b];best=distance;}}
    if(!pair)return false;
    const plan=planInteraction(...pair.map(p=>({id:p.id,bounds:p.win.getBounds(),area:this.area(p)})),kind||['greet','follow','chase','jump'][Math.floor(Math.random()*4)]);
    this.social={...plan,started:now,until:now+plan.duration};
    for(const p of pair){p.activity=plan.kind;p.busyUntil=this.social.until;p.win.webContents.send('pet:social-start',plan.duration);}
    this.onChange();return true;
  }
  ambient(now) {
    const {settings}=this.getState();
    if(settings.features.routines){const next=resting(settings.routine,new Date(),powerMonitor.getSystemIdleTime());if(next!==this.routineResting){this.routineResting=next;if(next)this.cancelSocial();this.onChange();}}
    if(settings.features.interactions&&now>=this.nextSocial){this.socialPlan();this.nextSocial=now+25000+Math.random()*35000;}
  }
  reset() {const {settings}=this.getState();settings.position=null;settings.primaryVisible=true;settings.placements={};for(const item of settings.companions){item.position=null;item.visible=true;}this.apply();}
  throwBall() {
    const {settings}=this.getState(),host=[...this.instances.values()].find(p=>this.active(p));if(!settings.features.toys||!settings.motion||!host)return false;
    this.cancelSocial();this.closeToy();const pet=host.win.getBounds(),area=this.area(host),width=32;
    const win=new BrowserWindow({width,height:width,frame:false,transparent:true,hasShadow:false,resizable:false,skipTaskbar:true,show:false,alwaysOnTop:true,webPreferences:this.windowOptions()});this.secure(win);
    if(process.platform==='darwin')win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    const start=clamp({x:pet.x+pet.width/2,y:pet.y-140,width,height:width},area);
    this.toy={win,hostId:host.id,x:start.x,y:start.y,vx:(Math.random()>.5?1:-1)*.25,vy:-.2,last:performance.now(),expires:performance.now()+22000,nextChase:0,drag:false};
    win.setPosition(start.x,start.y);win.loadFile(path.join(__dirname,'renderer','toy.html')).then(()=>{if(this.toy?.win===win)win.showInactive();});win.on('closed',()=>{if(this.toy?.win===win){this.toy=null;this.schedule();}});this.schedule();return true;
  }
  toyPress(pressed) {if(!this.toy)return;const toy=this.toy;if(toy.drag===pressed)return;toy.drag=pressed;if(pressed)toy.vx=toy.vy=0;toy.expires=performance.now()+22000;toy.last=performance.now();}
  tickToy(now,cursor) {
    const toy=this.toy,host=this.instances.get(toy.hostId);if(!this.getState().settings.features.toys||!host||!this.active(host)||now>toy.expires){this.closeToy();return;}
    const dt=Math.min(50,now-toy.last);toy.last=now;const area=this.area(host);
    if(toy.drag){toy.vx=Math.max(-1,Math.min(1,(cursor.x-16-toy.x)/Math.max(dt,1)));toy.vy=Math.max(-1,Math.min(1,(cursor.y-16-toy.y)/Math.max(dt,1)));toy.x=cursor.x-16;toy.y=cursor.y-16;}
    else{toy.vy+=.0012*dt;toy.x+=toy.vx*dt;toy.y+=toy.vy*dt;if(toy.x<=area.x||toy.x+32>=area.x+area.width){toy.vx*=-.7;toy.x=Math.max(area.x,Math.min(toy.x,area.x+area.width-32));}if(toy.y+32>=area.y+area.height){toy.y=area.y+area.height-32;toy.vy=Math.abs(toy.vy)<.07?0:-toy.vy*.6;toy.vx*=.95;}toy.y=Math.max(area.y,toy.y);}
    toy.win.setPosition(Math.round(toy.x),Math.round(toy.y));
    if(!toy.drag&&now>=toy.nextChase){toy.nextChase=now+2000;for(const p of this.instances.values()){const config=this.config(p);if(!this.active(p)||p.drag||p.walking||config.behaviour==='quiet'||this.routineResting)continue;const b=p.win.getBounds(),target=clamp({...b,x:toy.x-b.width/2+16,y:toy.y-b.height+20},this.area(p));if(Math.hypot(b.x-target.x,b.y-target.y)<50)this.action(p,'jumping');else this.move(p,target,1600,target.x>=b.x?'running-right':'running-left');}}
  }
  closeToy(){if(this.toy){const win=this.toy.win;this.toy=null;if(!win.isDestroyed())win.destroy();}this.schedule();}
  dispose(){
    this.disposed=true;clearInterval(this.timer);this.timer=null;this.interval=0;this.social=null;this.toy=null;
    for(const p of this.instances.values())p.bubble?.destroy();
    // Stop activity here; app.quit owns the native window close sequence.
  }
}
module.exports={DesktopPets};
