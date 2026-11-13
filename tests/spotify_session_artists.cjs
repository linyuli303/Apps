"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);

function extract(name) {
  const pattern = new RegExp(
    "^function " + name + "\\([\\s\\S]*?^\\}", "gm"
  );
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, "Unique helper required: " + name);
  return matches[0][0];
}

const start = source.indexOf("function createSpotifyCallbackController(");
const end = source.indexOf("function createSpotifyConnectController(", start);
assert(start >= 0 && end > start);

const unused = () => { throw new Error("Unexpected default transport"); };

const create = new Function(
  "exchangeSpotifyAuthorization",
  "readSpotifyPlaylistPage",
  "readSpotifyFollowedArtistPage",
  "spotifyCallbackCleanupURL",
  "validateSpotifyPlaylistPage",
  extract("validateSpotifyTokenResponse") + "\n" +
  (extract("selectSpotifyArtworkURL") + "\n" + extract("validateSpotifyFollowedArtistPage")) + "\n" +
  source.slice(start, end) +
  "\nreturn createSpotifyCallbackController;"
)(
  unused, unused, unused,
  () => "https://linyuli303.github.io/Apps/",
  page => {
    assert.equal(page.status, "received");
    return Object.freeze({
      items: Object.freeze([]), nextOffset: null, offset: page.offset
    });
  }
);

