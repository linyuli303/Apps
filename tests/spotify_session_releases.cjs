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
  assert.equal(matches.length, 1, "Unique helper required: " + name);
  return matches[0][0];
}

const unused = () => { throw new Error("Unexpected transport"); };
const controllerStartMarker = "function createSpotifyCallbackController(";
const controllerEndMarker = "function createSpotifyConnectController(";
assert.equal(source.split(controllerStartMarker).length - 1, 1);
assert.equal(source.split(controllerEndMarker).length - 1, 1);
const controllerStart = source.indexOf(controllerStartMarker);
const controllerEnd = source.indexOf(controllerEndMarker, controllerStart);
assert(controllerEnd > controllerStart);
const controllerSource = source.slice(controllerStart, controllerEnd);

const create = new Function(
  "exchangeSpotifyAuthorization",
  "readSpotifyPlaylistPage",
  "readSpotifyFollowedArtistPage",
  "spotifyCallbackCleanupURL",
  "validateSpotifyPlaylistPage",
  [
    extract("validateSpotifyTokenResponse"),
    (extract("selectSpotifyArtworkURL") + "\n" + extract("validateSpotifyFollowedArtistPage")),
    extract("validateSpotifyArtistReleasePage"),
    controllerSource,
    "return createSpotifyCallbackController;"
  ].join("\n")
)(
  unused, unused, unused,
  () => "https://linyuli303.github.io/Apps/",
  page => {
    assert.equal(page.status, "received");
    return {items: [], nextOffset: null};
  }
);

