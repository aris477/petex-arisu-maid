const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp, rm} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {once} = require('node:events');

async function until(label, check, timeout = 25000) {
  const finish = Date.now() + timeout;
  while (Date.now() < finish) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, 'open', {signal: AbortSignal.timeout(5000)});
  let id = 0;
  return {
    async evaluate(expression) {
      const expected = ++id;
      const {result, exceptionDetails} = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.removeEventListener('message', onMessage);
          reject(new Error(`DevTools did not respond: ${expression}`));
        }, 5000);
        function onMessage(event) {
          const message = JSON.parse(event.data);
          if (message.id !== expected) return;
          clearTimeout(timeout);
          socket.removeEventListener('message', onMessage);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({id: expected, method: 'Runtime.evaluate',
          params: {expression, awaitPromise: true, returnByValue: true}}));
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    },
    close() { socket.close(); },
  };
}

async function main() {
  const executable = process.argv[2];
  assert(executable, 'Pass the path to the app executable inside Contents/MacOS.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'arisu-smoke-'));
  const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    env: {...process.env, PEDEX_DATA_DIR: path.join(root, 'user'), PEDEX_CODEX_HOME: path.join(root, 'codex')},
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '', launchError, page;
  child.on('error', error => { launchError = error; });
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-32000); });
  function stillRunning() {
    if (launchError) throw launchError;
    assert(child.exitCode === null && child.signalCode === null, 'The packaged app exited early');
  }
  try {
    const port = await until('DevTools socket', () => {
      stillRunning();
      return /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)?.[1];
    });
    const target = await until('pet renderer', async () => {
      stillRunning();
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(3000)});
      return (await response.json()).find(item => item.type === 'page' && item.url.endsWith('/pet.html'));
    });
    page = await connect(target.webSocketDebuggerUrl);
    const state = await until('Arisu is active', async () => {
      const value = await page.evaluate('window.pedex?.getState()');
      return value?.petActive && value;
    });
    assert.equal(state.platform, 'darwin');
    assert.equal(state.settings.petId, '8a87ef6b-0a63-428c-af2a-a30448d753af');
    assert.equal(state.pets.length, 1);
    assert.deepEqual([...state.pets[0].edgeSides].sort(), ['bottom', 'left', 'right', 'top']);
    for (const key of ['sadUrl', 'lookUrl', 'waveUrl', 'pettingUrl', 'cleaningUrl', 'mopLeftUrl', 'mopRightUrl']) {
      assert(state.pets[0][key], `Missing ${key}`);
    }
    await until('opaque and transparent pixels in the sprite canvas', () => page.evaluate(`(() => {
      const canvas = document.getElementById('pet');
      if (!canvas) return false;
      const {width, height} = canvas;
      const {data} = canvas.getContext('2d').getImageData(0, 0, width, height);
      let transparent = false, opaque = false;
      for (let i = 3; i < data.length && !(transparent && opaque); i += 4) {
        transparent ||= data[i] === 0;
        opaque ||= data[i] === 255;
      }
      return transparent && opaque;
    })()`));
    await page.evaluate(`(() => {
      window.__arisuTrialAction = null;
      window.pedex.onAction(action => { window.__arisuTrialAction = action; });
    })()`);
    assert.equal(await page.evaluate('window.pedex.stroke()'), true);
    await until('petting animation and visible bubble', () => page.evaluate(`(() => {
      const bubble = document.getElementById('speech-bubble');
      return JSON.stringify(window.__arisuTrialAction).includes('petting3') &&
        !bubble.hidden && Boolean(document.getElementById('speech-text').textContent);
    })()`, 5000));
    console.log('macOS package: Arisu started, all four edges and seven action atlases registered, canvas and petting bubble verified.');
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    page?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill();
      await Promise.race([closed, delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    }
    await rm(root, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
