// Harness: run the REAL app/desktop.cjs against a stub electron module.
// Verifies (a) the cling window uses the 0.75 scale and stays rim-aligned, and
// (b) pulling her off an edge leaves her body exactly where it was.
const Module = require('node:module');
const path = require('node:path');
const assert = require('node:assert');

const ROOT = process.argv[2];
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const cursor = { x: 900, y: 500 };
const wins = [];

class StubWin {
  constructor(opts) {
    this.bounds = { x: opts.x ?? 0, y: opts.y ?? 0, width: opts.width, height: opts.height };
    this.destroyed = false; this.visible = false; this.events = {};
    this.webContents = { send: () => {} };
    wins.push(this);
  }
  getBounds() { return { ...this.bounds }; }
  setBounds(b) { this.bounds = { x: Math.round(b.x), y: Math.round(b.y), width: b.width, height: b.height }; }
  setMinimumSize() {} setMaximumSize() {} setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {} setIgnoreMouseEvents() {}
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  loadFile() { return Promise.resolve(); }
  on(ev, fn) { (this.events[ev] ||= []).push(fn); }
  destroy() { this.destroyed = true; }
  setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; }
}

const stub = {
  BrowserWindow: StubWin,
  screen: {
    getCursorScreenPoint: () => ({ ...cursor }),
    getDisplayMatching: () => ({ id: 1, workArea: AREA, bounds: AREA }),
    getAllDisplays: () => [{ id: 1, workArea: AREA, bounds: AREA }],
    getPrimaryDisplay: () => ({ id: 1, workArea: AREA, bounds: AREA }),
  },
  powerMonitor: { getSystemIdleTime: () => 0 },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'electron') return 'electron-stub';
  return origResolve.call(this, req, ...rest);
};
require.cache['electron-stub'] = { id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: stub };

const { DesktopPets } = require(path.join(ROOT, 'app', 'desktop.cjs'));

function settings(over = {}) {
  return {
    petId: 'p1', clickAction: 'waving', size: 160, alwaysOnTop: true, motion: true,
    randomAnimations: true, behaviour: 'calm', followCursor: true, launchAtLogin: false,
    visible: true, hideFullscreen: false, snapEdges: true, edgeCling: true, edgeAutoPeek: true,
    edgePeekEvery: 0, shortcut: true, language: 'zh-Hans', position: null,
    features: { multiPet: false, interactions: false, personalities: false, roaming: false, toys: false, petting: false, routines: false, layouts: false, libraryTools: false },
    companions: [], primaryVisible: true, placements: {}, roamArea: null,
    routine: { start: 22, end: 7, idleMinutes: 10 },
    ...over,
  };
}
const PETS = [{ id: 'p1', displayName: 'Arisu', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2, edgeSides: ['left'] }];

function make(over) {
  const S = settings(over);
  const state = { settings: S, pets: PETS, screenAwake: true, fullscreenDisplays: new Set() };
  const dp = new DesktopPets({
    getState: () => state, secure: () => {}, windowOptions: () => ({}),
    onChange: () => {}, onSave: () => {},
  });
  const p = dp.primary;
  p.loaded = true; p.win.visible = true;
  dp.place(p);
  return { dp, p, S, state };
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}

// Her visible body's left edge in SCREEN coordinates.
// Clinging: the cell's rim (x=64 of 384) is placed on the screen edge by the window
// position, so the artwork's outer tip is exactly there.
function bodyLeftOnScreen(dp, p) {
  const b = p.win.getBounds();
  if (p.cling) return b.x + b.width * (64 / 384);
  return b.x + dp.bodyBox(p).left;
}

// Read the shrink factor from the source so this test tracks the code instead of
// hard-coding a number that has to be edited every time the constant changes.
const SRC = require('node:fs').readFileSync(path.join(ROOT, 'app', 'desktop.cjs'), 'utf8');
const CLING_SCALE = Number(/const EDGE_CLING_SCALE=([\d.]+)/.exec(SRC)[1]);
console.log(`\n(cling scale read from source: ${CLING_SCALE})`);

