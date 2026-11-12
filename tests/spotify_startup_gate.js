
"use strict";
/* CURRENT_SPOTIFY_STARTUP_HELPERS */
const results = [];
const root = "https://linyuli303.github.io/Apps/";
const callback = root + "?code=FAKE-code&state=FAKE-state";

function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function test(name, run) {
  try { run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

test("Cleanup completes before callback becomes available", () => {
  let url = callback;
  const calls = [];
  const gate = captureSpotifyStartupCallback({
    readURL() { calls.push("read"); return url; },
    replaceURL(clean) { calls.push("clean"); url = clean; }
  });
  assert(calls.join(",") === "read,clean,read");
  assert(url === root && gate.status === "callback");
  assert(gate.take() === callback);
  assert(Object.isFrozen(gate));
});

test("Callback can be taken only once", () => {
  let url = callback;
  const gate = captureSpotifyStartupCallback({
    readURL:() => url,
    replaceURL(clean) { url = clean; }
  });
  assert(gate.take() === callback);
  assert(gate.take() === null);
  assert(gate.take() === null);
});

test("Discard prevents later callback release", () => {
  let url = callback;
  const gate = captureSpotifyStartupCallback({
    readURL:() => url,
    replaceURL(clean) { url = clean; }
  });
  gate.discard();
  assert(gate.take() === null);
});

test("Ordinary root URLs do not change history", () => {
  for (const suffix of ["", "?view=phone", "#/podcasts"]) {
    let writes = 0;
    const gate = captureSpotifyStartupCallback({
      readURL:() => root + suffix,
      replaceURL() { writes++; }
    });
    assert(gate.status === "not_callback");
    assert(writes === 0 && gate.take() === null);
  }
});

test("Throwing or ineffective history cleanup releases nothing", () => {
  for (const replaceURL of [
    () => { throw new Error("fixture"); },
    () => {}
  ]) {
    const gate = captureSpotifyStartupCallback({
      readURL:() => callback, replaceURL
    });
    assert(gate.status === "failed" && gate.take() === null);
  }
});

test("Asynchronous cleanup is rejected even if URL changes", () => {
  let url = callback;
  const gate = captureSpotifyStartupCallback({
    readURL:() => url,
    replaceURL(clean) {
      url = clean;
      return Promise.resolve();
    }
  });
  assert(gate.status === "failed" && gate.take() === null);
});

test("Read failures and wrong destinations fail closed", () => {
  for (const readURL of [
    () => { throw new Error("fixture"); },
    () => "https://other.example/?code=FAKE",
    () => null
  ]) {
    let writes = 0;
    const gate = captureSpotifyStartupCallback({
      readURL,
      replaceURL() { writes++; }
    });
    assert(gate.status === "failed" && gate.take() === null);
    assert(writes === 0);
  }
});

test("Malformed callback is cleaned but not represented as authorized", () => {
  const original = root + "?code=one&code=two&state=wrong#unexpected";
  let url = original;
  const gate = captureSpotifyStartupCallback({
    readURL:() => url,
    replaceURL(clean) { url = clean; }
  });
  assert(url === root);
  assert(gate.status === "callback");
  assert(gate.take() === original);
  assert(Object.keys(gate).sort().join(",") === "discard,status,take");
  // The separate callback validator must reject this original URL.
});

test("Ordinary section and preview URLs bypass callback handling", () => {
  for (const url of [
    root + "MyTube/",
    root + "MyPodcasts/?view=phone",
    "http://127.0.0.1:8773/MyPodcasts/",
    "file:///C:/Temp/MyApps_preview.html"
  ]) {
    let writes = 0;
    const gate = captureSpotifyStartupCallback({
      readURL:() => url,
      replaceURL() { writes++; }
    });
    assert(gate.status === "not_callback");
    assert(gate.take() === null && writes === 0);
  }
});

const failed = results.filter(line => line.startsWith("FAIL:")).length;
document.getElementById("results").textContent =
  results.join("\n") + "\n\n" +
  (failed ? failed + " failed" : "9 passed; 0 failed");
