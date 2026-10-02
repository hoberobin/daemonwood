# Daemonwood — Design System

Status: v0.13  
Authority: `src/design/tokens.js` is the source of record. This document explains
it; where the two disagree, the code is right and this file is stale.

The art bible (`art-bible.md`) governs the **world**: the plate,
the familiars, the palette's meaning. This document governs the **system that
draws it** — where values live, which layer may use them, and the tests that
stop the two from drifting apart.

---

## 1. The one rule

> Nothing in this project may invent a colour.

Every colour comes from `src/design/tokens.js`. The palette used to exist in
three places — `assets/palette/pnw-palette.json`, the `:root` block in `src/styles.css`,
and a `signal` object inside `renderer.js`. They matched by luck, and nothing
would have caught the day they stopped.

`tests/design-tokens.test.js` now fails if:

- the tokens drift from `assets/palette/pnw-palette.json`;
- the `:root` block in `src/styles.css` drifts from the tokens;
- a colour literal (`#hex` or `rgb(...)`) appears in `renderer.js` or `effects.js`.

**To change a colour, edit `src/design/tokens.js` and `src/styles.css` together.**
The test tells you immediately if you only did one.

### Why the duplication exists

`src/styles.css` carries the literals so the first paint is correct before a single
byte of JavaScript runs. `applyTokens()` writes them again at boot, so the
module is what actually decides. The duplication is deliberate, bounded, and
test-enforced — which is the difference between a mirror and a second source.

---

## 2. Token groups

| Group | What it is for | Used by |
| --- | --- | --- |
| `environment` | The 24 world colours, measured off the plate and shared with the art pipeline. | Art, ambient effects |
| `signals` | One colour per state, eleven of them. **Only these may mean something.** | Canvas tags, HUD |
| `ui` | Interface surfaces, ink, HUD paper, scrims. Not world colours. | CSS, canvas HUD |
| `alert` | The two signal washes an alert surface is allowed to use. | CSS |
| `ambient` | Local light and water: alphas, cadences, counts. | `effects.js`, `world-art.js` |
| `hud` | Canvas HUD geometry, in logical world units. | `renderer.js` |
| `type` | Two families: `mono` for labels, `sans` for body. | CSS, canvas |
| `motion` | Speeds and cadences shared by camera, walk, and pulses. | Renderer, world model |
| `shape` | Three radii — small, default, large. Every corner is one of them. See §7. | CSS |
| `cssVariables` | The map from tokens to `--custom-properties`. | `applyTokens()` |

### The theme, in one line

**Quiet world, lit signals, cool work.**

The preserved plate is a high-density painted raster: fir, fern and wet basalt,
with stronger chroma in the creek, lamps, and illustrated foliage. The palette is
built on that: the world keeps the quiet, and **every
signal is a light the world does not contain**. On a map with no chroma of its
own, a saturated colour can only mean a session.

The interface is made of the two warm things the grade left bright — the lamp
and the brass. That is why the brand mark, the Connect button and the focus ring
are lantern-coloured and nothing else in the chrome carries a hue: so that every
coloured thing on the page is a state.

### Signal discipline

A signal colour means a state and nothing else. A lantern painted in the world
is `environment.lamp` at 68% chroma; a session that needs you is
`signals.needs_input` at 100%. They are different colours on purpose. If
decoration borrows a signal, the map starts lying at a glance, which is the one
thing it may never do.

`tests/design-tokens.test.js` enforces this as geometry rather than as a habit:
no `environment` colour may enter the **lit corner** of the gold/green band
(hue 40-95, saturation above 0.55, lightness above 0.45). The plate is allowed
all the muted yellow-green it likes; it may not have the lit kind, because that
corner belongs to *Needs you* and *Done*.

### The three tiers

Ten visual states plus `disconnected` get eleven colours, not five. Colour is
now a third reading of a session alongside its glyph and the station it walked
to — but only inside a structure, or eleven hues is just noise:

| Tier | States | Treatment |
| --- | --- | --- |
| **Look at me** | Needs you, Trouble, Done | Lantern gold, ember, meadow-in-sun. The highest chroma on the page, and the only three that get it. |
| **Work in progress** | Starting, Getting started, Researching, Editing, Running, Testing | One arc of the creek's blue. Cyan is *looking*, blue is *doing*. Capped below tier one, so a busy map never reads as a map that needs you. |
| **Nobody home** | Idle, Disconnected | Desaturated — warm for a session resting by the fire, cold for one that is gone. |

