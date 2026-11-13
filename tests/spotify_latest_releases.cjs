"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function groupSpotifyLatestReleases\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

const group = new Function(
  matches[0][0] + "\nreturn groupSpotifyLatestReleases;"
)();

const id = n => String(n).padStart(22, "0");
const followed = id(900);
function release(n, releaseType = "album", date = "2024-01-01") {
  return Object.freeze({
    id: id(n), type: "album", name: "Release " + n,
    releaseType, dateLowerBound: date,
    artistIds: Object.freeze([followed])
  });
}

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log("PASS: " + name);
}

test("Separates singles/albums and sorts newest loaded releases first", () => {
  const input = [
    release(1, "album", "2023-01-01"),
    release(2, "single", "2025-01-01"),
    release(3, "album", "2026-01-01"),
    release(4, "single", "2024-01-01")
  ];
  const originalOrder = input.map(item => item.id);
  const output = group(input, [followed]);

  assert.deepEqual(output.albums.items.map(item => item.id), [id(3), id(1)]);
  assert.deepEqual(output.singles.items.map(item => item.id), [id(2), id(4)]);
  assert.deepEqual(input.map(item => item.id), originalOrder);
  assert(Object.isFrozen(output));
  assert(Object.isFrozen(output.albums));
  assert(Object.isFrozen(output.albums.items));
});

test("Excludes uncredited artists, retains collaborations and deduplicates IDs", () => {
  const first = release(1);
  const duplicate = {...first, name: "Duplicate title"};
  const unrelated = {...release(2), artistIds: [id(901)]};
  const collaboration = {
    ...release(3), artistIds: [id(901), followed]
  };
  const result = group(
    [first, duplicate, unrelated, collaboration], [followed]
  );

  assert.equal(result.albums.loadedCount, 2);
  assert.equal(result.albums.items.find(item => item.id === id(1)), first);
  assert(result.albums.items.some(item => item.id === id(3)));
  assert(!result.albums.items.some(item => item.id === id(2)));
  assert.equal(group([first], []).albums.loadedCount, 0);
});

test("Limits each collection independently and reports truncation", () => {
  const result = group([
    release(1), release(2), release(3),
    release(4, "single"), release(5, "single")
  ], [followed], 2);

  assert.equal(result.albums.items.length, 2);
  assert.equal(result.albums.loadedCount, 3);
  assert.equal(result.albums.truncated, true);
  assert.equal(result.singles.items.length, 2);
  assert.equal(result.singles.loadedCount, 2);
  assert.equal(result.singles.truncated, false);

  const empty = group([], [followed]);
  assert.equal(empty.albums.items.length, 0);
  assert.equal(empty.singles.items.length, 0);
});

test("Rejects malformed containers, limits and reduced records", () => {
  for (const limit of [0, 101, 1.5, "24", Infinity]) {
    assert.throws(() => group([], [followed], limit));
  }
  for (const ids of [null, ["bad"], [42]]) {
    assert.throws(() => group([], ids));
  }
  assert.throws(() => group(null, [followed]));
  assert.throws(() => group(Array(5001).fill(release(1)), [followed]));

  for (const changes of [
    {id: "../escape"}, {type: "track"}, {name: null},
    {releaseType: "compilation"}, {dateLowerBound: null},
    {artistIds: null}
  ]) {
    assert.throws(() => group([{...release(1), ...changes}], [followed]));
  }
});

console.log(passed + " latest-release grouping tests passed.");