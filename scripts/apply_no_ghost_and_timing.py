# -*- coding: utf-8 -*-
import hashlib, json, struct
from pathlib import Path

portable = Path(r"D:\codex_file\2026-11-08\new-chat-2\outputs\Petex-Portable")
asar_path = portable / "resources" / "app.asar"
exe_path = portable / "Petex.exe"
asar_bytes = asar_path.read_bytes()
exe_bytes = exe_path.read_bytes()

u0, u1, u2, u3 = struct.unpack("<IIII", asar_bytes[:16])
old_hdr_json = asar_bytes[16:16+u3]
old_hdr_sha = hashlib.sha256(old_hdr_json).hexdigest().encode("ascii")
assert old_hdr_sha in exe_bytes, "old_hdr_sha not found in Petex.exe"

hdr = json.loads(old_hdr_json.decode("utf-8"))
data_start = 8 + u1
file_blobs = {}
def walk_load(node, prefix=()):
    if "files" in node:
        for k, v in node["files"].items(): walk_load(v, prefix + (k,))
    elif "offset" in node and not node.get("unpacked", False):
        off = data_start + int(node["offset"])
        sz = int(node["size"])
        file_blobs[prefix] = asar_bytes[off:off+sz]
walk_load(hdr)

def get_txt(p): return file_blobs[p].decode("utf-8").replace("\r\n", "\n")
def set_txt(p, t): file_blobs[p] = t.encode("utf-8")

# 1. Update app/renderer/sprite.js: slower frame durations, multi-cycle counts, hysteresis single-frame crisp gaze (zero ghosting!)
sp = get_txt(("app", "renderer", "sprite.js"))

old_anims = """export const ANIMATIONS = {
  idle: {row: 0, durations: [280,110,110,140,140,320]},
  'running-right': {row: 1, durations: [120,120,120,120,120,120,120,220]},
  'running-left': {row: 2, durations: [120,120,120,120,120,120,120,220]},
  waving: {row: 3, durations: [140,140,140,280]},
  jumping: {row: 4, durations: [140,140,140,140,280]},
  failed: {row: 5, durations: [140,140,140,140,140,140,140,240]},
  waiting: {row: 6, durations: [150,150,150,150,150,260]},
  running: {row: 7, durations: [120,120,120,120,120,220]},
  review: {row: 8, durations: [150,150,150,150,150,280]},
};"""
if "\r\n" in sp and "\r\n" not in old_anims:
    old_anims = old_anims.replace("\n", "\r\n")

new_anims = """export const ANIMATIONS = {
  idle: {row: 0, durations: [600,160,160,200,200,680], cycles: 1},
  'running-right': {row: 1, durations: [165,165,165,165,165,165,165,260], cycles: 2},
  'running-left': {row: 2, durations: [165,165,165,165,165,165,165,260], cycles: 2},
  waving: {row: 3, durations: [220,220,220,380], cycles: 3},
  jumping: {row: 4, durations: [200,190,220,190,360], cycles: 2},
  failed: {row: 5, durations: [220,220,240,280,280,260,240,420], cycles: 2},
  waiting: {row: 6, durations: [240,240,260,240,240,400], cycles: 2},
  running: {row: 7, durations: [190,190,190,190,190,320], cycles: 3},
  review: {row: 8, durations: [240,240,260,240,260,420], cycles: 2},
};"""
if "\r\n" in sp and "\r\n" not in new_anims:
    new_anims = new_anims.replace("\n", "\r\n")
assert old_anims in sp, "old_anims not found"
sp = sp.replace(old_anims, new_anims, 1)

sp = sp.replace(
    "const cycles = ['waving','jumping','review','waiting','running'].includes(name) ? 2 : 1;",
    "const cycles = ANIMATIONS[name]?.cycles || 2;",
    1
)

# Replace gaze step + tick drawing with single-frame hysteresis + continuous micro-lean (NO alpha blending / ghosting!)
old_gaze_block = """  set gaze(value){
    const prev=this._gaze;this._gaze=value;
    if(!value){this._smoothAngle=null;if(prev)this.refresh();return;}
    this._targetAngle=(Math.atan2(value.x,-value.y)+Math.PI*2)%(Math.PI*2);
    if(this._smoothAngle===undefined||this._smoothAngle===null)this._smoothAngle=this._targetAngle;
    if(!this._gazeRaf)this._stepGaze();
  }
  _stepGaze(){
    this._gazeRaf=null;
    if(!this._gaze||this.stopped||!this._active)return;
    const twoPi=Math.PI*2;
    let diff=((this._targetAngle-this._smoothAngle+Math.PI)%twoPi+twoPi)%twoPi-Math.PI;
    const maxStep=0.22;
    const step=Math.abs(diff)>maxStep?Math.sign(diff)*maxStep:diff*0.38;
    this._smoothAngle=(this._smoothAngle+step+twoPi)%twoPi;
    this.tick(performance.now());
    if(Math.abs(diff)>0.008){
      this._gazeRaf=requestAnimationFrame(()=>this._stepGaze());
    }
  }"""