The work arc separates by **value, not hue**: its lightnesses zigzag
(71, 58, 49, 64, 52, 70). A first pass ran the arc smoothly from mist to deep
water and Editing, Running and Testing were indistinguishable on the map, which
is the kind of thing only a render shows you. `docs/palette-board.html` renders
all eleven over the real plate for exactly that check.

One caveat worth stating: *Done* and *Needs you* are 32 degrees apart, so under
deuteranopia they converge. The glyph (check against bang), the station (dock
against gate) and the attention pulse all carry that distinction independently,
so colour is never the only channel — but it is not a colour-blind-safe pair and
should not be treated as one.

---

## 3. Layers, and what each may touch

The canvas draws in a fixed order. Each layer has a rule it may not break.

```
1. plate          the illustrated map
2. ambient        firelight, lantern pools, local water       <- may not touch 3-5
3. placards       station names
4. familiars      sprites, rings, helper dots
5. badges         one action glyph per familiar
```

**Weather is drawn under the familiars, never over them.** Atmosphere may change
how the world feels and never what it says. `tests/effects.test.js` asserts this
ordering in the source, so it cannot be undone by accident.

A placard yields to a tag that covers it: the placard names an empty station,
and a familiar standing there names it better.

---

## 4. Motion

Three rules, taken from the art bible and enforced by taste:

1. **Decoration animates slower and quieter than state.** The fire breathes over
   2.4 seconds, lanterns over 5.4 seconds and waterfall glints over 5.8 seconds;
   an attention pulse takes a quarter of a second.
2. **The centre stays quiet.** The campfire is the centre of the map, so its
   fire breathes rather than flickers.
3. **`prefers-reduced-motion` freezes the local effects.** Fire and lantern light
   stay visible; their pulses and the water highlights stop moving.

Nothing ambient is random. Embers are laid out deterministically so the world
looks the same on every reload — which matters when the whole job is recognising
it at a glance, and makes it testable.

Ambient was briefly larger than this: drifting mist, a cloud-filtered light
grade and an edge vignette. All three were removed. They read as atmosphere in a
screenshot and as noise in a tool you keep open all day, and the plate is
already lit. The fire stays because it is the one thing in the world that should
obviously be alive.

### Behaviours, moods and pokes

A familiar's posture comes from one table, `BEHAVIOURS` in
`src/familiar-behaviour.js`. Each row names its states, when it applies and the
pose it asks for; `resolvePoses()` reads the table once a frame and the renderer
draws what it returns. A behaviour changes posture and never state, route or
badge. No new sprite art is used: poses are asked for by name (`face_left`,
`back`, …) and resolve to existing frames, with `FAMILIAR_POSES` ready for the
day one familiar's sheet gains a pose of its own.

| Behaviour | What it looks like |
| --- | --- |
| `needs_input.impatience` | Calm, then glancing (a hop every 5 s after 1 min), then tapping (tap-tap-tap from 5 min), then sulking (back turned from 15 min, looking round every 6 s with its sign up). The hover nameplate, the alert and the screen-reader sentence carry the wait ("NEEDS YOU · 7M"). |
| `idle.company` | Two or more familiars settled IDLE at the fire turn to face it and each other. A newcomer does not restart anyone's company. |
| `idle.firewatch` | A familiar settled at the fire briefly looks toward the flames and takes a small breath. Company keeps facing inward between breaths. |
| `arriving.look_around` | In its first three seconds a new arrival looks left, then right. A reload later does not replay it. |
| `work.station_item` | At its own station a familiar works with the station's tool — mallet at the Workbench (editing), book at Research, gray joystick with a muted red knob at Command (running), flask at Test — in a short beat and a rest. Only for a familiar whose station sheet exists (see below); reduced motion holds the tool still. It outranks the stationmates' glance, because the side-on frames hold no tool. |
| `work.stationmates` | Two working at the same station glance over at each other now and then. |
| `finished.homeward` | In the last minute before a quiet DONE becomes IDLE, the familiar glances toward the fire. |
| `trouble.fretting` | TROUBLE left for two minutes gets a small anxious hop now and then. |

