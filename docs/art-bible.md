# The Patch — Art and World Bible v0.1

Status: locked foundation for the solo/local prototype  
Product: a visual habitat for monitoring local Claude Code sessions  
Primary player action: observe, identify attention needs, inspect, and return to a session

## 1. Visual thesis

The Patch is a warm, rain-soaked cooperative workshop in the forests of western Oregon/Cascadia, inhabited by strange, industrious pixel familiars. It is quietly useful, slightly broken, expressive, and never corporate.

The world must communicate four facts before it communicates decoration:

1. How many sessions are active.
2. What broad state each session is in.
3. Which session needs the user's attention.
4. What recently finished.

The art is not a skin over a dashboard. Physical movement through the habitat is the status display.

## 2. Locked presentation

- Camera: fixed top-down three-quarter view.
- Logical world: 32 × 18 tiles.
- Tile size: 16 × 16 pixels.
- Logical canvas: 512 × 288 pixels.
- Default display: 1536 × 864 at integer 3× scaling.
- Minimum display: 1024 × 576 at integer 2× scaling.
- Pixel rendering: the illustrated plate and high-density familiar atlases use the same high-quality canvas sampling. Never enlarge a low-resolution sprite with nearest-neighbor filtering; source-pixel density should match the plate at the final world scale.
- Initial map: one fixed habitat with no scrolling.
- Navigation: authored waypoint graph; no general pathfinding in v0.1.
- Player avatar: none in v0.1. The user observes and selects familiars with pointer or keyboard.
- Active top-level sessions: eight visible familiars maximum (`MAP_FAMILIAR_LIMIT`; four in v0.1).
- Subagents: small helpers attached to a parent session; they do not claim occupancy slots.

## 3. Pacific Northwest identity

The habitat must feel native to the wet western side of the Pacific Northwest, with western Oregon as its strongest reference. This is an ecological and material identity, not a layer of regional jokes.

### Landscape language

- Douglas-fir and western red cedar define the tall perimeter silhouette.
- Sword ferns, salal, Oregon grape, moss, lichen, and nurse logs build the understory.
- Dark basalt and rounded creek stones replace generic fantasy boulders.
- Ground surfaces show rain-darkened soil, fallen needles, small puddles, mossy stone, and damp wood.
- Water is clear, cold blue-green creek water inspired by Cascade-fed Oregon rivers.
- Subtle mist and low cloud-filtered light create depth without obscuring stations.
- Small native woodland flowers may provide restrained seasonal color.

### Built language

- Structures use weathered cedar, cedar-shake or corrugated rain roofs, practical canvas tarps, and moss-softened stone.
- Rain chains, gutters, covered work surfaces, raised timber decking, and warm lamps make the camp feel adapted to the climate.
- Machinery remains repaired, repurposed, and practical rather than steampunk-fantasy ornamental.
- Signs are hand-painted on cedar or canvas.

### Regional exclusions

- No Seattle skyline or Space Needle.
- No snow-mountain postcard composition.
- No plaid lumberjack costume language.
- No sasquatch gag as shorthand for the region.
- No national-park poster treatment.
- No generic fantasy mushroom overload.
- No tropical foliage or dry pine-desert landscape.

## 4. Palette

Use one shared palette with a maximum of 24 environment colors before interface colors.

Core families:

- Soot: near-black and charcoal for outlines, machines, and deepest shade.
- Warm gray: fur, stone, smoke, and neutral surfaces.
- Parchment: paper, canvas, highlights, and readable signs.
- Fir green: canopy and deepest vegetation.
- Fern and moss: understory, age, and passive life.
- Cedar brown: architecture and warm natural surfaces.
- Basalt charcoal: stone, outlines, machines, and wet ground.
- Fog gray: atmosphere and neutral separation.
- Faded teal: metal paint and quiet system activity.
- Creek turquoise: clear cold water; use sparingly away from state signals.
- Rust: machinery and active labor.
- Amber: lamps, warmth, and ordinary notifications.
- Signal yellow: needs-input state only.
- Completion green: successful finish state only.
- Failure coral: session/tool failure only; not ordinary activity.

