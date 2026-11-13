"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^async function loadSpotifyLatestReleaseBatch\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

const load = new Function(
  matches[0][0] + "\nreturn loadSpotifyLatestReleaseBatch;"
)();

const id = n => String(n).padStart(22, "0");
const artists = [1, 2, 3, 4, 5].map(id);
function page(artistId, changes = {}) {
  return {
    status: "ready", artistId, offset: 0, nextOffset: null,
    items: [Object.freeze({id: artistId})],
    ...changes
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("At most three requests per batch; explicit continuation", async () => {
    const calls = [];
    const controller = {
      async readArtistReleases(artistId, offset) {
        calls.push({artistId, offset});
        return page(artistId);
      }
    };

    const first = await load(controller, artists);
    assert.equal(first.status, "ready");
    assert.equal(first.completed, 3);
    assert.equal(first.nextIndex, 3);
    assert.deepEqual(calls.map(call => call.artistId), artists.slice(0, 3));
    assert(calls.every(call => call.offset === 0));
    assert(Object.isFrozen(first));
    assert(Object.isFrozen(first.items));

    const second = await load(controller, artists, first.nextIndex);
    assert.equal(second.completed, 2);
    assert.equal(second.nextIndex, null);
    assert.equal(calls.length, 5);
  });

  await test("Requests run sequentially, not concurrently", async () => {
    const pending = deferred();
    const calls = [];
    const controller = {
      async readArtistReleases(artistId) {
        calls.push(artistId);
        return calls.length === 1 ? pending.promise : page(artistId);
      }
    };
    const work = load(controller, artists);
    assert.deepEqual(calls, [artists[0]]);
    pending.resolve(page(artists[0]));
    const result = await work;
    assert.equal(result.completed, 3);
    assert.equal(calls.length, 3);
  });

  await test("Deduplicates release IDs and reports incomplete artist pages", async () => {
    const result = await load({
      async readArtistReleases(artistId) {
        return page(artistId, {
          items: [{id: id(100)}],
          nextOffset: 20
        });
      }
    }, artists);

    assert.equal(result.items.length, 1);
    assert.equal(result.partialArtistPages, 3);
    assert.equal(result.completed, 3);
  });

  await test("Errors stop the batch without automatic retries", async () => {
    for (const state of ["restricted", "rate_limited", "failed", "throw"]) {
      let calls = 0;
      const result = await load({
        async readArtistReleases(artistId) {
          calls++;
          if (calls === 1) return page(artistId);
          if (state === "throw") throw new Error("PRIVATE");
          return {status: state, privateDetails: "PRIVATE"};
        }
      }, artists);

      assert.equal(calls, 2);
      assert.equal(result.status, state === "throw" ? "failed" : state);
      assert.equal(result.completed, 1);
      assert.equal(result.nextIndex, 1);
      assert(!JSON.stringify(result).includes("PRIVATE"));
    }
  });

  await test("Cancellation and session loss return no accumulated metadata", async () => {
    let calls = 0;
    const controller = {
      async readArtistReleases(artistId) {
        calls++;
        return page(artistId);
      }
    };
    assert.deepEqual(
      await load(controller, artists, 0, () => false),
      {status: "cancelled"}
    );
    assert.equal(calls, 0);

    const pending = deferred();
    let current = true;
    const work = load({
      readArtistReleases() { return pending.promise; }
    }, artists, 0, () => current);
    current = false;
    pending.resolve(page(artists[0]));
    assert.deepEqual(await work, {status: "cancelled"});

    for (const state of ["reauthorize", "cancelled"]) {
      let count = 0;
      const result = await load({
        async readArtistReleases(artistId) {
          return ++count === 1 ? page(artistId) : {status: state};
        }
      }, artists);
      assert.deepEqual(result, {status: state});
      assert.equal(count, 2);
    }
  });

  await test("Invalid inputs and mismatched responses fail safely", async () => {
    const controller = {
      async readArtistReleases(artistId) { return page(artistId); }
    };
    for (const ids of [null, ["bad"], [id(1), id(1)]]) {
      await assert.rejects(() => load(controller, ids));
    }
    for (const start of [-1, 6, 1.5, "0"]) {
      await assert.rejects(() => load(controller, artists, start));
    }
    await assert.rejects(() => load({}, artists));
    await assert.rejects(() => load(controller, artists, 0, null));

    const empty = await load(controller, []);
    assert.equal(empty.completed, 0);
    assert.equal(empty.nextIndex, null);

    for (const changes of [
      {artistId: id(999)}, {offset: 20}, {items: null},
      {items: Array.from({length: 21}, (_, i) => ({id: id(i)}))}
    ]) {
      let calls = 0;
      const result = await load({
        async readArtistReleases(artistId) {
          calls++;
          return page(artistId, changes);
        }
      }, artists);
      assert.equal(result.status, "failed");
      assert.equal(calls, 1);
      assert.equal(result.nextIndex, 0);
    }
  });

  console.log(passed + " latest-release batch tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});