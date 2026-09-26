import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssVariables, environment, shape, signals, toneFor, toneVar } from "../src/design/tokens.js";
import { VISUAL_STATES } from "../src/state-machine.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), "utf8");

const rootBlock = (css) => css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const outsideRoot = (css) => css.slice(0, css.indexOf(":root {")) + css.slice(css.indexOf("}", css.indexOf(":root {")));

test("the art palette and the design tokens are the same palette", async () => {
  const palette = JSON.parse(await read("assets/palette/pnw-palette.json"));
  assert.deepEqual({ ...environment }, palette.environment, "environment colours drifted from assets/palette/pnw-palette.json");
  assert.deepEqual({ ...signals }, palette.signals, "signal colours drifted from assets/palette/pnw-palette.json");
});

test("the stylesheet declares exactly the token values", async () => {
  const block = rootBlock(await read("src/styles.css"));
  assert.ok(block.length > 0, "styles.css must declare a :root token block");

  for (const [name, value] of Object.entries(cssVariables)) {
    const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block);
    assert.ok(match, `${name} is missing from the :root block in styles.css`);
    assert.equal(
      match[1].trim().toLowerCase(),
      String(value).toLowerCase(),
      `${name} in styles.css disagrees with src/design/tokens.js`
    );
  }
});

/* The rule that keeps the system from rotting: canvas code may not invent a
   colour. Anything drawn on the world has to come from the tokens module, so
   changing the palette changes the world rather than half of it. */
test("canvas code carries no colour literals of its own", async () => {
  for (const file of ["src/renderer.js", "src/effects.js"]) {
    const source = await read(file);
    const literals = [
      ...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...source.matchAll(/\brgba?\s*\(\s*\d+\s*,/g)
    ].map((match) => match[0]);
    assert.deepEqual(literals, [], `${file} should take its colours from src/design/tokens.js, found: ${literals.join(", ")}`);
  }
});

/* The same rule for the stylesheet, which used to leak a dozen one-off hexes —
   a teal brand gradient, two alert borders, three backdrop washes — none of
   which any test could see. Plain white and plain black at partial alpha are
   allowed through: those are light and shadow on a surface, not palette. */
test("the stylesheet invents no colour outside its token block", async () => {
  const css = outsideRoot(await read("src/styles.css"));
  const literals = [
    ...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
    ...css.matchAll(/\brgba?\s*\([^)]*\)/g)
  ]
    .map((match) => match[0])
    .filter((value) => !/^rgba?\(\s*(255,\s*255,\s*255|0,\s*0,\s*0)\s*[,)]/.test(value));
  assert.deepEqual(literals, [], `src/styles.css should use var(--token), found: ${literals.join(", ")}`);
});

/* The same rule for shape. Three radii, and every corner is one of them. v0.13
   cut each panel with four different corners and hung the buttons at an angle;
   together with nails and grain it read as garnish, not a workshop, and it is
   exactly the kind of thing that creeps back one element at a time.

   Two exemptions: `0` for an edge docked against something (the drawer's
   spine), and `50%` for a status light. */
test("every corner in the interface is one of three radii", async () => {
  const css = outsideRoot(await read("src/styles.css"));
  const offenders = [...css.matchAll(/border-radius:\s*([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((value) => value !== "0" && value !== "50%" && !/^var\(--radius(-sm|-lg)?\)$/.test(value));
  assert.deepEqual(offenders, [], `every radius should be a --radius token, found: ${offenders.join(" | ")}`);
  assert.equal(Object.keys(shape).length, 3, "three radii, not a scale");
});

/* The garnish that was taken out in v0.15, held out: nothing in the chrome is
   tilted, nailed, grained or scored, and the viewport has no corner ticks. */
test("the chrome carries no decoration that is not a signal", async () => {
  const css = await read("src/styles.css");
  for (const pattern of [/rotate\(/, /--nail/, /--grain/, /--strap/, /--score/, /--worn/, /--hang/, /--cut-/]) {
    assert.ok(!pattern.test(css), `styles.css should not contain ${pattern}`);
  }
  assert.ok(!/\.world-(frame|stage)::before/.test(css), "no corner ticks on the viewport");
});

/* Colour is a third way to read a session, next to the glyph and the walk. That
   only works if the mapping is total: a state with no colour of its own would
   silently fall back to "disconnected" and read as a session that had left. */
test("every visual state has a colour of its own", () => {
  const states = Object.values(VISUAL_STATES);
  for (const state of states) {
    assert.ok(signals[state], `${state} has no entry in signals`);
    assert.equal(toneFor(state), signals[state]);
    assert.ok(cssVariables[toneVar(state)], `${toneVar(state)} is missing from cssVariables`);
  }
  const seen = new Map();
  for (const state of [...states, "disconnected"]) {
    const colour = toneFor(state);
    assert.ok(!seen.has(colour), `${state} and ${seen.get(colour)} are both ${colour}`);
    seen.set(colour, state);
  }
});

/* The theme, stated as a test. The world holds the warm half of the wheel and
   the signals are lights it does not contain.
   The plate does paint plenty of yellow-green — the grass is hue 67 — so the
   reservation is not the hue band, it is the **lit corner** of it: saturated
   AND light. Every green in the art is a midtone in shade (the lightest,
   `meadow_light`, sits at l 0.40); `signals.finished` is that same meadow in
   full sun at l 0.54, and `needs_input` is a lantern at l 0.62 and full chroma.
   Nothing painted into the world may climb into that corner, because a lamp
   wearing `signals.needs_input` makes the map lie at a glance. */
test("no environment colour strays into a signal's band", () => {
  const hsl = (hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
  };

  const lit = ({ h, s, l }) => h >= 40 && h <= 95 && s > 0.55 && l > 0.45;

  for (const [name, hex] of Object.entries(environment)) {
    assert.ok(!lit(hsl(hex)), `environment.${name} (${hex}) sits in the lit gold/green corner the signals own`);
  }
  // And the two that claim it actually do, so the reservation is worth having.
  for (const name of ["needs_input", "finished"]) {
    assert.ok(lit(hsl(signals[name])), `signals.${name} should own the lit gold/green corner`);
  }

  // And the reverse: every signal has to be bright enough to survive the plank
  // it is painted on, which is near-black by design.
  for (const [name, hex] of Object.entries(signals)) {
    assert.ok(hsl(hex).l > 0.3, `signals.${name} (${hex}) is too dark to read on a sign`);
  }
});
