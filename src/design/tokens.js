/* Daemonwood — design tokens.
 *
 * One source of record for every value the world and the interface share. The
 * palette used to live in three places — `assets/palette/pnw-palette.json`, the
 * `:root` block in `styles.css`, and a `signal` object inside the renderer. They
 * agreed by luck, not by construction, and nothing would have caught the day
 * they stopped. `tests/design-tokens.test.js` now fails if any of the three
 * drifts from this file.
 *
 * Two rules keep this honest and worth having:
 *   1. Canvas code imports from here. It never writes a colour literal.
 *   2. `styles.css` declares the same values in `:root` so the page is correct
 *      before a single byte of JavaScript runs, and `applyTokens` re-asserts
 *      them at boot so this file is what actually decides.
 */

/* ---------------------------------------------------------------------------
 * The one idea this palette is built on
 * ---------------------------------------------------------------------------
 * Daemonwood is a wet, illustrated place. The preserved plate carries
 * saturated foliage, creek blue, lamps, and warm wood, while signals remain
 * deliberately brighter and more legible than the surrounding world. Fir and fern and
 * wet basalt, almost no chroma anywhere — except the creek, and the lamps.
 *
 * So the world keeps the quiet, and **every signal is a light the world does
 * not contain**. Nothing painted on the plate is allowed into the lit corner of
 * the gold/green band, so when a saturated colour appears on this map it can
 * only mean a session. The work states take the creek's blue, the one cool the
 * art already owns, capped below the three alerts so a busy map never reads as
 * a map that needs you.
 *
 * That is the whole theme. Quiet world, lit signals, cool work — and the
 * interface itself made of the only warm things left in the art, the lamp and
 * the brass, so the chrome never competes with a state.
 * --------------------------------------------------------------------------- */

/* The world palette, shared with the art pipeline. Mirrors
   `assets/palette/pnw-palette.json` exactly; the test proves it. Max 24
   environment colours before interface colours, per the art bible.

   Every value here was sampled out of `assets/map/workshop-plate-v3.png` rather
   than chosen — the palette used to describe a cooler, greyer forest than the
   one actually illustrated (it called the grass hue 133 when the plate paints
   it at hue 67), so the interface was colour-matching a map that did not
   exist. Re-measure if the plate is repainted. */
export const environment = Object.freeze({
  /* Ground and wood. The grade left these almost neutral — sand is 13% chroma
     now, where v3 painted it at 44 — so the map's warmth is carried by the
     lamps rather than the ground. */
  sand: "#78685d",
  sand_light: "#91887e",
  sand_deep: "#605651",
  cedar: "#675e57",
  cedar_dark: "#473e39",
  cedar_deep: "#2c2b2a",
  /* The two things the grade did NOT mute, and so the only warm chroma left in
     the world. The interface borrows them for its own wood and brass, which is
     why the chrome looks lit rather than painted. Not signals: a lantern is
     `lamp` at 68% chroma, a session waiting on you is `signals.needs_input` at
     100%, and the sign it sits on is near-black either way. */
  lamp: "#e8be88",
  brass: "#b89167",

  /* Fir, fern and wet moss — hue 129-172 after the grade, where v3 had a
     yellow-green summer meadow at hue 67. The names stayed; the hues moved. */
  meadow: "#49664f",
  meadow_light: "#557159",
  meadow_deep: "#3e5748",
  canopy: "#41504e",
  canopy_deep: "#2e3f39",
  thicket: "#51574f",

  /* Wet basalt, air, and the deepest value in the art. */
  stone: "#67615f",
  basalt: "#474040",
  soot: "#212026",
  fog: "#626d77",
  /* The flower highlight, held at a neutral warm white. The plate paints it
     with a yellow cast that strays into the band the signals own; 31 pixels of
     it do no harm on the map, but the palette is what the art pipeline paints
     FROM, and a named colour that invites more of it would. */
  bloom: "#f4f2e6",

  /* The creek. The one place the world kept real chroma. */
  creek: "#21414e",
  creek_deep: "#1e2f39",
  creek_light: "#305866",

  /* Fire. The grade all but erased the campfire's core — three pixels survive
     above 55% chroma — so this is the name the art pipeline paints a flame
     from, not a census of the current plate. */
  flame: "#e08a3a",
  rust: "#6e514e"
});

/* State colours. These are the only colours allowed to mean something, and
   there is now exactly one per state rather than five shared between ten —
   colour joins the glyph and the walk as a third way to read a session.
   The keys are the `VISUAL_STATES` values verbatim, plus `disconnected`, so the
   lookup is mechanical and a new state cannot ship without a colour.

   Three tiers, and the tiers are the design:

   A. **Look at me.** Three states end a turn in your court. They get the
      highest chroma on the page, and they are the only ones that do.
   B. **Work in progress.** Six states mean "busy, nothing for you yet". They
      share one arc of creek-blue that deepens as the session goes further into
      the task — one family at a glance, six readings up close, and capped below
      tier A so a working map never competes with a waiting one.
   C. **Nobody home.** Desaturated, warm for a session resting by the fire and
      cold for one that is gone.

   Nothing decorative may borrow one of these. */
