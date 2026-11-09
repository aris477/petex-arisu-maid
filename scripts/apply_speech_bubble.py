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

# 1. Update app/preload.cjs
preload_js = '''const {contextBridge, ipcRenderer, webUtils} = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const subscribe = (channel, callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('pedex', {
  getState: () => invoke('state:get'),
  updateSettings: patch => invoke('settings:update', patch),
  importPet: kind => invoke('pets:import-dialog', kind),
  importDropped: files => invoke('pets:import-dropped', Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  importBuiltins: () => invoke('pets:import-builtins'),
  discoverPets: () => invoke('pets:discover'),
  removePet: id => invoke('pets:remove', id),
  exportPets: kind => invoke('pets:export', kind),
  home: () => invoke('pet:home'),
  playAnimation: name => invoke('pet:play', name),
  openRepository: () => invoke('repository:open'),
  openPetsFolder: () => invoke('pets:open-folder'),
  closeSettings: () => invoke('settings:close'),
  menu: () => invoke('pet:menu'),
  pressStart: () => invoke('pet:press-start'),
  pressEnd: () => invoke('pet:press-end'),
  hit: value => invoke('pet:hit', value),
  wander: (name, duration) => invoke('pet:wander', name, duration),
  stroke: () => invoke('pet:stroke'),
  addCompanion: id => invoke('companions:add',id),
  removeCompanion: id => invoke('companions:remove',id),
  updateCompanion: (id,patch) => invoke('companions:update',id,patch),
  interact: () => invoke('pets:interact'),
  throwBall: () => invoke('toy:show'),
  toyPress: pressed => invoke('toy:press',pressed),
  chooseArea: () => invoke('area:open'),
  saveArea: area => invoke('area:save',area),
  closeArea: () => invoke('area:close'),
  saveLayout: name => invoke('layouts:save',name),
  restoreLayout: id => invoke('layouts:restore',id),
  removeLayout: id => invoke('layouts:remove',id),
  onState: callback => subscribe('state:changed', callback),
  onCursor: callback => subscribe('pet:cursor', callback),
  onAction: callback => subscribe('pet:action', callback),
  onSpeech: callback => subscribe('pet:speech', callback),
  onStroke: callback => subscribe('pet:stroke',callback),
  onSocialStart: callback => subscribe('pet:social-start',callback),
  onSocialEnd: callback => subscribe('pet:social-end',callback),
});
'''
set_txt(("app", "preload.cjs"), preload_js)

# 2. Update app/desktop.cjs: reserve top space for speech bubble + add speech() method
desk = get_txt(("app", "desktop.cjs"))
for old_w, old_h in [("config.size+32", "Math.ceil(config.size*208/192)+32"), ("Math.max(config.size+48,268)", "Math.ceil(config.size*208/192)+116")]:
    desk = desk.replace(f"width={old_w},height={old_h}", "width=Math.max(config.size+72,304),height=Math.ceil(config.size*208/192)+180")
    desk = desk.replace(f"Math.max({old_w},Math.round(work.width*r.width))", "Math.max(Math.max(config.size+72,304),Math.round(work.width*r.width))")
    desk = desk.replace(f"Math.max({old_h},Math.round(work.height*r.height))", "Math.max(Math.ceil(config.size*208/192)+180,Math.round(work.height*r.height))")
for old_cw, old_ch in [("cfg.size+32", "Math.ceil(cfg.size*208/192)+32"), ("Math.max(cfg.size+48,268)", "Math.ceil(cfg.size*208/192)+116")]:
    desk = desk.replace(f"winW={old_cw},winH={old_ch}", "winW=Math.max(cfg.size+72,304),winH=Math.ceil(cfg.size*208/192)+180")

if "speech(p,payload)" not in desk:
    old_act_method = "  action(p,name,coordinated=false,duration) {\n    if(!p||!this.active(p)||!this.config(p).motion||p.drag)return;\n    if(!coordinated){this.cancelSocial();p.walking=null;}\n    p.busyUntil=performance.now()+(duration||3600);p.activity=name;p.win.webContents.send('pet:action',duration?{name,duration}:name);this.schedule();\n  }"
    new_act_method = old_act_method + "\n  speech(p,payload) {\n    const target=p||this.primary;\n    if(!target||!this.active(target))return;\n    if(payload?.action&&!target.drag&&this.config(target).motion){\n      this.cancelSocial();target.walking=null;\n      target.busyUntil=performance.now()+(payload.actionDuration||3600);\n      target.activity=payload.action;\n      target.win.webContents.send('pet:action',{name:payload.action,duration:payload.actionDuration,silent:true});\n      this.schedule();\n    }\n    target.win.webContents.send('pet:speech',payload);\n  }"
    assert old_act_method in desk, "old_act_method not found in desktop.cjs"
    desk = desk.replace(old_act_method, new_act_method, 1)
desk = desk.replace(
    "if(!this.getState().settings.features.petting||now-p.lastPetting<8000||p.drag||!this.active(p)||!this.config(p).motion)return false;",
    "if(now-p.lastPetting<2500||p.drag||!this.active(p)||!this.config(p).motion)return false;"
)
set_txt(("app", "desktop.cjs"), desk)

