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

const startMarker = "function createSpotifyCallbackController(";
const endMarker = "function createSpotifyConnectController(";
assert.equal(source.split(startMarker).length - 1, 1);
assert.equal(source.split(endMarker).length - 1, 1);
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
assert(end > start);

const unused = () => { throw new Error("Unexpected default transport"); };
const create = new Function(
  "exchangeSpotifyAuthorization",
  "readSpotifyPlaylistPage",
  "readSpotifyFollowedArtistPage",
  "spotifyCallbackCleanupURL",
  [
    extract("selectSpotifyArtworkURL"),
    extract("validateSpotifyTokenResponse"),
    extract("validateSpotifyFollowedArtistPage"),
    extract("validateSpotifyArtistReleasePage"),
    extract("validateSpotifyTrackMetadata"),
    extract("validateSpotifyAlbumTrackPage"),
    source.slice(start, end),
    "return createSpotifyCallbackController;"
  ].join("\n")
)(
  unused, unused, unused,
  () => "https://linyuli303.github.io/Apps/"
);

const id = n => String(n).padStart(22, "0");
const artistId = id(1);
const albumId = id(100);
const scopes = [
  "user-follow-read", "playlist-read-private",
  "playlist-read-collaborative", "user-library-read",
  "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];

function songPage(offset = 0) {
  return {
    status:"ready", albumId, offset,
    total:offset + 2, nextOffset:null,
    items:[
      {
        position:offset + 1,
        track:{
          id:id(200), type:"track", name:"Sample song",
          artists:[{id:artistId, name:"Sample artist"}],
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

function fixture(reader = async offset => songPage(offset)) {
  let now = 1000000;
  const calls = [];
  const controller = create({
    clientId:"a".repeat(32),
    store:{
      consume:() => ({status:"authorized"}),
      clear() {}
    },
    replaceURL() {},
    clock:() => now,
    exchange:async () => ({
      accessToken:"FAKE.private-token",
      refreshToken:null,
      expiresAt:4600000,
      scopes:[...scopes]
    }),
    artistReader:async () => ({
      status:"ready", total:1, nextAfter:null,
      items:[{id:artistId, type:"artist", name:"Sample artist"}]
    }),
    releaseReader:async () => ({
      status:"ready", artistId, offset:0, total:1, nextOffset:null,
      items:[{
        id:albumId, type:"album", name:"Sample album",
        releaseType:"album",
        releaseDate:"2025", releaseDatePrecision:"year",
        artistIds:[artistId]
      }]
    }),
    albumTrackReader:async (token, album, offset, context) => {
      calls.push({token, album, offset, signal:context.signal});
      return reader(offset, context);
    }
  });

  async function connect() {
    assert.equal(await controller.completeCallback(
      "https://linyuli303.github.io/Apps/?code=FAKE&state=FAKE"
    ), "connected");
  }
  async function allowAlbum() {
    assert.equal((await controller.readArtists()).status, "ready");
    assert.equal(
      (await controller.readArtistReleases(artistId)).status, "ready"
    );
  }

  return {
    controller, calls, connect, allowAlbum,
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
  await test("Unknown albums and invalid requests never reach transport", async () => {
    const f = fixture();
    assert.deepEqual(await f.controller.readAlbumTracks(albumId),
      {status:"reauthorize"});
    await f.connect();

    assert.deepEqual(await f.controller.readAlbumTracks(albumId),
      {status:"restricted"});

    // Following the artist alone does not authorize arbitrary albums.
    await f.controller.readArtists();
    assert.deepEqual(await f.controller.readAlbumTracks(albumId),
      {status:"restricted"});

    for (const [album, offset] of [
      ["bad",0], [albumId,1], [albumId,-1], [albumId,10020]
    ]) {
      assert.deepEqual(await f.controller.readAlbumTracks(album, offset),
        {status:"failed"});
    }
    assert.equal(f.calls.length, 0);
    f.controller.disconnect();
  });

  await test("Eligible album returns safe immutable songs and unavailable positions",
    async () => {
      const f = fixture();
      await f.connect();
      await f.allowAlbum();

      const result = await f.controller.readAlbumTracks(albumId);
      assert.equal(result.status, "ready");
      assert.equal(f.calls[0].token, "FAKE.private-token");
      assert.equal(f.calls[0].album, albumId);
      assert(f.calls[0].signal.aborted);
      assert(Object.isFrozen(result));
      assert(Object.isFrozen(result.items[0].track));
      assert.equal(result.items[1].track, null);
      assert.equal(result.items[0].track.spotifyURL,
        "https://open.spotify.com/track/" + id(200));
      assert(!JSON.stringify(result).includes("PRIVATE"));
      assert(!JSON.stringify(result).includes("FAKE.private-token"));
      assert(!JSON.stringify(result).includes("untrusted.example"));
      f.controller.disconnect();
    }
  );

  await test("Explicit cancellation preserves album eligibility", async () => {
    const pending = deferred();
    let reads = 0;
    const f = fixture(offset =>
      ++reads === 1 ? pending.promise : songPage(offset));
    await f.connect();
    await f.allowAlbum();

    const work = f.controller.readAlbumTracks(albumId);
    f.controller.cancelAlbumTracks();
    f.controller.cancelAlbumTracks();
    assert(f.calls[0].signal.aborted);
    pending.resolve(songPage());
    assert.deepEqual(await work, {status:"cancelled"});

    assert.equal(
      (await f.controller.readAlbumTracks(albumId)).status, "ready"
    );
    assert.equal(f.controller.getStatus(), "connected");
    f.controller.disconnect();
  });

  await test("Artist refresh and disconnect revoke album eligibility", async () => {
    for (const action of ["refresh", "disconnect"]) {
      const pending = deferred();
      const f = fixture(() => pending.promise);
      await f.connect();
      await f.allowAlbum();

      const work = f.controller.readAlbumTracks(albumId);
      if (action === "refresh") await f.controller.readArtists();
      else f.controller.disconnect();

      assert(f.calls[0].signal.aborted);
      pending.resolve(songPage());
      assert.deepEqual(await work, {status:"cancelled"});

      if (action === "disconnect") await f.connect();
      assert.deepEqual(await f.controller.readAlbumTracks(albumId),
        {status:"restricted"});
      assert.equal(f.calls.length, 1);
      f.controller.disconnect();
    }
  });

  await test("Expiry and newer song requests discard stale results", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    await f.connect();
    await f.allowAlbum();

    const work = f.controller.readAlbumTracks(albumId);
    f.setNow(4600000);
    pending.resolve(songPage());
    assert.deepEqual(await work, {status:"reauthorize"});
    assert.equal(f.controller.getStatus(), "expired");
    assert(f.calls[0].signal.aborted);

    const old = deferred();
    let reads = 0;
    const newer = fixture(offset =>
      ++reads === 1 ? old.promise : songPage(offset));
    await newer.connect();
    await newer.allowAlbum();

    const first = newer.controller.readAlbumTracks(albumId);
    const second = await newer.controller.readAlbumTracks(albumId, 20);
    assert.equal(second.offset, 20);
    assert(newer.calls[0].signal.aborted);
    old.resolve(songPage());
    assert.deepEqual(await first, {status:"cancelled"});
    newer.controller.disconnect();
  });

  await test("Access/rate-limit states stay fixed; malformed pages fail closed",
    async () => {
      for (const state of ["restricted","rate_limited","reauthorize"]) {
        const f = fixture(async () => ({
          status:state, privateDetails:"PRIVATE"
        }));
        await f.connect();
        await f.allowAlbum();
        assert.deepEqual(await f.controller.readAlbumTracks(albumId),
          {status:state});
        assert.equal(f.calls.length, 1);
        if (state === "reauthorize") {
          assert.equal(f.controller.getStatus(), "expired");
        }
        f.controller.disconnect();
      }

      for (const change of [
        {albumId:id(999)}, {offset:20}, {nextOffset:20},
        {items:[{position:9, track:null}]},
        {items:[{
          position:1,
          track:{...songPage().items[0].track, durationMs:-1}
        }]}
      ]) {
        const f = fixture(async () => ({...songPage(), ...change}));
        await f.connect();
        await f.allowAlbum();
        assert.deepEqual(await f.controller.readAlbumTracks(albumId),
          {status:"failed"});
        f.controller.disconnect();
      }
    }
  );

  console.log(passed + " album-session tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});