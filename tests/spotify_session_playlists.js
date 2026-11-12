
"use strict";
/* CURRENT_SPOTIFY_SESSION_PLAYLIST_HELPERS */
const results = [];
const scopes = [
  "user-follow-read", "playlist-read-private", "playlist-read-collaborative",
  "user-library-read", "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function page(offset = 0) {
  return {
    status:"received", offset, total:1,
    items:[{
      id:"a".repeat(22), name:"Sample playlist",
      owner:{id:"sample-owner", display_name:"Sample owner"}
    }]
  };
}
function fixture(reader) {
  let now = 1000000;
  const calls = [];
  const controller = createSpotifyCallbackController({
    clientId:"a".repeat(32),
    clock:() => now,
    store:{
      consume() { return {status:"authorized"}; },
      clear() {}
    },
    replaceURL() {},
    exchange:async () => ({
      accessToken:"FAKE.private-token",
      refreshToken:null,
      expiresAt:4600000,
      scopes:[...scopes]
    }),
    playlistReader:async (token, offset, options) => {
      calls.push({token, offset, signal:options.signal});
      return reader ? reader(offset, options) : page(offset);
    }
  });
  return {
    controller, calls,
    connect:() => controller.completeCallback(
      "https://linyuli303.github.io/Apps/?code=FAKE&state=FAKE"
    ),
    setNow(value) { now = value; }
  };
}
async function test(name, run) {
  try { await run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

(async () => {
  await test("Disconnected and invalid requests never reach transport", async () => {
    const f = fixture();
    assert((await f.controller.readPlaylists()).status === "reauthorize");
    await f.connect();
    assert((await f.controller.readPlaylists(1)).status === "failed");
    assert(f.calls.length === 0);
  });

  await test("Token stays inside transport; renderer receives reduced data", async () => {
    const f = fixture();
    await f.connect();
    const result = await f.controller.readPlaylists();
    assert(f.calls[0].token === "FAKE.private-token");
    assert(result.status === "ready");
    assert(result.items[0].name === "Sample playlist");
    assert(!JSON.stringify(result).includes("FAKE.private-token"));
    assert(!("accessToken" in f.controller));
    assert(f.calls[0].signal.aborted);
  });

  await test("Disconnect aborts read and discards late response", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    await f.connect();
    const result = f.controller.readPlaylists();
    f.controller.disconnect();
    assert(f.calls[0].signal.aborted);
    pending.resolve(page());
    assert((await result).status === "cancelled");
    assert(f.controller.getStatus() === "disconnected");
  });

  await test("Newer page request supersedes older response", async () => {
    const old = deferred();
    const f = fixture(offset => offset === 0 ? old.promise : page(offset));
    await f.connect();
    const first = f.controller.readPlaylists(0);
    const second = await f.controller.readPlaylists(20);
    assert(second.status === "ready" && second.offset === 20);
    assert(f.calls[0].signal.aborted);
    old.resolve(page());
    assert((await first).status === "cancelled");
  });

  await test("Expiry during request discards returned playlist data", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    await f.connect();
    const result = f.controller.readPlaylists();
    f.setNow(4600000);
    pending.resolve(page());
    assert((await result).status === "reauthorize");
    assert(f.controller.getStatus() === "expired");
    assert(f.calls[0].signal.aborted);
  });

  await test("Restricted/rate-limited reads remain fixed states; 401 expires session", async () => {
    for (const state of ["restricted", "rate_limited", "reauthorize"]) {
      const f = fixture(() => ({status:state, privateBody:"discard"}));
      await f.connect();
      const result = await f.controller.readPlaylists();
      assert(result.status === state);
      assert(Object.keys(result).join(",") === "status");
      assert(f.calls.length === 1);
      if (state === "reauthorize") {
        assert(f.controller.getStatus() === "expired");
      }
    }
  });

  await test("Wrong page and malformed item produce no display data", async () => {
    for (const value of [
      page(20),
      {...page(), items:[{id:"invalid"}]}
    ]) {
      const f = fixture(() => value);
      await f.connect();
      const result = await f.controller.readPlaylists();
      assert(result.status === "failed");
      assert(!("items" in result));
    }
  });

  const failed = results.filter(line => line.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : "7 passed; 0 failed");
})();