# 3. Update app/renderer/pet.html: Arisu game-console + accurate 4-rect Halo + cute blue hearts
pet_html = '''<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' pet-asset: data:; connect-src 'none'; object-src 'none'; base-uri 'none'"><title>Petex pet</title><link rel="stylesheet" href="pet.css"></head><body>
<div id="speech-bubble" class="speech-bubble" role="status" aria-live="polite" hidden>
  <!-- Top-left tilted handheld game console -->
  <svg class="console-deco" viewBox="0 0 64 34" aria-hidden="true">
    <rect x="2" y="3" width="60" height="28" rx="8" fill="#ffffff" stroke="#4a5f78" stroke-width="2"/>
    <rect x="5" y="6" width="54" height="22" rx="6" fill="#233954"/>
    <rect x="17" y="8" width="30" height="18" rx="2.5" fill="#5ce1e6" stroke="#152538" stroke-width="1.2"/>
    <path d="M20 10 L28 10 L23 24 L18 24 Z" fill="rgba(255,255,255,0.45)"/>
    <path d="M10.5 13.5 v5 M8 16 h5" stroke="#7dd3fc" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="10.5" cy="22.5" r="1.6" fill="#94a3b8"/>
    <circle cx="52" cy="13.5" r="1.5" fill="#38bdf8"/>
    <circle cx="55" cy="16.5" r="1.5" fill="#f472b6"/>
    <circle cx="49" cy="16.5" r="1.5" fill="#4ade80"/>
    <circle cx="52" cy="19.5" r="1.5" fill="#facc15"/>
  </svg>
  <!-- Top-right floating Arisu 4-rect Halo + cute blue hearts + pixel sparkle -->
  <svg class="hearts-deco" viewBox="0 0 88 44" aria-hidden="true">
    <defs>
      <linearGradient id="heartBlue1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#60a5fa"/>
        <stop offset="100%" stop-color="#38bdf8"/>
      </linearGradient>
      <linearGradient id="heartBlue2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#93c5fd"/>
        <stop offset="100%" stop-color="#bae6fd"/>
      </linearGradient>
      <linearGradient id="arisuHaloGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7efce6"/>
        <stop offset="100%" stop-color="#cffef4"/>
      </linearGradient>
    </defs>
    <!-- Floating tilted Arisu 4-rectangle Halo ornament -->
    <g transform="translate(2, 1) scale(0.38) rotate(-10 50 50)">
      <path fill-rule="evenodd" d="M23 56 H55 V88 H23 Z M27.5 60.5 V83.5 H50.5 V60.5 Z" fill="url(#arisuHaloGrad)" stroke="#4bc4b0" stroke-width="2.2"/>
      <path fill-rule="evenodd" d="M11 14 H65 V68 H11 Z M18 21 V61 H58 V21 Z" fill="url(#arisuHaloGrad)" stroke="#4bc4b0" stroke-width="2.2"/>
      <rect x="38" y="19" width="14" height="4.8" fill="url(#arisuHaloGrad)" stroke="#4bc4b0" stroke-width="1.8"/>
      <path fill-rule="evenodd" d="M46 31 H90 V75 H46 Z M51.5 36.5 V69.5 H84.5 V36.5 Z" fill="url(#arisuHaloGrad)" stroke="#4bc4b0" stroke-width="2.2"/>
      <path fill-rule="evenodd" d="M69 16 H86.5 V27 H69 Z M73.2 19.2 V23.8 H82.3 V19.2 Z" fill="url(#arisuHaloGrad)" stroke="#4bc4b0" stroke-width="2.0"/>
    </g>
    <!-- Small pastel blue heart -->
    <g transform="translate(38, 14) rotate(-15)">
      <path d="M8 3.5 C8 1.5 6.2 0 4.2 0 C2.7 0 1.4 0.9 0.8 2.1 C0.2 0.9 -1.1 0 -2.6 0 C-4.6 0 -6.4 1.5 -6.4 3.5 C-6.4 6.8 0.8 10.6 0.8 10.6 C0.8 10.6 8 6.8 8 3.5 Z" transform="translate(7,2) scale(0.95)" fill="url(#heartBlue2)" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
    </g>
    <!-- Main glossy sky-blue heart -->
    <g transform="translate(54, 5) rotate(14)">
      <path d="M11 4.8 C11 2 8.6 0 5.8 0 C3.7 0 1.9 1.2 1.1 2.9 C0.3 1.2 -1.5 0 -3.6 0 C-6.4 0 -8.8 2 -8.8 4.8 C-8.8 9.3 1.1 14.5 1.1 14.5 C1.1 14.5 11 9.3 11 4.8 Z" transform="translate(10,2)" fill="url(#heartBlue1)" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      <ellipse cx="6.2" cy="5.5" rx="2.1" ry="1.2" transform="rotate(-25 6.2 5.5)" fill="rgba(255,255,255,0.78)"/>
    </g>
    <!-- Four-point pixel sparkle -->
    <path d="M79 20 L80.4 23.6 L84 25 L80.4 26.4 L79 30 L77.6 26.4 L74 25 L77.6 23.6 Z" fill="#38bdf8" stroke="#ffffff" stroke-width="0.9"/>
  </svg>
  <!-- Bottom-right tilted White Maid Headband traced directly from Arisu's T2 Maid Headband artwork -->
  <svg class="maid-headband-deco" viewBox="42 58 302 292" aria-hidden="true">
    <g stroke-linejoin="round" stroke-linecap="round">
      <!-- 1. Continuous outer white trim band (obtuse pentagon-like lobes, NO internal dividing lines) -->
      <path d="M 85 298
               L 66 266 L 56 240 L 68 212
               L 52 184 L 60 162 L 82 152
               L 89 110 L 118 102 L 138 103
               L 171 68 L 206 78 L 219 89
               L 253 79 L 276 98 L 282 111
               L 312 121 L 317 154 L 316 165
               L 333 182 L 335 216 L 327 224
               L 329 250 L 312 260
               L 296 254
               C 305 182, 255 128, 195 128
               C 135 128, 92 188, 108 292 Z"
            fill="#ffffff" stroke="#8e96a8" stroke-width="4.5"/>
      <!-- 2. Inner frill body with thick dark slate contour line parallel to the outer obtuse peaks -->
      <path d="M 98 294
               L 77 262 L 68 239 L 79 214
               L 63 184 L 71 165 L 92 156
               L 99 118 L 125 111 L 144 111
               L 173 79 L 203 88 L 216 98
               L 249 89 L 270 106 L 276 118
               L 304 128 L 308 157 L 308 169
               L 324 185 L 326 214 L 318 224
               L 320 246 L 303 255
               L 292 248
               C 300 180, 252 128, 195 128
               C 138 128, 96 186, 111 290 Z"
            fill="#ffffff" stroke="#2f3545" stroke-width="6"/>
      <!-- 3. Soft lavender-gray pleat shading inside the frill (no hard dividing lines) -->
      <path d="M 102 290 C 90 245, 92 195, 118 162 L 92 156 L 71 165 L 63 184 L 79 214 L 68 239 L 77 262 L 98 294 Z" fill="#e2e4f4" opacity="0.85"/>
      <path d="M 188 126 L 195 96 L 208 127 Z" fill="#dfe2f2" opacity="0.85"/>
      <path d="M 214 130 L 222 104 L 236 134 Z" fill="#dfe2f2" opacity="0.85"/>
      <path d="M 275 162 L 305 168 L 321 186 L 323 213 L 315 224 L 317 245 L 298 253 C 302 215, 292 182, 275 162 Z" fill="#e2e4f4" opacity="0.85"/>
      <!-- Re-stroke the inner dark contour cleanly on top of the soft shading -->
      <path d="M 98 294
               L 77 262 L 68 239 L 79 214
               L 63 184 L 71 165 L 92 156
               L 99 118 L 125 111 L 144 111
               L 173 79 L 203 88 L 216 98
               L 249 89 L 270 106 L 276 118
               L 304 128 L 308 157 L 308 169
               L 324 185 L 326 214 L 318 224
               L 320 246 L 303 255"
            fill="none" stroke="#2f3545" stroke-width="6"/>
      <!-- 4. Thick black/charcoal inner headband arch -->
      <path d="M 178 342
               C 138 320, 96 278, 96 225
               C 96 156, 146 115, 202 115
               C 258 115, 304 158, 304 222
               C 304 256, 295 288, 286 312
               L 273 308
               C 282 284, 289 254, 289 222
               C 289 168, 249 131, 202 131
               C 154 131, 114 168, 114 225
               C 114 270, 149 309, 186 330 Z"
            fill="#1f2430" stroke="#12151e" stroke-width="4.5"/>
      <!-- 5. Left & right small black ribbon bows -->
      <path d="M 122 296 L 94 300 C 88 304, 88 314, 96 317 L 120 307 L 106 338 L 120 342 L 128 310 Z"
            fill="#1f2430" stroke="#12151e" stroke-width="3.5"/>
      <path d="M 298 242 L 326 240 L 328 252 L 301 252 L 330 278 L 325 288 L 296 258 Z"
            fill="#1f2430" stroke="#12151e" stroke-width="3.5"/>
    </g>
  </svg>
  <span class="hud-corner hud-tl" aria-hidden="true"></span>
  <span class="hud-corner hud-bl" aria-hidden="true"></span>
  <span class="hud-corner hud-tr" aria-hidden="true"></span>
  <!-- Floating tilted status sticker ONLY shown on special events (Task Done / Petting / Task Start) -->
  <div id="speech-tag" class="speech-tag" hidden>
    <span id="speech-badge-text"></span>
    <span id="speech-meta" class="speech-meta" hidden></span>
  </div>
  <div id="speech-text" class="speech-text"></div>
</div>
<canvas id="pet" aria-label="Desktop pet. Drag to move, click to wave, hold to jump, right-click for settings."></canvas>
<script src="../locales.js"></script><script type="module" src="pet.js"></script></body></html>
'''
set_txt(("app", "renderer", "pet.html"), pet_html)