console.log(`\n== 1. cling window uses the ${CLING_SCALE} scale and stays rim-aligned ==`);
{
  const { dp, p } = make();
  const width = 304, height = 354;
  const box = dp.bodyBox(p);
  p.win.setBounds({ x: -box.left, y: 300, width, height });
  const ok = dp.tryGrab(p, { x: -box.left, y: 300, width, height });
  check('tryGrab fires when her body is flush at the left edge', () => assert.ok(ok, 'tryGrab returned false'));
  const cling = p.cling;
  check('cling window exists', () => assert.ok(cling, 'no cling'));

  const base = Math.ceil(160 * 208 / 192) / 416;      // per-atlas-pixel scale
  check(`tightened to 384*scale*${CLING_SCALE} = ${Math.round(384 * base * CLING_SCALE)} (got ${cling?.width})`, () =>
    assert.strictEqual(cling.width, Math.round(384 * base * CLING_SCALE)));
  check(`tightened to 512*scale*${CLING_SCALE} = ${Math.round(512 * base * CLING_SCALE)} (got ${cling?.height})`, () =>
    assert.strictEqual(cling.height, Math.round(512 * base * CLING_SCALE)));
  check(`exactly ${CLING_SCALE}× the unshrunk geometry`, () => {
    const oldW = Math.round(384 * base);
    const ratio = cling.width / oldW;
    assert.ok(Math.abs(ratio - CLING_SCALE) < 0.01, `ratio ${ratio.toFixed(4)} should be ~${CLING_SCALE}`);
  });
  check('the artwork rim still sits on the screen edge', () => {
    const b = p.win.getBounds();
    const rim = b.x + b.width * (64 / 384);
    assert.ok(Math.abs(rim - AREA.x) < 1.5, `rim at ${rim.toFixed(2)}, edge at ${AREA.x}`);
  });
  check('validateCling keeps a cling it just created', () => {
    dp.validateCling(p);
    assert.ok(p.cling, 'valid cling was dropped');
  });
  check('a size change still invalidates the cling', () => {
    p.win.webContents; // no-op
    const S2 = settings({ size: 200 });
    dp.getState = () => ({ settings: S2, pets: PETS, screenAwake: true, fullscreenDisplays: new Set() });
    dp.validateCling(p);
    assert.strictEqual(p.cling, null, 'cling should be dropped on a size change');
  });
}

console.log('\n== 2. pulling her off the edge leaves her body in place ==');
for (const size of [160, 200, 240]) {
  const { dp, q } = (() => { const e = make({ size }); return { dp: e.dp, q: e.p }; })();
  const width = Math.max(size + 72, 304), height = Math.ceil(size * 208 / 192) + 180;
  const box = dp.bodyBox(q);
  q.win.setBounds({ x: -box.left, y: 340, width, height });
  const started = dp.tryGrab(q, { x: -box.left, y: 340, width, height });
  const clingBodyLeft = bodyLeftOnScreen(dp, q);

  const bb = q.win.getBounds();
  const grabX = Math.round(bb.x + bb.width * (64 / 384) + 4);
  const grabY = Math.round(bb.y + bb.height * 0.5);
  cursor.x = grabX; cursor.y = grabY;
  dp.pressStart(q);
  // A press alone must not move her: she might just be being spoken to.
  const afterPress = bodyLeftOnScreen(dp, q);

  // Then drag right well past the grab threshold: this is the real detach. Stopping
  // inside 48 px would (correctly) re-cling on release, which is a different test.
  const TRAVEL = 140;
  let detachBodyLeft = null;
  for (let i = 1; i <= 35; i++) {
    cursor.x = grabX + i * (TRAVEL / 35); dp.tick();
    if (!q.cling && detachBodyLeft === null) detachBodyLeft = bodyLeftOnScreen(dp, q);
  }
  const afterDrag = bodyLeftOnScreen(dp, q);
  cursor.x = grabX + TRAVEL;
  dp.pressEnd(q);
  const afterRelease = bodyLeftOnScreen(dp, q);

  console.log(`   size ${size}: cling body ${clingBodyLeft.toFixed(1)} | press ${afterPress.toFixed(1)} | detach ${detachBodyLeft === null ? 'n/a' : detachBodyLeft.toFixed(1)} | drag ${afterDrag.toFixed(1)} | release ${afterRelease.toFixed(1)}`);

  check(`size ${size}: cling starts`, () => assert.ok(started, 'tryGrab failed'));
  check(`size ${size}: body is flush with the edge while clinging`, () =>
    assert.ok(Math.abs(clingBodyLeft - AREA.x) < 1.5, `body at ${clingBodyLeft.toFixed(1)}`));
  check(`size ${size}: a plain press does not move her`, () =>
    assert.ok(Math.abs(afterPress - clingBodyLeft) < 1.5, `moved ${(afterPress - clingBodyLeft).toFixed(1)} px`));
  check(`size ${size}: detach keeps her body where it was`, () =>
    assert.ok(detachBodyLeft !== null && Math.abs(detachBodyLeft - clingBodyLeft) < 12,
      `jumped ${(detachBodyLeft - clingBodyLeft).toFixed(1)} px`));
  check(`size ${size}: release adds no inland snap (${(afterRelease - afterDrag).toFixed(1)} px)`, () =>
    assert.ok(Math.abs(afterRelease - afterDrag) < 3, `snapped ${(afterRelease - afterDrag).toFixed(1)} px`));
  check(`size ${size}: she did not re-cling after being carried away`, () =>
    assert.strictEqual(q.cling, null, 're-clung although dragged far from the edge'));
}

