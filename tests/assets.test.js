import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FAMILIARS } from "../src/familiars.js";

test("Tiled map preserves the locked world dimensions and one station per lifecycle place", async () => {
  const map = JSON.parse(await readFile(new URL("../assets/map/workshop.tmj", import.meta.url), "utf8"));
  assert.equal(map.width, 32);
  assert.equal(map.height, 18);
  assert.equal(map.tilewidth, 16);
  assert.equal(map.tileheight, 16);
  const stations = map.layers.find((layer) => layer.name === "stations").objects;
  assert.equal(stations.filter((station) => station.name === "workbench").length, 1);
  for (const required of ["workbench", "research", "command", "test_dungeon", "permission_gate", "shipping_dock", "campfire"]) {
    assert.ok(stations.some((station) => station.name === required), `missing ${required}`);
  }
  assert.equal(stations.length, 7);
});

test("the simplified runtime plate keeps the approved wide composition", async () => {
  const png = await readFile(new URL("../assets/map/workshop-plate-v3.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), 1672);
  assert.equal(png.readUInt32BE(20), 941);
});

test("the ten-familiar catalog and atlas agree on 24 high-density frames", async () => {
  const atlas = JSON.parse(await readFile(new URL("../assets/sprites/familiar-atlas-v1.json", import.meta.url), "utf8"));
  assert.equal(atlas.frameSize, 128);
  assert.equal(atlas.columns * atlas.rows, 24);
  assert.equal(atlas.drawSize, 42);
  assert.equal(Object.values(atlas.animations).flat().length, 24);
  assert.equal(FAMILIARS.length, 10);
  assert.equal(new Set(FAMILIARS.map(({ type }) => type)).size, 10);
  assert.equal(Object.keys(atlas.familiars).length, FAMILIARS.length);
  for (const familiar of FAMILIARS) {
    const manifestEntry = atlas.familiars[familiar.type];
    assert.equal(manifestEntry.image, familiar.image);
    assert.equal(manifestEntry.sourceBounds.length, 24);
    const png = await readFile(new URL(`../${familiar.image}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 512, `${familiar.image} width`);
    assert.equal(png.readUInt32BE(20), 768, `${familiar.image} height`);
  }
});