# 4. Update app/renderer/pet.css: Reference-matched sky-blue gradient + game console + blue hearts + accurate Halo
pet_css = '''*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent!important;user-select:none}
body{padding:164px 24px 16px 24px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative}
canvas{width:100%;height:100%;object-fit:contain;flex:0 0 auto;display:block;cursor:grab;touch-action:none}
canvas:active{cursor:grabbing}
.petted{animation:petting .7s ease-in-out}
@keyframes petting{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-4px) rotate(-3deg)}65%{transform:translateY(-2px) rotate(3deg)}}

.speech-bubble{
  position:absolute;
  left:50%;
  bottom:calc(var(--pet-h, 248px) + 14px);
  transform:translateX(-50%) translateY(0) scale(1);
  transform-origin:50% 100%;
  width:max-content;
  max-width:calc(100vw - 28px);
  min-width:162px;
  padding:11px 22px 11px 18px;
  border-radius:16px;
  background:linear-gradient(180deg,#d8f3ff 0%,#eefbff 46%,#f7fdff 53%,#d4f1ff 100%);
  border:1.6px solid #576b82;
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.88),0 6px 16px rgba(27,59,98,0.18);
  color:#2b3847;
  font-family:"Microsoft YaHei UI","PingFang SC","Segoe UI",system-ui,sans-serif;
  font-size:12.5px;
  line-height:1.45;
  pointer-events:none;
  z-index:20;
  opacity:1;
  transition:opacity .22s ease,transform .24s cubic-bezier(.22,1.28,.36,1);
}
.speech-bubble[hidden]{display:none!important}
.speech-bubble.is-entering{opacity:0;transform:translateX(-50%) translateY(8px) scale(.92)}
.speech-bubble.is-leaving{opacity:0;transform:translateX(-50%) translateY(5px) scale(.95)}

/* Tilted handheld game console on top-left corner (matching reference image) */
.console-deco{
  position:absolute;
  top:-12px;
  left:-10px;
  width:38px;
  height:20px;
  transform:rotate(-28deg);
  filter:drop-shadow(0 2px 3px rgba(23,43,77,0.25));
  z-index:3;
}

/* Top-right floating Arisu Halo + glossy blue hearts & sparkle */
.hearts-deco{
  position:absolute;
  top:-16px;
  right:4px;
  width:68px;
  height:34px;
  filter:drop-shadow(0 2px 4px rgba(56,189,248,0.28));
  z-index:3;
  pointer-events:none;
}

/* Bottom-right slightly tilted White Maid Headband (Arisu T2 item) */
.maid-headband-deco{
  position:absolute;
  bottom:-14px;
  right:0px;
  width:40px;
  height:38px;
  transform:rotate(28deg);
  filter:drop-shadow(0 2px 3px rgba(27,59,98,0.24));
  z-index:3;
  pointer-events:none;
}

/* Inner HUD tech brackets matching reference image */
.hud-corner{
  position:absolute;
  pointer-events:none;
  border-color:#5b7088;
  border-style:solid;
  opacity:.78;
}
.hud-tl{
  top:6px;left:5px;width:9px;height:14px;
  border-width:1.4px 0 0 1.4px;
  border-top-left-radius:6px;
}
.hud-bl{
  bottom:5px;left:5px;width:16px;height:11px;
  border-width:0 0 1.4px 1.4px;
  border-bottom-left-radius:7px;
}
.hud-tr{
  top:5px;right:5px;width:14px;height:12px;
  border-width:1.4px 1.4px 0 0;
  border-top-right-radius:7px;
}

/* Speech bubble downward pointer tail */
.speech-bubble::after{
  content:"";
  position:absolute;
  left:50%;
  bottom:-7px;
  width:11px;
  height:11px;
  background:#d4f1ff;
  border-right:1.6px solid #576b82;
  border-bottom:1.6px solid #576b82;
  transform:translateX(-50%) rotate(45deg);
}

/* Task complete variant: Starry Blue Archive Sky-Blue & Royal-Cyan (no green!) */
.speech-bubble.is-task-done{
  background:linear-gradient(180deg,#c7ecff 0%,#eaf8ff 46%,#f8fdff 54%,#bae6ff 100%);
  border-color:#2563eb;
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.95),0 0 14px rgba(56,189,248,0.42),0 7px 20px rgba(37,99,235,0.22);
}
.speech-bubble.is-task-done::after{
  background:#bae6ff;
  border-right-color:#2563eb;
  border-bottom-color:#2563eb;
}
.speech-bubble.is-task-done .hud-corner{
  border-color:#3b82f6;
}

/* Task warning variant: soft ice-lavender-blue so it stays in Arisu's palette */
.speech-bubble.is-task-warn{
  background:linear-gradient(180deg,#e0e7ff 0%,#f5f7ff 48%,#dbeafe 100%);
  border-color:#4f46e5;
}
.speech-bubble.is-task-warn::after{
  background:#dbeafe;
  border-right-color:#4f46e5;
  border-bottom-color:#4f46e5;
}

/* Floating tilted corner sticker tag ONLY for special events (no stiff header bar inside bubble!) */
.speech-tag{
  position:absolute;
  top:-12px;
  left:30px;
  transform:rotate(-3.5deg);
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:1.5px 8px;
  border-radius:999px;
  font-size:10.5px;
  font-weight:700;
  color:#ffffff;
  background:linear-gradient(90deg,#2563eb,#0ea5e9);
  border:1.4px solid #ffffff;
  box-shadow:0 2px 6px rgba(37,99,235,0.28);
  z-index:4;
  pointer-events:none;
}
.speech-tag[hidden]{display:none!important}
.speech-meta{
  font-size:9.5px;
  font-weight:700;
  color:#e0f2fe;
  padding-left:4px;
  border-left:1px solid rgba(255,255,255,0.45);
}
.speech-meta[hidden]{display:none!important}
.speech-text{
  position:relative;
  z-index:2;
  font-weight:600;
  color:#2b3847;
  word-break:break-word;
  white-space:normal;
  display:-webkit-box;
  -webkit-line-clamp:3;
  -webkit-box-orient:vertical;
  overflow:hidden;
}
'''
set_txt(("app", "renderer", "pet.css"), pet_css)