console.log('\n== 2b. dropping her inside the grab threshold does re-cling ==');
{
  const { dp, p: q } = make();
  const width = 304, height = 354, box = dp.bodyBox(q);
  q.win.setBounds({ x: -box.left, y: 340, width, height });
  dp.tryGrab(q, { x: -box.left, y: 340, width, height });
  const bb = q.win.getBounds();
  const grabX = Math.round(bb.x + bb.width * (64 / 384) + 4);
  const grabY = Math.round(bb.y + bb.height * 0.5);
  cursor.x = grabX; cursor.y = grabY;
  dp.pressStart(q);
  // pull her out only 20 px, then let go: her body is still within EDGE_GRAB
  for (let i = 1; i <= 5; i++) { cursor.x = grabX + i * 4; dp.tick(); }
  cursor.x = grabX + 20;
  dp.pressEnd(q);
  check('a short pull from the wall re-clings on release', () => assert.ok(q.cling, 'did not re-cling'));
}

console.log('\n== 3. dropping her near an edge still re-clings ==');
{
  const { dp, p: q } = make();
  const width = 304, height = 354;
  const box = dp.bodyBox(q);
  q.win.setBounds({ x: 600, y: 300, width, height });
  cursor.x = 700; cursor.y = 400;
  dp.pressStart(q);
  // drag until her body is within the grab threshold of the left edge (a bit outside it)
  const targetX = 20 - box.left;
  let steps = 0;
  while (q.win.getBounds().x > targetX && steps++ < 400) { cursor.x -= 5; dp.tick(); }
  dp.pressEnd(q);
  check('dropping her at the edge grabs it', () => assert.ok(q.cling, 'no cling after a drop on the edge'));
}

console.log('\n== 4. a drag far from the edge is still kept on screen ==');
{
  const { dp, p: q } = make();
  q.win.setBounds({ x: 500, y: 300, width: 304, height: 354 });
  cursor.x = 620; cursor.y = 400;
  dp.pressStart(q);
  for (let i = 1; i <= 40; i++) { cursor.x = 620 + i * 40; dp.tick(); }
  dp.pressEnd(q);
  const b = q.win.getBounds(), box = dp.bodyBox(q);
  check('her body is fully on screen after a long drag', () => {
    assert.ok(b.x + box.right <= AREA.x + AREA.width + 1, `body right ${(b.x + box.right).toFixed(1)}`);
    assert.ok(b.x + box.left >= AREA.x - 1, `body left ${(b.x + box.left).toFixed(1)}`);
  });
}