export const signals = Object.freeze({
  /* A — the three lit signals. */
  needs_input: "#ffcf3d", //  lantern gold — the map paints no pure yellow
  trouble: "#ef5a35",     //  ember — the dock banner, brought up to heat
  finished: "#a9d143",    //  meadow in full sun — the grass, lit

  /* B — the work arc. Cyan is looking, blue is doing: the three states that
     only read the project sit at the creek's own hue, and the three that change
     it move toward the console's blue. Lightness deliberately zigzags
     (71, 58, 49, 64, 52, 70) because six colours inside one family separate by
     value far better than by hue alone — a first pass ran the arc smoothly and
     Editing, Running and Testing were indistinguishable on the map. */
  arriving: "#a4bcc6",      //  mist: here, not started
  preparing: "#6ea5bb",     //  kindling
  investigating: "#3b9fbd", //  reading by the water — the deepest cyan
  editing: "#6ba2dc",       //  the chisel — first of the blues
  running: "#4668c4",       //  the console
  testing: "#8b8ed8",       //  the assay

  /* C — at rest. */
  idle: "#8a8c7c",        //  banked coals, still warm
  disconnected: "#5f635e" //  gone cold
});

/* One mapping, used by the canvas and the DOM alike, so a state cannot be one
   colour on the map and another in the panel. */
export function toneFor(state) {
  return signals[state] ?? signals.disconnected;
}

/* The custom property that carries a state's colour, e.g. `--state-needs-input`.
   Underscores become hyphens because that is what CSS reads as one word. */
export function toneVar(state) {
  return `--state-${String(state).replace(/_/g, "-")}`;
}

/* Interface surfaces. Warm near-blacks rather than the cool blue-greens these
   used to be: the page is the dark room the lit map hangs in, and a cool
   surround made the warm plate look like it had been pasted on from somewhere
   else. `backdrop` is the page behind the world and is NOT `environment.soot`,
   which is an outline colour inside the art. */
export const ui = Object.freeze({
  backdrop: "#13120e",
  surface: "#1c1913",
  surfaceRaised: "#262117",
  border: "#3a3020",
  ink: "#f1ece0",
  muted: "#a2977f",
  /* Drawn type on the canvas: warm paper on near-black, matching the plate's
     own signage rather than a cooler page ink. */
  hudPaper: "#f7f1e3",
  hudInk: "#13120e",
  /* Inside the world frame, before and around the plate. */
  frame: "#0f0e0a",
  /* The veil over the map when there is nothing on it, and the dialog's
     backdrop. Both are the page colour with the map faintly behind. */
  scrim: "rgba(17, 15, 11, 0.84)",
  veil: "rgba(10, 9, 6, 0.74)",
  /* The bridge chip in the map's corner, and the rule between log lines. */
  chip: "rgba(24, 21, 15, 0.9)",
  hairline: "rgba(58, 48, 32, 0.55)"
});

/* The two signal washes. An alert is the one place a signal colour is allowed
   to become a surface rather than a mark, because the whole element *is* the
   signal. Both are the signal at low alpha over a dark edge of the same hue. */
export const alert = Object.freeze({
  goldWash: "rgba(255, 207, 61, 0.13)",
  goldEdge: "#7a6222",
  emberWash: "rgba(239, 90, 53, 0.12)",
  emberEdge: "#7d3524"
});

/* Signage. Every label in this world is one made object: a dark plank inside a
   cedar batten, over a soot outline. No rivets, no grain — the plate already
   paints the wood; the interface only has to be the same shape and value.
   These build that out of the palette rather than inventing a UI material.
   The plank stays near-black on purpose — the value structure is what makes
   eleven state colours legible over a bright map, so the material changes and
   the contrast does not. */
export const sign = Object.freeze({
  /* Stained cedar rather than neutral charcoal: warm enough to belong to the
     same wood as the benches and the signboards, dark enough that state colour
     still reads against a bright map. */
  plankTop: "#2a2117",
  plankBottom: "#191209",
  batten: environment.cedar_dark,
  edge: environment.soot
});

/* Firelight. The one ambient effect the world carries: the plate paints the
   flame, this draws the light it casts. Deliberately small — the art bible
   allows decoration to animate only at lower contrast and slower cadence than
   an agent's own state, and the campfire sits at the centre of the map, which
   is the part that has to stay quiet.

   The glow is `environment.flame`, measured from the fire's own core. The
   embers are warm orange and NOT gold: gold is the colour of a session waiting
   on you, and a drifting spark that borrowed it would make the centre of the
   map flash the one colour that is supposed to mean "come here". */
export const ambient = Object.freeze({
  fireGlow: "rgba(249, 120, 21, 1)",
  fireGlowAlpha: 0.26,
  fireCoreAlpha: 0.3,
  firePulseSeconds: 2.4,
  emberColor: "rgba(251, 178, 60, 1)",
  emberCount: 7,
  emberAlpha: 0.85,
  emberRiseSeconds: 3.6,
  /* Stoking: what a click on the fire does. The glow swells and settles over
     `stokeMs`, and a burst of sparks climbs higher than the idle embers ever
     do. Same ember colour, never gold, for the reason above. */
  stokeMs: 1800,
  stokeFlare: 1.2,
  stokeSparkCount: 16,
  stokeSparkRise: 46,
  stokeLimit: 3
});

