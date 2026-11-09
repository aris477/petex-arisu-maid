# -*- coding: utf-8 -*-
import hashlib, json, struct
from pathlib import Path

portable = Path(r"D:\codex_file\2026-11-08\new-chat-2\outputs\Petex-Portable")
asar_orig = (portable / "resources" / "app.asar.orig").read_bytes()
exe_orig = (portable / "Petex.exe.orig").read_bytes()

u0, u1, u2, u3 = struct.unpack("<IIII", asar_orig[:16])
old_hdr_json_bytes = asar_orig[16:16+u3]
old_hdr_sha = hashlib.sha256(old_hdr_json_bytes).hexdigest().encode("ascii")
assert old_hdr_sha in exe_orig, "old_hdr_sha not found in Petex.exe.orig"

hdr = json.loads(old_hdr_json_bytes.decode("utf-8"))
data_start = 8 + u1

file_blobs = {}
def walk_load(node, prefix=()):
    if "files" in node:
        for k, v in node["files"].items():
            walk_load(v, prefix + (k,))
    elif "offset" in node and not node.get("unpacked", False):
        off = data_start + int(node["offset"])
        sz = int(node["size"])
        file_blobs[prefix] = asar_orig[off:off+sz]

walk_load(hdr)
print("Loaded", len(file_blobs), "files from app.asar.orig")

def get_txt(path_tuple):
    return file_blobs[path_tuple].decode("utf-8")

def set_txt(path_tuple, text):
    file_blobs[path_tuple] = text.encode("utf-8")

# --- 1. Patch app/library.cjs ---
lib = get_txt(("app", "library.cjs"))
lib = lib.replace(
    "const DEFAULTS = Object.freeze({ petId: 'miso', size: 160,",
    "const DEFAULTS = Object.freeze({ petId: 'miso', clickAction: 'waving', size: 160,",
    1
)
lib = lib.replace(
    "petId: typeof input.petId === 'string' ? input.petId : DEFAULTS.petId,",
    "petId: typeof input.petId === 'string' ? input.petId : DEFAULTS.petId, clickAction: ['waving','jumping','failed','waiting','running','review','running-left','running-right','random'].includes(input.clickAction) ? input.clickAction : (DEFAULTS.clickAction || 'waving'),",
    1
)
lib = lib.replace("limitInputPixels: 1536 * 2288", "limitInputPixels: 3072 * 4576")
lib = lib.replace(
    "if (size.width !== 1536 || size.height !== rows * 208)",
    "const sc = size.width === 3072 ? 2 : 1; if (size.width !== 1536 * sc || size.height !== rows * 208 * sc)"
)
lib = lib.replace(
    "spriteVersionNumber: size.height === 2288 ? 2 : 1",
    "spriteVersionNumber: (size.height === 2288 || size.height === 4576) ? 2 : 1"
)
set_txt(("app", "library.cjs"), lib)

# --- 2. Patch app/main.cjs ---
main = get_txt(("app", "main.cjs"))
main = main.replace("const permitted = ['petId', 'size',", "const permitted = ['petId', 'clickAction', 'size',", 1)
old_menu_head = "{label:t('wave'),click:()=>desktop.action(p,'waving')},"
assert old_menu_head in main, "old_menu_head not found"
new_menu_items = ",\r\n    ".join([
    "{label:t('wave'),click:()=>desktop.action(p,'waving')}",
    "{label:t('look'),click:()=>desktop.action(p,'review')}",
    "{label:t('wait'),click:()=>desktop.action(p,'waiting')}",
    "{label:t('work'),click:()=>desktop.action(p,'running')}",
    "{label:t('sad'),click:()=>desktop.action(p,'failed')}",
    "{label:t('left'),click:()=>desktop.action(p,'running-left')}",
    "{label:t('right'),click:()=>desktop.action(p,'running-right')},"
])
main = main.replace(old_menu_head, new_menu_items, 1)
set_txt(("app", "main.cjs"), main)

