
"use strict";
/* CURRENT_SPOTIFY_CONNECT_HELPERS */
const results = [];
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve=yes; reject=no; });
  return {promise, resolve, reject};
}
function fixture(options = {}) {
  let now = 1000000;
  let saved = null;
  const calls = [];
  const clientId = "a".repeat(32);
  const pkce = {
    verifier:"v".repeat(43), state:"s".repeat(43),
    challenge:"c".repeat(43), challengeMethod:"S256"
  };
  function destination(transaction) {
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id:clientId, redirect_uri:transaction.redirectUri,
      state:transaction.state, response_type:"code",
      code_challenge:pkce.challenge, code_challenge_method:"S256"
    });
    return url.href;
  }
  const controller = createSpotifyConnectController({
    clientId,
    clock:() => now,
    store:{
      clear() {
        calls.push("clear");
        if (options.clearFails) throw new Error("fixture");
        saved = null;
      },
      save(transaction) {
        calls.push("save");
        saved = transaction;
        if (options.saveFails) throw new Error("fixture");
      }
    },
    generatePKCE:options.generatePKCE || (async () => pkce),
    buildURL:options.buildURL || (async transaction => destination(transaction)),
    navigate(url) {
      calls.push("navigate");
      assert(new URL(url).origin === "https://accounts.spotify.com");
      if (options.navigateFails) throw new Error("fixture");
    }
  });
  return {
    controller, calls, pkce, destination,
    saved:() => saved,
    setNow(value) { now=value; }
  };
}
async function test(name, run) {
  try { await run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

(async () => {
  await test("Transaction saved before navigation", async () => {
    const f = fixture();
    assert(await f.controller.connect() === "redirecting");
    assert(f.calls.join(",") === "clear,save,navigate");
    assert(f.saved().redirectUri === "https://linyuli303.github.io/Apps/");
  });

  await test("Cancel during PKCE generation prevents save and redirect", async () => {
    const pending = deferred();
    const f = fixture({generatePKCE:() => pending.promise});
    const result = f.controller.connect();
    f.controller.cancel();
    pending.resolve(f.pkce);
    assert(await result === "cancelled");
    assert(!f.calls.includes("save") && !f.calls.includes("navigate"));
    assert(f.controller.getStatus() === "cancelled");
  });

  await test("Cancel during URL construction prevents navigation", async () => {
    const building = deferred();
    const entered = deferred();
    const f = fixture({
      buildURL(transaction) {
        entered.resolve(transaction);
        return building.promise;
      }
    });
    const result = f.controller.connect();
    const transaction = await entered.promise;
    f.controller.cancel();
    building.resolve(f.destination(transaction));
    assert(await result === "cancelled");
    assert(!f.calls.includes("save") && !f.calls.includes("navigate"));
  });

  await test("Older Connect cannot overwrite newer successful attempt", async () => {
    const old = deferred();
    let count = 0;
    const f = fixture({
      generatePKCE() {
        count++;
        return count === 1 ? old.promise : Promise.resolve({
          verifier:"w".repeat(43), state:"t".repeat(43),
          challenge:"d".repeat(43), challengeMethod:"S256"
        });
      }
    });
    const first = f.controller.connect();
    assert(await f.controller.connect() === "redirecting");
    old.resolve(f.pkce);
    assert(await first === "cancelled");
    assert(f.saved().state === "t".repeat(43));
    assert(f.calls.filter(x => x === "navigate").length === 1);
    assert(f.controller.getStatus() === "redirecting");
  });

  await test("Expired transaction after async work never navigates", async () => {
    let f;
    f = fixture({
      async buildURL(transaction) {
        f.setNow(transaction.expiresAt);
        return f.destination(transaction);
      }
    });
    assert(await f.controller.connect() === "failed");
    assert(!f.calls.includes("save") && !f.calls.includes("navigate"));
  });

  await test("Storage and navigation failures clear saved material", async () => {
    for (const options of [{saveFails:true}, {navigateFails:true}]) {
      const f = fixture(options);
      assert(await f.controller.connect() === "failed");
      assert(f.saved() === null);
      if (options.saveFails) assert(!f.calls.includes("navigate"));
    }
  });

  await test("Wrong navigation destination fails before save", async () => {
    for (const destination of [
      "https://other.example/authorize",
      "https://accounts.spotify.com/other",
      "https://accounts.spotify.com/authorize?client_id=wrong"
    ]) {
      const f = fixture({buildURL:async () => destination});
      assert(await f.controller.connect() === "failed");
      assert(!f.calls.includes("save") && !f.calls.includes("navigate"));
    }
  });

  await test("Failed initial cleanup prevents generation", async () => {
    let generated = false;
    const f = fixture({
      clearFails:true,
      async generatePKCE() { generated=true; throw new Error("fixture"); }
    });
    assert(await f.controller.connect() === "cleanup_failed");
    assert(!generated && !f.calls.includes("navigate"));
  });

  const failed = results.filter(line => line.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : "8 passed; 0 failed");
})();
