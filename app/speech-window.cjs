const {BrowserWindow}=require('electron');
const path=require('node:path');
const WIDTH=320,HEIGHT=148;
const limit=(v,a,b)=>Math.max(a,Math.min(b,v));

// The pet keeps its exact 384x512 window. Decorations get their own transparent,
// non-activating, click-through window in the screen's work area.
function bubbleBounds(pet,side,area,frame=0,progress=frame/31,extent=null){
  const width=Math.min(WIDTH,area.width),height=Math.min(HEIGHT,area.height);
  const follow=Math.min(100,pet.height*100/240)*limit(Number(progress)||0,0,1);
  let anchorX=pet.x+pet.width/2,x,y;
  if(side==='left'){
    anchorX=pet.x+pet.width/6+pet.width*.25;
    x=pet.x+pet.width/6+8;y=pet.y+pet.height*126/512-height+16;
  }else if(side==='right'){
    anchorX=pet.x+pet.width*5/6-pet.width*.25;
    x=pet.x+pet.width*5/6-width-8;y=pet.y+pet.height*96/512-height+16;
  }else if(side==='bottom'){
    anchorX=pet.x+pet.width*200/384;
    // Follow the actual drawn frame over a short travel, keeping ahead of the halo.
    x=anchorX-width/2;y=pet.y+pet.height*117/512-height-12+follow;
    if(extent)y=Math.min(y,pet.y+pet.height*extent.min/512-height-8);
  }else{
    anchorX=pet.x+pet.width*184/384;
    x=anchorX-width/2;y=pet.y+pet.height*415/512+12-follow;
    if(extent)y=Math.max(y,pet.y+pet.height*extent.max/512+8);
  }
  x=Math.round(limit(x,area.x,area.x+area.width-width));
  y=Math.round(limit(y,area.y,area.y+area.height-height));
  return {bounds:{x,y,width,height},tailX:anchorX-x,edge:side};
}

class SpeechWindow {
  constructor({owner,windowOptions,secure,isActive,getArea,getConfig}){
    Object.assign(this,{owner,isActive,getArea,getConfig});
    this.payload=null;this.timer=null;this.destroyed=false;this.ready=false;this.lastLayout='';this.hiddenAt=0;
    this.win=new BrowserWindow({width:WIDTH,height:HEIGHT,useContentSize:true,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,skipTaskbar:true,show:false,focusable:false,title:'Petex speech',webPreferences:windowOptions()});
    secure(this.win);this.win.setIgnoreMouseEvents(true,{forward:true});
    this.win.on('closed',()=>{this.destroyed=true;clearTimeout(this.timer);});
    this.loading=this.win.loadFile(path.join(__dirname,'renderer','pet.html'),{query:{speech:'1'}}).then(()=>{
      if(this.destroyed)return;
    }).catch(()=>{this.destroy();});
  }
  rendererReady(){
    if(this.destroyed)return;
    this.ready=true;this.lastLayout='';
    if(this.payload&&this.expires>performance.now())this.deliver();
  }
  show(payload){
    if(this.destroyed)return;
    this.payload=payload;this.expires=performance.now()+payload.duration;
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.clear(),payload.duration+260);
    if(this.ready)this.deliver();
  }
  deliver(){
    if(!this.update())return;
    const duration=Math.max(1,this.expires-performance.now());
    this.win.webContents.send('pet:bubble-show',{...this.payload,duration});
    this.win.showInactive();
  }
  update(){
    if(this.destroyed||!this.payload)return false;
    if(!this.isActive()||!this.owner.cling){this.clear();return false;}
    const layout=bubbleBounds(this.owner.win.getBounds(),this.owner.cling.side,this.getArea(),this.owner.cling.frame,this.owner.cling.bubbleFollow,this.owner.cling.extent);
    const config=this.getConfig(),signature=JSON.stringify({...layout,alwaysOnTop:config.alwaysOnTop});
    if(signature!==this.lastLayout){
      this.lastLayout=signature;this.win.setBounds(layout.bounds);
      this.win.setAlwaysOnTop(config.alwaysOnTop,'floating');
      if(this.ready)this.win.webContents.send('pet:bubble-layout',layout);
    }
    return true;
  }
  clear(){
    if(this.payload)this.hiddenAt=performance.now();
    clearTimeout(this.timer);this.timer=null;this.payload=null;
    if(!this.destroyed)this.win.hide();
  }
  destroy(){
    clearTimeout(this.timer);this.timer=null;this.payload=null;
    if(!this.destroyed&&!this.win.isDestroyed())this.win.destroy();
    this.destroyed=true;
  }
}
module.exports={SpeechWindow,bubbleBounds};