# 5. Update app/renderer/pet.js
pet_js = '''import {PetSprite, ANIMATIONS, RandomAnimations} from './sprite.js';
const api=window.pedex,canvas=document.getElementById('pet'),sprite=new PetSprite(canvas);
const bubbleEl=document.getElementById('speech-bubble'),tagEl=document.getElementById('speech-tag'),badgeEl=document.getElementById('speech-badge-text'),metaEl=document.getElementById('speech-meta'),textEl=document.getElementById('speech-text');
const randomAnimations=new RandomAnimations();
const HOLD_MS=550,DRAG_THRESHOLD=6;
let settings,selectedPet,active=false,down=null,dragging=false,lastHit=null,actionUntil=0,holdTimer=null,behaviourTimer=null,socialUntil=0,strokes=[],lastStroke=null,strokeDirection=0;
let bubbleTimer=null,bubbleHideTimer=null,lastLine='',welcomed=false;

const ARISU_LINES={
  waving:[
    '“邦邦咔邦～！女仆爱丽丝，随时听候老师差遣！”',
    '“欢迎回来，老师！今天也要一起攻略主线任务吗？”',
    '“爱丽丝已经充好电了！好感度与干劲都是 MAX！”',
    '“老师老师！女仆装爱丽丝的支援技能已经准备就绪啦！”'
  ],
  jumping:[
    '“邦邦咔邦！发现稀有宝箱！会开出什么传奇装备呢？”',
    '“升级啦！爱丽丝的敏捷度与幸运值提升了 10 点！”',
    '“太好啦！和老师组队的时候，暴击率是 100% 哦！”',
    '“耶～！今日份的委托奖励是美味的布丁吗？”'
  ],
  review:[
    '“雷达扫描中……前方区域没有发现 Bug 怪兽！”',
    '“唔……这里的代码迷宫，爱丽丝正在仔细侦察！”',
    '“发现隐藏支线线索！老师，要一起过去看看吗？”',
    '“女仆侦察模式启动！一切细节都逃不过爱丽丝的眼睛～”'
  ],
  waiting:[
    '“待机模式启动……爱丽丝会乖乖守在老师身边的。”',
    '“正在恢复 MP……老师工作累了也要记得喝口水哦！”',
    '“女仆值班时间！有任何需要随时呼唤爱丽丝～”',
    '“存档点休息中……随时准备迎接下一场挑战！”'
  ],
  running:[
    '“光之剑充能中……正在全力帮老师清理杂兵！”',
    '“哒哒哒！女仆大扫除技能发动，报错统统消失吧！”',
    '“正在高速处理委托……爱丽丝干劲十足！”',
    '“全速推进主线进度！请老师拭目以待～！”'
  ],
  failed:[
    '“呜呜……不小心踩到陷阱掉血了，需要老师的治疗术……”',
    '“HP 告急……不过只要老师摸摸头，爱丽丝就能满血复活！”',
    '“唔，刚才的蓄力好像 Miss 了……下次一定会暴击的！”',
    '“女仆修行还不够熟练……爱丽丝会继续努力的！”'
  ],
  'running-left':[
    '“女仆爱丽丝，正在桌面左侧区域巡逻中～！”',
    '“向着下一个存档点前进！出发～！”'
  ],
  'running-right':[
    '“女仆爱丽丝，正在桌面右侧区域巡逻中～！”',
    '“发现新的地图区域！爱丽丝去探探路～”'
  ],
  stroke:[
    '“嘿嘿，被老师摸头了！幸福感经验槽蓄满啦～♪”',
    '“邦邦咔邦！获得老师的鼓励 Buff，全属性大幅提升！”',
    '“呜哇～好温暖！爱丽丝最喜欢和老师一起做任务了！”'
  ]
};

function pickLine(kind='waving'){
  const pool=ARISU_LINES[kind]||ARISU_LINES.waving;
  const candidates=pool.length>1?pool.filter(item=>item!==lastLine):pool;
  const chosen=candidates[Math.floor(Math.random()*candidates.length)];
  lastLine=chosen;
  return chosen;
}

function showSpeech(opts={}){
  if(!bubbleEl)return;
  const rawText=typeof opts==='string'?opts:(opts.text||pickLine(opts.action||'waving'));
  const text=rawText.replace(/[“”]/g,'');
  const rawBadge=(opts.badge||'').replace(/^✦\\s*/,'').trim();
  const showTag=Boolean(opts.kind==='done'||opts.kind==='warn'||opts.kind==='info'||(rawBadge&&rawBadge!=='天童爱丽丝'&&rawBadge!=='爱丽丝'));
  const badge=showTag?(rawBadge||(opts.kind==='done'?'任务完成 💙':opts.kind==='warn'?'任务提示':'收到委托')):'';
  const meta=opts.meta||'';
  const duration=opts.duration||(opts.kind==='done'?7500:4200);
  clearTimeout(bubbleTimer);clearTimeout(bubbleHideTimer);
  if(tagEl){
    if(showTag){
      tagEl.hidden=false;
      if(badgeEl)badgeEl.textContent=badge;
      if(meta){metaEl.textContent=meta;metaEl.hidden=false;}else{metaEl.textContent='';metaEl.hidden=true;}
    }else{
      tagEl.hidden=true;
    }
  }
  textEl.textContent=text;
  bubbleEl.classList.remove('is-task-done','is-task-warn','is-leaving');
  if(opts.kind==='done')bubbleEl.classList.add('is-task-done');
  else if(opts.kind==='warn')bubbleEl.classList.add('is-task-warn');
  bubbleEl.hidden=false;
  bubbleEl.classList.add('is-entering');
  requestAnimationFrame(()=>{requestAnimationFrame(()=>{bubbleEl.classList.remove('is-entering');});});
  bubbleTimer=setTimeout(()=>{
    bubbleEl.classList.add('is-leaving');
    bubbleHideTimer=setTimeout(()=>{bubbleEl.hidden=true;bubbleEl.classList.remove('is-leaving');},240);
  },duration);
}

function cancelHold(){clearTimeout(holdTimer);holdTimer=null;}
function plan() {
  clearTimeout(behaviourTimer);behaviourTimer=null;
  if(!settings||!active||!settings.motion||down)return;
  const now=performance.now();
  if(now<socialUntil){behaviourTimer=setTimeout(plan,Math.max(1,socialUntil-now));return;}
  if(now<actionUntil){behaviourTimer=setTimeout(plan,Math.max(1,actionUntil-now));return;}
  if(sprite.state!=='idle'){sprite.action('idle');actionUntil=0;}
  const next=randomAnimations.next(selectedPet,now,settings.randomAnimations,false,settings.behaviour);
  if(next){
    sprite.action(next.name);sprite.gaze=null;actionUntil=now+next.duration;
    if(next.name.startsWith('running-'))api.wander(next.name,next.duration).catch(()=>{});
  }
  const deadline=next?actionUntil:randomAnimations.nextAt;
  if(deadline!==null)behaviourTimer=setTimeout(plan,Math.max(1,deadline-now));
}
function resetBehaviour(){randomAnimations.reset();plan();}
function action(value,fromPress=false,withBubble=true){
  const name=typeof value==='string'?value:value?.name;
  const silent=typeof value==='object'&&value?.silent;
  if(!settings?.motion||!active||!ANIMATIONS[name]||dragging||(down&&!fromPress))return;
  sprite.action(name);sprite.gaze=null;
  actionUntil=performance.now()+(value?.duration||ANIMATIONS[name].durations.reduce((a,b)=>a+b,0)*(ANIMATIONS[name].cycles||2));
  if(withBubble&&!silent){
    showSpeech({badge:'✦ 爱丽丝',text:pickLine(name),duration:4200});
  }
  resetBehaviour();
}
function render(state){
  document.documentElement.lang=state.locale;canvas.setAttribute('aria-label',globalThis.PetexI18n.translate(state.locale,'petInstructions'));
  const next=state.settings,pet=state.pets.find(p=>p.id===next.petId)||state.pets[0];
  const changed=pet.id!==selectedPet?.id||next.motion!==settings?.motion||state.petActive!==active||next.randomAnimations!==settings?.randomAnimations||next.behaviour!==settings?.behaviour;
  if(down&&(!state.petActive||pet.id!==selectedPet?.id))finishPointer(null,true);
  settings=next;selectedPet=pet;active=state.petActive;
  if(next?.size){
    const h=Math.ceil(next.size*208/192);
    canvas.style.width=next.size+'px';
    canvas.style.height=h+'px';
    document.documentElement.style.setProperty('--pet-h',h+'px');
  }
  sprite.active=active;sprite.motion=settings.motion;
  sprite.setPet(pet).catch(()=>sprite.setPet(state.pets[0]));
  if(changed){actionUntil=0;sprite.action('idle');resetBehaviour();}
  if(active&&!welcomed){
    welcomed=true;
    setTimeout(()=>showSpeech({badge:'✦ 爱丽丝',text:'“邦邦咔邦～！女仆爱丽丝已就位，点击我可以对话，任务完成也会第一时间提醒老师哦！”',duration:5200}),450);
  }
}
api.onState(render);api.getState().then(render);
api.onAction(value=>action(value));
api.onSpeech(payload=>showSpeech(payload));
api.onStroke(()=>{
  canvas.classList.remove('petted');void canvas.offsetWidth;canvas.classList.add('petted');
  showSpeech({badge:'✦ 好感度 UP',text:pickLine('stroke'),duration:4200});
});
canvas.addEventListener('animationend',()=>canvas.classList.remove('petted'));
api.onSocialStart(duration=>{socialUntil=performance.now()+duration;clearTimeout(behaviourTimer);behaviourTimer=setTimeout(plan,duration);});
api.onSocialEnd(()=>{socialUntil=0;sprite.gaze=null;resetBehaviour();});
api.onCursor(cursor=>{
  if(!settings||!active)return;
  const rect=canvas.getBoundingClientRect(),x=cursor.x-rect.x,y=cursor.y-rect.y;
  const isDragging=cursor.dragging&&!!down;
  if(isDragging){
    dragging=true;down.moved=true;cancelHold();actionUntil=0;
    const state=cursor.direction||'idle';
    if(sprite.state!==state)sprite.action(state);
  }
  const gx=x-rect.width/2,gy=y-rect.height*.45;
  sprite.gaze=isDragging?cursor.dragGaze:cursor.socialGaze&&!cursor.walking?cursor.socialGaze:!cursor.walking&&settings.followCursor&&settings.motion&&Math.hypot(gx,gy)>35&&Math.hypot(gx,gy)<1100?{x:gx,y:gy}:null;
  let hit=false;
  if(x>=0&&y>=0&&x<rect.width&&y<rect.height){try{hit=sprite.ctx.getImageData(Math.floor(x/rect.width*384),Math.floor(y/rect.height*416),1,1).data[3]>30;}catch{hit=true;}}
  if(hit!==lastHit&&!down){lastHit=hit;api.hit(hit).catch(()=>{});}
});
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||down)return;
  down={x:event.screenX,y:event.screenY,id:event.pointerId,moved:false,longPressed:false};
  canvas.setPointerCapture(event.pointerId);clearTimeout(behaviourTimer);actionUntil=0;sprite.action('idle');
  api.pressStart().catch(()=>finishPointer(null,true));cancelHold();
  holdTimer=setTimeout(()=>{if(!down||down.moved||dragging)return;down.longPressed=true;action('jumping',true,true);},HOLD_MS);
});
canvas.addEventListener('pointermove',event=>{if(down&&Math.hypot(event.screenX-down.x,event.screenY-down.y)>=DRAG_THRESHOLD){down.moved=true;cancelHold();}});
canvas.addEventListener('pointermove',event=>{
  if(!settings?.motion||event.buttons||down){lastStroke=null;strokes=[];return;}
  const rect=canvas.getBoundingClientRect(),relY=(event.clientY-rect.top)/Math.max(1,rect.height);
  const inHeadZone=relY>=0.04&&relY<=0.58;
  if(!event.shiftKey&&!inHeadZone){lastStroke=null;strokes=[];return;}
  const now=performance.now();
  if(lastStroke!==null&&Math.abs(event.clientX-lastStroke)>4){const direction=Math.sign(event.clientX-lastStroke);if(direction!==strokeDirection){strokes.push(now);strokeDirection=direction;}strokes=strokes.filter(at=>now-at<1500);if(strokes.length>=3){api.stroke().catch(()=>{});strokes=[];}}
  lastStroke=event.clientX;
});
function finishPointer(event,cancelled=false){
  if(!down)return;
  const press=down,moved=dragging||press.moved;down=null;dragging=false;cancelHold();
  if(canvas.hasPointerCapture(press.id))canvas.releasePointerCapture(press.id);
  api.pressEnd().catch(()=>{});lastHit=null;
  if(moved||cancelled){sprite.action('idle');sprite.gaze=null;actionUntil=0;resetBehaviour();}
  else if(!press.longPressed){const ca=settings?.clickAction||'waving';const pool=['waving','jumping','review','waiting','running','failed'];const chosen=ca==='random'?pool[Math.floor(Math.random()*pool.length)]:ca;action(chosen,false,true);}else plan();
}
canvas.addEventListener('pointerup',event=>finishPointer(event));
canvas.addEventListener('pointercancel',event=>finishPointer(event,true));
canvas.addEventListener('lostpointercapture',event=>finishPointer(event,true));
window.addEventListener('blur',()=>finishPointer(null,true));
canvas.addEventListener('contextmenu',event=>{event.preventDefault();finishPointer(null,true);api.menu();});
'''
set_txt(("app", "renderer", "pet.js"), pet_js)

