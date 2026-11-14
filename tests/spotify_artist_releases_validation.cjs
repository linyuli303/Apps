"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function validateSpotifyArtistReleasePage\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);
const artworkMatches = [...source.matchAll(
  /^function selectSpotifyArtworkURL\([\s\S]*?^\}/gm
)];
assert.equal(artworkMatches.length, 1);
const validate = new Function(
  artworkMatches[0][0] + "\n" +
  matches[0][0] + "\nreturn validateSpotifyArtistReleasePage;"
)();

const id = n => String(n).padStart(22, "0");
const artistId = id(900);
function release(n = 1, changes = {}) {
  return {
    id: id(n), type: "album", name: " Sample release ",
    album_type: "album", album_group: "album",
    release_date: "2024-02-29", release_date_precision: "day",
    artists: [{id: artistId}],
    ...changes
  };
}
function page(items = [release()], offset = 0,
              total = offset + items.length) {
  return {items, offset, total, limit: 10};
}

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log("PASS: " + name);
}

test("Immutable reduced metadata with fixed album links", () => {
  const input = page();
  input.items[0].images = [{url: "https://untrusted.example/image"}];
  input.items[0].external_urls = {spotify: "https://untrusted.example/"};
  input.items[0].description = "<img src=x>";
  const output = validate(input, artistId);
  const item = output.items[0];

  assert.equal(item.name, "Sample release");
  assert.equal(item.type, "album");
  assert.equal(item.spotifyURL,
    "https://open.spotify.com/album/" + id(1));
  assert.equal(Object.keys(item).sort().join(","),
    "artistIds,dateLowerBound,id,name,releaseDate,releaseDatePrecision,releaseType,spotifyURL,type");
  assert(Object.isFrozen(output));
  assert(Object.isFrozen(output.items));
  assert(Object.isFrozen(item));
  assert(Object.isFrozen(item.artistIds));

  input.items[0].artists[0].id = id(901);
  input.items[0].name = "Changed";
  assert.deepEqual(item.artistIds, [artistId]);
  assert.equal(item.name, "Sample release");
});

test("Only explicitly credited album/single groups survive", () => {
  const output = validate(page([
    release(1),
    release(2, {album_type: "single", album_group: "single"}),
    release(3, {artists: [{id: id(901)}]}),
    release(4, {album_type: "compilation", album_group: "compilation"}),
    release(5, {album_group: "appears_on"}),
    release(6, {artists: [
      {id: id(901)}, {id: artistId}, {id: artistId}
    ]})
  ]), artistId);

  assert.deepEqual(output.items.map(item => item.id),
    [id(1), id(2), id(6)]);
  assert.equal(output.items[1].releaseType, "single");
  assert.deepEqual(output.items[2].artistIds, [id(901), artistId]);
});

test("Missing album_group is accepted; album_type decides; credit still required", () => {
  const without = changes => {
    const item = release(changes.n, changes);
    delete item.album_group;
    delete item.n;
    return item;
  };
  const output = validate(page([
    without({n: 1}),
    without({n: 2, album_type: "single"}),
    without({n: 3, album_type: "compilation"}),
    without({n: 4, artists: [{id: id(901)}]}),
    release(5, {album_group: "appears_on"})
  ]), artistId);
  assert.deepEqual(output.items.map(item => item.id), [id(1), id(2)]);
  assert.deepEqual(output.items.map(item => item.releaseType),
    ["album", "single"]);
  for (const changes of [
    {album_group: null}, {album_group: ""}, {album_group: "unknown"}
  ]) {
    assert.throws(() => validate(page([release(1, changes)]), artistId));
  }
});

test("Year/month/day precision retained without inventing exact dates", () => {
  for (const [date, precision, lowerBound] of [
    ["2024", "year", "2024-01-01"],
    ["2024-02", "month", "2024-02-01"],
    ["2024-02-29", "day", "2024-02-29"]
  ]) {
    const item = validate(page([release(1, {
      release_date: date, release_date_precision: precision
    })]), artistId).items[0];
    assert.equal(item.releaseDate, date);
    assert.equal(item.releaseDatePrecision, precision);
    assert.equal(item.dateLowerBound, lowerBound);
  }

  for (const [date, precision] of [
    ["2023-02-29", "day"], ["2024-04-31", "day"],
    ["2024-13", "month"], ["2024-00", "month"],
    ["0000", "year"], ["2024", "day"],
    ["2024-02-01", "month"], ["2024", "unknown"],
    ["2024", "__proto__"], [null, "year"]
  ]) {
    assert.throws(() => validate(page([release(1, {
      release_date: date, release_date_precision: precision
    })]), artistId));
  }
});