if "\r\n" in sp and "\r\n" not in old_gaze_block:
    old_gaze_block = old_gaze_block.replace("\n", "\r\n")

new_gaze_block = """  set gaze(value){
    const prev=this._gaze;this._gaze=value;
    if(!value){this._smoothAngle=null;this._gazeIdx=null;if(prev)this.refresh();return;}
    this._targetAngle=(Math.atan2(value.x,-value.y)+Math.PI*2)%(Math.PI*2);
    if(this._smoothAngle===undefined||this._smoothAngle===null)this._smoothAngle=this._targetAngle;
    if(!this._gazeRaf)this._stepGaze();
  }
  _stepGaze(){
    this._gazeRaf=null;
    if(!this._gaze||this.stopped||!this._active)return;
    const twoPi=Math.PI*2,sector=Math.PI/8;
    let diff=((this._targetAngle-this._smoothAngle+Math.PI)%twoPi+twoPi)%twoPi-Math.PI;
    const maxStep=0.24;
    const step=Math.abs(diff)>maxStep?Math.sign(diff)*maxStep:diff*0.42;
    this._smoothAngle=(this._smoothAngle+step+twoPi)%twoPi;
    if(this._gazeIdx===undefined||this._gazeIdx===null){
      this._gazeIdx=Math.round(this._smoothAngle/sector)%16;
    }else{
      const cAng=this._gazeIdx*sector;
      const dSec=((this._smoothAngle-cAng+Math.PI)%twoPi+twoPi)%twoPi-Math.PI;
      if(Math.abs(dSec)>sector*0.5+0.061){
        this._gazeIdx=Math.round(this._smoothAngle/sector)%16;
      }
    }
    this.tick(performance.now());
    if(Math.abs(diff)>0.006){
      this._gazeRaf=requestAnimationFrame(()=>this._stepGaze());
    }
  }"""
if "\r\n" in sp and "\r\n" not in new_gaze_block:
    new_gaze_block = new_gaze_block.replace("\n", "\r\n")
assert old_gaze_block in sp, "old_gaze_block not found"
sp = sp.replace(old_gaze_block, new_gaze_block, 1)

old_tick = """    const gazing=this.motion&&this.gaze&&this.pet?.spriteVersionNumber===2&&this.state==='idle';
    const ang=gazing?(this._smoothAngle??(Math.atan2(this.gaze.x,-this.gaze.y)+Math.PI*2)%(Math.PI*2)):0;
    const exactDir=gazing?(ang/(Math.PI/8))%16:0;
    const d0=Math.floor(exactDir)%16,d1=(d0+1)%16,frac=exactDir-Math.floor(exactDir);
    const pose=gazing?{row:9+Math.floor(d0/8),frame:d0%8,d1,frac:Math.round(frac*20)/20}:animationFrame(this.motion?this.state:'idle',elapsed);
    const renderKey=JSON.stringify([this.pet?.id,!!this.image,this.pet?.builtin&&this.motion?Math.floor(now/40):0,pose,this.motion,this.pet?.builtin?this.gaze:null]);
    if(this.renderKey!==renderKey){
      this.renderKey=renderKey;
      const ctx=this.ctx;ctx.clearRect(0,0,384,416);ctx.save();ctx.scale(2,2);
      if(this.pet?.builtin)drawMiso(ctx,this.motion?now:0,this.motion?this.state:'idle',this.motion?this.gaze:null,this.motion,elapsed);
      else if(this.image){
        const s=this.image.naturalWidth===3072?2:1;
        if(gazing){
          const ox=Math.sin(ang)*1.2,oy=-Math.cos(ang)*1.0;
          const r0=9+Math.floor(d0/8),c0=d0%8,r1=9+Math.floor(d1/8),c1=d1%8;
          if(frac<0.15||frac>0.85){
            const rn=frac>0.5?r1:r0,cn=frac>0.5?c1:c0;
            ctx.drawImage(this.image,cn*192*s,rn*208*s,192*s,208*s,ox,oy,192,208);
          }else{
            ctx.globalAlpha=1;
            ctx.drawImage(this.image,c0*192*s,r0*208*s,192*s,208*s,ox,oy,192,208);
            ctx.globalAlpha=frac;
            ctx.drawImage(this.image,c1*192*s,r1*208*s,192*s,208*s,ox,oy,192,208);
            ctx.globalAlpha=1;
          }
        }else{
          ctx.drawImage(this.image,pose.frame*192*s,pose.row*208*s,192*s,208*s,0,0,192,208);
        }
      }
      ctx.restore();
    }"""
if "\r\n" in sp and "\r\n" not in old_tick:
    old_tick = old_tick.replace("\n", "\r\n")

