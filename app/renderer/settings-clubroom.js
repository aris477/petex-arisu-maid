export function initClubroom(onNavigate) {
  const root=document.getElementById('arisu-clubroom');
  const colors = {o:'#26518c',b:'#398ff1',a:'#8ed3ff',w:'#ffffff',p:'#fd96ba',d:'#d366a3',y:'#ffd26a',s:'#d38939',m:'#bdeaf1',g:'#52b3b5'};
  const glyphs = {
    pad:['................','................','....oooooooo....','..oowwwwwwwwoo..','.owwwaaaaaawwo.','.owowaaaaaywwo.','owooowaaaaapwwo','oawowaapaayaawo','oaaaawaaaaaawao','oaaboaaaaaobaao','oabbooooooobbao','.oooo....oooo..','................'],
    apron:['................','.....oooooo.....','.....oowwoo.....','.....oowwoo.....','....oowwwwoo....','....owwwwwwo....','...oowwaawwoo...','...owwaaaawwo...','..oowaaaaaawoo..','..owwaaaaaawwo..','..oawwwwwwwwwo..','..oabababababo..','...oooooooooo...','................'],
    heart:['................','................','..oooo....oooo..','.odppdo..odppdo.','odwpddooodpwpdo','oppppppppppppppo','oppppppppppppppo','.odppppppppppdo.','..odppppppppdo..','...odppppppdo...','....odppppdo....','.....oddpdo.....','......oddo......','.......oo.......','................'],
    door:['................','....oooooooo....','...obbbaaaboo...','...obaaaaaabo...','...obawwawabo...','...obawwaawbo...','...obaaaaaabo...','...obaaaaaybo...','...obaaaaaybo...','...obaaaaaabo...','...obaaaaaabo...','...obaaaaaabo...','..ooobbbbbbboo..','..oooooooooooo..','................'],
    cart:['................','....oooooooo....','...oaaaaaaaao...','...oawwwwwwao...','...oawbpbwaao...','...oawbybwaao...','...oawwwwwwao...','...oaaabbaaao...','...obbbbbbbbo...','...obbwbwbbbo...','...obbbbbbbbo...','...oooooooooo...','................'],
    star:['................','.......oo.......','.......oo.......','......oyyo......','......oyyo......','..ooooywwyoooo..','...oyyyyyyyyo...','....oyyyyyyo....','....oyysyyso....','...oyyooooyyo...','...ooyo..oyoo...','...oo......oo...','................']
  };
  const pixel = (ctx,name,x,y,n=1) => {
    glyphs[name].forEach((line,j) => [...line].forEach((code,i) => {
      if (colors[code]) {ctx.fillStyle=colors[code];ctx.fillRect(x+i*n,y+j*n,n,n);}
    }));
  };
  root.querySelectorAll('[data-icon]').forEach(c => pixel(c.getContext('2d'),c.dataset.icon,0,1));
  const room = root.querySelector('.room-art').getContext('2d');
  const rect = (x,y,w,h,color) => {room.fillStyle=color;room.fillRect(x,y,w,h);};
  const clouds = [[7,13,2],[32,8,1],[67,24,1],[110,15,2],[151,17,1],[195,13,2],[216,22,1]];
  const confetti = [[10,9,0],[21,43,0],[32,11,1],[58,8,0],[65,48,1],[81,12,0],[89,32,0],[102,8,1],[120,38,0],[144,8,0],[190,9,1],[230,13,0],[239,28,0]];
  function drawRoom(decor=true) {
    rect(0,0,248,68,'#c5eaff');
    rect(101,0,147,42,'#b9e3ff');
    rect(0,48,248,3,'#a7dcff');
    rect(0,51,248,17,'#dff4ff');
    for (let y=54;y<68;y+=7) for (let x=-10;x<248;x+=22) {
      const offset=y%2?10:0; rect(x+offset,y,15,1,'#c2e6ff');rect(x+offset,y+1,1,2,'#c2e6ff');
    }
    rect(139,5,68,38,'#84baf0');
    rect(142,3,62,38,'#e9f8ff');
    rect(144,6,58,31,'#82cef9');
    rect(145,8,56,27,'#9cddff');
    const cloud=(x,y,s,shade='#eeffff') => {
      rect(x,y+2*s,12*s,2*s,shade);rect(x+2*s,y+s,7*s,3*s,shade);rect(x+5*s,y,4*s,5*s,shade);
    };
    cloud(147,17,1); cloud(183,14,1); cloud(168,23,1,'#c7f4ff');
    rect(172,5,3,35,'#f6fcff');rect(142,26,62,2,'#f6fcff');
    rect(139,39,68,3,'#f7fcff');rect(139,42,68,2,'#689fe0');
    rect(134,4,76,2,'#739ec3');
    rect(135,6,13,20,'#f6d9eb');rect(136,25,8,9,'#f5d6e6');rect(137,7,2,24,'#fce9f4');rect(143,7,2,18,'#eeb9d3');rect(136,25,9,2,'#d982af');
    rect(196,6,13,20,'#f6d9eb');rect(200,25,8,9,'#f5d6e6');rect(204,7,2,24,'#fce9f4');rect(199,7,2,18,'#eeb9d3');rect(199,25,9,2,'#d982af');
    rect(210,16,35,23,'#7eadd8');rect(212,18,31,19,'#f0f9ff');rect(212,26,31,2,'#8bb9e0');rect(212,36,31,2,'#7caedb');rect(225,18,2,19,'#a3c9e9');
    const box = (x,y,w,h,bg,refl) => {rect(x,y,w,h,'#4d8cce');rect(x+1,y+1,w-2,h-1,bg);rect(x+2,y+2,w-4,2,refl);};
    box(216,19,4,7,'#91c8ff','#cdeeff');box(220,18,4,8,'#faa8c2','#ffe1ef');box(229,20,5,6,'#91cdff','#d5f3ff');box(235,19,5,7,'#74b7f5','#bce8ff');
    box(216,31,8,5,'#a8c6ea','#e1f1ff');box(229,30,10,6,'#f2bdd3','#ffe9f3');
    // The sofa, chair and low TV cabinet echo the in-game club furniture set.
    rect(104,46,46,14,'#bce2f5');rect(113,42,30,13,'#c97683');rect(115,41,26,12,'#f2a7ac');
    rect(110,47,36,11,'#c97683');rect(111,46,34,7,'#ec999f');rect(113,50,30,4,'#ffbcc0');
    rect(115,53,26,2,'#da8a93');rect(123,43,1,6,'#dc8a94');rect(132,43,1,6,'#dc8a94');
    rect(113,57,3,3,'#7a849a');rect(140,57,3,3,'#7a849a');
    rect(211,46,13,12,'#5e9faa');rect(213,43,9,7,'#7fc8d2');rect(212,48,11,6,'#9edce2');rect(215,54,5,1,'#6cb1bb');
    rect(215,57,2,3,'#7098ad');rect(221,57,2,3,'#7098ad');
    rect(227,55,20,5,'#83a5c1');rect(229,60,2,4,'#7395b5');rect(244,60,2,4,'#7395b5');
    box(230,44,15,11,'#506c89','#85b3d1');rect(232,46,10,6,'#a1dbea');rect(233,47,4,1,'#e2fcfa');rect(235,54,5,1,'#b8d1e2');
    rect(89,58,28,4,'#b5dfff');pixel(room,'pad',89,47);pixel(room,'cart',103,48);
    rect(161,63,37,2,'#b5dcf8');rect(165,62,30,4,'#b5dcf8');
    if (decor) {
      clouds.slice(0,4).forEach(([x,y,s])=>cloud(x,y,s,'#d8f4ff'));
      confetti.forEach(([x,y,k])=>{const c=k?'#f4b4d4':'#f3fcff';rect(x+1,y,1,3,c);rect(x,y+1,3,1,c);});
      rect(99,1,3,2,'#89c6f7');rect(102,3,4,2,'#89c6f7');rect(106,5,8,1,'#89c6f7');rect(114,4,5,2,'#89c6f7');rect(119,2,4,2,'#89c6f7');
      rect(102,5,3,3,'#99aef8');rect(107,6,3,4,'#ffffff');rect(113,6,3,4,'#eea5ca');rect(119,4,3,4,'#75b5f7');
    }
  }
  drawRoom();
  const edge=new Image();
  edge.src='../assets/clubroom/peek-bottom.webp';
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const peek=root.querySelector('.room-peek');
  const peekContext=peek.getContext('2d');
  const peekReady=edge.decode().then(()=>true,()=>false);
  // Vertical travel of the visible right eye in atlas frames 0 through 11.
  const peekEyeOffsets=[0,1,2,3,5,8,10,14,17,22,26,30];
  let edgeClicks=0, peekJob=0, peekRun=0;
  function hidePeek() {
    peekRun++;
    cancelAnimationFrame(peekJob);
    peek.hidden=true;
  }
  function peekPose(f,noticed=false) {
    const {width,height}=peek;
    peekContext.clearRect(0,0,width,height);
    peekContext.drawImage(edge,(f%8)*width,Math.floor(f/8)*height,width,height,0,0,width,height);
    if(noticed) {
      peekContext.save();
      peekContext.translate(0,Math.min(peekEyeOffsets[f],21));
      peekContext.beginPath();
      peekContext.moveTo(119,117);peekContext.lineTo(129,106);
      peekContext.moveTo(124,124);peekContext.lineTo(137,119);
      peekContext.moveTo(126,132);peekContext.lineTo(138,136);
      peekContext.lineCap='round';
      peekContext.lineWidth=7;
      peekContext.strokeStyle='#28486e';
      peekContext.stroke();
      peekContext.lineWidth=4.5;
      peekContext.strokeStyle='#ffdd70';
      peekContext.stroke();
      peekContext.restore();
    }
  }
  async function showPeek() {
    hidePeek();
    const run=peekRun;
    if(!await peekReady||run!==peekRun) return;
    peek.hidden=false;
    const step=45, traverse=32*step, hold=840, start=performance.now();
    const noticeStart=(32-peekEyeOffsets.length)*step, flashPeriod=280;
    const staticPeek=reducedMotion.matches;
    if(staticPeek) peekPose(0,true);
    else peekPose(31);
    function tick(time) {
      const elapsed=Math.max(0,time-start);
      if(staticPeek?elapsed>=hold:elapsed>=2*traverse+hold) {hidePeek();return;}
      if(!staticPeek) {
        const frame=elapsed<traverse?31-Math.floor(elapsed/step):
          elapsed<traverse+hold?0:Math.floor((elapsed-traverse-hold)/step);
        const noticeTime=elapsed-noticeStart;
        const noticed=noticeTime>=0&&noticeTime<3*flashPeriod&&noticeTime%flashPeriod<170;
        peekPose(frame,noticed);
      }
      peekJob=requestAnimationFrame(tick);
    }
    peekJob=requestAnimationFrame(tick);
  }
  const buttons=[...root.querySelectorAll('[data-room-page]')];
  const panes=[...root.querySelectorAll('[data-room-pane]')];
  buttons.forEach(button => button.addEventListener('click', () => {
    buttons.forEach(b=>b===button?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
    panes.forEach(p=>p.hidden=p.dataset.roomPane!==button.dataset.roomPage);
    onNavigate(button.dataset.roomPage);
    if(button.dataset.roomPage!=='edge') {edgeClicks=0;hidePeek();return;}
    if(++edgeClicks===6) {edgeClicks=0;showPeek();}
  }));
}

