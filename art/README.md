# Art production notes

The runtime art is intentionally split into three layers:

* `art/source/` contains preserved raster masters and the explicit animation contract.
* `scripts/export-art.mjs` deterministically normalizes those masters into runtime PNGs.
* `src/world-art.js` and the layer manifest add editable station effects, foreground masks, and depth without pretending the flattened map was recovered as layered source.

Run `npm run art:export` after changing a source master, then `npm run art:check`. The check covers all 240 familiar frames, helper frames, pivots, alpha gutters, hashes, and exact map crops. With `npm run dev` serving the checkout, `npm run art:qa` opens the isolated synthetic review scene at `/docs/art-review.html`; it never connects to the bridge or writes a session event. Review captures are kept in `art/qa/` with `report.json`.

The contract is 4 × 6 cells per familiar sheet: four walk frames for each direction, idle, needs-input, trouble, and finished. Frames use a 128px cell, a 119px foot baseline, a 64px horizontal pivot, and a 42-unit in-world draw size. Helpers use an 8-frame 4 × 2 sheet and collapse beyond three visible helpers into `+N`.

The original flattened workshop plate is preserved byte-for-byte at `art/source/map/workshop-master.png`. Station crops are exact source copies. They provide a safe seam-free base for depth and effects; moving terrain still requires a future inpainting pass because no editable layered original was supplied.

Generated source sheets were made with the built-in image-generation tool and their prompts are recorded in `art/prompts/`. The original project art remains archived at its existing paths. Confirm ownership/licensing of supplied references before redistribution.

`art/source/candidates/` retains the four non-destructive continuity-correction candidates used during review; the promoted masters remain the files referenced by `art/registry.json`.

## Station-work sheets (optional, one familiar at a time)

Each familiar can gain a second, smaller sheet in which it works with its station's tool: a mallet at the Workbench (editing), a book at Research, a gray joystick with a muted red knob at Command (running) and a flask at the Test Dungeon. The frame layout is `art/source/station-contract.json`: 4 × 2 cells, two frames per tool, a held pose and a moving one. The 24-frame base sheet is never touched.

1. Generate the sheet from `art/prompts/stations/<id>.txt`, giving the image tool that familiar's approved base sheet as Image 1. Keep only a result whose character is unmistakably the same one.
2. Save it as `art/source/familiars/<id>-stations.png` (1024 × 512, transparent) and add a `familiar-stations` entry for it to `art/registry.json` with the same provenance fields as the base sheet.
3. Run `npm run art:export`. The station sheet is exported at the familiar's base-sheet scale, so the body matches frame for frame; a figure too large for its cell at that scale fails here with a message. `src/station-sheets.js` is regenerated.
4. Run `npm run art:check`, then review in `npm run dev` → `/docs/art-review.html`: scene **Station work**, pick the familiar, and check the **Station sheet** contact sheet below the family sheet.

A familiar without a station sheet draws its ordinary frames at every station, so an unfinished family is always a correct one. To take a sheet back out, delete its source PNG and export again.
