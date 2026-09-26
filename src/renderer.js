import { farewellCopy, stateCopy } from "./state-language.js";
import { stationPlacards } from "./world-model.js";
import { ambient, hud, motion, sign as signMaterial, toneFor, type as typeface, ui } from "./design/tokens.js";
import { AmbientLayer, shadowInk, withAlpha } from "./effects.js";
import { FAMILIARS } from "./familiars.js";
import { SPRITE, STATION_FRAME_BASE, ArtTimeline, animationFrame, frameRect, helperCount, stablePhase } from "./art-animation.js";
import { STATION_SHEETS } from "./station-sheets.js";
import { StationArt, foreground, drawForeground, drawCreek, drawParcel, drawBoat, drawTapDust } from "./world-art.js";
import { impatience, waitLabel } from "./familiar-moods.js";
import { EMPTY_POSE, resolvePoses } from "./familiar-behaviour.js";

// The world is authored in a fixed 512x288 logical space. Everything below scales
// that space up to whatever backing store the display can actually show, so the
// illustrated plate renders at its own resolution instead of a 512px thumbnail.
export const WORLD_WIDTH = 512;
export const WORLD_HEIGHT = 288;

// The illustrated plate carries about 3.27 source pixels per logical world
// pixel. A 128px source frame gives the 42-unit familiar a comparable detail
// density, while keeping its footprint and interaction geometry unchanged.
const SPRITE_SIZE = SPRITE.size;
const SPRITE_DRAW = SPRITE.drawSize;

/* Every colour drawn on the world comes from the tokens module. The renderer
   holds no palette of its own, so changing the palette changes the whole world
   rather than the parts someone remembered to update. State colour arrives via
   `toneFor`, which is the same lookup the DOM panel uses — a state cannot be
   one colour on the map and another in the rail. */
const signal = { ink: ui.hudInk, paper: ui.hudPaper };

// Alpha variants, kept next to the thing they tint so the numbers are readable.
const tint = {
  signShadow: withAlpha(shadowInk, 0.55),
  contactShadow: shadowInk,
  hoverRing: withAlpha(ui.hudPaper, 0.55)
};

/* One glyph per state, and no two states may share one.

   The badge above a familiar's head is now the only thing it carries, so a
   shape that means two different things is a shape that means nothing. `bang`
   used to cover both "needs you" and "trouble" and `spark` covered both
   "preparing" and "arriving" — colour told them apart, which is no help to
   anyone reading shape first, and no help at all to the third of a glance that
   lands on the map before it lands on the palette. */
export const stateGlyph = {
  investigating: "search",
  editing: "pencil",
  running: "chevron",
  testing: "flask",
  preparing: "spark",
  needs_input: "bang",
  trouble: "cross",
  finished: "check",
  idle: "moon",
  arriving: "dots",
  /* Not a lifecycle state: the badge a familiar wears on its way out. */
  leaving: "wave"
};

/* The three states that end a turn in your court. Theirs are the only badges
   filled with a state colour instead of painted on a dark plank: three lit
   signs among however many unlit ones, which is the read this whole screen
   exists to give. The rest stay dark so that staying dark means something. */
const litStates = new Set(["needs_input", "trouble", "finished"]);

