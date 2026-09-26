import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateGlyph } from "../src/renderer.js";
import { destinationByState } from "../src/world-model.js";
import { VISUAL_STATES } from "../src/state-machine.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), "utf8");

test("every static ID queried by the browser app exists exactly once", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  const ids = [...app.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  for (const id of new Set(ids)) {
    const occurrences = [...html.matchAll(new RegExp(`id=["']${id}["']`, "g"))].length;
    assert.equal(occurrences, 1, `#${id} should exist exactly once`);
  }
});

test("the primary actions meet the 44px touch target contract", async () => {
  const css = await read("src/styles.css");
  assert.match(css, /\.connect-button[^}]*min-height:\s*44px/);
  assert.match(css, /\.attention-banner[^}]*min-height:\s*44px/);
  // The close control is thumb-sized where thumbs are the input device.
  const narrow = css.slice(css.indexOf("@media (max-width: 860px)"));
  assert.match(narrow, /\.icon-button\s*{[^}]*width:\s*44px;\s*height:\s*44px/);
});

test("the inspector is closed at rest and lives inside the world frame", async () => {
  const html = await read("index.html");
  assert.match(html, /<aside class="inspector" id="inspector"[^>]*hidden/, "the inspector must start closed");
  const frame = html.indexOf('id="world-frame"');
  const stage = html.indexOf('id="world-stage"');
  const inspector = html.indexOf('id="inspector"');
  const console_ = html.indexOf('id="dev-console"');
  assert.ok(frame > 0 && stage > frame && inspector > stage && inspector < console_,
    "the inspector belongs inside the map frame, beside the stage");
  // The map layer keeps its own box, so a phone can stack the panel under it.
  const css = await read("src/styles.css");
  assert.match(css, /\.world-stage\s*{\s*position:\s*absolute;\s*inset:\s*0;/);
});

test("selected-familiar detail lives in the inspector, not in page chrome", async () => {
  const html = await read("index.html");
  const start = html.indexOf('id="inspector"');
  const end = html.indexOf("</aside>", start);
  assert.ok(start > 0 && end > start);
  for (const id of ["agent-name", "repo-value", "task-value", "subagent-value", "freshness-value", "agent-trail"]) {
    const position = html.indexOf(`id="${id}"`);
    assert.ok(position > start && position < end, `#${id} should live inside the inspector`);
  }

  // The alert and the way in are the only things the corner HUD earns, and
  // the HUD rides on the map rather than taking a row above it.
  const topbarStart = html.indexOf('<header class="topbar">');
  const topbarEnd = html.indexOf("</header>", topbarStart);
  assert.ok(topbarStart > html.indexOf('id="world-stage"'), "the corner HUD sits on the map");
  assert.ok(html.indexOf('id="attention-banner"') > topbarStart && html.indexOf('id="attention-banner"') < topbarEnd, "the alert belongs in the corner HUD");
  assert.ok(html.indexOf('id="connect-agent"') > topbarStart && html.indexOf('id="connect-agent"') < topbarEnd, "connecting belongs in the corner HUD");
  assert.ok(!html.includes('class="brand"'), "no brand row costs the map height");
});

/* The drawer covers the map, and that is allowed — what is not allowed is for
   covering the map to cost you a session. The world holds still; the renderer
   is told what is hidden and redraws those familiars at the drawer's edge. */
test("the drawer covers the map without hiding a session", async () => {
  const [app, renderer] = await Promise.all([read("src/app.js"), read("src/renderer.js")]);
  // The board does not move for the chrome: no inset, no pan, no rescale.
  assert.ok(!/setInset|animateInset|this\.inset\b/.test(renderer), "the world must not be inset for the drawer");
  assert.ok(!/panTarget|animateCamera/.test(renderer), "the camera must not slide when a panel opens");
  const layout = renderer.slice(renderer.indexOf("  layout() {"), renderer.indexOf("\n  }", renderer.indexOf("  layout() {")));
  assert.ok(!layout.includes("this.inset"), "layout fits the whole canvas, always");
  // Instead the app measures what the drawer covers and the world accounts for it.
  assert.match(app, /renderer\.setCover\(/, "the app must report what the drawer covers");
  assert.match(app, /ui\.inspector\.getBoundingClientRect\(\)/, "the footprint must be measured, not assumed");
  assert.match(renderer, /drawEdgeMarkers\(/, "whoever is behind the drawer must be drawn at its edge");
});

test("the drawer is not a modal — the map stays live behind it", async () => {
  const [html, css, app] = await Promise.all([read("index.html"), read("src/styles.css"), read("src/app.js")]);
  assert.ok(!/<dialog[^>]*id="inspector"/.test(html), "the inspector is a panel, not a dialog");
  assert.ok(!/id="inspector"[^>]*aria-modal/.test(html), "nothing behind the drawer may go inert");
  assert.ok(!app.includes(".inert"), "the world keeps running while the drawer is open");
  assert.ok(!css.includes(".world-frame.inspecting"), "the frame must not change shape for the panel");
  assert.ok(!/aspect-ratio:\s*2\.3088/.test(css), "the widened frame is gone with the inset");
});

/* The badge is the only state signal on the map now. A shape that means two
   things is a shape that means nothing, and position does not save you when
   both states send the familiar to the same station. */
test("every state has a glyph, and no two states can be confused for each other", () => {
  const states = Object.values(VISUAL_STATES);
  for (const state of states) assert.ok(stateGlyph[state], `${state} has no glyph`);
  assert.equal(new Set(Object.values(stateGlyph)).size, Object.keys(stateGlyph).length,
    "two states share a glyph");
  for (const a of states) {
    for (const b of states) {
      if (a === b || destinationByState[a] !== destinationByState[b]) continue;
      assert.notEqual(stateGlyph[a], stateGlyph[b], `${a} and ${b} share a station and a glyph`);
    }
  }
});

/* The name and the state came off the canvas. They have to exist somewhere for
   anyone who is reading the page rather than looking at it — and the canvas
   never carried them in the first place. */
test("the map has an accessible twin, and it announces once", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  assert.match(html, /<ul class="sr-only" id="sr-roster"/, "the map needs a readable roster");
  assert.match(html, /id="live-status"[^>]*aria-live="polite"/, "one live region, not a whole panel");
  assert.ok(!/id="inspector"[^>]*aria-live/.test(html),
    "a live panel re-reads itself on every render tick");
  assert.ok(!/ui\.roster\.replaceChildren\(/.test(app), "accessible rows retain their DOM identity");
  assert.match(html, /id="session-picker"[^>]*aria-labelledby/, "session actions have a visible dialog");
  assert.match(app, /function announce\(/, "announcements are deduped, not sprayed");
});

/* A phone gets the sheet under the map, not the drawer over it. The slide
   leaves a transform behind, and a static sheet that inherits it renders off
   the side of the screen — invisible in source, obvious in a screenshot. */
test("a phone gets a stacked sheet with no drawer left on it", async () => {
  const css = await read("src/styles.css");
  const narrow = css.slice(css.indexOf("@media (max-width: 860px)"), css.indexOf("@keyframes hud-in-up"));
  const panel = narrow.slice(narrow.indexOf(".inspector {"), narrow.indexOf("}", narrow.indexOf(".inspector {")));
  assert.match(panel, /position:\s*static/, "the sheet stacks under the map");
  assert.match(panel, /transform:\s*none/, "the drawer's slide must be undone");
  assert.match(panel, /inset:\s*auto/, "the drawer's edge offsets must be undone");
});

test("counts and rosters that only repeat the map are gone", async () => {
  const html = await read("index.html");
  for (const id of ["agent-roster", "active-count", "waiting-count", "finished-count", "drawer", "drawer-toggle"]) {
    assert.ok(!html.includes(`id="${id}"`), `#${id} duplicates what the map already shows`);
  }
});

test("the inspector states no fact that is the same for every familiar", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  // Every session comes from Claude Code, so a "Via" row was a label reading
  // the same word forever. A row earns its place by telling sessions apart.
  assert.ok(!html.includes('id="provider-value"'), "the source row says the same thing for every familiar");
  assert.ok(!html.includes("<dt>Via</dt>"), "the source row says the same thing for every familiar");
  assert.ok(!app.includes("sourceLabel"), "nothing should still be looking up a source name");
});

test("the interface speaks about one agent, not a menagerie", async () => {
  const html = await read("index.html");
  assert.ok(!/codex/i.test(html), "Codex is no longer connected, so it must not be promised");
  // The page is served by an installed Patch: it points at repair, never at
  // checkout-only npm scripts or docs the server does not serve.
  assert.ok(!/npm run/.test(html), "npm scripts exist only in the source checkout");
  assert.ok(!html.includes("./docs/"), "docs are not part of the served payload");
  assert.match(html, /id="repair-command"/);
});

test("the raw event stream is a developer console, hidden until asked for", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  assert.match(html, /<section class="dev-console" id="dev-console" hidden/);
  const logPosition = html.indexOf('id="event-log"');
  const consoleStart = html.indexOf('id="dev-console"');
  assert.ok(logPosition > consoleStart, "the raw log belongs to the console");
  assert.match(app, /event\.key === "`"/, "the console needs its key");
});

test("the map is reachable without a pointer", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  assert.match(html, /<canvas id="world" tabindex="0"/, "the world must be focusable");
  assert.match(app, /ArrowRight/, "the arrows must step between familiars");
  assert.match(app, /registry\.cycle\(/, "stepping must go through the registry order");
});

/* The alert and the next step say where to go, from one module. The hover
   nameplate and the panel do not name the terminal: a hover is name and state,
   and the panel leads with the project, the part a person recognises. */
test("the page points at a session in one wording, and hover says only who and what", async () => {
  const [html, app, renderer] = await Promise.all([read("index.html"), read("src/app.js"), read("src/renderer.js")]);
  assert.match(app, /from "\.\/session-address\.js"/, "the app reads the address from the one module");
  // The alert names where to go, and the address rides inside the same button.
  const banner = html.slice(html.indexOf('id="attention-banner"'), html.indexOf("</button>", html.indexOf('id="attention-banner"')));
  assert.match(banner, /id="attention-where"/, "the alert carries the address");
  // Hover is one line: name and state.
  assert.ok(!/whereLabel/.test(renderer), "the nameplate carries no address line");
  // The panel leads with the project; there is no terminal row.
  const stats = html.slice(html.indexOf('<dl class="ins-stats">'), html.indexOf("</dl>"));
  assert.ok(!/>Terminal</.test(stats), "no terminal row");
  assert.match(stats.slice(0, stats.indexOf("</div>")), /<dt[^>]*>Project<\/dt>/, "the project is the first row");
  assert.match(app, /const chosen = chosenSessionName\(selected\);\s*setStat\(ui\.session, chosen/, "Claude Code's fallback slug is not a row");
});

/* The drawer says what the session is about in the words on its terminal
   tab. It is a line of its own under the name, not a clipped stat cell, and
   it is hidden rather than printed as a placeholder until Claude Code has
   written one. A /rename is both the title and the session name: said once. */
test("the drawer leads with the session's tab title", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  const head = html.indexOf("</header>", html.indexOf('class="ins-head"'));
  const title = html.indexOf('id="task-value"');
  assert.ok(title > head && title < html.indexOf('<dl class="ins-stats">'), "the title sits between the header and the stats");
  assert.match(html, /<p class="ins-title" id="task-value" hidden><\/p>/, "hidden at rest");
  assert.ok(!/>Task</.test(html.slice(html.indexOf('<dl class="ins-stats">'), html.indexOf("</dl>"))), "no Task row");
  assert.match(app, /ui\.task\.hidden = !title/);
  assert.match(app, /setStat\(ui\.session, chosen === title \? "" : chosen\)/);
});

/* A button that says "Connect" beside a familiar that is plainly connected is
   a bar contradicting its own map. The bridge reports the install check and
   the button says what it found. */
test("the top bar distinguishes installation from receipt on the live bridge", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  const button = html.slice(html.indexOf('id="connect-agent"'), html.indexOf("</button>", html.indexOf('id="connect-agent"')));
  assert.match(button, /id="connect-dot"/);
  assert.match(button, /id="connect-label"/);
  assert.match(app, /function applySetup\(/);
  assert.match(app, /connectionStatus\(/, "status is derived from separate evidence");
  assert.match(app, /eventSource\.addEventListener\("patch-delivery"/, "delivery updates immediately after an accepted hook");
  assert.match(app, /eventSource\.addEventListener\("patch-beat", withSetup\)/, "the check arrives with the beat, not on a poll");
  // The dialog repeats it with the numbers, so the fix is one command away.
  assert.match(html, /id="setup-status"/);
});

/* A session that ends does not blink out. The familiar walks to the gate and
   waves; the renderer draws whoever the registry says is on the map, which is
   the sessions with a place and the familiars on their way out. */
test("a familiar leaves by walking out, with a wave, and the panel follows it", async () => {
  const [app, renderer] = await Promise.all([read("src/app.js"), read("src/renderer.js")]);
  assert.match(app, /renderer\.draw\(registry\.drawn,/, "the map draws the departing too");
  assert.match(app, /findNearest\(point\.x, point\.y, 28, \{ departing: true \}\)/, "hover answers for a departing familiar");
  assert.match(app, /toneColor\(leaving \? "disconnected" : state\)/, "the panel greys the portrait as it goes");
  assert.match(app, /ui\.emptyWorld\.hidden = registry\.drawn\.length > 0/, "the quiet clearing waits for the goodbye");
  assert.equal(stateGlyph.leaving, "wave");
  assert.match(renderer, /kind === "wave"/, "the wave is drawn");
  assert.match(renderer, /1 - agent\.departure/, "and the familiar fades through the gate rather than being clipped");
});
