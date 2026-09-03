"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const groups = require("../../EDITOR/static/js/core/effect_groups.js");
const drag = require("../../EDITOR/static/js/ui/group_drag.js");
const stat = (id) => ({ type: "stat", id, op: "+", value: 1 });
const random = (...effects) => ({ type: "random", choices: effects.map((effect, index) => ({ weight: index + 1, effect })) });

test("Effect containers round trip without flattening execution or changing legacy effects", () => {
  const effects = [stat("before"), random(stat("a"), stat("b")), stat("after")];
  assert.deepEqual(groups.entries(effects).map(({ id }) => id), ["0", "1.0", "1.1", "2"]);
  assert.deepEqual(groups.assemble(groups.entries(effects)), effects);
  groups.replace(effects, "1.1", stat("replacement"));
  assert.equal(effects[1].choices[1].weight, 2);
  assert.equal(effects[1].choices[1].effect.id, "replacement");
  const singleton = groups.remove(effects, "1.0");
  assert.equal(singleton[1].type, "random");
  assert.equal(singleton[1].choices.length, 1);
  assert.deepEqual(groups.remove(singleton, "1.0"), [stat("before"), stat("after")]);
});

test("dwell creates a single-layer random block and dragging out preserves singleton", () => {
  const grouped = groups.applyDrop(drag, [stat("a"), stat("b"), stat("c")], {
    mode: "group", sourceId: "0", targetId: "1", position: "before",
  });
  assert.deepEqual(grouped, [{ type: "random", choices: [
    { weight: 1, effect: stat("a") }, { weight: 1, effect: stat("b") },
  ] }, stat("c")]);
  const out = groups.applyDrop(drag, grouped, {
    mode: "reorder", sourceId: "0.0", targetId: "1", position: "after", targetGroup: groups.LOOSE,
  });
  assert.deepEqual(out, [random(stat("b")), stat("c"), stat("a")]);
  const joined = groups.applyDrop(drag, out, { mode: "group", sourceId: "2", targetId: "0.0", position: "after" });
  assert.equal(joined[0].choices.length, 2);
  assert.equal(groups.entries(joined).length, 3);
});

test("whole-group sorting preserves child weights, independent groups, and sequential neighbors", () => {
  const a = random(stat("a"), stat("b")), b = random(stat("c"));
  assert.deepEqual(groups.applyDrop(drag, [a, stat("middle"), b], {
    sourceGroup: "random:0", targetId: "2.0", position: "after",
  }), [stat("middle"), b, a]);
  const reordered = groups.applyDrop(drag, [a], {
    mode: "group", sourceId: "0.1", targetId: "0.0", targetGroup: "random:0", position: "before",
  });
  assert.deepEqual(reordered[0].choices, [a.choices[1], a.choices[0]]);
});

test("probability feedback handles relative weights without overflow or silent invalid defaults", () => {
  assert.deepEqual(groups.percentages([1, 3]).map(groups.percentageLabel), ["25%", "75%"]);
  assert.deepEqual(groups.percentages([1e308, 1e308]), [50, 50]);
  assert.deepEqual(groups.percentages([2]), [100]);
  for (const invalid of [0, -1, NaN, Infinity, "", null]) assert.deepEqual(groups.percentages([invalid, 1]), [null, null]);
  assert.equal(groups.percentageLabel(0.001), "<0.1%");
  assert.equal(groups.percentageLabel(null), "—");
});
