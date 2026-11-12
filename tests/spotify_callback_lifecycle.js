
"use strict";
/* CURRENT_SPOTIFY_LIFECYCLE_HELPERS */
const results = [];
const root = "https://linyuli303.github.io/Apps/";
const scopes = [
  "user-follow-read", "playlist-read-private", "playlist-read-collaborative",
  "user-library-read", "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function fixture(options = {}) {
  let now = 1000000;
  let saved = true;
  const calls = [];
  const tokens = {
    accessToken:"FAKE.access-token",
    refreshToken:"FAKE.refresh-token",
    expiresAt:now + 3600000,
    scopes:[...scopes]
  };
  const store = {
    consume() {
      calls.push("consume");
      if (!saved) throw new Error("Already consumed");
      saved = false;
      return options.denied
        ? {status:"denied"}
        : {status:"authorized", code:"FAKE-code"};
    },
    clear() {
      calls.push("clear");
      if (options.cleanupFails) throw new Error("Cleanup failed");
      saved = false;
    }
  };
  const controller = createSpotifyCallbackController({
    clientId:"a".repeat(32),
    store,
    clock:() => now,
    replaceURL(url) {
      calls.push("clean");
      assert(url === root);
      if (options.historyFails) throw new Error("History unavailable");
    },
    exchange:async (authorization, context) => {
      calls.push("exchange");
      if (options.exchange) return options.exchange(context, tokens);
      return tokens;
    }
  });
  return {
    controller, calls, tokens,
    callback:root + "?code=FAKE-code&state=FAKE-state",
    setNow(value) { now = value; }
  };
}
async function test(name, run) {
  try { await run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

(async () => {
  await test("URL cleanup precedes consumption and exchange", async () => {
    const f = fixture();
    assert(await f.controller.completeCallback(f.callback) === "connected");
    assert(f.calls.join(",") === "clean,consume,exchange");
    assert(f.controller.getStatus() === "connected");
    assert(Object.keys(f.controller).sort().join(",") ===
      "completeCallback,disconnect,getStatus");
  });

  await test("Normal app URL does not consume or exchange", async () => {
    const f = fixture();
    assert(await f.controller.completeCallback(root) === "not_callback");
    assert(f.calls.length === 0);
  });

  await test("Failed history cleanup prevents token exchange", async () => {
    const f = fixture({historyFails:true});
    assert(await f.controller.completeCallback(f.callback) === "failed");
    assert(f.calls.join(",") === "clean,clear");
  });

  await test("Denial consumes transaction without exchange", async () => {
    const f = fixture({denied:true});
    assert(await f.controller.completeCallback(f.callback) === "denied");
    assert(f.calls.join(",") === "clean,consume");
  });

  await test("Replayed callback cannot exchange twice", async () => {
    const f = fixture();
    await f.controller.completeCallback(f.callback);
    assert(await f.controller.completeCallback(f.callback) === "failed");
    assert(f.calls.filter(x => x === "exchange").length === 1);
    assert(f.controller.getStatus() !== "connected");
  });

  await test("Disconnect aborts exchange and discards late success", async () => {
    let finish;
    let signal;
    const f = fixture({
      exchange(context, tokens) {
        signal = context.signal;
        return new Promise(resolve => { finish = () => resolve(tokens); });
      }
    });
    const pending = f.controller.completeCallback(f.callback);
    assert(f.controller.getStatus() === "connecting");
    assert(f.controller.disconnect() === "disconnected");
    assert(signal.aborted);
    finish();
    assert(await pending === "cancelled");
    assert(f.controller.getStatus() === "disconnected");
  });

  await test("Late failure cannot overwrite disconnected status", async () => {
    let fail;
    const f = fixture({
      exchange() {
        return new Promise((resolve, reject) => {
          fail = () => reject(new Error("PRIVATE FIXTURE DETAILS"));
        });
      }
    });
    const pending = f.controller.completeCallback(f.callback);
    f.controller.disconnect();
    fail();
    assert(await pending === "cancelled");
    assert(f.controller.getStatus() === "disconnected");
  });

  await test("Cleanup failure still prevents late reconnection", async () => {
    let finish;
    const f = fixture({
      cleanupFails:true,
      exchange(context, tokens) {
        return new Promise(resolve => { finish = () => resolve(tokens); });
      }
    });
    const pending = f.controller.completeCallback(f.callback);
    assert(f.controller.disconnect() === "cleanup_failed");
    finish();
    assert(await pending === "cancelled");
    assert(f.controller.getStatus() === "cleanup_failed");
  });

  await test("Expired session is cleared when status is checked", async () => {
    const f = fixture();
    await f.controller.completeCallback(f.callback);
    f.setNow(f.tokens.expiresAt);
    assert(f.controller.getStatus() === "expired");
  });

  await test("Malformed returned credentials fail closed", async () => {
    for (const changes of [
      {accessToken:"with space"},
      {scopes:["streaming"]},
      {expiresAt:1000000},
      {expiresAt:Infinity}
    ]) {
      const f = fixture({
        exchange(context, tokens) {
          return {...tokens, ...changes};
        }
      });
      assert(await f.controller.completeCallback(f.callback) === "failed");
      assert(f.controller.getStatus() !== "connected");
    }
  });

  const failed = results.filter(line => line.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : "10 passed; 0 failed");
})();
