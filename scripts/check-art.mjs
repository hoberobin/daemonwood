import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodePNG, bounds } from "./lib/png.mjs";
import { FAMILIARS } from "../src/familiars.js";
import { SPRITE, CLIPS, STATION_CLIPS } from "../src/art-animation.js";
import { STATION_SHEETS } from "../src/station-sheets.js";
import { access } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url));
const json = async (path) => JSON.parse(await read(path));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = await json("assets/sprites/familiar-atlas-v1.json");
assert.deepEqual(manifest.animations, CLIPS);
assert.deepEqual(manifest.pivot, [SPRITE.pivotX, SPRITE.pivotY]);
assert.equal(manifest.frameSize, SPRITE.size);
assert.equal(manifest.drawSize, SPRITE.drawSize);
assert.equal(Object.keys(manifest.familiars).length, FAMILIARS.length);

function checkFrames(image, size, count, baseline, label) {
  const hashes = [];
  for (let frame = 0; frame < count; frame++) {
    const x = frame % 4 * size, y = Math.floor(frame / 4) * size;
    const box = bounds(image, [x, y, size, size]);
    assert.ok(box, `${label} ${frame}: nonempty`);
    assert.ok(box[0] >= x + 4 && box[0] + box[2] <= x + size - 4, `${label} ${frame}: horizontal gutter`);
    assert.ok(box[1] >= y + 4 && box[1] + box[3] <= y + size - 4, `${label} ${frame}: vertical gutter`);
    assert.ok(Math.abs(box[1] + box[3] - 1 - y - baseline) <= 1, `${label} ${frame}: baseline`);
    const data = Buffer.concat(Array.from({ length: size }, (_, row) => image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + size) * 4)));
    hashes.push(hash(data));
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      if (px > 1 && px < size - 2 && py > 1 && py < size - 2) continue;
      assert.equal(data[(py * size + px) * 4 + 3], 0, `${label} ${frame}: transparent cell edge`);
    }
  }
  assert.equal(new Set(hashes).size, count, `${label}: no duplicate frames (visual gait review is still required)`);
}
for (const familiar of FAMILIARS) {
  const entry = manifest.familiars[familiar.type];
  assert.equal(entry.image, familiar.image);
  const bytes = await read(entry.image);
  assert.equal(hash(bytes), entry.exportHash, `${familiar.type}: stale export hash`);
  assert.equal(hash(await read(entry.source)), entry.sourceHash, `${familiar.type}: source changed; export again`);
  const image = decodePNG(bytes);
  assert.deepEqual([image.width, image.height], [512, 768]);
  checkFrames(image, 128, 24, 119, familiar.type);
}
/* Station-work sheets: optional per familiar, so the check is that whatever
   exists is complete and current, and that the runtime list agrees with it. */
const stationContract = await json("art/source/station-contract.json");
const stations = await json("assets/sprites/familiar-stations-v1.json");
assert.deepEqual(stationContract.animations, STATION_CLIPS, "station contract and runtime clips agree");
assert.deepEqual(stations.animations, STATION_CLIPS, "station atlas is from the current contract");
assert.deepEqual(Object.keys(STATION_SHEETS).sort(), Object.keys(stations.familiars).sort(), "src/station-sheets.js is stale; run npm run art:export");
for (const familiar of FAMILIARS) {
  const source = `art/source/familiars/${familiar.type}${stationContract.sourceSuffix}.png`;
  const present = await access(new URL(`../${source}`, import.meta.url)).then(() => true, () => false);
  const entry = stations.familiars[familiar.type];
  assert.equal(Boolean(entry), present, `${familiar.type}: station source ${present ? "not exported" : "missing for exported sheet"}; run npm run art:export`);
  if (!entry) continue;
  assert.equal(STATION_SHEETS[familiar.type], entry.image);
  const bytes = await read(entry.image);
  assert.equal(hash(bytes), entry.exportHash, `${familiar.type}: stale station export hash`);
  assert.equal(hash(await read(entry.source)), entry.sourceHash, `${familiar.type}: station source changed; export again`);
  const image = decodePNG(bytes);
  assert.deepEqual([image.width, image.height], [512, 256]);
  checkFrames(image, 128, 8, 119, `${familiar.type} stations`);
}
const stationCount = Object.keys(stations.familiars).length;
const helper = decodePNG(await read("assets/sprites/toolbox-helper-v1.png"));
assert.deepEqual([helper.width, helper.height], [256, 128]);
checkFrames(helper, 64, 8, 59, "helper");
const master = decodePNG(await read("art/source/map/workshop-master.png"));
const plate = decodePNG(await read("assets/map/workshop-plate-v3.png"));
assert.deepEqual(master, plate, "Preserved master and runtime plate must agree");
const layers = await json("assets/map/workshop-layers-v1.json");
assert.deepEqual(layers, await json("art/source/map/layers.json"));
for (const station of layers.stations) {
  const image = decodePNG(await read(station.image));
  const [x, y, w, h] = station.sourceRect;
  assert.deepEqual([image.width, image.height], [w, h]);
  for (let row = 0; row < h; row++) assert.deepEqual(image.data.subarray(row * w * 4, (row + 1) * w * 4), master.data.subarray(((y + row) * master.width + x) * 4, ((y + row) * master.width + x + w) * 4), station.id);
}
console.log(`Art checks passed: 240 familiar frames, ${stationCount * 8} station-work frames (${stationCount} of ${FAMILIARS.length} familiars), 8 helper frames, 7 exact station crops, contract, alpha, pivots, hashes.`);
