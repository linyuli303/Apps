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
const first = source.indexOf("function createSpotifyCallbackController(");
const last = source.indexOf("function createSpotifyConnectController(", first);
assert(first >= 0 && last > first);

const unused = () => { throw new Error("Unexpected default transport"); };
const create = new Function(
  "exchangeSpotifyAuthorization", "readSpotifyPlaylistPage",
  "readSpotifyFollowedArtistPage", "spotifyCallbackCleanupURL",
  [
    extract("selectSpotifyArtworkURL"),
    extract("validateSpotifyTokenResponse"),
    extract("validateSpotifyPlaylistPage"),
    extract("validateSpotifyTrackMetadata"),
    extract("validateSpotifyPlaylistItemPage"),
    source.slice(first, last),
    "return createSpotifyCallbackController;"
  ].join("\n")
)(unused, unused, unused, () => "https://linyuli303.github.io/Apps/");

const id = n => String(n).padStart(22, "0");
const playlistId = id(1);
const scopes = [
  "user-follow-read", "playlist-read-private",
  "playlist-read-collaborative", "user-library-read",
  "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];
function songs(offset = 0) {
  return {
    status:"ready", playlistId, offset, total:offset + 2,
    nextOffset:null,
    items:[
      {
        position:offset + 1,
        track:{
          id:id(200), type:"track", name:"Sample",
          artists:[{id:id(300), name:"Artist"}],
          durationMs:180000, availability:"unknown",
          spotifyURL:"https://untrusted.example/",
          privateDetails:"PRIVATE"
        }
      },
      {position:offset + 2, track:null}
    ]
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function fixture(reader = async offset => songs(offset)) {
  let now = 1000000;
  const calls = [];
  const controller = create({
    clientId:"a".repeat(32),
    clock:() => now,
    store:{consume:() => ({status:"authorized"}), clear() {}},
    replaceURL() {},
    exchange:async () => ({
      accessToken:"FAKE.private-token", refreshToken:null,
      expiresAt:4600000, scopes:[...scopes]
    }),
    playlistReader:async offset => {
      // This callback receives token first; see explicit adapter below.
      throw new Error("Unexpected adapter");
    },
    playlistItemReader:async (token, playlist, offset, context) => {
      calls.push({token, playlist, offset, signal:context.signal});
      return reader(offset);
    },
    // Metadata membership comes from a validated account playlist page.
    ...{
      playlistReader:async () => ({
        status:"received", offset:0, total:1,
        items:[{
          id:playlistId, name:"Account playlist",
          owner:{id:"sample-owner", display_name:"Owner"},
          collaborative:false
        }]
      })
    }
  });
  return {
    controller, calls,
    async connect() {
      assert.equal(await controller.completeCallback(
        "https://linyuli303.github.io/Apps/?code=FAKE&state=FAKE"
      ), "connected");
    },
    async allow() {
      assert.equal((await controller.readPlaylists()).status, "ready");
    },
    setNow(value) { now = value; }
  };
}
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("Unloaded playlists and invalid requests never reach transport",
    async () => {
      const f = fixture();
      assert.deepEqual(await f.controller.readPlaylistItems(playlistId),
        {status:"reauthorize"});
      await f.connect();
      assert.deepEqual(await f.controller.readPlaylistItems(playlistId),
        {status:"restricted"});
      for (const [playlist, offset] of [
        ["bad",0], [playlistId,1], [playlistId,-1], [playlistId,10020]
      ]) {
        assert.deepEqual(await f.controller.readPlaylistItems(playlist, offset),
          {status:"failed"});
      }
      assert.equal(f.calls.length, 0);
      f.controller.disconnect();
    }
  );

  await test("Loaded membership permits reduced immutable song results", async () => {
    const f = fixture();
    await f.connect();
    await f.allow();
    const result = await f.controller.readPlaylistItems(playlistId);
    assert.equal(result.status, "ready");
    assert.equal(f.calls[0].token, "FAKE.private-token");
    assert(f.calls[0].signal.aborted);
    assert(Object.isFrozen(result.items[0].track));
    assert.equal(result.items[1].track, null);
    assert.equal(result.items[0].track.spotifyURL,
      "https://open.spotify.com/track/" + id(200));
    assert(!JSON.stringify(result).includes("PRIVATE"));
    assert(!JSON.stringify(result).includes("FAKE.private-token"));
    assert(!JSON.stringify(result).includes("untrusted.example"));
    f.controller.disconnect();
  });

  await test("Cancellation stops delivery without removing playlist membership",
    async () => {
      const pending = deferred();
      let reads = 0;
      const f = fixture(offset =>
        ++reads === 1 ? pending.promise : songs(offset));
      await f.connect();
      await f.allow();
      const work = f.controller.readPlaylistItems(playlistId);
      f.controller.cancelPlaylistItems();
      assert(f.calls[0].signal.aborted);
      pending.resolve(songs());
      assert.deepEqual(await work, {status:"cancelled"});
      assert.equal(
        (await f.controller.readPlaylistItems(playlistId)).status, "ready"
      );
      f.controller.disconnect();
    }
  );

  await test("Refresh, disconnect and expiry discard pending songs", async () => {
    for (const action of ["refresh","disconnect","expiry"]) {
      const pending = deferred();
      const f = fixture(() => pending.promise);
      await f.connect();
      await f.allow();
      const work = f.controller.readPlaylistItems(playlistId);
      if (action === "refresh") await f.controller.readPlaylists();
      if (action === "disconnect") f.controller.disconnect();
      if (action === "expiry") f.setNow(4600000);
      pending.resolve(songs());
      assert.deepEqual(await work, {
        status:action === "expiry" ? "reauthorize" : "cancelled"
      });
      assert(f.calls[0].signal.aborted);
      if (action === "disconnect") {
        await f.connect();
        assert.deepEqual(await f.controller.readPlaylistItems(playlistId),
          {status:"restricted"});
      }
      f.controller.disconnect();
    }
  });

  await test("Provider denial remains restricted despite loaded membership",
    async () => {
      for (const state of ["restricted","rate_limited","reauthorize"]) {
        const f = fixture(async () => ({status:state, privateDetails:"PRIVATE"}));
        await f.connect();
        await f.allow();
        assert.deepEqual(await f.controller.readPlaylistItems(playlistId),
          {status:state});
        assert.equal(f.calls.length, 1);
        if (state === "reauthorize") {
          assert.equal(f.controller.getStatus(), "expired");
        }
        f.controller.disconnect();
      }
    }
  );

  await test("Newer reads win; mismatched responses fail closed", async () => {
    const pending = deferred();
    let reads = 0;
    const f = fixture(offset =>
      ++reads === 1 ? pending.promise : songs(offset));
    await f.connect();
    await f.allow();
    const old = f.controller.readPlaylistItems(playlistId);
    assert.equal(
      (await f.controller.readPlaylistItems(playlistId,20)).offset, 20
    );
    assert(f.calls[0].signal.aborted);
    pending.resolve(songs());
    assert.deepEqual(await old, {status:"cancelled"});
    f.controller.disconnect();

    for (const changes of [
      {playlistId:id(999)}, {offset:20}, {nextOffset:20},
      {items:[{position:9,track:null}]},
      {items:[{position:1,track:{
        ...songs().items[0].track, durationMs:-1
      }}]}
    ]) {
      const invalid = fixture(async () => ({...songs(), ...changes}));
      await invalid.connect();
      await invalid.allow();
      assert.deepEqual(
        await invalid.controller.readPlaylistItems(playlistId),
        {status:"failed"}
      );
      invalid.controller.disconnect();
    }
  });

  console.log(passed + " playlist-song session tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});