Do not use neon cyberpunk colors, glossy gradients, soft antialiasing, or excessive bloom.

## 5. Map topology

### Required stations

| Station | Purpose | Capacity | Approximate region |
| --- | --- | ---: | --- |
| Workbench | Preparing/editing activity | 8 familiars | upper left |
| Research Desk | Read/search activity | 8 familiars | upper center |
| Command machine | Generic tool/command activity | 8 familiars | upper center-right |
| Test Dungeon | Test activity | 8 familiars | upper right |
| Permission Gate | Permission/input waiting | 8 familiars | lower left |
| Shipping Dock | Explicitly completed work | 8 familiars | lower right |
| Campfire | Idle circulation and visual breathing room | 8 familiars | center |

### Movement graph

Every station connects to the central circulation ring. No route passes through another station's interaction footprint. Session-specific offsets create four lanes and occupancy positions from one canonical anchor per place.

```text
Workbench ───┐
Research ────┼─ Central ring ─ Test Dungeon
Command ─────┤        │
             ├─ Permission Gate
             ├─ Shipping Dock
             └─ Campfire
```

### Interaction anchors

Every station requires:

- one named arrival waypoint;
- one canonical occupancy anchor, fanned into stable runtime offsets per session;
- one departure waypoint outside the occupancy footprint;
- a visible floor marker during development;
- a collision polygon independent from decorative art;
- a z-depth zone for correct foreground overlap.

### Map layers

1. `ground`: grass, dirt, stone, water.
2. `ground_detail`: cracks, flowers, scattered paper.
3. `collision_low`: rocks, benches, water edges.
4. `stations`: interactive structures.
5. `agents`: familiars and helpers.
6. `foreground`: canopy, posts, hanging signs.
7. `effects`: sparks, smoke, signals, completion bursts.
8. `debug`: waypoints, anchors, paths, state labels.

## 6. Primary familiar

### Character

Working name: Moss  
Species: raccoon mechanic  
Silhouette: low center of gravity, large striped tail ending in a cable light, small rounded ears, apron block at torso, brass monocle on the same side in every facing.

Moss established the production silhouette and palette. The production family now has ten members. They share the same frame, baseline, outline, lighting, and animation contracts; state readability still comes from pose, station, and effects rather than species.

| Familiar | Species and role | Silhouette and vibe |
| --- | --- | --- |
| Moss | raccoon mechanic | striped cable-light tail; resourceful workshop lead |
| Fern | opossum archivist | pale face, curled tail, field pack; meticulous keeper |
| Lumen | luna-moth tester | tall antennae and broad wings; gentle precision |
| Cedar | pigeon courier | compact blue-gray body and parcel strap; brisk and dependable |
| Alder | beaver builder | sturdy body, flat tail, tool satchel; grounded craftsperson |
| Mica | spotted-owl analyst | round facial disk and folio; calm observer |
| Ripple | river-otter debugger | long tail and rust scarf; quick, curious investigator |
| Thimble | deer-mouse scout | oversized ears and field cape; alert and brave |
| Spruce | Douglas-squirrel cartographer | tufted ears, bushy tail, compass; energetic precision |
| Nettle | banana-slug forager | low golden glide and gathering satchel; patient determination |

### Sprite specification

- Logical frame box: 32 × 32 for authored animation geometry; runtime source frame: 128 × 128 pixels so the familiar matches the high-resolution illustrated plate when drawn into a 42-unit footprint.
- Feet baseline: consistent across all standing and walking frames.
- Directions: four (`down`, `left`, `right`, `up`).
- Mirroring: left/right may be mirrored only if monocle and cable-tail asymmetry are redrawn correctly.
- Shadow: separate 16 × 6 translucent sprite, not baked into character frames.
- Outline: one-pixel soot outline at logical resolution.
- Palette variants: apron accent changes distinguish concurrent sessions; anatomy does not change.
- Selection treatment: separate ground ring; never recolor the familiar.

### Animation inventory

