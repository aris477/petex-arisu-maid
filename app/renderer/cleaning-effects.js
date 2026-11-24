const STAR = new Path2D('M0 -1 Q.13 -.16 .88 0 Q.13 .16 0 1 Q-.13 .16 -.88 0 Q-.13 -.16 0 -1Z');
const HEART = new Path2D('M-.04 -.29 C-.30 -.51 -.62 -.65 -.83 -.51 C-1.16 -.34 -1.02 -.02 -.83 .20 Q-.57 .51 -.15 .78 C.13 .80 .46 .60 .67 .39 C.91 .13 1.06 -.28 .95 -.59 C.79 -1.02 .21 -1.03 -.04 -.29Z');
const HEART_GLINT = new Path2D('M-.81 -.32 Q-.72 -.43 -.62 -.32 Q-.54 -.23 -.60 -.16 Q-.64 -.12 -.71 -.17 Q-.83 -.25 -.81 -.32Z');
const HEART_START_MS = 5720;
// Two marks on the left and three on the right, with independent flicker timing.
const HEART_BUBBLES = [
  [-1.70,-.66,.19,.16,-.45,190,211,4.9],
  [-1.59,.67,.17,.21,-.60,224,204,4.4],
  [.83,-1.23,.13,.23,.46,197,222,4.8],
  [1.54,-.47,.22,.13,.38,222,208,5.7],
  [1.30,.55,.13,.20,-.36,248,200,5.2],
];

function twinkle(ctx, sourceMs, x, y, start, period, size) {
  const cycles = (sourceMs - start) / period;
  if (cycles <= 0 || cycles >= 2) return;
  const strength = Math.sin(Math.PI * (cycles % 1)) ** 1.35 * (cycles >= 1 ? .72 : 1);
  const scale = size * (.55 + .45 * strength);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = strength;
  ctx.lineWidth = 1.45 / scale;
  ctx.strokeStyle = '#d8a35e';
  ctx.fillStyle = '#fff7cf';
  ctx.stroke(STAR);
  ctx.fill(STAR);
  ctx.restore();
}

function drawHeartBubbles(ctx,elapsed) {
  if(elapsed<190||elapsed>=448)return;
  // Anchor the little pop in place while the heart continues on its own path.
  ctx.save();
  ctx.translate(270,138);
  ctx.scale(11,11);
  ctx.lineCap='round';
  for(const [x,y,rx,ry,tilt,start,duration,span] of HEART_BUBBLES){
    const age=(elapsed-start)/duration;
    if(age<=0||age>=1)continue;
    const spread=1+.14*age;
    ctx.globalAlpha=.87*Math.min(1,age/.20,(1-age)/.41);
    ctx.lineWidth=x<0?.095:.072;
    ctx.strokeStyle=x<0?'#e0b5c3':'#c492a4';
    ctx.beginPath();
    ctx.ellipse(x*spread,y*spread,rx+.04,ry+.04,tilt,-.88,-.88+span);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCleaningEffects(ctx, sourceMs) {
  // The sparkles stay in the wiped area of the screen while Arisu moves behind them.
  twinkle(ctx, sourceMs, 89, 171, 4460, 482, 12);
  twinkle(ctx, sourceMs, 111, 195, 4620, 460, 8.5);

  const elapsed = sourceMs - HEART_START_MS;
  const t = elapsed / 840;
  if (t <= 0 || t >= 1) return;
  drawHeartBubbles(ctx,elapsed);
  const drift = 1 - (1 - t) ** 2;
  const size = 6.5 + 5.3 * Math.min(1, t / .25);
  const opacity = .92 * Math.min(1, t / .19, (1 - t) / .31);
  ctx.save();
  ctx.translate(214 + 91 * drift, 149 - 29 * drift + 5 * Math.sin(Math.PI * t));
  ctx.rotate(.24 - .33 * drift);
  ctx.scale(size, size);
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1.15 / size;
  ctx.strokeStyle = '#a87387';
  ctx.fillStyle = '#db9bae';
  ctx.stroke(HEART);
  ctx.fill(HEART);
  ctx.globalAlpha=opacity*.58;
  ctx.fillStyle='#fff4f6';
  ctx.fill(HEART_GLINT);
  ctx.restore();
}