**Station sheets** are optional art, one per familiar: `art/source/familiars/<id>-stations.png`,
a 4 × 2 sheet whose frames are listed in `art/source/station-contract.json`.
`npm run art:export` exports each at its familiar's base-sheet scale and
regenerates `src/station-sheets.js`; `npm run art:check` holds every sheet that
exists to the base sheet's rules. A familiar without one draws exactly as it
did before station sheets existed, so the family can gain its tools one
familiar at a time. Prompts are in `art/prompts/stations/`.

**Temperament** (`TEMPERAMENTS` in `src/familiars.js`) gives each familiar a
`tempo` between 0.8 and 1.3 that stretches how often its flourishes come round:
Spruce is brisk, Mica and Nettle are unhurried. It never changes a threshold —
seven minutes of waiting is "tapping" for everyone.

**The rules every row is tested against** (`tests/familiar-behaviour.test.js`):
listed here by id; presentation only and never mutates a record; deterministic;
reduced motion turns every flourish off and zeroes every lift; lift at most 3
units; nothing while walking or leaving; the turned back and the raised "?"
belong to NEEDS INPUT alone; and a flourish is active at most 15% of the time
and comes round no more often than every 6 s, even at the brisk end of tempo.

**Adding a behaviour:** add a row, list its id in the table above, and check it
in the art review (`npm run dev`, then `/docs/art-review.html`, scene
"Behaviours", with the time-in-state slider). The tests pick the row up on
their own.

**Pokes.** Clicking the fire stokes it (the glow swells and a burst of sparks
flies). Clicking the boat makes it bob and ring the water. A familiar always
wins the click, and a poke never changes the selection.

Timing comes from `record.stateSince`, which is event time, so a reload lands
every familiar in the mood it left. Reduced motion keeps the postures and the
stoke's light, and drops hops, taps, glances, sparks and the rocking.

---

## 5. The HUD language

The map and the panel are one instrument, not a game next to a web page.

- **Micro-labels** — anything that names a field rather than carrying its value —
  use `--hud-font` (mono), `--hud-label` size, `--hud-tracking`, uppercase, in
  `--muted`. This is the same type language the canvas draws its placards in.
- **Values** stay in the sans body face, because they are read, not scanned.
- **State chips** are square-cut with a 1px edge in the state colour: a readout
  on an instrument, not a web badge.
- **The viewport is framed in the same cedar batten as the placards** — a plain
  2px border, no corner ticks.
- **Rules are plain 1px hairlines.** No scored or dashed dividers.

### Adding a new HUD element

1. Does it name something? Give it `.hud-label` or the same three properties.
2. Does it carry state? Its colour is a `signals` token, never a near-miss.
3. Does it animate? It is decoration until proven otherwise — slower and quieter
   than an agent's own state, and it respects reduced motion.

---

## 6. Signage — how every label is made

Read off the plate: **every sign in this world is a made object.** A plank set
into a darker cedar batten, a soot edge, and a shadow under it. Nothing is a
floating rectangle.

The interface follows that, everywhere a label appears:

| Element | Where |
| --- | --- |
| Familiar action badge | `renderer.js` → `drawBadge` |
| Hover nameplate (outlined type, no plank) | `renderer.js` → `drawNameplate` |
| Station placards | `renderer.js` → `drawStationLabels` |
| The detail panel | `.inspector` |
| The connect dialog | `.connect-dialog` |
| Controls (connect, alert) | `.connect-button`, `.attention-banner` |

The recipe, in `sign` tokens:

1. `edge` — a soot outline, one pixel, under everything.
2. `batten` — cedar frame, 2px.
3. `plankTop` → `plankBottom` — the face, lit from above like every wooden thing
   on the plate.
4. The state colour as **trim**, never as the fill — along the foot of a badge,
   around the portrait frame in the panel.

The one exception is a **lit badge**. The three states that end a turn in your
court — `needs_input`, `trouble`, `finished` — fill the badge face with their
state colour and go dark on the glyph. Everything else keeps the unlit plank.
That is deliberately the same licence the alert pill has: when the whole object
*is* the signal, the signal may be the surface. It also means the first read is
value, not hue — a light badge or a dark one — which survives a palette a
colour-blind viewer cannot fully see.

### The badge carries one fact

The head tag used to be a two-line sign: the familiar's name, then a glyph and
the state spelled out. Both lines repeated something already on screen — the
station under its feet names the work, the panel names the familiar — so the
tag was cut to a single glyph at roughly a third of the area. Two rules keep
that safe, and `tests/ui-contract.test.js` enforces both:

