
"use strict";
/* MYAPPS_CURRENT_SPOTIFY_CLEANUP */
const results = [];
const root = "https://linyuli303.github.io/Apps/";
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

test("Success callback cleans code and state", () => {
  assert(spotifyCallbackCleanupURL(
    root + "?code=fake-code&state=fake-state"
  ) === root);
});

test("Denial cleans provider error fields", () => {
  assert(spotifyCallbackCleanupURL(
    root + "?error=access_denied&state=fake&error_description=text"
      + "&error_uri=https%3A%2F%2Fother.example%2F"
  ) === root);
});

test("Duplicate and encoded parameter names are cleaned", () => {
  for (const query of [
    "?code=one&code=two",
    "?%63ode=fake&%73tate=fake",
    "?state=one&state=two"
  ]) {
    assert(spotifyCallbackCleanupURL(root + query) === root);
  }
});

test("Unexpected query and fragment are not retained with a callback", () => {
  assert(spotifyCallbackCleanupURL(
    root + "?code=fake&next=https%3A%2F%2Fother.example%2F#private"
  ) === root);
});

test("Normal application URLs are left untouched", () => {
  for (const suffix of ["", "?view=phone", "#/podcasts", "?view=tv#/tube"]) {
    assert(spotifyCallbackCleanupURL(root + suffix) === null);
  }
});

test("Even incomplete callback parameters trigger cleanup", () => {
  for (const query of ["?state=", "?code=", "?error_description=text"]) {
    assert(spotifyCallbackCleanupURL(root + query) === root);
  }
});

test("Wrong origins, paths and userinfo are rejected", () => {
  for (const url of [
    "http://linyuli303.github.io/Apps/?code=fake",
    "https://other.example/Apps/?code=fake",
    "https://linyuli303.github.io/Apps/MyTube/?code=fake",
    "https://user@linyuli303.github.io/Apps/?code=fake",
    "https://linyuli303.github.io.evil.example/Apps/?code=fake"
  ]) {
    rejects(() => spotifyCallbackCleanupURL(url));
  }
});

test("Malformed and oversized inputs fail closed", () => {
  for (const value of [null, {}, "not a URL", root + "?code=" + "x".repeat(12000)]) {
    rejects(() => spotifyCallbackCleanupURL(value));
  }
});

const failed = results.filter(line => line.startsWith("FAIL:")).length;
document.getElementById("results").textContent =
  results.join("\n") + "\n\n" +
  (failed ? failed + " failed" : "8 passed; 0 failed");
