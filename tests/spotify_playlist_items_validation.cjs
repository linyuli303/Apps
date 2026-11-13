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
  assert.equal(matches.length, 1, name);
  return matches[0][0];
}
const validate = new Function([
  extract("validateSpotifyTrackMetadata"),
  extract("validateSpotifyPlaylistItemPage"),
  "return validateSpotifyPlaylistItemPage;"
].join("\n"))();

const id = n => String(n).padStart(22, "0");
const playlistId = id(900);
const song = n => ({
  id:id(n), type:"track", name:"Song " + n,
  duration_ms:180000,
  artists:[{id:id(800), name:"Artist"}]
});
const entry = n => ({
  item:song(n),
  added_at:"2026-11-01T00:00:00Z",
  added_by:{id:"PRIVATE"}
});
const page = (items, offset=0, total=offset+items.length) => ({
  items, offset, total, limit:20
});

// Preserve repeated songs and positions; unsupported content becomes null.
const input = page([
  entry(2),
  null,
  {item:null},
  {item:{type:"episode"}},
  {item:song(3), is_local:true},
  {item:{type:"track", is_local:true}},
  entry(1),
  entry(2)
]);
const result = validate(input, playlistId);
assert.equal(result.playlistId, playlistId);
assert.deepEqual(result.items.map(row => row.position), [1,2,3,4,5,6,7,8]);
assert.deepEqual(result.items.map(row => row.track?.id ?? null),
  [id(2),null,null,null,null,null,id(1),id(2)]);
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.items));
assert(Object.isFrozen(result.items[0]));
assert(Object.isFrozen(result.items[0].track));

// Private/provider metadata and playlist-added dates are not retained.
assert(!JSON.stringify(result).includes("PRIVATE"));
assert(!JSON.stringify(result).includes("2026-11-01"));
assert(!("releaseDate" in result.items[0].track));
input.items[0].item.name = "Changed";
assert.equal(result.items[0].track.name, "Song 2");
console.log("PASS: order, repeated songs, unsupported entries and safe reduction");

// Pagination counts raw entries, not playable songs.
const full = Array.from({length:20}, () => ({item:null}));
assert.equal(validate(page(full,0,40),playlistId).nextOffset,20);
assert.equal(validate(page(full,20,40),playlistId,20).nextOffset,null);
assert.equal(validate(page(full,20,40),playlistId,20).items[0].position,21);
assert.equal(validate(page([{item:null}],0,40),playlistId).nextOffset,null);
assert.equal(validate(page([],20,0),playlistId,20).nextOffset,null);
assert.equal(
  validate(page(full,10000,100000),playlistId,10000).nextOffset,null
);
console.log("PASS: bounded pagination preserves unavailable positions");

// Reject missing current-shape wrappers rather than guessing legacy fields.
for (const invalid of [
  undefined, [], "entry", {}, {track:song(1)},
  {item:song(1),is_local:"true"},
  {item:{...song(1),id:"../escape"}}
]) {
  assert.throws(() => validate(page([invalid]),playlistId));
}
for (const changes of [
  {limit:50}, {offset:20}, {total:-1}, {total:Infinity},
  {total:100001}, {items:null}, {total:0},
  {items:Array.from({length:21}, () => entry(1)),total:21}
]) {
  assert.throws(() => validate({...page([entry(1)]),...changes},playlistId));
}
for (const value of [null,[],{}]) {
  assert.throws(() => validate(value,playlistId));
}
for (const badId of ["",null,42,"../escape"]) {
  assert.throws(() => validate(page([]),badId));
}
for (const offset of [-1,1,10020,"0"]) {
  assert.throws(() => validate(page([]),playlistId,offset));
}
console.log("PASS: malformed entries, page bindings and identifiers rejected");

const stripped = validate({
  ...page([entry(1)]),
  next:"https://untrusted.example/steal",
  previous:"https://untrusted.example/"
},playlistId);
assert.equal(Object.keys(stripped).sort().join(","),
  "items,nextOffset,offset,playlistId,total");
assert(!JSON.stringify(stripped).includes("untrusted.example"));
console.log("Playlist-item validation checks passed.");