new_tick = """    const gazing=this.motion&&this.gaze&&this.pet?.spriteVersionNumber===2&&this.state==='idle';
    const ang=gazing?(this._smoothAngle??(Math.atan2(this.gaze.x,-this.gaze.y)+Math.PI*2)%(Math.PI*2)):0;
    const dirIdx=gazing?(this._gazeIdx??Math.round(ang/(Math.PI/8))%16):0;
    const ox=gazing?Math.round(Math.sin(ang)*3)/2:0,oy=gazing?Math.round(-Math.cos(ang)*2)/2:0;
    const pose=gazing?{row:9+Math.floor(dirIdx/8),frame:dirIdx%8,ox,oy}:animationFrame(this.motion?this.state:'idle',elapsed);
    const renderKey=JSON.stringify([this.pet?.id,!!this.image,this.pet?.builtin&&this.motion?Math.floor(now/40):0,pose,this.motion,this.pet?.builtin?this.gaze:null]);
    if(this.renderKey!==renderKey){
      this.renderKey=renderKey;
      const ctx=this.ctx;ctx.clearRect(0,0,384,416);ctx.save();ctx.scale(2,2);
      if(this.pet?.builtin)drawMiso(ctx,this.motion?now:0,this.motion?this.state:'idle',this.motion?this.gaze:null,this.motion,elapsed);
      else if(this.image){
        const s=this.image.naturalWidth===3072?2:1;
        ctx.drawImage(this.image,pose.frame*192*s,pose.row*208*s,192*s,208*s,ox,oy,192,208);
      }
      ctx.restore();
    }"""
if "\r\n" in sp and "\r\n" not in new_tick:
    new_tick = new_tick.replace("\n", "\r\n")
assert old_tick in sp, "old_tick not found"
sp = sp.replace(old_tick, new_tick, 1)
set_txt(("app", "renderer", "sprite.js"), sp)

# 2. Update app/renderer/pet.js: use multi-cycle duration when triggering an action
pjs = get_txt(("app", "renderer", "pet.js"))
old_act_dur = "actionUntil=performance.now()+(value?.duration||ANIMATIONS[name].durations.reduce((a,b)=>a+b,0));"
new_act_dur = "actionUntil=performance.now()+(value?.duration||ANIMATIONS[name].durations.reduce((a,b)=>a+b,0)*(ANIMATIONS[name].cycles||2));"
assert old_act_dur in pjs, "old_act_dur not found in pet.js"
pjs = pjs.replace(old_act_dur, new_act_dur, 1)
set_txt(("app", "renderer", "pet.js"), pjs)

# 3. Update app/renderer/settings.js: use multi-cycle duration in preview
sjs = get_txt(("app", "renderer", "settings.js"))
old_s_dur = "ANIMATIONS[name].durations.reduce((a,b)=>a+b,0));run(()=>api.playAnimation(name));"
new_s_dur = "ANIMATIONS[name].durations.reduce((a,b)=>a+b,0)*(ANIMATIONS[name].cycles||2));run(()=>api.playAnimation(name));"
assert old_s_dur in sjs, "old_s_dur not found in settings.js"
sjs = sjs.replace(old_s_dur, new_s_dur, 1)
set_txt(("app", "renderer", "settings.js"), sjs)

# 4. Update app/desktop.cjs: increase default action busyUntil to 3600ms
desk = get_txt(("app", "desktop.cjs"))
desk = desk.replace("p.busyUntil=performance.now()+(duration||1400);", "p.busyUntil=performance.now()+(duration||3600);", 1)
set_txt(("app", "desktop.cjs"), desk)

# Repack ASAR
new_parts = []
cur_off = 0
BS = 4 * 1024 * 1024
def walk_repack(node, prefix=()):
    global cur_off
    if "files" in node:
        for k, v in node["files"].items(): walk_repack(v, prefix + (k,))
    elif "offset" in node and not node.get("unpacked", False):
        data = file_blobs[prefix]
        sz = len(data)
        node["offset"] = str(cur_off)
        node["size"] = sz
        if "integrity" in node:
            h = hashlib.sha256(data).hexdigest()
            node["integrity"]["hash"] = h
            node["integrity"]["blocks"] = [hashlib.sha256(data[i:i+BS]).hexdigest() for i in range(0, max(1, sz), BS)]
        new_parts.append(data)
        cur_off += sz
walk_repack(hdr)
new_hdr_json = json.dumps(hdr, separators=(",", ":")).encode("utf-8")
slen = len(new_hdr_json)
spad = (slen + 3) & ~3
pad = b"\x00" * (spad - slen)
asar_hdr = struct.pack("<IIII", 4, 8 + spad, 4 + spad, slen) + new_hdr_json + pad
asar_path.write_bytes(asar_hdr + b"".join(new_parts))
new_hdr_sha = hashlib.sha256(new_hdr_json).hexdigest().encode("ascii")
exe_path.write_bytes(exe_bytes.replace(old_hdr_sha, new_hdr_sha))
print("Updated crisp no-ghosting gaze + slower animations! New SHA256:", new_hdr_sha.decode())