const scopes = [
  "user-follow-read", "playlist-read-private",
  "playlist-read-collaborative", "user-library-read",
  "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];
const id = n => String(n).padStart(22, "0");
const artistPage = (n = 1) => ({
  status: "ready", total: 1, nextAfter: null,
  items: [{id: id(n), type: "artist", name: "Sample artist " + n}]
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

function fixture(artistReader = async () => artistPage(),
                 playlistReader = async offset => ({
                   status: "received", offset
                 })) {
  let now = 1000000;
  const calls = [];
  const playlists = [];
  const controller = create({
    clientId: "a".repeat(32),
    clock: () => now,
    store: {
      consume: () => ({status: "authorized"}),
      clear() {}
    },
    replaceURL() {},
    exchange: async () => ({
      accessToken: "FAKE.private-token",
      refreshToken: null,
      expiresAt: 4600000,
      scopes: [...scopes]
    }),
    artistReader: async (token, cursor, options) => {
      calls.push({token, cursor, signal: options.signal});
      return artistReader(cursor, options);
    },
    playlistReader: async (token, offset, options) => {
      playlists.push({token, offset, signal: options.signal});
      return playlistReader(offset, options);
    }
  });
  return {
    controller, calls, playlists,
    connect: () => controller.completeCallback(
      "https://linyuli303.github.io/Apps/?code=FAKE&state=FAKE"
    ),
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
  await test("Disconnected and invalid reads never reach transport", async () => {
    const f = fixture();
    assert.deepEqual(await f.controller.readArtists(),
      {status: "reauthorize"});
    await f.connect();
    for (const cursor of ["bad", "", 42, {}]) {
      assert.deepEqual(await f.controller.readArtists(cursor),
        {status: "failed"});
    }
    assert.equal(f.calls.length, 0);
  });

  await test("Only reduced immutable data leaves the controller", async () => {
    const f = fixture(async () => ({
      ...artistPage(),
      privateDetails: "PRIVATE",
      items: [{
        ...artistPage().items[0],
        images: [{url: "https://untrusted.example/image"}],
        spotifyURL: "https://untrusted.example/"
      }]
    }));
    await f.connect();
    const result = await f.controller.readArtists();
    assert.equal(result.status, "ready");
    assert.equal(f.calls[0].token, "FAKE.private-token");
    assert(f.calls[0].signal.aborted);
    assert(Object.isFrozen(result));
    assert(Object.isFrozen(result.items[0]));
    assert(!JSON.stringify(result).includes("PRIVATE"));
    assert(!JSON.stringify(result).includes("FAKE.private-token"));
    assert(!("images" in result.items[0]));
    assert.equal(result.items[0].spotifyURL,
      "https://open.spotify.com/artist/" + id(1));
    assert(!("accessToken" in f.controller));
  });

  await test("Disconnect aborts reads and rejects late success", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    await f.connect();
    const work = f.controller.readArtists();
    f.controller.disconnect();
    assert(f.calls[0].signal.aborted);
    pending.resolve(artistPage());
    assert.deepEqual(await work, {status: "cancelled"});
    assert.equal(f.controller.getStatus(), "disconnected");
  });

  await test("New artist read supersedes the previous read", async () => {
    const pending = deferred();
    let count = 0;
    const f = fixture(() => ++count === 1
      ? pending.promise : artistPage(2));
    await f.connect();
    const old = f.controller.readArtists();
    const current = await f.controller.readArtists();
    assert.equal(current.items[0].id, id(2));
    assert(f.calls[0].signal.aborted);
    pending.resolve(artistPage());
    assert.deepEqual(await old, {status: "cancelled"});
  });

  await test("Expiry during a read discards returned metadata", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    await f.connect();
    const work = f.controller.readArtists();
    f.setNow(4600000);
    pending.resolve(artistPage());
    assert.deepEqual(await work, {status: "reauthorize"});
    assert.equal(f.controller.getStatus(), "expired");
    assert(f.calls[0].signal.aborted);
  });

  await test("Restricted/rate-limited results are reduced; 401 expires session",
    async () => {
      for (const state of ["restricted", "rate_limited", "reauthorize"]) {
        const f = fixture(async () => ({
          status: state, privateDetails: "DO NOT DISPLAY"
        }));
        await f.connect();
        assert.deepEqual(await f.controller.readArtists(), {status: state});
        assert.equal(f.calls.length, 1);
        assert.equal(f.controller.getStatus(),
          state === "reauthorize" ? "expired" : "connected");
      }
    }
  );

  await test("Malformed results and late failures expose no private details",
    async () => {
      for (const value of [
        null, [], {status: "ready"},
        {...artistPage(), items: [{id: "../escape"}]},
        {...artistPage(), nextAfter: id(9)}
      ]) {
        const f = fixture(async () => value);
        await f.connect();
        assert.deepEqual(await f.controller.readArtists(), {status: "failed"});
      }

      const pending = deferred();
      const f = fixture(() => pending.promise);
      await f.connect();
      const work = f.controller.readArtists();
      f.controller.disconnect();
      pending.reject(new Error("PRIVATE PROVIDER DETAILS"));
      assert.deepEqual(await work, {status: "cancelled"});
      assert.equal(f.controller.getStatus(), "disconnected");
    }
  );

  await test("Artist and playlist reads are independent; disconnect aborts both",
    async () => {
      const artists = deferred();
      const playlists = deferred();
      const f = fixture(
        () => artists.promise,
        () => playlists.promise
      );
      await f.connect();
      const artistWork = f.controller.readArtists();
      const playlistWork = f.controller.readPlaylists();

      assert(!f.calls[0].signal.aborted);
      assert(!f.playlists[0].signal.aborted);

      f.controller.disconnect();
      assert(f.calls[0].signal.aborted);
      assert(f.playlists[0].signal.aborted);

      artists.resolve(artistPage());
      playlists.resolve({status: "received", offset: 0});
      assert.deepEqual(await artistWork, {status: "cancelled"});
      assert.deepEqual(await playlistWork, {status: "cancelled"});
    }
  );

  await test("Artist artwork is revalidated at the session boundary", async () => {
    const artworkURL = "https://i.scdn.co/image/" + "b".repeat(40);

    for (const candidate of [
      artworkURL,
      "https://untrusted.example/image",
      artworkURL + "?token=private"
    ]) {
      const f = fixture(async () => ({
        ...artistPage(),
        items:[{
          ...artistPage().items[0],
          artworkURL:candidate,
          images:[{url:artworkURL}]
        }]
      }));

      await f.connect();
      const result = await f.controller.readArtists();
      assert.equal(result.status, "ready");
      assert(!("images" in result.items[0]));

      if (candidate === artworkURL) {
        assert.equal(result.items[0].artworkURL, artworkURL);
      } else {
        // Raw image arrays cannot bypass reduced-metadata validation.
        assert(!("artworkURL" in result.items[0]));
      }

      assert(!JSON.stringify(result).includes("FAKE.private-token"));
      f.controller.disconnect();
    }
  });

  console.log(passed + " artist-session tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});