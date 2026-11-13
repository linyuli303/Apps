"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const startMarker = "function validateSpotifyFollowedArtistPage(";
const endMarker = "async function readSpotifyPlaylistPage(";
assert.equal(source.split(startMarker).length - 1, 1);
assert.equal(source.split(endMarker).length - 1, 1);
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
assert(end > start);

const artworkMatches = [...source.matchAll(
  /^function selectSpotifyArtworkURL\([\s\S]*?^\}/gm
)];
assert.equal(artworkMatches.length, 1);
const validate = new Function(
  artworkMatches[0][0] + "\n" + source.slice(start, end) +
  "\nreturn validateSpotifyFollowedArtistPage;"
)();

const id = n => String(n).padStart(22, "0");
const artist = n => ({
  id: id(n), type: "artist", name: " Sample artist " + n + " "
});
function page(items = [artist(1)], after = null, total = items.length) {
  return {artists: {items, limit: 20, total, cursors: {after}}};
}

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log("PASS: " + name);
}

test("Safe immutable display data; input remains detached", () => {
  const input = page();
  const output = validate(input);
  assert.deepEqual(output.items[0], {
    id: id(1), type: "artist", name: "Sample artist 1",
    spotifyURL: "https://open.spotify.com/artist/" + id(1)
  });
  assert(Object.isFrozen(output));
  assert(Object.isFrozen(output.items));
  assert(Object.isFrozen(output.items[0]));
  input.artists.items[0].name = "Changed";
  assert.equal(output.items[0].name, "Sample artist 1");
});

test("Untrusted links, HTML descriptions and artwork are discarded", () => {
  const input = artist(1);
  input.external_urls = {spotify: "https://untrusted.example/"};
  input.images = [{url: "https://untrusted.example/image"}];
  input.description = "<img src=x onerror=alert(1)>";
  const result = validate(page([input])).items[0];
  assert.equal(Object.keys(result).sort().join(","),
    "id,name,spotifyURL,type");
  assert.equal(result.spotifyURL,
    "https://open.spotify.com/artist/" + id(1));
});

test("Empty and terminal pages stop pagination", () => {
  assert.equal(validate(page([])).nextAfter, null);
  assert.equal(validate(page([], id(9), 100)).nextAfter, null);
  assert.equal(validate(page([artist(1)])).nextAfter, null);
});

test("Continuation cursor is retained without following provider URLs", () => {
  const input = page([artist(1), artist(2)], id(2), 40);
  input.artists.next = "https://untrusted.example/steal";
  const result = validate(input);
  assert.equal(result.nextAfter, id(2));
  assert(!("next" in result));
  assert.equal(validate(page([artist(2)], id(2), 40), id(1)).nextAfter,
    id(2));
});

test("Duplicate, repeated and malformed artist IDs are rejected", () => {
  assert.throws(() => validate(page([artist(1), artist(1)])));
  assert.throws(() => validate(page([artist(1)]), id(1)));
  for (const badID of ["../escape", "", null, 42, "a".repeat(23)]) {
    assert.throws(() => validate(page([{...artist(1), id: badID}])));
  }
  assert.throws(() => validate(page([{...artist(1), type: "album"}])));
});

test("Invalid labels rejected; Unicode and markup stay plain strings", () => {
  for (const name of [null, 42, "", "   ", "bad\nname",
                       "bad\u007f", "x".repeat(301)]) {
    assert.throws(() => validate(page([{...artist(1), name}])));
  }
  for (const name of ["落日大道", "<b>Artist</b>"]) {
    assert.equal(validate(page([{...artist(1), name}])).items[0].name,
      name);
  }
});

test("Malformed page containers and oversized pages are rejected", () => {
  for (const value of [null, [], {}, {artists: null}, {artists: []}]) {
    assert.throws(() => validate(value));
  }
  for (const changes of [
    {limit: 50}, {items: null}, {total: -1}, {total: 0},
    {total: Infinity}, {total: 100001}, {cursors: null},
    {cursors: []}, {cursors: {}},
    {items: Array.from({length: 21}, (_, i) => artist(i)), total: 21}
  ]) {
    assert.throws(() => validate({
      artists: {...page().artists, ...changes}
    }));
  }
});

test("Malformed or nonprogressing cursors are rejected", () => {
  // Explicit undefined uses the default null request cursor.
  assert.deepEqual(validate(page(), undefined), validate(page(), null));

  // A missing cursor in the provider response must still be rejected.
  const missingCursor = page();
  delete missingCursor.artists.cursors.after;
  assert.throws(() => validate(missingCursor));

  for (const cursor of ["bad", "", 42, {}]) {
    assert.throws(() => validate(page(), cursor));
    assert.throws(() => validate(page([artist(1)], cursor)));
  }
  assert.throws(() => validate(page([artist(2)], id(1), 40), id(1)));
  assert.throws(() => validate(page([artist(1)], id(9), 40)));
});

test("Validated artwork is optional and detached", () => {
  const artworkURL = "https://i.scdn.co/image/" + "a".repeat(40);
  const input = artist(1);
  input.images = [
    {url:artworkURL, width:300, height:300},
    {url:"https://untrusted.example/image", width:140, height:140}
  ];

  const result = validate(page([input])).items[0];
  assert.equal(result.artworkURL, artworkURL);
  assert(!("images" in result));
  assert(Object.isFrozen(result));

  input.images[0].url = "https://untrusted.example/changed";
  assert.equal(result.artworkURL, artworkURL);

  const withoutArtwork = validate(page([artist(2)])).items[0];
  assert(!("artworkURL" in withoutArtwork));
});

console.log(passed + " followed-artist validation tests passed.");