# 6. Update app/main.cjs: add right-click menu items + Codex session task monitor + notify.json watcher
main_cjs = get_txt(("app", "main.cjs"))

old_menu_head = '''function petMenu(p=desktop.primary) {
  desktop.cancelSocial();p.walking=null;desktop.schedule();
  Menu.buildFromTemplate([
    {label:t('wave'),click:()=>desktop.action(p,'waving')},'''

new_menu_head = '''function triggerTaskDoneNotice(p=desktop?.primary, metaText='', summaryText='') {
  if(!desktop||!p)return;
  const doneLines=[
    '“邦邦咔邦～！老师的委托任务已经顺利完成啦！请老师验收成果～”',
    '“报告老师！当前回合任务已圆满通关，经验值 +999！”',
    '“作战大成功！女仆爱丽丝已完成全部指令，特来向老师报喜～！”',
    '“叮咚～！任务顺利完成！爱丽丝今天的表现还不错吧，老师？”'
  ];
  const baseLine=doneLines[Math.floor(Math.random()*doneLines.length)];
  const text=summaryText?`${baseLine}\n（${summaryText}）`:baseLine;
  desktop.speech(p,{kind:'done',badge:'✦ 任务完成',meta:metaText,text,action:'jumping',duration:8000});
}
function petMenu(p=desktop.primary) {
  desktop.cancelSocial();p.walking=null;desktop.schedule();
  Menu.buildFromTemplate([
    {label:'💬 随机台词气泡',click:()=>{const pool=['waving','jumping','review','waiting','running'];desktop.action(p,pool[Math.floor(Math.random()*pool.length)]);}},
    {label:'🎉 测试任务完成提示',click:()=>triggerTaskDoneNotice(p,'耗时 12s','已更新天童爱丽丝女仆发箍与多行气泡高度防截断…')},
    {type:'separator'},
    {label:t('wave'),click:()=>desktop.action(p,'waving')},'''