const id = n => String(n).padStart(22, "0");
const scopes = [
  "user-follow-read", "playlist-read-private",
  "playlist-read-collaborative", "user-library-read",
  "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];

function artists(n = 1) {
  return {
    status: "ready", total: 1, nextAfter: null,
    items: [{id: id(n), type: "artist", name: "Artist " + n}]
  };
}
function releases(artistId = id(1), offset = 0) {
  return {
    status: "ready", artistId, offset,
    total: offset + 1, nextOffset: null,
    items: [{
      id: id(100), type: "album", name: "Sample release",
      releaseType: "album",
      releaseDate: "2024",
      releaseDatePrecision: "year",
      artistIds: [artistId],
      spotifyURL: "https://untrusted.example/",
      privateDetails: "PRIVATE"
    }]
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}
function fixture(options = {}) {
  let now = 1000000;
  const calls = [], artistCalls = [], playlistCalls = [];
  const controller = create({
    clientId: "a".repeat(32),
    store: {
      consume: () => ({status: "authorized"}),
      clear() {}
    },
    replaceURL() {},
    clock: () => now,
    exchange: async () => ({
      accessToken: "FAKE.private-token", refreshToken: null,
      expiresAt: 4600000, scopes: [...scopes]
    }),
    artistReader: async (token, after, context) => {
      artistCalls.push({after, signal: context.signal});
      return options.artists
        ? options.artists(after, context) : artists();
    },
    releaseReader: async (token, artistId, offset, context) => {
      calls.push({token, artistId, offset, signal: context.signal});
      return options.releases
        ? options.releases(artistId, offset, context)
        : releases(artistId, offset);
    },
    playlistReader: async (token, offset, context) => {
      playlistCalls.push({signal: context.signal});
      return options.playlists
        ? options.playlists(offset, context)
        : {status: "received", offset};
    }
  });
  return {
    controller, calls, artistCalls, playlistCalls,
    connect: () => controller.completeCallback(
      "https://linyuli303.github.io/Apps/?code=FAKE&state=FAKE"
    ),
    setNow(value) { now = value; }
  };
}
async function ready(f) {
  assert.equal(await f.connect(), "connected");
  assert.equal((await f.controller.readArtists()).status, "ready");
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("Disconnected, invalid and unfollowed reads never reach transport",
    async () => {
      const f = fixture();
      assert.deepEqual(await f.controller.readArtistReleases(id(1)),
        {status: "reauthorize"});
      await f.connect();
      assert.deepEqual(await f.controller.readArtistReleases(id(1)),
        {status: "restricted"});
      for (const [artistId, offset] of [
        ["bad", 0], [id(1), 1], [id(1), -1], [id(1), 10020]
      ]) {
        assert.deepEqual(
          await f.controller.readArtistReleases(artistId, offset),
          {status: "failed"}
        );
      }
      assert.equal(f.calls.length, 0);
    }
  );

  await test("Followed membership permits reduced immutable release results",
    async () => {
      const f = fixture();
      await ready(f);
      const result = await f.controller.readArtistReleases(id(1));
      assert.equal(result.status, "ready");
      assert.equal(f.calls[0].token, "FAKE.private-token");
      assert(f.calls[0].signal.aborted);
      assert(Object.isFrozen(result));
      assert(Object.isFrozen(result.items[0]));
      assert.equal(result.items[0].spotifyURL,
        "https://open.spotify.com/album/" + id(100));
      assert(!JSON.stringify(result).includes("PRIVATE"));
      assert(!JSON.stringify(result).includes("FAKE.private-token"));
      assert.deepEqual(await f.controller.readArtistReleases(id(2)),
        {status: "restricted"});
      assert.equal(f.calls.length, 1);
    }
  );

  await test("Followed refresh cancels releases and clears old membership",
    async () => {
      const pending = deferred();
      let artistReads = 0;
      const f = fixture({
        artists: async () => ++artistReads === 1
          ? artists(1) : {status: "restricted"},
        releases: () => pending.promise
      });
      await ready(f);
      const work = f.controller.readArtistReleases(id(1));
      await f.controller.readArtists();
      assert(f.calls[0].signal.aborted);
      pending.resolve(releases());
      assert.deepEqual(await work, {status: "cancelled"});
      assert.deepEqual(await f.controller.readArtistReleases(id(1)),
        {status: "restricted"});
      assert.equal(f.calls.length, 1);
    }
  );

  await test("Disconnect and expiry discard in-flight results", async () => {
    for (const reason of ["disconnect", "expiry"]) {
      const pending = deferred();
      const f = fixture({releases: () => pending.promise});
      await ready(f);
      const work = f.controller.readArtistReleases(id(1));
      if (reason === "disconnect") f.controller.disconnect();
      else f.setNow(4600000);
      pending.resolve(releases());
      assert.deepEqual(await work, {
        status: reason === "disconnect" ? "cancelled" : "reauthorize"
      });
      assert(f.calls[0].signal.aborted);
      assert.equal(f.controller.getStatus(),
        reason === "disconnect" ? "disconnected" : "expired");
    }
  });

  await test("New release read wins; playlists remain independent", async () => {
    const old = deferred(), playlist = deferred();
    let count = 0;
    const f = fixture({
      releases: (artistId, offset) => ++count === 1
        ? old.promise : releases(artistId, offset),
      playlists: () => playlist.promise
    });
    await ready(f);
    const first = f.controller.readArtistReleases(id(1));
    const playlistWork = f.controller.readPlaylists();
    const second = await f.controller.readArtistReleases(id(1), 20);
    assert.equal(second.offset, 20);
    assert(f.calls[0].signal.aborted);
    assert(!f.playlistCalls[0].signal.aborted);
    old.resolve(releases());
    assert.deepEqual(await first, {status: "cancelled"});
    playlist.resolve({status: "received", offset: 0});
    assert.equal((await playlistWork).status, "ready");
  });

  await test("Fixed failure states; reauthorization clears membership", async () => {
    for (const state of ["restricted", "rate_limited", "reauthorize"]) {
      const f = fixture({
        releases: async () => ({status: state, privateDetails: "PRIVATE"})
      });
      await ready(f);
      assert.deepEqual(await f.controller.readArtistReleases(id(1)),
        {status: state});
      assert.equal(f.calls.length, 1);
      if (state === "reauthorize") {
        assert.equal(f.controller.getStatus(), "expired");
        await f.connect();
        assert.deepEqual(await f.controller.readArtistReleases(id(1)),
          {status: "restricted"});
      }
    }
  });

  await test("Wrong bindings and malformed metadata fail closed", async () => {
    for (const change of [
      {artistId: id(2)}, {offset: 20}, {nextOffset: 1},
      {items: [{...releases().items[0], artistIds: [id(2)]}]},
      {items: [{...releases().items[0], releaseDate: "2023-02-29",
        releaseDatePrecision: "day"}]}
    ]) {
      const f = fixture({releases: async () => ({
        ...releases(), ...change
      })});
      await ready(f);
      assert.deepEqual(await f.controller.readArtistReleases(id(1)),
        {status: "failed"});
    }

    const f = fixture({
      releases: async () => { throw new Error("PRIVATE"); }
    });
    await ready(f);
    assert.deepEqual(await f.controller.readArtistReleases(id(1)),
      {status: "failed"});
  });

  await test("Filtered empty pages preserve validated raw-page pagination",
    async () => {
      const f = fixture({releases: async () => ({
        ...releases(), items: [], total: 40, nextOffset: 20
      })});
      await ready(f);
      const result = await f.controller.readArtistReleases(id(1));
      assert.equal(result.status, "ready");
      assert.equal(result.items.length, 0);
      assert.equal(result.nextOffset, 20);
    }
  );

  await test("Explicit cancellation aborts without clearing followed membership",
    async () => {
      const pending = deferred();
      let reads = 0;
      const f = fixture({
        releases: (artistId, offset) => ++reads === 1
          ? pending.promise : releases(artistId, offset)
      });
      await ready(f);

      const work = f.controller.readArtistReleases(id(1));
      assert.equal(f.calls.length, 1);
      assert(!f.calls[0].signal.aborted);

      f.controller.cancelArtistReleases();
      f.controller.cancelArtistReleases();
      assert(f.calls[0].signal.aborted);

      pending.resolve(releases());
      assert.deepEqual(await work, {status: "cancelled"});
      assert.equal(f.controller.getStatus(), "connected");

      const next = await f.controller.readArtistReleases(id(1));
      assert.equal(next.status, "ready");
      assert.equal(f.calls.length, 2);
      assert.equal(next.artistId, id(1));

      f.controller.disconnect();
    }
  );

  await test("Release artwork is revalidated at the session boundary",
    async () => {
      const artworkURL = "https://i.scdn.co/image/" + "b".repeat(40);

      for (const candidate of [
        artworkURL,
        "https://untrusted.example/image",
        artworkURL + "?token=private"
      ]) {
        const f = fixture({
          releases:async (artistId, offset) => {
            const value = releases(artistId, offset);
            return {
              ...value,
              items:value.items.map(item => ({
                ...item,
                artworkURL:candidate,
                images:[{url:artworkURL}]
              }))
            };
          }
        });

        await ready(f);
        const result = await f.controller.readArtistReleases(id(1));
        assert.equal(result.status, "ready");
        assert(!("images" in result.items[0]));
        assert(Object.isFrozen(result.items[0]));

        if (candidate === artworkURL) {
          assert.equal(result.items[0].artworkURL, artworkURL);
        } else {
          // Raw image arrays cannot bypass the reduced artwork field.
          assert(!("artworkURL" in result.items[0]));
        }

        assert(!JSON.stringify(result).includes("FAKE.private-token"));
        f.controller.disconnect();
      }
    }
  );

  console.log(passed + " release-session tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});