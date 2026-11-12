
"use strict";
/* MYAPPS_CURRENT_SPOTIFY_TOKEN_VALIDATOR */
const results = [];
const now = 1000000;
const scopes = [
  "user-follow-read", "playlist-read-private",
  "playlist-read-collaborative", "user-library-read",
  "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];
function fresh() {
  return {
    access_token:"FAKE.access-token",
    refresh_token:"FAKE.refresh-token",
    token_type:"Bearer",
    expires_in:3600,
    scope:scopes.join(" ")
  };
}
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

test("Valid response returns bounded memory-only credential record", () => {
  const value = validateSpotifyTokenResponse(fresh(), now);
  assert(value.accessToken === "FAKE.access-token");
  assert(value.refreshToken === "FAKE.refresh-token");
  assert(value.expiresAt === now + 3600000);
  assert(Object.isFrozen(value) && Object.isFrozen(value.scopes));
});

test("Scope order is irrelevant; returned scopes are detached", () => {
  const input = fresh();
  input.scope = [...scopes].reverse().join(" ");
  const value = validateSpotifyTokenResponse(input, now);
  input.access_token = "changed";
  assert(value.accessToken === "FAKE.access-token");
  assert(value.scopes.join(" ") === [...scopes].sort().join(" "));
});

test("Missing, extra and duplicate scopes rejected", () => {
  for (const scope of [
    scopes.slice(1).join(" "),
    scopes.join(" ") + " playlist-modify-public",
    [...scopes.slice(1), scopes[1]].join(" "),
    scopes.join("  "),
    ""
  ]) {
    rejects(() => validateSpotifyTokenResponse({...fresh(), scope}, now));
  }
});

test("Malformed access and refresh tokens rejected", () => {
  for (const token of ["", null, 123, "with space", "x\n", "x".repeat(8193)]) {
    rejects(() => validateSpotifyTokenResponse(
      {...fresh(), access_token:token}, now
    ));
    rejects(() => validateSpotifyTokenResponse(
      {...fresh(), refresh_token:token}, now
    ));
  }
});

test("Optional refresh token and Bearer case handled", () => {
  const input = fresh();
  delete input.refresh_token;
  input.token_type = "bearer";
  assert(validateSpotifyTokenResponse(input, now).refreshToken === null);
  rejects(() => validateSpotifyTokenResponse(
    {...fresh(), token_type:"Basic"}, now
  ));
});

test("Invalid expiry and clock values rejected", () => {
  for (const expires_in of [0, -1, 86401, 1.5, "3600", NaN]) {
    rejects(() => validateSpotifyTokenResponse(
      {...fresh(), expires_in}, now
    ));
  }
  for (const clock of [-1, NaN, Infinity, "1000000", Number.MAX_SAFE_INTEGER]) {
    rejects(() => validateSpotifyTokenResponse(fresh(), clock));
  }
  validateSpotifyTokenResponse({...fresh(), expires_in:1}, now);
  validateSpotifyTokenResponse({...fresh(), expires_in:86400}, now);
});

test("Unrelated fields discarded and invalid containers rejected", () => {
  const value = validateSpotifyTokenResponse(
    {...fresh(), email:"fake@example.invalid", unexpected:"discard"}, now
  );
  assert(Object.keys(value).sort().join(",") ===
    "accessToken,expiresAt,refreshToken,scopes");
  for (const input of [null, [], "invalid", {}]) {
    rejects(() => validateSpotifyTokenResponse(input, now));
  }
});

const failed = results.filter(line => line.startsWith("FAIL:")).length;
document.getElementById("results").textContent =
  results.join("\n") + "\n\n" +
  (failed ? failed + " failed" : "7 passed; 0 failed");
