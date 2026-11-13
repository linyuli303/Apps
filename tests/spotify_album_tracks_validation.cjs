"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);

function extract(name) {
  const matches = [...source.matchAll(new RegExp(
    "^function " + name + "\\([\\s\\S]*?^\\}", "gm"
  ))];
  assert.equal(matches.length, 1);
  return matches[0][0];
}

const validate = new Function(
  extract("validateSpotifyTrackMetadata") + "\n" +
  extract("validateSpotifyAlbumTrackPage") +
  "\nreturn validateSpotifyAlbumTrackPage;"
)();

const id = n => String(n).padStart(22, "0");
const albumId = id(900);
const track = n => ({
  id:id(n), type:"track", name:"Song " + n,
  artists:[{id:id(800), name:"Artist"}], duration_ms:180000
});
const page = (items, offset = 0, total = offset + items.length) => ({
  items, offset, total, limit:20
});

// Preserve order, duplicates and unavailable positions.
const input = page([track(2), null, track(1), track(2)]);
input.next = "https://untrusted.example/steal";
const result = validate(input, albumId);
assert.equal(result.albumId, albumId);
assert.deepEqual(result.items.map(row => row.position), [1,2,3,4]);
assert.deepEqual(result.items.map(row => row.track?.id ?? null),
  [id(2),null,id(1),id(2)]);
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.items));
assert(Object.isFrozen(result.items[0]));
assert(!("next" in result));
assert(!JSON.stringify(result).includes("untrusted.example"));
assert(!("releaseDate" in result.items[0].track));

// Pagination counts source entries, including unavailable tracks.
const full = Array.from({length:20}, (_, i) =>
  i === 5 ? null : track(i));
assert.equal(validate(page(full, 0, 40), albumId).nextOffset, 20);
assert.equal(validate(page(full, 20, 40), albumId, 20).nextOffset, null);
assert.equal(validate(page(full, 20, 40), albumId, 20)
  .items[0].position, 21);
assert.equal(validate(page([track(1)], 0, 40), albumId).nextOffset, null);
assert.equal(validate(page([], 20, 0), albumId, 20).nextOffset, null);
assert.equal(validate(page(full, 10000, 100000),
  albumId, 10000).nextOffset, null);

// Reject malformed pages and track records.
for (const changes of [
  {limit:50}, {offset:20}, {total:-1}, {total:Infinity},
  {total:100001}, {items:null},
  {items:Array.from({length:21}, (_,i) => track(i)), total:21},
  {items:[track(1)], total:0},
  {items:[{...track(1), id:"../escape"}]}
]) {
  assert.throws(() => validate(
    {...page([track(1)]), ...changes}, albumId
  ));
}
for (const offset of [-1, 1, 10020, "0"]) {
  assert.throws(() => validate(page([]), albumId, offset));
}
for (const bad of [null, "", "../escape", 42]) {
  assert.throws(() => validate(page([]), bad));
}
console.log("PASS: album song order, unavailable positions, immutable metadata, raw-entry pagination, fixed album binding and malformed-page rejection.");