# --- 3. Patch app/desktop.cjs (Fix Windows DPI setPosition window-enlargement & aspect distortion bug!) ---
desk = get_txt(("app", "desktop.cjs"))
desk = desk.replace(
    "p.win=new BrowserWindow({width,height,frame:false,",
    "p.win=new BrowserWindow({width,height,minWidth:width,maxWidth:width,minHeight:height,maxHeight:height,useContentSize:true,frame:false,",
    1
)
old_place_set = "p.win.setBounds({...clamp({...position,width,height},this.area(p)),width,height});"
new_place_set = "p.win.setMinimumSize(width,height);p.win.setMaximumSize(width,height);const cb=clamp({...position,width,height},this.area(p));p.win.setBounds({x:Math.round(cb.x),y:Math.round(cb.y),width,height});"
assert old_place_set in desk, "old_place_set not found"
desk = desk.replace(old_place_set, new_place_set, 1)

desk = desk.replace(
    "if(position.x!==bounds.x||position.y!==bounds.y)p.win.setPosition(position.x,position.y);",
    "if(position.x!==bounds.x||position.y!==bounds.y){const cfg=this.config(p),winW=cfg.size+32,winH=Math.ceil(cfg.size*208/192)+32;p.win.setBounds({x:Math.round(position.x),y:Math.round(position.y),width:winW,height:winH});}",
    1
)
desk = desk.replace(
    "if(p.drag){movement=p.drag.update(cursor,now);if(movement.dragging){const bounds=p.win.getBounds(),pos=clamp({...bounds,...movement.position},this.area(p));p.win.setPosition(pos.x,pos.y);}}",
    "if(p.drag){movement=p.drag.update(cursor,now);if(movement.dragging){const cfg=this.config(p),winW=cfg.size+32,winH=Math.ceil(cfg.size*208/192)+32,pos=clamp({x:movement.position.x,y:movement.position.y,width:winW,height:winH},this.area(p));p.win.setBounds({x:Math.round(pos.x),y:Math.round(pos.y),width:winW,height:winH});}}",
    1
)
desk = desk.replace(
    "const target=freeTarget(bounds,candidate,this.obstacles(p),this.area(p));p.win.setPosition(target.x,target.y);",
    "const cfg=this.config(p),winW=cfg.size+32,winH=Math.ceil(cfg.size*208/192)+32,target=freeTarget({x:bounds.x,y:bounds.y,width:winW,height:winH},candidate,this.obstacles(p),this.area(p));p.win.setBounds({x:Math.round(target.x),y:Math.round(target.y),width:winW,height:winH});",
    1
)
desk = desk.replace(
    "if(p.drag){const wasDragging=p.drag.dragging;p.drag=null;const bounds=p.win.getBounds();const position=wasDragging&&this.getState().settings.snapEdges?snapPosition(bounds,this.area(p)):clamp(bounds,this.area(p));p.win.setPosition(position.x,position.y);this.remember(p);}",
    "if(p.drag){const wasDragging=p.drag.dragging;p.drag=null;const cfg=this.config(p),winW=cfg.size+32,winH=Math.ceil(cfg.size*208/192)+32,bNow=p.win.getBounds(),bounds={x:bNow.x,y:bNow.y,width:winW,height:winH};const position=wasDragging&&this.getState().settings.snapEdges?snapPosition(bounds,this.area(p)):clamp(bounds,this.area(p));p.win.setBounds({x:Math.round(position.x),y:Math.round(position.y),width:winW,height:winH});this.remember(p);}",
    1
)
set_txt(("app", "desktop.cjs"), desk)

# --- 4. Patch app/renderer/pet.css & app/renderer/pet.js ---
pcss = get_txt(("app", "renderer", "pet.css"))
pcss = pcss.replace(
    "body{padding:16px}canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}",
    "body{padding:16px;display:flex;align-items:center;justify-content:center}canvas{width:100%;height:100%;object-fit:contain;flex:0 0 auto;display:block;cursor:grab;touch-action:none}",
    1
)
set_txt(("app", "renderer", "pet.css"), pcss)