export class WorldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.pixelRatio = 1;
    /* How many CSS pixels of the right edge the drawer is lying over. The world
       does not move for it — this is a fixed board, the way a tactics game's is,
       and a camera that only ever moves as an involuntary reaction to a click is
       a camera nobody can build a model of. What the world owes instead is an
       accounting: anyone standing behind the drawer is redrawn at its edge, so
       the panel can cover ground without ever costing you a session. */
    this.coverRight = 0;
    /* Weather is drawn, not authored into the plate, so it can breathe. A
       viewer who asked for less motion gets the light and the haze without the
       movement — the atmosphere is the point, the animation is the flourish. */
    /* Asked once and held: a viewer who wants less motion gets a still pulse
       and a still reticle too, not just still weather. Those two were animating
       straight through the preference because only the weather was ever told. */
    this.reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.ambient = new AmbientLayer({ reducedMotion: this.reducedMotion });
    this.timeline = new ArtTimeline();
    this.stationArt = new StationArt();
    // When the boat was last knocked, in page milliseconds.
    this.boatKnockedAt = -Infinity;
    this.motionPreference = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.motionPreference?.addEventListener("change", (event) => {
      this.reducedMotion = event.matches;
      this.ambient.reducedMotion = event.matches;
    });
    this.map = new Image();
    this.helper = new Image();
    this.stationBases = [];
    this.sprites = new Map(FAMILIARS.map(({ type }) => [type, new Image()]));
    /* Station-work sheets are optional, so they may never cost the world its
       first frame: a sheet that fails to load is left out of this map and its
       familiar draws its ordinary frames. Only sheets that really loaded are
       in here, and the behaviour engine asks this map before it asks for one. */
    this.stationSprites = new Map();
    this.ready = Promise.all([
      ...Object.entries(STATION_SHEETS).map(([type, source]) => {
        const image = new Image();
        return loadImage(image, source).then(() => { this.stationSprites.set(type, image); }, () => {});
      }),
      loadImage(this.map, "./assets/map/workshop-plate-v3.png"),
      loadImage(this.helper, "./assets/sprites/toolbox-helper-v1.png"),
      fetch("./assets/map/workshop-layers-v1.json").then((response) => {
        if (!response.ok) throw new Error("Workshop layer manifest unavailable");
        return response.json();
      }).then(async (manifest) => {
        this.stationBases = await Promise.all(manifest.stations.map(async (station) => {
          const image = new Image(); await loadImage(image, `./${station.image}`);
          return { ...station, image, sourceSize: manifest.size };
        }));
      }),
      ...FAMILIARS.map(({ type, image }) => loadImage(this.sprites.get(type), image))
    ]);
    this.resize();
  }

  // Match the backing store to the element's real pixel size so the plate is not
  // rendered at 512px and then stretched by CSS. The canvas fills its frame and
  // letterboxes the world internally, which keeps the drawn rect something we
  // can map pointer coordinates back through.
  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = rect.width || this.canvas.clientWidth || WORLD_WIDTH;
    const cssHeight = rect.height || this.canvas.clientHeight || WORLD_HEIGHT;
    const width = Math.max(WORLD_WIDTH, Math.round(cssWidth * ratio));
    const height = Math.max(WORLD_HEIGHT, Math.round(cssHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.pixelRatio = width / (cssWidth || 1);
    this.layout();
  }

  /* Tell the world how much of its right edge the drawer is lying over, in CSS
     pixels. Nothing rescales and nothing slides; this is only so the world knows
     who it has to redraw at the edge. */
  setCover(right = 0) {
    this.coverRight = right;
  }

  /* Somebody touched the world rather than a familiar. Only the thing touched
     answers; no session, selection or signal is involved. */
  poke(landmark, elapsed) {
    if (landmark === "fire") this.ambient.stoke(elapsed);
    else if (landmark === "boat") this.boatKnockedAt = elapsed;
    else return false;
    return true;
  }

  layout() {
    this.scale = Math.min(this.canvas.width / WORLD_WIDTH, this.canvas.height / WORLD_HEIGHT);
    this.offsetX = Math.round((this.canvas.width - WORLD_WIDTH * this.scale) / 2);
    this.offsetY = Math.round((this.canvas.height - WORLD_HEIGHT * this.scale) / 2);
  }

  // Pointer position (CSS px, relative to the canvas) -> logical world units.
  toWorld(cssX, cssY) {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.canvas.width / (rect.width || 1);
    return {
      x: (cssX * ratio - this.offsetX) / this.scale,
      y: (cssY * ratio - this.offsetY) / this.scale
    };
  }

  draw(records, elapsed, selectedId = null, hoveredId = null, now = Date.now()) {
    const context = this.context;
    this.timeline.update(records, elapsed);
    /* Behaviours are read once a frame, off the wall clock for how long a
       state has lasted and the page clock for cadence. The table lives in
       familiar-behaviour.js; this only asks it for one pose per familiar. */
    this.now = now;
    this.poses = resolvePoses(records, { now, elapsed, reducedMotion: this.reducedMotion, stationSheets: this.stationSprites });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Both the plate and the high-density familiar atlases are illustrated pixel
    // art being fitted to the world, so they share the same sampling treatment.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      this.map,
      this.offsetX, this.offsetY,
      WORLD_WIDTH * this.scale, WORLD_HEIGHT * this.scale
    );
    for (const station of this.stationBases) {
      const [x, y, width, height] = station.sourceRect;
      const sx = WORLD_WIDTH * this.scale / station.sourceSize[0], sy = WORLD_HEIGHT * this.scale / station.sourceSize[1];
      context.drawImage(station.image, this.offsetX + x * sx, this.offsetY + y * sy, width * sx, height * sy);
    }

    /* Everything ambient happens here, between the plate and everyone standing
       on it. Nothing below this line may tint a familiar, a tag or a placard:
       atmosphere is allowed to change how the world feels and never what it
       says. */
    this.ambient.draw(context, {
      x: this.offsetX,
      y: this.offsetY,
      width: WORLD_WIDTH * this.scale,
      height: WORLD_HEIGHT * this.scale,
      scale: this.scale
    }, elapsed);
    const view = { x: this.offsetX, y: this.offsetY, scale: this.scale };
    drawCreek(context, view, elapsed, this.reducedMotion);
    drawBoat(context, this.map, view, elapsed - this.boatKnockedAt, this.reducedMotion);
    this.stationArt.draw(context, view, records, elapsed, this.timeline, this.reducedMotion);

    /* The placards carry more weight than they used to: with the state spelled
       out over every head, a station name was the third label in one glance,
       and now it is the only one naming the place. They are still measured
       against the badges first and yield to one that lands on them, but a badge
       is small and rides high, so in practice a station stays named even while
       it is occupied — which is when its name is worth the most. */
    const sorted = [...records].sort((a, b) => a.controller.position.y - b.controller.position.y);
    const badges = sorted.map((record) => this.badgeRect(record));
    this.drawStationLabels(badges);

    const layers = [
      ...sorted.map((record) => ({ depth: record.controller.position.y, record })),
      ...foreground.map((mask) => ({ depth: mask.depth, mask }))
    ].sort((a, b) => a.depth - b.depth);
    for (const layer of layers) {
      if (layer.mask) drawForeground(context, this.map, layer.mask, view);
      else this.drawAgent(layer.record, elapsed, layer.record.key === selectedId, layer.record.key === hoveredId);
    }
    // Signals always draw last; foreground and neighboring bodies cannot hide
    // an alert. The body and badge share the same departure opacity.
    for (const [index, record] of sorted.entries()) {
      const agent = record.controller;
      const tone = toneFor(agent.leaving ? "disconnected" : agent.state);
      context.save();
      context.globalAlpha = agent.leaving ? 1 - agent.departure : 1;
      this.drawBadge(record, tone, elapsed, badges[index]);
      if (record.key === hoveredId) this.drawNameplate(record, badges[index], tone);
      context.restore();
    }

    this.drawEdgeMarkers(sorted, elapsed, selectedId, hoveredId);
  }

  /* Anyone standing behind the drawer, redrawn as their badge in a column at
     the edge of the ground you can still see. This is the off-screen-unit
     marker every game with a camera and a panel has — XCOM's edge chevrons,
     Total War's off-screen banners — and it is what makes a panel that covers
     the map an honest trade: the map loses pixels, never a session.

     They are the same badge the familiar wears, so there is nothing new to
     learn, and the selected one keeps the paper ring it wears in the world. */
  edgeMarkers(records) {
    const cover = this.coverRight * this.pixelRatio;
    if (!cover) return [];
    const size = this.badgeSize();
    const gap = hud.badgeGap * this.scale;
    const edge = this.canvas.width - cover;
    return [...records].sort((a, b) => a.controller.position.y - b.controller.position.y || a.key.localeCompare(b.key))
      .filter((record) => record.controller.position.x * this.scale + this.offsetX > edge - size * 0.5)
      .map((record, index) => ({ record, size, gap,
        x: edge - size * 2 - gap * 2,
        y: this.offsetY + gap * 3 + index * (size + gap * 1.6),
        width: size * 2 + gap, height: size, rightBound: edge - gap }));
  }

  edgeRecordAt(records, cssX, cssY) {
    const x = cssX * this.pixelRatio, y = cssY * this.pixelRatio;
    return this.edgeMarkers(records).find((box) => !box.record.leaving &&
      x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height)?.record || null;
  }

  drawEdgeMarkers(records, elapsed, selectedId, hoveredId) {
    const context = this.context;
    for (const box of this.edgeMarkers(records)) {
      const { record, x, y, size, gap } = box;
      const tone = toneFor(record.leaving ? "disconnected" : record.controller.state);
      const sprite = this.sprites.get(record.familiarType);
      if (sprite?.complete && sprite.naturalWidth) context.drawImage(sprite, 0, SPRITE_SIZE * 4, SPRITE_SIZE, SPRITE_SIZE, x, y, size, size);
      const badge = { ...box, x: x + size + gap, visible: true };
      this.drawBadge(record, tone, elapsed, badge);
      if (record.key === selectedId || record.key === hoveredId) {
        context.save();
        context.strokeStyle = signal.paper;
        context.lineWidth = Math.max(1.5, 1.2 * this.scale);
        roundRect(context, x - gap * 0.6, y - gap * 0.6, box.width + gap * 1.2, size + gap * 1.2, hud.badgeRadius * this.scale);
        context.stroke();
        context.restore();
      }
      if (record.key === hoveredId) this.drawNameplate(record, badge, tone);
    }
  }

  drawStationLabels(badges = []) {
    const context = this.context;
    const scale = this.scale;
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `700 ${Math.max(7, Math.round(hud.placardType * scale))}px ${typeface.mono}`;
    for (const station of stationPlacards) {
      const x = station.x * scale + this.offsetX;
      const y = station.y * scale + this.offsetY;
      const paddingX = hud.placardPadX * scale;
      const height = hud.placardHeight * scale;
      const width = context.measureText(station.label).width + paddingX * 2;
      const box = { x: x - width / 2, y: y - height / 2, width, height };
      if (badges.some((badge) => badge.visible !== false && overlaps(badge, box))) continue;

      /* The same made object as a familiar's badge, stretched into a plank: the
         world's own signs are hand-painted on cedar, so the ones the renderer
         adds are too — otherwise the map carries two kinds of sign and only one
         of them belongs. */
      const left = x - width / 2;
      const top = y - height / 2;
      const inset = Math.max(1, 0.7 * scale);
      context.fillStyle = signMaterial.batten;
      roundRect(context, left, top, width, height, 1.8 * scale);
      context.fill();

      const plank = context.createLinearGradient(0, top, 0, top + height);
      plank.addColorStop(0, signMaterial.plankTop);
      plank.addColorStop(1, signMaterial.plankBottom);
      context.fillStyle = plank;
      roundRect(context, left + inset, top + inset, width - inset * 2, height - inset * 2, 1.2 * scale);
      context.fill();

      context.fillStyle = signal.paper;
      context.fillText(station.label, x, y + 0.3 * scale);
    }
    context.restore();
  }

  drawAgent(record, elapsed, selected, hovered = false, box = null) {
    const context = this.context;
    const agent = record.controller;
    const scale = this.scale;
    /* A familiar on its way out has gone cold: the badge and its trim take
       the disconnected grey, whatever it was doing when the session ended. */
    const tone = toneFor(agent.leaving ? "disconnected" : agent.state);

    // Logical position -> device pixels, inside the letterboxed world rect.
    const cx = agent.position.x * scale + this.offsetX;
    const baseY = agent.position.y * scale + this.offsetY;
    const size = SPRITE_DRAW * scale;

    // Authored contact/passing poses carry the gait; keep the foot pivot fixed.
    const spriteX = Math.round(cx - size / 2);
    const spriteY = Math.round(baseY - size * SPRITE.pivotY / SPRITE.size);

    context.save();
    /* The last stretch of the walk out fades the whole familiar — shadow,
       ring, sprite and badge together — so it goes through the gate rather
       than being cut off by the edge of the picture. */
    const presence = agent.leaving ? 1 - agent.departure : 1;
    const alpha = (value) => value * presence;
    if (presence < 1) context.globalAlpha = presence;

    // Contact shadow — without this the familiar floats over the illustration.
    context.globalAlpha = alpha(0.3);
    context.fillStyle = tint.contactShadow;
    context.beginPath();
    context.ellipse(cx, baseY + 1 * scale, size * 0.3, size * 0.12, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = alpha(1);

    // A turning dashed reticle for the selection, a still ring for whatever the
    // pointer is over: the two reads never get confused for each other.
    if (selected || hovered) {
      context.save();
      context.strokeStyle = selected ? signal.paper : tint.hoverRing;
      context.lineWidth = Math.max(1.5, 1.4 * scale);
      if (selected) {
        context.setLineDash([4.5 * scale, 3.5 * scale]);
        if (!this.reducedMotion) context.lineDashOffset = -(elapsed / motion.selectionSpinMs) % 4096;
      }
      context.globalAlpha = alpha(selected ? 0.95 : 0.8);
      context.beginPath();
      context.ellipse(cx, baseY + 1 * scale, size * 0.36, size * 0.16, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    // Attention pulse rides on the ground ring so it reads from across the room.
    if (agent.state === "needs_input" && !agent.leaving) {
      const pulse = this.reducedMotion ? 0.5 : (Math.sin(elapsed / motion.attentionPulseMs) + 1) / 2;
      context.strokeStyle = toneFor("needs_input");
      context.lineWidth = Math.max(1.5, 2 * scale);
      context.globalAlpha = 0.25 + pulse * 0.6;
      context.beginPath();
      context.ellipse(cx, baseY + 1 * scale, size * (0.4 + pulse * 0.28), size * (0.18 + pulse * 0.12), 0, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const phase = stablePhase(record.key);
    let frame = animationFrame(agent, elapsed, {
      reducedMotion: this.reducedMotion, phase,
      stateAge: this.timeline.get(record.key, elapsed).age
    });
    /* A behaviour changes posture and nothing else: which frame, a lift, the
       tap of a foot. Only a familiar standing still has one. */
    const pose = this.poses?.get(record.key) ?? EMPTY_POSE;
    let sprite = this.sprites.get(record.familiarType) || this.sprites.get(FAMILIARS[0].type);
    if (pose.frame !== null && pose.frame >= STATION_FRAME_BASE) {
      // A station frame lives on the familiar's station sheet. The engine only
      // names one for a sheet that loaded; the check here is belt and braces.
      const sheet = this.stationSprites?.get(record.familiarType);
      if (sheet) { sprite = sheet; frame = frameRect(pose.frame - STATION_FRAME_BASE); }
    } else if (pose.frame !== null) {
      frame = frameRect(pose.frame);
    }
    const lift = Math.round(pose.lift * scale);
    context.drawImage(sprite, frame.x, frame.y, SPRITE_SIZE, SPRITE_SIZE, spriteX, spriteY - lift, size, size);
    if (pose.tap) drawTapDust(context, cx, baseY, scale);
    if (agent.moving && agent.state === "finished" && !agent.leaving) drawParcel(context, cx, baseY, scale);
    context.globalAlpha = alpha(1);
    this.drawHelpers(record, cx, baseY, scale, elapsed, presence);
    context.restore();
  }

  /* Where a familiar's badge will land, without drawing it. The placards are
     laid out before the familiars are, so the two are measured once here and
     both drawn from the same numbers. */
  badgeRect(record) {
    const scale = this.scale;
    const size = this.badgeSize();
    const sprite = SPRITE_DRAW * scale;
    const cx = record.controller.position.x * scale + this.offsetX;
    const baseY = record.controller.position.y * scale + this.offsetY;
    const spriteTop = Math.round(baseY - sprite * SPRITE.pivotY / SPRITE.size);

    const worldLeft = this.offsetX + 2 * scale;
    const worldRight = this.offsetX + WORLD_WIDTH * scale - 2 * scale;
    const x = Math.round(Math.max(worldLeft, Math.min(cx - size / 2, worldRight - size)));
    // The badge rides the head, so it hops when the familiar does.
    const lift = this.poses?.get(record.key)?.lift ?? 0;
    const y = Math.round(spriteTop - size + hud.badgeDrop * scale - lift * scale);
    /* Resting wears no badge. A familiar sitting at the campfire, under a
       placard that reads IDLE, doing nothing, does not need a mark to say so —
       and "nothing to report" is the one state worth spending no ink on. The
       box is still measured, because the placards are laid out against it. */
    const visible = record.controller.state !== "idle" || record.controller.leaving;
    return { x, y, width: visible ? size : 0, height: visible ? size : 0, size, visible };
  }

  // One floor, so the only state signal on the map cannot shrink into a smudge.
  badgeSize() {
    return Math.max(hud.badgeFloor, hud.badgeSize * this.scale);
  }

  /* One badge, one fact: what this session is doing right now.

     It used to be a two-line sign — the familiar's name, then a glyph and the
     state spelled out — and both lines were saying something the screen already
     said. The station under its feet names the work. The panel names the
     familiar. So what is left is the action, and the action is a shape, which
     is the fastest thing a person can read from across a room.

     It is still the same made object as every other label in this world: a
     plank set into a cedar batten over a soot edge. Shrunk to one glyph, and
     given a tail, so it belongs to the character under it rather than floating
     somewhere over the map. */
  drawBadge(record, tone, elapsed, box) {
    if (box.visible === false) return;
    const context = this.context;
    const scale = this.scale;
    const state = record.controller.leaving ? "leaving" : record.controller.state;
    const size = box.size ?? this.badgeSize();
    const radius = hud.badgeRadius * scale;
    const { x, y } = box;
    const lit = litStates.has(state);

    context.save();

    // The badge sits above the ground it shades, so the shadow is its own pass.
    context.save();
    context.shadowColor = tint.signShadow;
    context.shadowBlur = 4 * scale;
    context.shadowOffsetY = 1.4 * scale;
    context.fillStyle = signMaterial.edge;
    roundRect(context, x, y, size, size, radius);
    context.fill();
    context.restore();

    // Batten: the darker cedar frame the face is set into.
    context.fillStyle = signMaterial.batten;
    roundRect(context, x, y, size, size, radius);
    context.fill();

    /* The face. Three states end a turn in your court, and those three light
       up: the badge becomes the state colour and the glyph goes dark on it.
       The rest keep the unlit plank and paint the glyph instead, so a busy map
       stays quiet and a map that wants you cannot be missed. In greyscale that
       is still the read — a light badge or a dark one — which is the question
       this screen exists to answer, and the one that must survive a palette
       nobody can see all of. */
    const inset = Math.max(1, 0.9 * scale);
    const face = size - inset * 2;
    if (lit) {
      context.fillStyle = tone;
    } else {
      const plank = context.createLinearGradient(0, y, 0, y + size);
      plank.addColorStop(0, signMaterial.plankTop);
      plank.addColorStop(1, signMaterial.plankBottom);
      context.fillStyle = plank;
    }
    roundRect(context, x + inset, y + inset, face, face, radius * 0.7);
    context.fill();

    /* Painted trim along the foot of the unlit badge. On the old sign this was
       a stripe up the left edge, which at a sixth of the size is a hairline
       nobody reads. The foot is the full width, so the state still has a bar of
       its own colour even when the glyph is too small to resolve. */
    if (!lit) {
      const trim = Math.max(1.5, hud.badgeTrim * scale);
      context.fillStyle = tone;
      roundRect(context, x + inset, y + size - inset - trim, face, trim, radius * 0.5);
      context.fill();
    }

    const glyph = Math.max(hud.glyphFloor, hud.badgeGlyph * scale);
    const top = lit ? (size - glyph) / 2 : (size - glyph) / 2 - Math.max(1, hud.badgeTrim * scale) * 0.5;
    drawGlyph(
      context,
      stateGlyph[state] || "spark",
      x + (size - glyph) / 2,
      y + top,
      glyph,
      lit ? signal.ink : tone,
      this.reducedMotion ? 0 : elapsed
    );
    context.restore();
  }

  /* A name is not on the map any more; it is in the panel, which is where you
     go when you want to know. The one exception is the pointer. Hovering is a
     question, and an answer that arrives under the cursor and leaves with it
     costs the resting map nothing. Outlined rather than boxed, so it reads as a
     nameplate and not as a second sign competing with the badge.

     One line: the name and the state. Where the session lives is in the
     panel, one click away; under the cursor it was a second line to read. */
  drawNameplate(record, box, tone) {
    const context = this.context;
    const scale = this.scale;
    const size = Math.max(9, Math.round(hud.nameType * scale));
    const name = record.agentName.toUpperCase();
    const waited = waitLabel(impatience(record, this.now ?? Date.now()).waited);
    const state = (record.controller.leaving ? farewellCopy(record.leaving?.reason) : stateCopy(record.controller.state)).label.toUpperCase() +
      (waited ? ` · ${waited.toUpperCase()}` : "");
    const separator = "  ";

    context.save();
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.lineJoin = "round";
    const gap = hud.badgeGap * scale;
    const baseline = (box.visible === false ? box.y + (box.size ?? 0) : box.y) - gap;
    const centre = box.x + (box.size ?? box.width) / 2;
    const worldLeft = this.offsetX + 2 * scale;
    const worldRight = Math.min(this.offsetX + WORLD_WIDTH * scale - 2 * scale, box.rightBound ?? Infinity);
    // Centred over the badge, then kept inside the plate: a nameplate near
    // the edge slides in rather than off.
    const fit = (width) => Math.max(worldLeft, Math.min(centre - width / 2, worldRight - width));

    context.font = `700 ${size}px ${typeface.mono}`;
    const nameWidth = context.measureText(name + separator).width;
    const total = nameWidth + context.measureText(state).width;
    const left = fit(total);

    /* Outlined, not boxed. A second plank over the badge would be the sign this
       whole change removed; a game nameplate is type with a dark edge so it
       survives whatever it lands on. */
    context.lineWidth = Math.max(2.5, 2.6 * scale);
    context.strokeStyle = signal.ink;
    context.strokeText(name + separator, left, baseline);
    context.strokeText(state, left + nameWidth, baseline);
    context.fillStyle = signal.paper;
    context.fillText(name + separator, left, baseline);
    // The state in its own colour, so hovering is also where the glyph is read.
    context.fillStyle = tone;
    context.fillText(state, left + nameWidth, baseline);
    context.restore();
  }

  drawHelpers(record, cx, baseY, scale, elapsed, presence) {
    const { visible, overflow } = helperCount(record.subagents);
    const history = this.timeline.get(record.key, elapsed);
    const duration = this.reducedMotion ? 0 : 550;
    const transitioning = history.helperAge < duration;
    const shown = transitioning ? Math.max(visible, history.previousHelpers) : visible;
    if (!shown) return;
    const context = this.context;
    const size = 12 * scale, spacing = 12 * scale;
    const startX = cx - ((shown - 1) * spacing) / 2;
    for (let index = 0; index < shown; index += 1) {
      const retiring = index >= visible;
      const emerging = transitioning && index >= history.previousHelpers;
      const progress = duration ? Math.min(1, history.helperAge / duration) : 1;
      const amount = retiring ? 1 - progress : emerging ? progress : 1;
      const tick = this.reducedMotion ? 0 : Math.floor((elapsed + index * 130) / 320) % 2;
      const agent = record.controller;
      const frame = retiring ? 6 + tick : emerging ? 0 : agent.moving ? 1 + tick : ["needs_input", "idle", "finished", "trouble"].includes(agent.state) ? 5 : 3 + tick;
      context.globalAlpha = presence * amount;
      const rendered = size * (0.65 + amount * 0.35);
      context.drawImage(this.helper, frame % 4 * 64, Math.floor(frame / 4) * 64, 64, 64,
        startX + index * spacing - rendered / 2, baseY + 3 * scale + (1 - amount) * 3 * scale, rendered, rendered);
    }
    if (overflow) {
      context.globalAlpha = presence; context.font = `700 ${Math.max(10, 4.5 * scale)}px ${typeface.mono}`;
      context.textAlign = "left"; context.lineWidth = 1.8 * scale; context.strokeStyle = signal.ink; context.fillStyle = signal.paper;
      const label = `+${overflow}`, x = cx + 20 * scale, y = baseY + 13 * scale;
      context.strokeText(label, x, y); context.fillText(label, x, y);
    }
    context.globalAlpha = presence;
  }
}

// Small vector glyphs, drawn rather than sprited so they stay crisp at any scale.
function drawGlyph(context, kind, x, y, size, tone, elapsed) {
  const unit = size / 8;
  context.save();
  context.translate(x, y);
  context.strokeStyle = tone;
  context.fillStyle = tone;
  context.lineWidth = Math.max(1, unit * 1.1);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (kind === "search") {
    context.beginPath();
    context.arc(unit * 3.2, unit * 3.2, unit * 2.4, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(unit * 5, unit * 5);
    context.lineTo(unit * 7.2, unit * 7.2);
    context.stroke();
  } else if (kind === "pencil") {
    context.beginPath();
    context.moveTo(unit, unit * 7);
    context.lineTo(unit * 1.8, unit * 5.2);
    context.lineTo(unit * 6, unit);
    context.lineTo(unit * 7, unit * 2);
    context.lineTo(unit * 2.8, unit * 6.2);
    context.closePath();
    context.fill();
  } else if (kind === "chevron") {
    context.beginPath();
    context.moveTo(unit * 1.6, unit * 2);
    context.lineTo(unit * 4.4, unit * 4);
    context.lineTo(unit * 1.6, unit * 6);
    context.stroke();
    context.beginPath();
    context.moveTo(unit * 5.2, unit * 6.2);
    context.lineTo(unit * 7.4, unit * 6.2);
    context.stroke();
  } else if (kind === "flask") {
    context.beginPath();
    context.moveTo(unit * 3, unit);
    context.lineTo(unit * 3, unit * 3.4);
    context.lineTo(unit * 1.4, unit * 6.6);
    context.lineTo(unit * 6.6, unit * 6.6);
    context.lineTo(unit * 5, unit * 3.4);
    context.lineTo(unit * 5, unit);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(unit * 2.4, unit);
    context.lineTo(unit * 5.6, unit);
    context.stroke();
  } else if (kind === "check") {
    context.beginPath();
    context.moveTo(unit * 1.4, unit * 4.2);
    context.lineTo(unit * 3.2, unit * 6.2);
    context.lineTo(unit * 6.8, unit * 1.8);
    context.stroke();
  } else if (kind === "cross") {
    // Trouble is a fault mark, not an exclamation. "Needs you" already owns the
    // exclamation, and the two must not be the same shape in two colours.
    context.beginPath();
    context.moveTo(unit * 1.9, unit * 1.9);
    context.lineTo(unit * 6.1, unit * 6.1);
    context.stroke();
    context.beginPath();
    context.moveTo(unit * 6.1, unit * 1.9);
    context.lineTo(unit * 1.9, unit * 6.1);
    context.stroke();
  } else if (kind === "dots") {
    // Arriving: the universal "starting up". Distinct from preparing's spark.
    for (const cx of [unit * 1.7, unit * 4, unit * 6.3]) {
      context.beginPath();
      context.arc(cx, unit * 4, unit * 0.85, 0, Math.PI * 2);
      context.fill();
    }
  } else if (kind === "bang") {
    context.beginPath();
    context.moveTo(unit * 4, unit);
    context.lineTo(unit * 4, unit * 4.8);
    context.stroke();
    context.beginPath();
    context.arc(unit * 4, unit * 6.6, unit * 0.75, 0, Math.PI * 2);
    context.fill();
  } else if (kind === "moon") {
    context.beginPath();
    context.arc(unit * 4.4, unit * 4, unit * 3, Math.PI * 0.25, Math.PI * 1.45);
    context.stroke();
  } else if (kind === "wave") {
    /* A raised hand, waving: palm, three fingers, a thumb, and the little
       arc of motion beside it. The one badge that is a gesture rather than a
       tool, because leaving is the one thing a familiar does for you and not
       for the work. It rocks a few degrees either way while the familiar
       walks; reduced motion holds it still. */
    const rock = elapsed ? Math.sin(elapsed / 260) * 0.22 : 0;
    context.save();
    context.translate(unit * 3.6, unit * 5.4);
    context.rotate(rock);
    context.translate(-unit * 3.6, -unit * 5.4);
    context.lineWidth = Math.max(1, unit * 1.05);
    for (const [x, top] of [[2.4, 1.6], [3.6, 1.0], [4.8, 1.6]]) {
      context.beginPath();
      context.moveTo(unit * x, unit * top);
      context.lineTo(unit * x, unit * 3.8);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(unit * 1.9, unit * 4.6);
    context.lineTo(unit * 0.9, unit * 3.4);
    context.stroke();
    context.beginPath();
    context.moveTo(unit * 2.0, unit * 3.6);
    context.lineTo(unit * 5.2, unit * 3.6);
    context.lineTo(unit * 5.2, unit * 6.0);
    context.lineTo(unit * 3.6, unit * 7.0);
    context.lineTo(unit * 2.0, unit * 6.0);
    context.closePath();
    context.fill();
    context.restore();
    context.lineWidth = Math.max(1, unit * 0.8);
    context.beginPath();
    context.arc(unit * 5.6, unit * 2.4, unit * 1.8, -Math.PI * 0.35, Math.PI * 0.2);
    context.stroke();
  } else {
    const twinkle = 0.7 + Math.sin(elapsed / 240) * 0.3;
    context.globalAlpha = twinkle;
    context.beginPath();
    context.moveTo(unit * 4, unit * 0.8);
    context.lineTo(unit * 4.9, unit * 3.1);
    context.lineTo(unit * 7.2, unit * 4);
    context.lineTo(unit * 4.9, unit * 4.9);
    context.lineTo(unit * 4, unit * 7.2);
    context.lineTo(unit * 3.1, unit * 4.9);
    context.lineTo(unit * 0.8, unit * 4);
    context.lineTo(unit * 3.1, unit * 3.1);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/* Takes one radius or four, in top-left, top-right, bottom-right, bottom-left
   order. Each corner is clamped to half the shorter side, so a small window
   never rounds a badge into a lozenge. */
function roundRect(context, x, y, width, height, radius) {
  const limit = Math.min(width, height) / 2;
  const corners = (Array.isArray(radius) ? radius : [radius, radius, radius, radius])
    .map((value) => Math.max(0, Math.min(value, limit)));
  const [tl, tr, br, bl] = corners;
  context.beginPath();
  context.moveTo(x + tl, y);
  context.lineTo(x + width - tr, y);
  context.arcTo(x + width, y, x + width, y + height, tr);
  context.lineTo(x + width, y + height - br);
  context.arcTo(x + width, y + height, x, y + height, br);
  context.lineTo(x + bl, y + height);
  context.arcTo(x, y + height, x, y, bl);
  context.lineTo(x, y + tl);
  context.arcTo(x, y, x + width, y, tl);
  context.closePath();
}

function loadImage(image, source) {
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = source;
  });
}
