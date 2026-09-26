# Pacific Northwest vegetation proposal

## Promotion

The user approved the displayed candidate and requested it become the real map.
The full approved image is now installed as the source master and runtime plate,
with all seven station crops regenerated from that same image. The original is
archived at `assets/archive/map/workshop-plate-v3-pre-pnw.png`. Map dimensions,
station crop coordinates, navigation and interaction geometry are unchanged.
The review below records the pre-promotion analysis; selective compositing was
not applied to the approved image.

The current map has rounded broadleaf crowns around the perimeter. Its creek,
rocks, timber structures, warm lights and existing ferns already support the
western Oregon direction described in `docs/art-bible.md`.

## Recommended changes

1. Replace perimeter tree crowns with irregular Douglas-fir tiers and drooping
   western redcedar sprays. Keep trunk positions and canopy footprints close to
   the originals so the clearing stays open.
2. Add restrained olive moss cushions to shaded perimeter rocks and root bases.
3. Add a few sword fern fans among existing edge vegetation. Preserve meadow
   flowers, bright paths and warm lighting.

These vegetation choices fit the region; see the [National Park Service forest
overview](https://home.nps.gov/olym/learn/nature/forests.htm) and [USGS ecology
overview](https://www.usgs.gov/geology-and-ecology-of-national-parks/ecology-olympic-national-park).

## Candidate and review

- Original: `assets/archive/map/workshop-plate-v3-pre-pnw.png`
- Proposal: `art/source/candidates/workshop-pnw-v1.png`
- Prompt: `art/prompts/workshop-pnw-v1.txt`
- Method: built-in image generation, editing the original map.
- Both images are 1672 × 941.

Visual inspection: the proposal reads more clearly as an evergreen forest and
retains the overall station, clearing and water layout. Foreground conifers are
taller than the original rounded crowns; keep the original footprints tighter
in a production composite, particularly beside the bottom fence.

Pixel inspection: pixels changed in every station rectangle, including the
campfire. This full-image candidate is therefore **a visual proposal, not a
pixel-identical replacement outside vegetation**. It was initially kept separate
from the renderer for review. The existing `npm run art:check` passed at that
stage. Following user approval, it was promoted as described above.

## Production approach

Composite only the selected tree and moss regions onto the original painting,
using explicit vegetation masks. Protect station rectangles, paths, shoreline,
landmark positions and the central clearing. Verify that every pixel outside
the masks is identical to the original. Inspect boundaries at full resolution
and at the app's display size.

The renderer uses the base painting plus seven exact station crops. Any promoted
painting must keep the source master, runtime plate and those crops consistent.
Preserve the original as an archive, run the existing art checks, and inspect
the map with familiars and foreground overlays before promotion. No navigation,
interaction anchors, camera or animation changes are needed.
