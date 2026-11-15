/* Shared geometry: require() in Electron's main process, side-effect import in the renderer. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PetexEdge=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const CELL={w:384,h:512},SCALE=0.75;
  // Anchors follow the character, rather than the transparent cell's centre.
  // Bounds include the original halo; they only constrain movement along the edge.
  const SIDES={
    left:{axis:'x',rim:64,block:0,retracted:22,anchor:0.622,bounds:[64,126,302,512]},
    right:{axis:'x',rim:320,block:1,retracted:22,anchor:301/512,bounds:[78,96,320,506]},
    bottom:{axis:'y',rim:432,block:2,retracted:31,anchor:200/384,bounds:[44,117,384,432]},
    top:{axis:'y',rim:80,block:3,retracted:31,anchor:184/384,bounds:[61,80,340,415]},
  };
  function sizeFor(size){
    const scale=(Math.ceil(size*208/192)/416)*SCALE;
    return {width:Math.round(CELL.w*scale),height:Math.round(CELL.h*scale)};
  }
  function normalY(normal){return 164+0.499*(normal.height-164);}
  function limit(value,min,max){return Math.max(min,Math.min(max,value));}
  function place(side,size,normal,box,area){
    const s=SIDES[side],{width,height}=sizeFor(size);
    let x,y;
    if(s.axis==='x'){
      const edge=side==='left'?area.x:area.x+area.width;
      x=edge-width*s.rim/CELL.w;
      y=normal.y+normalY(normal)-height*s.anchor;
      y=limit(y,area.y-height*s.bounds[1]/CELL.h,area.y+area.height-height*s.bounds[3]/CELL.h);
    }else{
      const edge=side==='top'?area.y:area.y+area.height;
      y=edge-height*s.rim/CELL.h;
      x=normal.x+(box.left+box.right)/2-width*s.anchor;
      x=limit(x,area.x-width*s.bounds[0]/CELL.w,area.x+area.width-width*s.bounds[2]/CELL.w);
    }
    return {x:Math.round(x),y:Math.round(y),width,height};
  }
  function detach(side,cling,normal,box,area){
    const s=SIDES[side];let x,y;
    if(s.axis==='x'){
      const contact=cling.x+cling.width*s.rim/CELL.w;
      x=contact-(side==='left'?box.left:box.right);
      y=cling.y+cling.height*s.anchor-normalY(normal);
    }else{
      const contact=cling.y+cling.height*s.rim/CELL.h;
      y=contact-(side==='top'?box.top:box.bottom);
      x=cling.x+cling.width*s.anchor-(box.left+box.right)/2;
    }
    x=limit(x,area.x-box.left,area.x+area.width-box.right);
    y=limit(y,area.y-box.top,area.y+area.height-box.bottom);
    return {x:Math.round(x),y:Math.round(y),width:normal.width,height:normal.height};
  }
  function hitBand(side,x,y,width,height,band=32){
    const s=SIDES[side];if(!s||width<=0||height<=0||x<0||y<0||x>=width||y>=height)return false;
    const rim=s.rim*(s.axis==='x'?width/CELL.w:height/CELL.h);
    const along=s.axis==='x'?y/height*CELL.h:x/width*CELL.w;
    const low=s.axis==='x'?s.bounds[1]:s.bounds[0],high=s.axis==='x'?s.bounds[3]:s.bounds[2];
    if(along<low||along>high)return false;
    const distance=side==='left'?x-rim:side==='right'?rim-x:side==='top'?y-rim:rim-y;
    return distance>=-1&&distance<=band;
  }
  // Screen coordinates, restricted to this character's complete emerged silhouette.
  // Keep the same region while she retracts, so reaching her small visible sliver
  // remains easy without making a distant part of the screen edge hold her open.
  function nearPet(side,pet,cursor,area){
    const s=SIDES[side];if(!s)return false;
    const [left,top,right,bottom]=s.bounds,pad=24;
    const x1=Math.max(area.x-8,pet.x+pet.width*left/CELL.w-pad);
    const x2=Math.min(area.x+area.width+8,pet.x+pet.width*right/CELL.w+pad);
    const y1=Math.max(area.y-8,pet.y+pet.height*top/CELL.h-pad);
    const y2=Math.min(area.y+area.height+8,pet.y+pet.height*bottom/CELL.h+pad);
    return cursor.x>=x1&&cursor.x<=x2&&cursor.y>=y1&&cursor.y<=y2;
  }
  return {CELL,SCALE,SIDES,sizeFor,place,detach,hitBand,nearPet};
});