- **No two states may share a glyph**, and in particular no two states that
  share a station. `arriving` and `preparing` both meant `spark` at the
  Workbench, and `needs_input` and `trouble` both meant `bang`; with the words
  gone, those were the same mark for different facts.
- **The badge has a floor in device pixels** (`hud.badgeFloor`, `hud.glyphFloor`).
  It is the only state signal drawn on the map, so it may not shrink into a
  smudge on a small window.

Names come back only on hover, as outlined type with the state beside it —
which is also where the glyph vocabulary is taught.

### Why the plank stays near-black

Stained cedar, not raw cedar. The face is warm but dark, because that value is
what keeps five different state colours legible over a bright map. The material
changed; the contrast did not. A light parchment sign was the more literal match
to the world's signboards and was rejected for exactly this reason — four bright
labels floating over the map fought the familiars for attention.

---

## 7. Shape — plain panels, one material

v0.13 tried to make the chrome look hand-made: four different radii on every
corner, buttons hung at half a degree, brass nails, wood grain, iron straps on
the drawer, knife-scored dividers and corner "camera" ticks on the viewport.
Each had a reason. Together they read as garnish — dots, stripes and wobble —
and on 2026-09-25 (v0.15) the user asked for them to go. They are gone, and
`tests/design-tokens.test.js` keeps them out.

What makes the interface feel like a game is not texture. It is:

1. **One material.** Every control and panel is the object the station
   placards on the map already are: `--plank` (the dark cedar face) inside a
   2px `--sign-batten` border, over a 1px `--sign-edge` outline.
2. **One button.** A plank on a dark `--lip` that drops onto it when pressed
   (`translateY(2px)` and `--pressed`). Variants change the edge colour, never
   the shape: brass while Connect is still a call to action, gold on the alert.
3. **Three radii.** `--radius-sm` (keys, chips, readouts), `--radius`
   (buttons, panels, dialog), `--radius-lg` (the world frame). The canvas uses
   one radius per shape too.
4. **Lights are signals.** A dot means a state: green beside "connected",
   ember in the bridge chip. The alert carries the same lit `!` badge a
   familiar wears when it needs you, so the alert and the creature are visibly
   one thing.
5. **The portrait is framed in the state colour**, the way a unit portrait is
   in a tactics game. That replaces the separate trim bar beside it.

### The rule, enforced

`tests/design-tokens.test.js` fails if a `border-radius` outside `:root` is
anything but a `--radius*` token, `0` (an edge docked against something) or
`50%` (a status light), and if the stylesheet contains `rotate(`, nails,
grain, straps, score lines, the worn highlight, or `::before` corner ticks on
the viewport.

## 8. Where things live

```
src/design/tokens.js     every shared value; the source of record
src/effects.js           firelight; imports tokens only
src/renderer.js          the world and its HUD; imports tokens only
src/styles.css           the DOM interface; mirrors :root from tokens
assets/palette/pnw-palette.json  the art pipeline's copy of the world palette
```

Tests that hold the system together:

| Test | What it prevents |
| --- | --- |
| `design-tokens.test.js` | The palette splitting into copies again; a stray hex in the stylesheet; a state shipping with no colour; the art straying into a signal's band; a machine-cut corner creeping back into the interface |
| `effects.test.js` | Ambient drawing over the interface; randomised worlds; canvas state leaking onto familiars |
| `world-model.test.js` | Familiars standing off their station or on each other |
| `ui-contract.test.js` | The panel covering the world; touch targets shrinking |

---

## 9. Adding an ambient effect

New light effects go in `effects.js` on `AmbientLayer`; water accents extend
`drawCreek()` in `world-art.js`. Their constants belong in `ambient` tokens.
Before adding one, note that the last three global effects were
removed for being noise — the bar is that the world is worse without it. It must:

- draw only in the ambient portion of the renderer, beneath familiars;
- balance every `save()` with a `restore()` (the test's stub models the stack);
- freeze its phase for reduced motion (`this.phase(elapsedMs)` in `effects.js`,
  zero elapsed seconds in `drawCreek()`);
- lay itself out deterministically, never with `Math.random()`;
- cost nothing measurable — the frame budget is 16.7ms and ambient currently
  uses a small fraction of it.
