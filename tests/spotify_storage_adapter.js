
"use strict";
/* CURRENT_SPOTIFY_STORAGE_ADAPTER_HELPERS */
const results = [];
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function rejects(run) {
  let rejected = false;
  try { run(); } catch { rejected = true; }
  assert(rejected);
}
function test(name, run) {
  try { run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}
function browser(url, storage) {
  const parsed = new URL(url);
  let reads = 0;
  return {
    location:{origin:parsed.origin, pathname:parsed.pathname},
    get sessionStorage() { reads++; return storage; },
    reads:() => reads
  };
}
function fakeStorage() {
  const data = new Map([["unrelated", "keep"]]);
  const writes = [];
  return {
    data, writes,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { writes.push(key); data.set(key, value); },
    removeItem(key) { data.delete(key); }
  };
}

test("Public identity and callback are fixed and immutable", () => {
  assert(Object.isFrozen(MYAPPS_SPOTIFY_CONFIG));
  assert(MYAPPS_SPOTIFY_CONFIG.clientId ===
    "f900eeb7bfba4a1fa35d0e37ec84c4ec");
  assert(MYAPPS_SPOTIFY_CONFIG.redirectUri ===
    "https://linyuli303.github.io/Apps/");
});

test("Approved origin opens adapter without writing data", () => {
  const storage = fakeStorage();
  const view = browser("https://linyuli303.github.io/Apps/", storage);
  const store = openSpotifyLoginStore(view);
  assert(view.reads() === 1);
  assert(Object.isFrozen(store));
  assert(storage.writes.length === 0);
  assert(storage.data.size === 1);
});

test("Existing app section can prepare login", () => {
  const storage = fakeStorage();
  const view = browser(
    "https://linyuli303.github.io/Apps/MyPodcasts/", storage
  );
  openSpotifyLoginStore(view);
  assert(view.reads() === 1 && storage.writes.length === 0);
});

test("Wrong origins and outside paths never access storage", () => {
  for (const url of [
    "http://linyuli303.github.io/Apps/",
    "https://other.example/Apps/",
    "http://127.0.0.1:8773/Apps/",
    "https://linyuli303.github.io/OtherProject/",
    "https://linyuli303.github.io/Apps-evil/",
    "https://linyuli303.github.io/Apps"
  ]) {
    const view = browser(url, fakeStorage());
    rejects(() => openSpotifyLoginStore(view));
    assert(view.reads() === 0);
  }
});

test("Unavailable or blocked storage fails closed", () => {
  const location = {
    origin:"https://linyuli303.github.io", pathname:"/Apps/"
  };
  for (const storage of [null, {}, {getItem() {}}]) {
    rejects(() => openSpotifyLoginStore({location, sessionStorage:storage}));
  }
  rejects(() => openSpotifyLoginStore({
    location,
    get sessionStorage() { throw new Error("Private fixture detail"); }
  }));
});

test("Save and consume affect only the temporary transaction key", () => {
  const storage = fakeStorage();
  const view = browser("https://linyuli303.github.io/Apps/", storage);
  const store = openSpotifyLoginStore(view);
  const now = 1000000;
  const client = MYAPPS_SPOTIFY_CONFIG.clientId;
  const transaction = createSpotifyAuthTransaction({
    verifier:"v".repeat(43), state:"s".repeat(43),
    challenge:"c".repeat(43), challengeMethod:"S256"
  }, client, now);
  store.save(transaction, client, now);
  assert(storage.writes.join(",") === "myapps-spotify-auth-v1:/Apps/");

  const callback = new URL(MYAPPS_SPOTIFY_CONFIG.redirectUri);
  callback.search = new URLSearchParams({
    code:"FAKE-code", state:transaction.state
  });
  assert(store.consume(callback.href, client, now).status === "authorized");
  assert(storage.data.size === 1);
  assert(storage.data.get("unrelated") === "keep");
  rejects(() => store.consume(callback.href, client, now));
});

const failed = results.filter(line => line.startsWith("FAIL:")).length;
document.getElementById("results").textContent =
  results.join("\n") + "\n\n" +
  (failed ? failed + " failed" : "6 passed; 0 failed");