pjs = get_txt(("app", "renderer", "pet.js"))
pjs = pjs.replace(
    "settings=next;selectedPet=pet;active=state.petActive;",
    "settings=next;selectedPet=pet;active=state.petActive;if(next?.size){canvas.style.width=next.size+'px';canvas.style.height=Math.ceil(next.size*208/192)+'px';}",
    1
)
pjs = pjs.replace(
    "const state=selectedPet.builtin||selectedPet.spriteVersionNumber===2?'idle':cursor.direction;",
    "const state=cursor.direction||'idle';",
    1
)
old_click = "else if(!press.longPressed)action('waving');else plan();"
new_click = "else if(!press.longPressed){const ca=settings?.clickAction||'waving';const pool=['waving','jumping','review','waiting','running','failed'];action(ca==='random'?pool[Math.floor(Math.random()*pool.length)]:ca);}else plan();"
assert old_click in pjs, "old_click not found in pet.js"
pjs = pjs.replace(old_click, new_click, 1)
set_txt(("app", "renderer", "pet.js"), pjs)

# --- 5. Patch app/renderer/settings.js ---
sjs = get_txt(("app", "renderer", "settings.js"))
old_anim_line = "$('animation').replaceChildren(...animations.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=t(({waving:'wave',jumping:'jump',failed:'sad',waiting:'wait',running:'work',review:'look','running-left':'left','running-right':'right'})[name]);return option;}));"
new_anim_line = "const opts=animations.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=t(({waving:'wave',jumping:'jump',failed:'sad',waiting:'wait',running:'work',review:'look','running-left':'left','running-right':'right'})[name]);return option;});const randOpt=document.createElement('option');randOpt.value='random';randOpt.textContent=state.locale.startsWith('zh')?'\u968f\u673a\u52a8\u4f5c':'Random';opts.push(randOpt);$('animation').replaceChildren(...opts);"
assert old_anim_line in sjs, "old_anim_line not found in settings.js"
sjs = sjs.replace(old_anim_line, new_anim_line, 1)
sjs = sjs.replace(
    "$('play').disabled=!settings.motion;",
    "if(settings.clickAction&&$('animation').value!==settings.clickAction)$('animation').value=settings.clickAction;$('play').disabled=!settings.motion;",
    1
)
old_play_fn = "function playAnimation() {const name=$('animation').value;if(!state.settings.motion)return;hero.action(name);clearTimeout(actionTimer);actionTimer=setTimeout(()=>hero.action('idle'),ANIMATIONS[name].durations.reduce((a,b)=>a+b,0));run(()=>api.playAnimation(name));}"
new_play_fn = "function playAnimation() {const raw=$('animation').value,pool=['waving','jumping','review','waiting','running','failed'],name=raw==='random'?pool[Math.floor(Math.random()*pool.length)]:raw;if(!state.settings.motion)return;hero.action(name);clearTimeout(actionTimer);actionTimer=setTimeout(()=>hero.action('idle'),ANIMATIONS[name].durations.reduce((a,b)=>a+b,0));run(()=>api.playAnimation(name));}"
assert old_play_fn in sjs, "old_play_fn not found in settings.js"
sjs = sjs.replace(old_play_fn, new_play_fn, 1)
sjs = sjs.replace(
    "$('play').onclick=playAnimation;$('hero-pet').onclick=playAnimation;",
    "$('animation').onchange=()=>{update({clickAction:$('animation').value});playAnimation();};$('play').onclick=playAnimation;$('hero-pet').onclick=playAnimation;",
    1
)
set_txt(("app", "renderer", "settings.js"), sjs)

