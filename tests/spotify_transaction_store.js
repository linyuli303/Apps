
"use strict";
/* MYAPPS_CURRENT_SPOTIFY_AUTH_HELPERS */
const results = [];
const client = "a".repeat(32);
const now = 1000000;
const key = "myapps-spotify-auth-v1:/Apps/";
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function rejects(run) {
  let rejected = false;
  try { run(); } catch { rejected = true; }
  assert(rejected);
}
function fixture() {
  const data = new Map([["unrelated-setting", "keep"]]);
  const storage = {
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, v); },
    removeItem(k) { data.delete(k); }
  };
  const transaction = createSpotifyAuthTransaction({
    verifier:"v".repeat(43), state:"s".repeat(43),
    challenge:"c".repeat(43), challengeMethod:"S256"
  }, client, now);
  const store = createSpotifyTransactionStore(storage);
  function callback(values = {code:"fake-code", state:transaction.state}) {
    const url = new URL(transaction.redirectUri);
    url.search = new URLSearchParams(values).toString();
    return url.href;
  }
  return {data, storage, transaction, store, callback};
}
function test(name, run) {
  try { run(fixture()); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

test("Valid callback consumes transaction exactly once", f => {
  f.store.save(f.transaction, client, now);
  const value = f.store.consume(f.callback(), client, now);
  assert(value.status === "authorized" && value.code === "fake-code");
  assert(!f.data.has(key));
  rejects(() => f.store.consume(f.callback(), client, now));
});

test("Stored record contains only transaction fields", f => {
  f.store.save(f.transaction, client, now);
  const stored = JSON.parse(f.data.get(key));
  assert(Object.keys(stored).sort().join(",") ===
    "clientId,createdAt,expiresAt,redirectUri,state,verifier,version");
  assert(!f.data.get(key).includes("fake-code"));
});

test("Mismatched state deletes the transaction", f => {
  f.store.save(f.transaction, client, now);
  rejects(() => f.store.consume(
    f.callback({code:"fake-code", state:"wrong"}), client, now
  ));
  assert(!f.data.has(key));
});

test("Expired transaction is deleted and rejected", f => {
  f.store.save(f.transaction, client, now);
  rejects(() => f.store.consume(
    f.callback(), client, f.transaction.expiresAt
  ));
  assert(!f.data.has(key));
});

test("Authorization denial consumes transaction", f => {
  f.store.save(f.transaction, client, now);
  const value = f.store.consume(
    f.callback({state:f.transaction.state, error:"access_denied"}),
    client, now
  );
  assert(value.status === "denied" && !f.data.has(key));
});

test("Malformed and oversized stored records are removed", f => {
  for (const raw of ["{", "x".repeat(2049), "null", "{}"]) {
    f.data.set(key, raw);
    rejects(() => f.store.consume(f.callback(), client, now));
    assert(!f.data.has(key));
  }
});

test("Cleanup preserves unrelated settings", f => {
  f.store.save(f.transaction, client, now);
  f.store.clear();
  assert(!f.data.has(key));
  assert(f.data.get("unrelated-setting") === "keep");
});

test("Failed writes are cleaned up", f => {
  f.storage.setItem = (k, v) => {
    f.data.set(k, v);
    throw new Error("fixture");
  };
  rejects(() => f.store.save(f.transaction, client, now));
  assert(!f.data.has(key));
  assert(f.data.get("unrelated-setting") === "keep");
});

test("Unconfirmed deletion prevents returning authorization inputs", f => {
  f.store.save(f.transaction, client, now);
  f.storage.removeItem = () => {};
  rejects(() => f.store.consume(f.callback(), client, now));
});

test("Invalid new transaction invalidates previous transaction", f => {
  f.store.save(f.transaction, client, now);
  rejects(() => f.store.save(
    {...f.transaction, extra:true}, client, now
  ));
  assert(!f.data.has(key));
});

test("Unavailable storage fails closed", f => {
  for (const value of [null, {}, {getItem() {}}]) {
    rejects(() => createSpotifyTransactionStore(value));
  }
  f.storage.getItem = () => { throw new Error("fixture"); };
  rejects(() => f.store.consume(f.callback(), client, now));
});

const failed = results.filter(line => line.startsWith("FAIL:")).length;
document.getElementById("results").textContent =
  results.join("\n") + "\n\n" +
  (failed ? failed + " failed" : "11 passed; 0 failed");
