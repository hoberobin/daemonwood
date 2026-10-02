import { ambient, ui } from "./design/tokens.js";

export const WORLD_WIDTH = 512;
export const WORLD_HEIGHT = 288;

/* Pure black is never drawn on this plate; the deepest value in the art is a
   warm near-black, and a true black contact shadow reads as a hole. */
export const shadowInk = ui.hudInk;

/* Colour helpers. Tokens store one canonical value per colour and callers vary
   only its alpha, so a colour is changed in exactly one place. */
export function withAlpha(color, alpha) {
  const clamped = Math.min(Math.max(alpha, 0), 1);
  if (color.startsWith("rgba")) return color.replace(/[\d.]+\s*\)$/, `${round(clamped)})`);
  if (color.startsWith("rgb")) return color.replace(/^rgb\(/, "rgba(").replace(/\)$/, `, ${round(clamped)})`);
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  const value = Number.parseInt(full, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${round(clamped)})`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/* Where the fire actually is on the illustrated plate, in world units. The
   campfire is painted into the background, so this layer never draws a flame —
   it draws the light that flame casts and the embers it throws, which is what
   was missing. Measured against assets/map/workshop-plate-v3.png; re-measure if the
   plate changes. */
export const FIRE = Object.freeze({ x: 258, y: 132, radius: 34 });

// Centres of painted lanterns, measured in the same 512 × 288 space as FIRE.
// A small selection across the map keeps the light local and leaves the status
// colours to the badges. The phases are fixed so reloads never reshuffle them.
export const LANTERNS = Object.freeze([
  { x: 56, y: 41, phase: 0.12 },
  { x: 139, y: 41, phase: 0.68 },
  { x: 224, y: 37, phase: 0.35 },
  { x: 286, y: 61, phase: 0.82 },
  { x: 73, y: 198, phase: 0.49 },
  { x: 358, y: 196, phase: 0.93 }
]);

/* Local light over the painted world. The campfire is painted into the plate
   mid-flame and frozen; this draws the light that flame casts and the embers it
   throws. Lanterns get a smaller, slower pulse around their painted centres.
   It draws BELOW the familiars and their tags, so no amount of atmosphere can
   cost the interface a pixel of legibility. */
export class AmbientLayer {
  constructor({ reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.embers = buildEmbers(ambient.emberCount);
    this.sparks = buildSparks(ambient.stokeSparkCount);
    /* When the fire was last poked, in page milliseconds. A few pokes in a row
       stack, up to a limit, so tapping it quickly builds a bigger blaze. */
    this.stokes = [];
  }

  /* Somebody poked the fire. Presentation only: nothing about any session
     changes, and nothing but the fire answers. */
  stoke(elapsedMs) {
    this.stokes = [...this.stokes.filter((at) => elapsedMs - at < ambient.stokeMs), elapsedMs].slice(-ambient.stokeLimit);
  }

  /* How much brighter than usual the fire is burning right now, from 0. The
     flare rises fast and settles slowly, the way a log catches. */
  flare(elapsedMs) {
    let total = 0;
    for (const at of this.stokes) {
      const age = elapsedMs - at;
      if (age < 0 || age >= ambient.stokeMs) continue;
      const rise = Math.min(1, age / 140);
      total += rise * (1 - age / ambient.stokeMs) ** 2;
    }
    return total * ambient.stokeFlare;
  }

  /* Seconds since load, or a frozen instant when the viewer asked for less
     motion. Freezing rather than skipping keeps the fire lit — it removes the
     movement, not the light. */
  phase(elapsedMs) {
    return this.reducedMotion ? 0 : elapsedMs / 1000;
  }

  draw(context, view, elapsedMs) {
    this.drawFirelight(context, view, this.phase(elapsedMs), this.flare(elapsedMs));
    this.drawLanterns(context, view, this.phase(elapsedMs));
    if (!this.reducedMotion) this.drawSparks(context, view, elapsedMs);
  }

  drawLanterns(context, view, seconds) {
    context.save();
    context.globalCompositeOperation = "screen";
    for (const lantern of LANTERNS) {
      const breath = 0.8 + Math.sin((seconds / ambient.lanternPulseSeconds + lantern.phase) * Math.PI * 2) * 0.2;
      const px = view.x + lantern.x * view.scale;
      const py = view.y + lantern.y * view.scale;
      const radius = ambient.lanternRadius * view.scale;
      const glow = context.createRadialGradient(px, py, 0, px, py, radius);
      glow.addColorStop(0, withAlpha(ambient.emberColor, ambient.lanternGlowAlpha * breath));
      glow.addColorStop(0.35, withAlpha(ambient.fireGlow, ambient.lanternGlowAlpha * breath * 0.42));
      glow.addColorStop(1, withAlpha(ambient.fireGlow, 0));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(px, py, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawFirelight(context, view, seconds, flare = 0) {
    const px = view.x + FIRE.x * view.scale;
    const py = view.y + FIRE.y * view.scale;

    /* Two offset sine waves so the breath never settles into an obvious loop.
       The fire is the one warm thing in a cool frame; it should feel alive
       without ever pulling the eye away from a familiar. */
    const breath = (0.72
      + Math.sin((seconds / ambient.firePulseSeconds) * Math.PI * 2) * 0.18
      + Math.sin((seconds / (ambient.firePulseSeconds * 0.37)) * Math.PI * 2) * 0.10) * (1 + flare);

    context.save();
    context.globalCompositeOperation = "screen";
    const reach = FIRE.radius * view.scale * (1 + breath * 0.18);
    const glow = context.createRadialGradient(px, py, 0, px, py, reach);
    glow.addColorStop(0, withAlpha(ambient.fireGlow, ambient.fireGlowAlpha * breath));
    glow.addColorStop(0.45, withAlpha(ambient.fireGlow, ambient.fireGlowAlpha * breath * 0.45));
    glow.addColorStop(1, withAlpha(ambient.fireGlow, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(px, py, reach, 0, Math.PI * 2);
    context.fill();

    /* A tight core sitting on the painted flame. Firelight spilling onto sunlit
       ground barely registers, which is physically right and visually flat, so
       the flicker that sells the fire is put where the fire already is. */
    const core = FIRE.radius * 0.34 * view.scale * (0.85 + breath * 0.3);
    const heart = context.createRadialGradient(px, py + core * 0.15, 0, px, py + core * 0.15, core);
    heart.addColorStop(0, withAlpha(ambient.emberColor, ambient.fireCoreAlpha * breath));
    heart.addColorStop(0.6, withAlpha(ambient.fireGlow, ambient.fireCoreAlpha * breath * 0.5));
    heart.addColorStop(1, withAlpha(ambient.fireGlow, 0));
    context.fillStyle = heart;
    context.beginPath();
    context.arc(px, py + core * 0.15, core, 0, Math.PI * 2);
    context.fill();

    for (const ember of this.embers) {
      const life = ((seconds / ambient.emberRiseSeconds) + ember.offset) % 1;
      // Fade in fast, out slow: a spark that appears mid-air looks like a bug.
      const alpha = Math.sin(Math.PI * life) ** 1.6;
      if (alpha <= 0.02) continue;
      const drift = Math.sin((life * ember.sway + ember.offset) * Math.PI * 2) * ember.spread;
      const ex = px + (ember.x + drift) * view.scale;
      const ey = py - life * ember.rise * view.scale;
      context.fillStyle = withAlpha(ambient.emberColor, alpha * ambient.emberAlpha);
      context.beginPath();
      context.arc(ex, ey, ember.size * view.scale, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  /* The burst a stoke throws: bigger, faster and higher than the idle embers,
     gone well before the glow has settled. */
  drawSparks(context, view, elapsedMs) {
    const px = view.x + FIRE.x * view.scale;
    const py = view.y + FIRE.y * view.scale;
    const flight = ambient.stokeMs * 0.75;
    context.save();
    context.globalCompositeOperation = "screen";
    for (const at of this.stokes) {
      const age = elapsedMs - at;
      if (age < 0 || age >= flight) continue;
      for (const spark of this.sparks) {
        const life = age / flight - spark.delay;
        if (life <= 0 || life >= 1) continue;
        const alpha = (1 - life) ** 1.4;
        const ex = px + (spark.x + spark.drift * life) * view.scale;
        const ey = py - (life * (2 - life)) * spark.rise * view.scale;
        context.fillStyle = withAlpha(ambient.emberColor, alpha * ambient.emberAlpha);
        context.beginPath();
        context.arc(ex, ey, spark.size * (1 - life * 0.4) * view.scale, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }
}

// The stoke's burst, laid out the same way every time, like the embers.
function buildSparks(count) {
  return Object.freeze([...Array(count).keys()].map((index) => Object.freeze({
    x: ((index % 5) - 2) * 2.2,
    drift: ((index * 7) % 9 - 4) * 2.4,
    rise: ambient.stokeSparkRise * (0.7 + ((index * 0.61803398875) % 1) * 0.5),
    delay: (index % 4) * 0.06,
    size: 0.9 + (index % 3) * 0.35
  })));
}

/* A deterministic layout, so the fire looks the same on every reload and the
   arrangement can be tested. */
function buildEmbers(count) {
  return Object.freeze([...Array(count).keys()].map((index) => Object.freeze({
    offset: (index * 0.61803398875) % 1,
    x: ((index % 3) - 1) * 3.4,
    rise: 30 + (index % 4) * 7,
    sway: 1 + (index % 3) * 0.5,
    spread: 2.2 + (index % 2) * 1.4,
    size: 0.7 + (index % 3) * 0.2
  })));
}
