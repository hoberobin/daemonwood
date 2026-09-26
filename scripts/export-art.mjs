import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { decodePNG, encodePNG, bounds, blit } from "./lib/png.mjs";
import { cuts } from "./lib/sheet.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const contract = JSON.parse(await readFile(resolve(root, "art/source/animation-contract.json")));
const registry = JSON.parse(await readFile(resolve(root, "art/registry.json")));
const { frameSize, columns, rows, baseline, maxSilhouette } = contract;
const atlas = { ...contract, familiars: {} };
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

for (const asset of registry.assets.filter((asset) => asset.kind === "familiar")) {
  const raw = await readFile(resolve(root, asset.source));
  const source = decodePNG(raw), xs = cuts(source, columns, false), ys = cuts(source, rows, true);
  const boxes = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const box = bounds(source, [xs[col], ys[row], xs[col + 1] - xs[col], ys[row + 1] - ys[row]]);
    if (!box) throw new Error(`${asset.id}: empty frame ${boxes.length}`);
    boxes.push(box);
  }
  const scale = Math.min(1, maxSilhouette / Math.max(...boxes.flatMap((box) => box.slice(2))));
  const image = { width: columns * frameSize, height: rows * frameSize, data: Buffer.alloc(columns * rows * frameSize ** 2 * 4) };
  boxes.forEach((box, i) => {
    const width = Math.max(1, Math.round(box[2] * scale)), height = Math.max(1, Math.round(box[3] * scale));
    blit(source, box, image, i % columns * frameSize + Math.floor((frameSize - width) / 2),
      Math.floor(i / columns) * frameSize + baseline + 1 - height, width, height);
  });
  const output = encodePNG(image);
  await mkdir(resolve(root, asset.export, ".."), { recursive: true });
  await writeFile(resolve(root, asset.export), output);
  atlas.familiars[asset.id] = { image: `./${asset.export}`, source: asset.source, sourceHash: hash(raw), exportHash: hash(output), sourceBounds: boxes };
  console.log(`${asset.id}: ${boxes.length} aligned frames → ${asset.export}`);
}
await writeFile(resolve(root, "assets/sprites/familiar-atlas-v1.json"), JSON.stringify(atlas, null, 2) + "\n");
// Helpers use the same export rules at half the source frame size.
const helperAsset = registry.assets.find((asset) => asset.kind === "helper");
const helperSource = decodePNG(await readFile(resolve(root, helperAsset.source)));
const hx = cuts(helperSource, 4, false), hy = cuts(helperSource, 2, true);
const helperBoxes = [];
for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
  const box = bounds(helperSource, [hx[col], hy[row], hx[col + 1] - hx[col], hy[row + 1] - hy[row]]);
  if (!box) throw new Error("Empty helper frame");
  helperBoxes.push(box);
}
const helperScale = 52 / Math.max(...helperBoxes.flatMap((box) => box.slice(2)));
const helperImage = { width: 256, height: 128, data: Buffer.alloc(256 * 128 * 4) };
helperBoxes.forEach((box, i) => {
  const width = Math.round(box[2] * helperScale), height = Math.round(box[3] * helperScale);
  blit(helperSource, box, helperImage, i % 4 * 64 + Math.floor((64 - width) / 2), Math.floor(i / 4) * 64 + 60 - height, width, height);
});
await writeFile(resolve(root, helperAsset.export), encodePNG(helperImage));
// Station bases are exact, lossless source crops. The terrain master is kept
// intact underneath so today's geometry and lighting never acquire seams.
const layers = JSON.parse(await readFile(resolve(root, "art/source/map/layers.json")));
const mapMaster = decodePNG(await readFile(resolve(root, "art/source/map/workshop-master.png")));
await mkdir(resolve(root, "assets/map/layers"), { recursive: true });
for (const station of layers.stations) {
  const [x, y, w, h] = station.sourceRect;
  const tile = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let py = 0; py < h; py++) mapMaster.data.copy(tile.data, py * w * 4, ((y + py) * mapMaster.width + x) * 4, ((y + py) * mapMaster.width + x + w) * 4);
  await writeFile(resolve(root, station.image), encodePNG(tile));
}
await writeFile(resolve(root, "assets/map/workshop-layers-v1.json"), JSON.stringify(layers, null, 2) + "\n");
console.log("Wrote shared atlas. Run npm run art:check before promotion.");
