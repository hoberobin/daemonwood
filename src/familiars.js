/* The familiar catalog is the one runtime source of truth for character
   identity and art. Assignment and rendering both consume this list, so adding
   a character never requires a second hard-coded sprite map. Keep each sheet
   on the shared 24-frame contract documented by familiar-atlas-v1.json. */
export const FAMILIARS = Object.freeze([
  familiar("moss", "Moss", "raccoon mechanic", "moss-walk-v0.3.png"),
  familiar("fern", "Fern", "opossum archivist", "fern-walk-v0.2.png"),
  familiar("lumen", "Lumen", "luna-moth tester", "lumen-walk-v0.2.png"),
  familiar("cedar", "Cedar", "pigeon courier", "cedar-walk-v0.2.png"),
  familiar("alder", "Alder", "beaver builder", "alder-walk-v0.1.png"),
  familiar("mica", "Mica", "spotted-owl analyst", "mica-walk-v0.1.png"),
  familiar("ripple", "Ripple", "river-otter debugger", "ripple-walk-v0.1.png"),
  familiar("thimble", "Thimble", "deer-mouse scout", "thimble-walk-v0.1.png"),
  familiar("spruce", "Spruce", "Douglas-squirrel cartographer", "spruce-walk-v0.1.png"),
  familiar("nettle", "Nettle", "banana-slug forager", "nettle-walk-v0.1.png")
]);

function familiar(type, name, species, image) {
  return Object.freeze({ type, name, species, image: `./assets/sprites/${type}-actions-v1.png`, legacyImage: `./assets/sprites/${image}` });
}

/* Temperament: how each familiar carries its behaviours, read off the vibe the
   art bible gives it. It changes style and never meaning — `tempo` stretches
   how often a flourish comes round (below 1 is brisker), and nothing else.
   Thresholds such as how long a session has waited stay the same for everyone,
   because "NEEDS YOU · 7M" has to mean the same thing whoever is asking. */
export const TEMPERAMENTS = Object.freeze({
  moss: Object.freeze({ tempo: 1, vibe: "resourceful workshop lead" }),
  fern: Object.freeze({ tempo: 1.1, vibe: "meticulous keeper" }),
  lumen: Object.freeze({ tempo: 1.15, vibe: "gentle precision" }),
  cedar: Object.freeze({ tempo: 0.9, vibe: "brisk and dependable" }),
  alder: Object.freeze({ tempo: 1.1, vibe: "grounded craftsperson" }),
  mica: Object.freeze({ tempo: 1.25, vibe: "calm observer" }),
  ripple: Object.freeze({ tempo: 0.85, vibe: "quick, curious investigator" }),
  thimble: Object.freeze({ tempo: 0.85, vibe: "alert and brave" }),
  spruce: Object.freeze({ tempo: 0.8, vibe: "energetic precision" }),
  nettle: Object.freeze({ tempo: 1.3, vibe: "patient determination" })
});
export const TEMPO_RANGE = Object.freeze({ min: 0.8, max: 1.3 });
const EVEN_TEMPER = Object.freeze({ tempo: 1, vibe: "" });

export function temperament(type) {
  return TEMPERAMENTS[type] ?? EVEN_TEMPER;
}

export function familiarByType(type) {
  return FAMILIARS.find((candidate) => candidate.type === type) || null;
}

/* Which familiar a new session becomes. The bridge decides this once, at
   admission, so the name a terminal's status line shows and the sprite the map
   draws come from the same choice; the browser only falls back to it for an
   event that arrives without one.

   Every session has one familiar it prefers, fixed by its id, and takes the
   next one along the family only while its own is worn by someone live. It
   used to hash into whichever species happened to be free, so the same
   session came back as a different creature whenever the set of live
   sessions was different — a bridge restart renamed everyone. The bridge
   also remembers past choices on disk (`familiar-ledger.js`); this is what
   decides when there is nothing to remember. */
export function chooseFamiliar(key, takenTypes = []) {
  const occupied = new Set(takenTypes);
  const start = stableIndex(key, FAMILIARS.length);
  for (let step = 0; step < FAMILIARS.length; step += 1) {
    const candidate = FAMILIARS[(start + step) % FAMILIARS.length];
    if (!occupied.has(candidate.type)) return candidate;
  }
  return FAMILIARS[start];
}

/* Claude labels a subagent with its agent type, which is a real name worth
   showing. A plain "Claude" is the product, not a name, so the familiar keeps
   the one Daemonwood gave it. */
export function isGenericAgentName(value) {
  return /^(?:agent|claude(?:[-\s]?code)?)$/i.test(String(value || "").trim());
}

export function displayName(agentName, familiar) {
  return isGenericAgentName(agentName) ? familiar?.name : agentName || familiar?.name;
}

function stableIndex(value, length) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}