console.log('\n== 5. edgeCling=false disables the whole thing ==');
{
  const { dp, p: q } = make({ edgeCling: false });
  const box = dp.bodyBox(q);
  q.win.setBounds({ x: -box.left, y: 300, width: 304, height: 354 });
  const ok = dp.tryGrab(q, { x: -box.left, y: 300, width: 304, height: 354 });
  check('no cling when the setting is off', () => assert.strictEqual(ok, false));
}

console.log('\n== 6. the corner cannot flip sides mid-drag (direction lock) ==');
{
  // Pretend all four edges have artwork so a corner really is ambiguous.
  const ALL = ['left', 'right', 'top', 'bottom'];
  const pets = [{ ...PETS[0], edgeSides: ALL }];
  const S = settings();
  const state = { settings: S, pets, screenAwake: true, fullscreenDisplays: new Set() };
  const dp = new DesktopPets({
    getState: () => state, secure: () => {}, windowOptions: () => ({}), onChange: () => {}, onSave: () => {},
  });
  const p = dp.primary;
  p.loaded = true; p.win.visible = true;
  dp.place(p);

  const width = 304, height = 354, box = dp.bodyBox(p);
  // Top-left corner: her body is 6 px from the left edge and 4 px from the top, so
  // both edges qualify and "top" is the nearer of the two.
  p.win.setBounds({ x: 6 - box.left, y: 4 - box.top, width, height });
  const b0 = p.win.getBounds();
  const first = dp.clingSideFor(p, b0, ALL, null);
  check(`corner picks the nearest edge first (${first})`, () => assert.strictEqual(first, 'top'));

  // Now she is dragged 2 px so that "left" becomes the nearer edge. With the lock held
  // she must stay on the side chosen at the start of the drag.
  const b1 = { ...b0, x: b0.x + 4, y: b0.y + 6 };
  const nearestNow = dp.clingSideFor(p, b1, ALL, null);
  const lockedNow = dp.clingSideFor(p, b1, ALL, first);
  console.log(`   nearest without lock: ${nearestNow}   with lock: ${lockedNow}`);
  check('without a lock the side would flip', () => assert.notStrictEqual(nearestNow, first));
  check('with the lock it stays on the original side', () => assert.strictEqual(lockedNow, first));

  // The lock must release when the edge is no longer in range at all.
  const far = { ...b0, x: 400, y: 400 };
  check('the lock lets go once that edge is out of range', () =>
    assert.notStrictEqual(dp.clingSideFor(p, far, ALL, first), first));

  // And a fresh press clears it.
  cursor.x = 900; cursor.y = 500;
  dp.pressStart(p);
  check('a new press clears the lock', () => assert.strictEqual(p.clingLock, null));
  dp.pressEnd(p);
}

console.log('\n== 7. a corner drop uses an edge that actually has artwork ==');
{
  // Only the left edge is supported here. Put her so the *top* edge is the nearer of
  // the two, which is the case that used to bail out entirely.
  const S = settings();
  const state = { settings: S, pets: PETS, screenAwake: true, fullscreenDisplays: new Set() };
  const dp = new DesktopPets({
    getState: () => state, secure: () => {}, windowOptions: () => ({}), onChange: () => {}, onSave: () => {},
  });
  const p = dp.primary;
  p.loaded = true; p.win.visible = true;
  dp.place(p);
  const box = dp.bodyBox(p);
  // left gap 30 px, top gap 5 px -> top is nearest, but only left has artwork
  const bounds = { x: 30 - box.left, y: 5 - box.top, width: 304, height: 354 };
  p.win.setBounds(bounds);
  const all = dp.clingSideFor(p, bounds, ['left', 'top'], null);
  check(`the nearer edge would be ${all}`, () => assert.strictEqual(all, 'top'));
  const ok = dp.tryGrab(p, bounds);
  check('she still clings, using the supported edge', () => {
    assert.ok(ok, 'tryGrab refused although the left edge was available');
    assert.strictEqual(p.cling.side, 'left');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