test("Pagination uses raw page size even when every release is filtered out", () => {
  // Spotify's artist-albums page size is 10 (February 2026 Web API).
  const excluded = Array.from({length: 10}, (_, i) =>
    release(i + 1, {artists: [{id: id(901)}]}));
  const result = validate(page(excluded, 0, 20), artistId);
  assert.equal(result.items.length, 0);
  assert.equal(result.nextOffset, 10);

  const full = Array.from({length: 10}, (_, i) => release(i + 1));
  assert.equal(validate(page(full, 10, 20), artistId, 10).nextOffset, null);
  assert.equal(validate(page([release()], 0, 40), artistId).nextOffset, null);
  assert.equal(validate(page([], 0, 0), artistId).nextOffset, null);
  assert.equal(
    validate(page(full, 10000, 100000), artistId, 10000).nextOffset, null
  );
});

test("Malformed records and duplicate release IDs rejected", () => {
  assert.throws(() => validate(page([release(), release()]), artistId));
  for (const changes of [
    {id: "../escape"}, {type: "track"},
    {name: ""}, {name: "   "}, {name: "bad\nname"},
    {name: "x".repeat(301)}, {name: null},
    {album_type: "unknown"}, {album_group: "unknown"},
    {artists: []}, {artists: null}, {artists: [{id: "bad"}]},
    {artists: Array.from({length: 101}, () => ({id: artistId}))}
  ]) {
    assert.throws(() => validate(
      page([release(1, changes)]), artistId
    ));
  }
  for (const name of ["落日大道", "<b>Sample</b>"]) {
    assert.equal(validate(
      page([release(1, {name})]), artistId
    ).items[0].name, name);
  }
});

test("Invalid artist IDs, offsets and page containers rejected", () => {
  for (const invalid of [null, "", "../escape", 42]) {
    assert.throws(() => validate(page(), invalid));
  }
  for (const offset of [-1, 1, 5, 15, 10010, "0", Infinity]) {
    assert.throws(() => validate(page(), artistId, offset));
  }
  for (const invalid of [null, [], {}, {items: []}]) {
    assert.throws(() => validate(invalid, artistId));
  }
  for (const changes of [
    {offset: 10}, {limit: 50}, {limit: 20}, {total: -1}, {total: 0},
    {total: 100001}, {total: Infinity}, {items: null},
    {items: Array.from({length: 11}, (_, i) => release(i + 1)), total: 11}
  ]) {
    assert.throws(() => validate({...page(), ...changes}, artistId));
  }
});

test("Provider pagination URLs and extra fields never leave the validator", () => {
  const result = validate({
    ...page(), next: "https://untrusted.example/steal",
    previous: "https://untrusted.example/", privateDetails: "PRIVATE"
  }, artistId);
  assert.equal(Object.keys(result).sort().join(","),
    "artistId,items,nextOffset,offset,total");
  assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("Validated release artwork is optional and detached", () => {
  const artworkURL = "https://i.scdn.co/image/" + "a".repeat(40);
  const input = page([release(1, {
    images:[{url:artworkURL, width:300, height:300}]
  })]);

  const output = validate(input, artistId).items[0];
  assert.equal(output.artworkURL, artworkURL);
  assert(!("images" in output));
  assert(Object.isFrozen(output));

  input.items[0].images[0].url = "https://untrusted.example/changed";
  assert.equal(output.artworkURL, artworkURL);

  const rejected = validate(page([release(2, {
    images:[{url:artworkURL + "?token=private"}]
  })]), artistId).items[0];
  assert(!("artworkURL" in rejected));
});

console.log(passed + " artist-release validation tests passed.");