
"use strict";
/* CURRENT_SPOTIFY_SCREEN_INITIALIZER */
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function fixture(options = {}) {
  const calls = [];
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {
      disabled:false, hidden:false, textContent:"",
      listeners:{},
      addEventListener(name, callback) { this.listeners[name] = callback; }
    });
    return nodes.get(id);
  };
  const pending = deferred();
  const location = {
    origin:options.preview ? "http://127.0.0.1:8773"
      : "https://linyuli303.github.io",
    pathname:options.preview ? "/" : "/Apps/",
    assign() { calls.push("navigate"); }
  };
  const history = {
    replaceState() { calls.push("history"); }
  };
  const documentListeners = {};
  const document = {
    hidden:false,
    addEventListener(name, callback) {
      documentListeners[name] = callback;
    }
  };
  const window = {
    location, history,
    confirm() { calls.push("confirm"); return options.consent !== false; },
    dispatchEvent() { calls.push("route"); }
  };
  let callbackStatus = "disconnected";
  const connector = {
    cancel() { calls.push("cancel-connect"); return "cancelled"; },
    connect() {
      calls.push("connect");
      return options.pendingConnect ? pending.promise
        : Promise.resolve("redirecting");
    }
  };
  const callbackController = {
    disconnect() {
      calls.push("cancel-callback");
      callbackStatus = "disconnected";
      return "disconnected";
    },
    completeCallback() {
      calls.push("complete");
      callbackStatus = "connecting";
      return pending.promise;
    },
    getStatus() { return callbackStatus; }
  };

  const run = new Function(
    "$", "MYAPPS_SPOTIFY_CONFIG", "location", "history", "document", "window",
    "SPOTIFY_STARTUP_CALLBACK", "openSpotifyLoginStore",
    "createSpotifyCallbackController", "createSpotifyConnectController",
    "createSpotifyPlaylistView",
    initializer
  );
  run(
    $, {clientId:"a".repeat(32),
        redirectUri:"https://linyuli303.github.io/Apps/"},
    location, history, document, window,
    {take() { return options.callback ? "FAKE-CALLBACK" : null; }},
    () => { calls.push("storage"); return {}; },
    () => callbackController,
    () => connector,
    receivedController => {
      assert(receivedController === callbackController);
      calls.push("playlist-create");
      return {
        load() {
          calls.push("playlist-load");
          return Promise.resolve();
        },
        clear() { calls.push("playlist-clear"); }
      };
    }
  );
  return {
    calls, $, pending,
    expire() {
      callbackStatus = "expired";
      documentListeners.visibilitychange();
    },
    click(id) { return $(id).listeners.click(); }
  };
}

const results = [];
async function test(name, run) {
  try { await run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}
(async () => {
  await test("Disconnected startup never opens storage or connects", () => {
    const f = fixture();
    assert(!f.$("spotify-connect").hidden);
    assert(!f.$("spotify-connect-warning").hidden);
    assert(f.calls.length === 0);
    assert(!f.$("spotify-connect").disabled);
    assert(f.$("spotify-disconnect").hidden);
  });

  await test("Local preview disables real connection without storage access", () => {
    const f = fixture({preview:true});
    assert(f.$("spotify-connect").disabled);
    assert(f.calls.length === 0);
  });

  await test("Declining confirmation does not open storage", async () => {
    const f = fixture({consent:false});
    await f.click("spotify-connect");
    assert(f.calls.join(",") === "confirm");
  });

  await test("Connect initializes lazily and cancels both old controllers", async () => {
    const f = fixture();
    await f.click("spotify-connect");
    assert(f.calls.join(",") ===
      "confirm,storage,cancel-connect,cancel-callback,connect");
    assert(f.$("spotify-status").textContent ===
      "Opening Spotify authorization...");
  });

  await test("Disconnect blocks late Connect screen update", async () => {
    const f = fixture({pendingConnect:true});
    const completion = f.click("spotify-connect");
    f.click("spotify-disconnect");
    f.pending.resolve("redirecting");
    await completion;
    assert(f.$("spotify-status").textContent === "Spotify is disconnected.");
    assert(f.calls.filter(x => x === "cancel-connect").length === 2);
    assert(f.calls.filter(x => x === "cancel-callback").length === 2);
  });

  await test("Captured callback routes cleanly; Disconnect blocks late success", async () => {
    const f = fixture({callback:true});
    assert(f.calls.join(",") === "storage,complete,history,route");
    assert(f.$("spotify-status").textContent ===
      "Completing Spotify authorization...");
    f.click("spotify-disconnect");
    f.pending.resolve("connected");
    await Promise.resolve();
    await Promise.resolve();
    assert(f.$("spotify-status").textContent === "Spotify is disconnected.");
  });

  await test("Successful callback creates playlist view; Disconnect clears it", async () => {
    const f = fixture({callback:true});
    f.pending.resolve("connected");
    await Promise.resolve();
    await Promise.resolve();

    assert(f.calls.filter(x => x === "playlist-create").length === 1);
    assert(f.calls.filter(x => x === "playlist-load").length === 1);
    assert(f.$("spotify-connect").disabled);
    assert(f.$("spotify-connect").hidden);
    assert(f.$("spotify-connect-warning").hidden);
    assert(!f.$("spotify-disconnect").hidden);

    f.click("spotify-disconnect");
    assert(!f.$("spotify-connect").hidden);
    assert(!f.$("spotify-connect-warning").hidden);
    assert(f.$("spotify-disconnect").hidden);
    assert(f.calls.filter(x => x === "playlist-clear").length === 1);
    assert(f.calls.includes("cancel-connect"));
    assert(f.calls.includes("cancel-callback"));
    assert(f.$("spotify-status").textContent === "Spotify is disconnected.");
    assert(!f.$("spotify-connect").disabled);
  });

  await test("Visibility expiry clears displayed playlist view", async () => {
    const f = fixture({callback:true});
    f.pending.resolve("connected");
    await Promise.resolve();
    await Promise.resolve();

    f.expire();
    assert(!f.$("spotify-connect").hidden);
    assert(!f.$("spotify-connect-warning").hidden);
    assert(f.$("spotify-disconnect").hidden);
    assert(f.calls.filter(x => x === "playlist-clear").length === 1);
    assert(f.$("spotify-status").textContent ===
      "Spotify authorization expired. Connect again.");
    assert(!f.$("spotify-connect").disabled);
  });

  const failures = results.filter(line => line.startsWith("FAIL:")).length;
  globalThis.document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failures ? failures + " failed" : "8 passed; 0 failed");
})();