| Animation | Directions | Frames | Loop | Meaning |
| --- | ---: | ---: | --- | --- |
| idle | 4 | 4 | yes | active but not transitioning |
| walk | 4 | 4 | yes | moving between stations |
| arrive | 1 | 6 | no | session started |
| investigate | 2 | 4 | yes | reading/searching |
| edit | 2 | 6 | yes | modifying files |
| command | 2 | 4 | yes | generic tool or shell activity |
| test_enter | 1 | 6 | no | entering Test Dungeon |
| testing | 1 | 4 | yes | tests in progress |
| needs_input | 1 | 4 | yes | permission or answer required |
| trouble | 1 | 4 | yes | tool/session failure |
| finish | 1 | 6 | no | task/session completed |
| carry_parcel | 4 | 4 | yes | traveling to Shipping Dock |
| depart | 1 | 6 | no | session dismissed/closed |

The production contract is now fixed at 24 frames per familiar: four down, left, right and back walk frames, two idle frames, two needs-input frames, two trouble frames, and two finished frames. Ended sessions depart rather than sleeping in the world. See `art/source/animation-contract.json`.

### First playable animation subset

1. `arrive_down`
2. `idle_down`
3. `walk_down`, `walk_up`, `walk_left`, `walk_right`
4. `edit_left`
5. `testing_down`
6. `needs_input_down`
7. `finish_down`
8. `carry_parcel_down`, with mirrored/temporary directional placeholders permitted during engine proof

## 7. Helper specification

Subagents appear as small toolbox creatures.

- Frame box: 16 × 16 pixels.
- Maximum visible helpers per parent: three; additional subagents collapse into a `+N` marker.
- Helpers inherit the parent's apron accent.
- Required animations: emerge, follow, work, wait, return.
- Helpers never travel to the Permission Gate independently in v0.1.
- Selecting a helper selects its parent session and highlights the subagent row.

## 8. State-to-world contract

| Derived application state | Destination | Familiar behavior | Signal |
| --- | --- | --- | --- |
| `arriving` | Workbench | arrival animation | small amber lamp |
| `preparing` | workbench | reviews paper order | subtle neutral icon |
| `investigating` | Research Desk | searches shelves | faded teal |
| `editing` | Workbench | uses tools at bench | soft sparks |
| `running` | command machine | operates console | faded teal pulse |
| `testing` | Test Dungeon | enters, machine runs | blue/teal flask signal |
| `needs_input` | Permission Gate | holds form/sign | signal yellow |
| `trouble` | current station or repair point | smoke, examines broken part | failure coral |
| `finished` | Shipping Dock | carries and places parcel | completion green |

State changes that require a new destination first enter `traveling`. The displayed status remains the destination state while a small movement indicator shows transit.

`session_ended`, `disconnected`, and `reset` remove the familiar from the Patch and from reconnect snapshots. They are terminal events, not world states. The Campfire is reserved for an open session between turns.

## 9. Readability rules

- Needs-input must remain identifiable in grayscale through pose and location, not color alone.
- No two important states may share the same station, pose, and effect combination.
- Effects must not obscure the familiar silhouette.
- Decorations may animate, but at lower contrast and slower cadence than agent state animations.
- The center of the map stays visually quiet.
- The world may celebrate completion for at most three seconds before returning to ambient behavior.
- A user must identify all waiting sessions without opening an inspector.
- UI text uses a pixel-compatible font only for short labels; inspector body text uses a highly readable sans serif.

## 10. Tile and prop inventory

### Base tiles

- rain-darkened forest floor: 6 variants
- fir-needle and leaf litter: 4 variants
- moss ground: 4 variants
- dirt path: center, four edges, four outer corners, four inner corners
- stone path: center, four edges, four corners
- water: center, four edges, four corners, two animated surface frames
- wood dock: center, edges, corners
- basalt boundary: straight, corners, end caps

### Structural props

- one communal workbench sized for four familiars
- research shelves and desk
- command machine with idle and active overlays
- Test Dungeon entrance with closed, active, passed, and failed overlays
- Permission Gate with neutral and attention overlays
- Shipping Dock with three parcel anchors
- campfire with four frames