# --- 6. Patch app/renderer/sprite.js ---
sp = get_txt(("app", "renderer", "sprite.js"))
old_delay = "delay(behaviour = 'calm') { return behaviour === 'playful' ? 15000 + this.random() * 25000 : 45000 + this.random() * 75000; }"
new_delay = "delay(behaviour = 'calm') { return behaviour === 'playful' ? 4000 + this.random() * 4000 : 10000 + this.random() * 8000; }"
assert old_delay in sp, "old_delay not found in sprite.js"
sp = sp.replace(old_delay, new_delay, 1)
old_weights = "const weights = {waving:4, review:4, waiting:3, running:2, jumping:behaviour==='playful'?3:1, failed:.5, 'running-left':1, 'running-right':1};"
new_weights = "const weights = {waving:2, review:2.5, waiting:2.5, running:2.5, jumping:2.2, failed:1.5, 'running-left':2, 'running-right':2};"
assert old_weights in sp, "old_weights not found in sprite.js"
sp = sp.replace(old_weights, new_weights, 1)
old_cycles = "const cycles = behaviour==='playful' ? 1 + Math.floor(this.random() * 2) : 1;"
new_cycles = "const cycles = ['waving','jumping','review','waiting','running'].includes(name) ? 2 : 1;"
assert old_cycles in sp, "old_cycles not found in sprite.js"
sp = sp.replace(old_cycles, new_cycles, 1)
old_tick_draw = "else if(this.image)ctx.drawImage(this.image,pose.frame*192,pose.row*208,192,208,0,0,192,208);"
new_tick_draw = "else if(this.image){const s=this.image.naturalWidth===3072?2:1;ctx.drawImage(this.image,pose.frame*192*s,pose.row*208*s,192*s,208*s,0,0,192,208);}"
assert old_tick_draw in sp, "old_tick_draw not found in sprite.js"
sp = sp.replace(old_tick_draw, new_tick_draw, 1)
set_txt(("app", "renderer", "sprite.js"), sp)

# --- Repack ASAR cleanly ---
new_payload_parts = []
current_offset = 0
BLOCK_SIZE = 4 * 1024 * 1024

def walk_repack(node, prefix=()):
    global current_offset
    if "files" in node:
        for k, v in node["files"].items():
            walk_repack(v, prefix + (k,))
    elif "offset" in node and not node.get("unpacked", False):
        data = file_blobs[prefix]
        sz = len(data)
        node["offset"] = str(current_offset)
        node["size"] = sz
        if "integrity" in node:
            full_sha = hashlib.sha256(data).hexdigest()
            blocks = [
                hashlib.sha256(data[i:i+BLOCK_SIZE]).hexdigest()
                for i in range(0, max(1, sz), BLOCK_SIZE)
            ]
            node["integrity"]["hash"] = full_sha
            node["integrity"]["blocks"] = blocks
        new_payload_parts.append(data)
        current_offset += sz

walk_repack(hdr)

new_hdr_json = json.dumps(hdr, separators=(",", ":")).encode("utf-8")
str_len = len(new_hdr_json)
str_padded_len = (str_len + 3) & ~3
padding = b"\x00" * (str_padded_len - str_len)
header_payload_size = 4 + str_padded_len
outer_pickle_payload_size = 4 + header_payload_size
asar_header = struct.pack("<IIII", 4, outer_pickle_payload_size, header_payload_size, str_len) + new_hdr_json + padding

out_asar_bytes = asar_header + b"".join(new_payload_parts)
(portable / "resources" / "app.asar").write_bytes(out_asar_bytes)

new_hdr_sha = hashlib.sha256(new_hdr_json).hexdigest().encode("ascii")
exe_new = exe_orig.replace(old_hdr_sha, new_hdr_sha)
(portable / "Petex.exe").write_bytes(exe_new)
print("Repacked app.asar cleanly! New size:", len(out_asar_bytes), "New hdr SHA256:", new_hdr_sha.decode())