/* The type system. Two families and no more: the canvas draws its placards and
   tags in `mono`, so every micro-label in the DOM uses it too and the panel
   reads as the same instrument as the map. Body copy stays in `sans`, because
   the art bible allows a pixel-compatible face for short labels only. */
export const type = Object.freeze({
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  sans: 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif',
  labelTracking: "0.09em"
});

/* Canvas HUD geometry, in logical world units.

   The head-tag used to be a two-line sign: the familiar's name, then a glyph
   and the state spelled out. Both lines were saying something the map already
   said — the station under its feet names the work, and the panel names the
   familiar — so what is left is one badge carrying one fact: the action. It is
   roughly a third of the old sign's area, which is the whole point. */
export const hud = Object.freeze({
  placardType: 5.2,
  placardHeight: 9.5,
  placardPadX: 4,
  /* The action badge above a familiar's head. No tail: a speech bubble claims
     the familiar is saying something, and it is working, not talking. It is a
     small sign, so it is shaped like the other signs. `trim` is the painted
     state colour along its foot — at this size a left-edge stripe disappears,
     and the trim is what has to carry the state from across a room. */
  badgeSize: 16,
  badgeGlyph: 9.5,
  badgeRadius: 2.6,
  badgeTrim: 2,
  badgeGap: 2.6,
  /* How far the badge descends into the sprite's own frame. The walk sheets
     leave about nine units of empty air over every familiar's head, so a badge
     parked above the frame floats a body-width clear of the creature it belongs
     to and reads as scenery. It sits on the head instead. */
  badgeDrop: 9,
  /* Floors in device pixels. The badge is the only state signal on the map now,
     so it is never allowed to degrade into a smudge on a small window. */
  badgeFloor: 18,
  glyphFloor: 11,
  /* The hover nameplate: the one place a name is still drawn on the map, and
     only while the pointer is asking. Name and state, one line. */
  nameType: 5.6
});

/* Shape. Three radii, used everywhere, and nothing else.

   v0.13 cut every panel with four different corners, hung the buttons at half a
   degree, and nailed brass rivets to them. Each was reasoned, and together they
   were garnish: the eye read dots, stripes and wobble, not a workshop. The
   world is pixel art, and pixel-art games frame their UI in plain, chunky,
   evenly cut panels — so this one does too. The canvas placards and badges take
   the same numbers (`hud.badgeRadius` and friends are in world units; these are
   CSS pixels), so the map and the panel stay one object. */
export const shape = Object.freeze({
  radiusSmall: "3px", //  a key, a chip, a status readout
  radius: "5px",      //  a button, a panel, a dialog
  radiusLarge: "8px"  //  the frame around the world
});

export const motion = Object.freeze({
  // Agent walking speed, world units per second.
  walkSpeed: 82,
  selectionSpinMs: 26,
  attentionPulseMs: 260,
  walkBobMs: 110,
  walkFrameMs: 170
});

/* What `styles.css` declares in `:root`. The stylesheet carries these literals
   so the first paint is correct without JavaScript; `applyTokens` writes them
   again at boot so this file is the one that decides, and the drift test proves
   the two copies are the same values. */
export const cssVariables = Object.freeze({
  "--soot": ui.backdrop,
  "--surface": ui.surface,
  "--surface-raised": ui.surfaceRaised,
  "--border": ui.border,
  "--ink": ui.ink,
  "--muted": ui.muted,
  "--paper": ui.hudPaper,
  "--frame": ui.frame,
  "--scrim": ui.scrim,
  "--veil": ui.veil,
  "--chip": ui.chip,
  "--hairline": ui.hairline,

  /* World colours the interface is allowed to wear. The chrome is made of wood
     and brass and nothing else, so that every coloured thing on the page is a
     state. */
  "--cedar": environment.cedar,
  "--brass": environment.brass,
  "--lamp": environment.lamp,

  /* One per state. */
  ...Object.fromEntries(Object.keys(signals).map((state) => [toneVar(state), signals[state]])),

  "--gold-wash": alert.goldWash,
  "--gold-edge": alert.goldEdge,
  "--ember-wash": alert.emberWash,
  "--ember-edge": alert.emberEdge,

  "--hud-font": type.mono,
  "--hud-tracking": type.labelTracking,
  "--sign-plank-top": sign.plankTop,
  "--sign-plank-bottom": sign.plankBottom,
  "--sign-batten": sign.batten,
  "--sign-edge": sign.edge,

  /* Every radius in `styles.css` is one of these three. */
  "--radius-sm": shape.radiusSmall,
  "--radius": shape.radius,
  "--radius-lg": shape.radiusLarge
});

export function applyTokens(root = globalThis.document?.documentElement) {
  if (!root?.style) return false;
  for (const [name, value] of Object.entries(cssVariables)) root.style.setProperty(name, value);
  return true;
}