### Small props

- lamp, rain chain, gutter, crate, stool, paper, mug, cable, tool rack, potted moss, cedar signpost, nurse log, basalt rock, creek stone, sword fern, salal, Oregon grape, lichen, flower, puddle, parcel, blueprint, smoke puff, spark, question placard.

## 11. Production files

Recommended structure:

```text
art/
  source/
    palette.aseprite
    tileset.aseprite
    moss.aseprite
    helper.aseprite
    effects.aseprite
  export/
    tileset.png
    moss.png
    helper.png
    effects.png
  maps/
    workshop.tmx
    workshop.json
  references/
    world-concept.png
    familiar-state-concept.png
    map-concept.png
```

Runtime structure:

```text
public/assets/patch/
  tileset.png
  moss.png
  helper.png
  effects.png
  workshop.json
  atlas.json
```

Export requirements:

- PNG with transparency where appropriate.
- No scaling during export.
- No lossy formats.
- Stable frame names.
- Atlas JSON checked into source control.
- Tiled map uses external tileset references during authoring and a normalized exported JSON for runtime.

## 12. Engine-facing contracts

The art pipeline exposes these stable identifiers:

```ts
type AgentVisualState =
  | "arriving"
  | "preparing"
  | "investigating"
  | "editing"
  | "running"
  | "testing"
  | "needs_input"
  | "trouble"
  | "finished";

type StationId =
  | "workbench"
  | "research"
  | "command"
  | "test_dungeon"
  | "permission_gate"
  | "shipping_dock"
  | "campfire";
```

Every animation key follows `moss:{state}:{direction}`. One-shot transitions add a suffix such as `moss:test_enter:down`.

## 13. Art-first implementation order

### Gate A — visual lock

- Approve world mood and palette.
- Approve fixed map topology.
- Approve Moss silhouette, proportions, and identifying details.
- Reject any element that reduces state readability.

### Gate B — graybox art

- Construct exact 32 × 18 Tiled map using flat placeholder tiles.
- Add station collisions, anchors, and waypoint paths.
- Add a single 32 × 32 placeholder familiar.
- Verify movement and occlusion before detailed rendering.

### Gate C — production character

- Draw directional idle and walk cycles.
- Draw the five first-playable state animations.
- Export the high-density atlas and validate its sampling and apparent pixel size against the illustrated plate at 2× and 3× display scales.
- Test all states against every map background region.

### Gate D — production environment

- Render base terrain and paths.
- Render interactive stations in priority order: bench, gate, dungeon, dock.
- Add foreground layers only after collision and visibility tests pass.
- Add ambient effects last.

### Gate E — hook integration

- Connect the state simulator to real Claude Code hook events.
- Do not add a second familiar species until one complete real session works end-to-end.

## 14. Locked exclusions

- No user-controlled walking avatar in v0.1.
- No scrolling map.
- No map editor.
- No procedural world generation.
- No sprite equipment system.
- No care, feeding, or cleanliness meters.
- No XP, levels, currency, streaks, or productivity scores.
- No team multiplayer in the local prototype.
- No generated art at runtime.
- No animation that claims knowledge of Claude's private reasoning.
- No generic cozy-fantasy biome that erases the Pacific Northwest identity.

## 15. Definition of art-complete for v0.1

Art is ready for the first real coding-agent integration when:

1. The exact 32 × 18 map loads without scaling artifacts.
2. Four workstations are visually distinct and share the same functional footprint.
3. All station anchors and travel paths are validated.
4. Moss can sleep, arrive, walk in four directions, edit, test, wait, finish, and carry a parcel.
5. Needs-input and finished are identifiable without text or color.
6. One helper can emerge, work, follow, and return.
7. Foreground objects never hide a waiting familiar.
8. Every exported asset uses stable names and integer dimensions.
9. The world remains readable at 2× scale.
10. A complete simulated session can be understood without opening the inspector.
11. The unpopulated map is recognizably western Oregon/Cascadia without relying on text or landmarks.
