import test from "node:test";
import assert from "node:assert/strict";
import { WorldRenderer } from "../src/renderer.js";

test("edge marker hit regions match drawing geometry at different pixel densities", () => {
  for (const ratio of [1, 2]) {
    const renderer = Object.assign(Object.create(WorldRenderer.prototype), {
      coverRight: 280, pixelRatio: ratio, canvas: { width: 1024 * ratio }, scale: 2 * ratio, offsetX: 0, offsetY: 0
    });
    const covered = { key: "covered", controller: { position: { x: 460, y: 220 } } };
    const visible = { key: "visible", controller: { position: { x: 100, y: 120 } } };
    const records = [covered, visible];
    const [box] = renderer.edgeMarkers(records);
    assert.equal(renderer.edgeMarkers(records).length, 1);
    assert.equal(renderer.edgeRecordAt(records, (box.x + box.width / 2) / ratio, (box.y + box.height / 2) / ratio), covered);
    assert.equal(renderer.edgeRecordAt(records, (box.x - 1) / ratio, box.y / ratio), null);
    renderer.coverRight = 0;
    assert.equal(renderer.edgeRecordAt(records, box.x / ratio, box.y / ratio), null);
  }
});