if "triggerTaskDoneNotice" not in main_cjs:
    assert old_menu_head in main_cjs, "old_menu_head not found in main.cjs"
    main_cjs = main_cjs.replace(old_menu_head, new_menu_head, 1)
else:
    main_cjs = main_cjs.replace("triggerTaskDoneNotice(p,'刚刚')", "triggerTaskDoneNotice(p,'耗时 12s','已更新天童爱丽丝女仆发箍与多行气泡高度防截断…')")

codex_watcher_block = '''
  // Monitor Codex session rollout JSONL files & data/notify.json for task completion alerts
  const codexHome = process.env.PEDEX_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sessionsDir = path.join(codexHome, 'sessions');
  const notifyFile = path.join(app.getPath('userData'), 'notify.json');
  const rolloutOffsets = new Map();
  const completedTurns = new Set();
  const startedTurns = new Set();
  let watcherInitialized = false;
  let lastNotifyMtime = 0;

  async function listRecentRollouts() {
    const out = [];
    try {
      const years = (await fs.readdir(sessionsDir)).filter(x => /^\\d{4}$/.test(x)).sort().slice(-2);
      for (const y of years) {
        const yPath = path.join(sessionsDir, y);
        const months = (await fs.readdir(yPath)).filter(x => /^\\d{2}$/.test(x)).sort().slice(-2);
        for (const m of months) {
          const mPath = path.join(yPath, m);
          const days = (await fs.readdir(mPath)).filter(x => /^\\d{2}$/.test(x)).sort().slice(-3);
          for (const d of days) {
            const dPath = path.join(mPath, d);
            const files = (await fs.readdir(dPath)).filter(x => x.endsWith('.jsonl'));
            for (const f of files) {
              const full = path.join(dPath, f);
              try {
                const st = await fs.stat(full);
                if (Date.now() - st.mtimeMs < 36 * 3600 * 1000) out.push({full, size: st.size, mtimeMs: st.mtimeMs});
              } catch {}
            }
          }
        }
      }
    } catch {}
    return out;
  }

  function cleanSummary(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const firstLine = raw.replace(/```[\\s\\S]*?```/g, '').replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1').replace(/[*#>`~_]/g, '').split(/\\r?\\n/).map(s => s.trim()).find(Boolean) || '';
    return firstLine.length > 34 ? firstLine.slice(0, 34) + '…' : firstLine;
  }

  async function pollCodexTasks() {
    if (quitting || !desktop) return;
    try {
      const st = await fs.stat(notifyFile).catch(() => null);
      if (st && st.mtimeMs > lastNotifyMtime) {
        const prev = lastNotifyMtime;
        lastNotifyMtime = st.mtimeMs;
        if (prev > 0) {
          const raw = await fs.readFile(notifyFile, 'utf8').catch(() => '');
          if (raw.trim()) {
            const data = JSON.parse(raw);
            desktop.speech(desktop.primary, {
              kind: data.kind || 'done',
              badge: data.badge || '✦ 任务完成',
              meta: data.meta || '',
              text: data.text || '“邦邦咔邦～！老师的委托任务已经顺利完成啦！”',
              action: data.action || 'jumping',
              duration: data.duration || 7500,
            });
          }
        }
      }
    } catch {}

    const files = await listRecentRollouts();
    if (!watcherInitialized) {
      for (const item of files) rolloutOffsets.set(item.full, item.size);
      try {
        const st = await fs.stat(notifyFile).catch(() => null);
        if (st) lastNotifyMtime = st.mtimeMs;
      } catch {}
      watcherInitialized = true;
      return;
    }

    for (const item of files) {
      const prevOff = rolloutOffsets.has(item.full) ? rolloutOffsets.get(item.full) : item.size;
      if (item.size <= prevOff) {
        rolloutOffsets.set(item.full, item.size);
        continue;
      }
      let fh;
      try {
        const readLen = Math.min(item.size - prevOff, 512 * 1024);
        const startOff = item.size - readLen;
        fh = await fs.open(item.full, 'r');
        const buf = Buffer.alloc(readLen);
        const {bytesRead} = await fh.read(buf, 0, readLen, startOff);
        const lastNl = buf.lastIndexOf(0x0a, bytesRead - 1);
        if (lastNl < 0) continue;
        rolloutOffsets.set(item.full, startOff + lastNl + 1);
        const chunk = buf.subarray(0, lastNl + 1).toString('utf8');
        for (const line of chunk.split(/\\r?\\n/)) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj?.type !== 'event_msg' || !obj.payload) continue;
          const p = obj.payload;
          const turnId = p.turn_id || p.root_turn_id || '';
          if (p.type === 'task_started' && turnId && !startedTurns.has(turnId)) {
            startedTurns.add(turnId);
            desktop.speech(desktop.primary, {
              kind: 'info',
              badge: '✦ 收到委托',
              text: '“收到新指令！女仆爱丽丝正在陪老师一起攻略任务～”',
              action: 'running',
              duration: 4000,
            });
          } else if (p.type === 'task_complete' && turnId && !completedTurns.has(turnId)) {
            completedTurns.add(turnId);
            const sec = p.duration_ms ? Math.max(1, Math.round(p.duration_ms / 1000)) : 0;
            const meta = sec ? (sec >= 60 ? `耗时 ${Math.floor(sec / 60)}m ${sec % 60}s` : `耗时 ${sec}s`) : '';
            const summary = cleanSummary(p.last_agent_message);
            triggerTaskDoneNotice(desktop.primary, meta, summary);
          } else if (p.type === 'turn_aborted' && turnId && !completedTurns.has(turnId)) {
            completedTurns.add(turnId);
            desktop.speech(desktop.primary, {
              kind: 'warn',
              badge: '✦ 任务中止',
              text: '“唔……当前回合已中止，爱丽丝随时待命准备重新出发！”',
              action: 'waiting',
              duration: 5000,
            });
          }
        }
      } catch {} finally {
        if (fh) await fh.close().catch(() => {});
      }
    }
  }
  setInterval(() => { pollCodexTasks().catch(() => {}); }, 1200);
  pollCodexTasks().catch(() => {});
'''

if "pollCodexTasks" not in main_cjs:
    anchor = "if (!process.argv.includes('--hidden') && !app.getLoginItemSettings().wasOpenedAtLogin) showSettings();"
    assert anchor in main_cjs, "anchor not found in main.cjs"
    main_cjs = main_cjs.replace(anchor, codex_watcher_block + "\n  " + anchor, 1)

set_txt(("app", "main.cjs"), main_cjs)

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
print("Speech bubble + Codex task completion alerts patched! New SHA256:", new_hdr_sha.decode())
