import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPatchServer } from '../src/event-server.js';

// Isolated browser integration checks. No real process/session discovery,
// settings writes, adapter installation, or production event POSTs.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = await mkdtemp(join(tmpdir(), 'patch-ui-check-'));
const chromePath = process.env.PATCH_CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const server = createPatchServer({ root, processSnapshot: () => [], ledgerSnapshot: () => new Set(), registrySnapshot: () => new Map() });
let chrome, ws;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let pending = new Map(), next = 0;
let passed = 0;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  chrome = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let launchError;
  chrome.on('error', (error) => { launchError = error; });
  let port;
  for (let attempt = 0; attempt < 100 && !port; attempt++) {
    if (launchError) throw launchError;
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome debugging endpoint started; set PATCH_CHROME to your Chrome binary');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data), task = pending.get(message.id);
    if (task) { clearTimeout(task.timer); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await new Promise((r, reject) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const check = async (label, expression) => { assert.equal(await evaluate(expression), true, label); passed++; console.log(`ok ${passed} - ${label}`); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // Mock only the transport, before the app loads. Fixtures stay in this tab.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.EventSource = class extends EventTarget {
      constructor() { super(); window.fixtureStream = this; }
      emit(type, payload) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload) })); }
    };
  ` });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await send('Page.navigate', { url: origin });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('Boolean(window.fixtureStream)')) break;
    await delay(100);
  }
  await evaluate(`(async () => {
    window.app = await import('/src/app.js');
    window.sanitize = (await import('/src/state-machine.js')).sanitizeHookEvent;
    window.fixture = (id, type = 'needs_input') => sanitize({sessionId:id,agentName:id,repository:'sample-project',terminalProgram:'VS Code',type,timestamp:new Date().toISOString()});
    window.setupFixture = {file:'~/.claude/settings.json',hooks:{configured:12,total:12},statusLine:{active:true}};
    fixtureStream.emit('ready',{setup:setupFixture,delivery:{hookEvents:0,lastHookReceivedAt:null}});
  })()`);
  await check('installation alone never claims event delivery', `document.querySelector('#connect-label').textContent === 'Ready for Claude Code' && document.querySelector('#connect-dot').hidden`);
  await evaluate(`for(let i=0;i<5;i++) app.applySafeEvent(fixture('Session '+i));`);
  await check('five waiting sessions are counted, with an actionable overflow', `app.registry.records.size===5 && app.registry.visible.length===4 && document.querySelector('#hidden-notice').tagName==='BUTTON' && !document.querySelector('#hidden-notice').hidden`);
  await check('attention is announced without selecting a familiar', `!app.registry.selected && document.querySelector('#live-status').textContent.includes('needs you')`);
  await evaluate(`document.querySelector('#attention-banner').click()`);
  await check('attention opens a complete five-session queue', `document.querySelector('#session-picker').open && document.querySelectorAll('#session-list button').length===5`);
  await evaluate(`window.focusedChoice=document.querySelector('#session-list button');focusedChoice.focus();app.applySafeEvent(fixture('Session 0'));`);
  await check('an event update preserves the focused session button', `focusedChoice.isConnected && document.activeElement===focusedChoice`);
  // Exercise the real 15-second refresh, not only event-driven renders.
  await delay(15500);
  await check('the periodic refresh preserves visible keyboard focus', `focusedChoice.isConnected && document.activeElement===focusedChoice && getComputedStyle(focusedChoice).visibility==='visible'`);
  await evaluate(`window.hiddenKey=app.registry.hidden[0].key;[...document.querySelectorAll('#session-list li')].find(n=>n.dataset.key===hiddenKey).querySelector('button').click();`);
  await check('hidden sessions open the inspector without displacing another session', `app.registry.selectedId===hiddenKey && !app.registry.visibleKeys.includes(hiddenKey) && !document.querySelector('#inspector').hidden`);
  await evaluate(`fixtureStream.emit('patch-snapshot',[...app.registry.records.values()].map(r=>fixture(r.key)));`);
  await check('reconnect snapshots preserve a still-existing selected session', `app.registry.selectedId===hiddenKey`);
  await check('accessible map has no invisible tab stops', `document.querySelectorAll('#sr-roster button, #sr-roster [tabindex]').length===0 && document.querySelectorAll('#sr-roster li').length===5`);
  await evaluate(`fixtureStream.emit('patch-delivery',{hookEvents:1,lastHookReceivedAt:new Date().toISOString()});`);
  await check('actual delivery updates the status immediately', `document.querySelector('#connect-label').textContent==='Receiving Claude events' && !document.querySelector('#connect-dot').hidden`);
  await evaluate(`fixtureStream.emit('error',{});`);
  await check('an outage cannot retain a reassuring green delivery light', `document.querySelector('#connect-label').textContent==='Reconnecting…' && document.querySelector('#connect-dot').hidden`);
  await evaluate(`fixtureStream.emit('ready',{setup:setupFixture,delivery:{hookEvents:0,lastHookReceivedAt:null}});`);
  await check('bridge restart clears prior delivery evidence', `document.querySelector('#connect-label').textContent==='Ready for Claude Code'`);
  await evaluate(`document.querySelector('#attention-banner').click();window.removedChoice=document.activeElement;window.removedKey=removedChoice.closest('li').dataset.key;app.applySafeEvent(fixture(removedKey,'session_ended'));`);
  await check('removing a focused queue row moves focus to another visible control', `!removedChoice.isConnected && document.activeElement.matches('#session-list button, #sessions-close')`);
  await evaluate(`document.querySelector('#session-picker').close();app.registry.clear();app.applySafeEvent(fixture('Dock A','stopped'));app.applySafeEvent(fixture('Dock B','stopped'));for(let i=0;i<40;i++)app.registry.update(1);document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));`);
  await delay(300);
  const markerPoint = await evaluate(`(async()=>{
    const {WorldRenderer}=await import('/src/renderer.js');
    const canvas=document.querySelector('#world'),rect=canvas.getBoundingClientRect();
    const scale=Math.min(canvas.width/512,canvas.height/288);
    const renderer=Object.assign(Object.create(WorldRenderer.prototype),{canvas,scale,pixelRatio:canvas.width/rect.width,offsetX:Math.round((canvas.width-512*scale)/2),offsetY:Math.round((canvas.height-288*scale)/2),coverRight:document.querySelector('#inspector').getBoundingClientRect().width});
    const box=renderer.edgeMarkers(app.registry.drawn).find(b=>b.record.key!==app.registry.selectedId);
    return {x:rect.x+(box.x+box.width/2)/renderer.pixelRatio,y:rect.y+(box.y+box.height/2)/renderer.pixelRatio,key:box.record.key};
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: markerPoint.x, y: markerPoint.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: markerPoint.x, y: markerPoint.y });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: markerPoint.x, y: markerPoint.y });
  await check('the drawn edge marker selects the session beneath the inspector', `app.registry.selectedId===${JSON.stringify(markerPoint.key)}`);
  const output = process.env.PATCH_UI_OUTPUT ? resolve(process.env.PATCH_UI_OUTPUT) : null;
  const capture = async (name) => {
    if (!output) return;
    await mkdir(output, { recursive: true });
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(join(output,`${name}.png`),Buffer.from(screenshot.data,'base64'));
  };
  await capture('desktop-edge-marker');
  await evaluate(`document.querySelector('#card-close').click();app.registry.clear();for(let i=0;i<5;i++)app.applySafeEvent(fixture('Session '+i));document.querySelector('#attention-banner').click();`);
  await capture('desktop-session-picker');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:false}); await delay(300);
  await check('narrow session picker stays inside the viewport', `(()=>{const r=document.querySelector('#session-picker').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()`);
  await capture('phone-session-picker');
  await evaluate(`document.querySelector('#session-list button').click()`); await delay(300);
  await check('narrow inspector stacks below the full map without horizontal overflow', `getComputedStyle(document.querySelector('#inspector')).position==='static' && document.documentElement.scrollWidth<=innerWidth`);
  await capture('phone-inspector');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await check('reduced motion disables drawer animation', `getComputedStyle(document.querySelector('#inspector')).animationName==='none'`);
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(`${passed} browser checks passed. Fixtures never reached a live bridge.`);
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  ws?.close();
  if (chrome && chrome.exitCode === null && chrome.pid) {
    const closed = once(chrome, 'exit'); chrome.kill('SIGTERM');
    await Promise.race([closed, delay(3000)]);
    if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await closed; }
  }
  server.closeAllConnections(); await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
