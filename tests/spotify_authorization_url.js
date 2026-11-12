
"use strict";
/* MYAPPS_CURRENT_SPOTIFY_AUTHORIZATION */
const results = [];
const client = "a".repeat(32);
const now = 1000000;
const pkce = {
  verifier:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  state:"s".repeat(43),
  challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  challengeMethod:"S256"
};
const transaction = () => createSpotifyAuthTransaction(pkce, client, now);

function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
async function rejects(run) {
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  assert(rejected);
}
async function build(value = transaction(), challenge = pkce.challenge) {
  return buildSpotifyAuthorizationURL(value, challenge, client, now);
}
async function test(name, run) {
  try { await run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

(async () => {
  await test("Fixed Spotify endpoint and exact authorization fields", async () => {
    const url = new URL(await build());
    assert(url.origin === "https://accounts.spotify.com");
    assert(url.pathname === "/authorize");
    assert(!url.hash && !url.username && !url.password);
    const expected = [
      "client_id", "response_type", "redirect_uri", "state", "scope",
      "code_challenge_method", "code_challenge"
    ].sort().join(",");
    assert([...url.searchParams.keys()].sort().join(",") === expected);
    assert(url.searchParams.get("client_id") === client);
    assert(url.searchParams.get("response_type") === "code");
    assert(url.searchParams.get("redirect_uri") ===
      "https://linyuli303.github.io/Apps/");
    assert(url.searchParams.get("state") === pkce.state);
    assert(url.searchParams.get("code_challenge_method") === "S256");
    assert(url.searchParams.get("code_challenge") === pkce.challenge);
  });

  await test("Exactly the nine approved scopes, without duplicates", async () => {
    const url = new URL(await build());
    const actual = url.searchParams.get("scope").split(" ");
    const expected = [
      "user-follow-read", "playlist-read-private",
      "playlist-read-collaborative", "user-library-read",
      "user-library-modify", "streaming",
      "user-modify-playback-state", "user-read-private", "user-read-email"
    ];
    assert(actual.length === 9 && new Set(actual).size === 9);
    assert([...actual].sort().join(",") === expected.sort().join(","));
  });

  await test("Verifier and client secret are absent from login URL", async () => {
    const raw = await build();
    const url = new URL(raw);
    assert(!raw.includes(pkce.verifier));
    for (const key of [
      "code_verifier", "client_secret", "access_token", "refresh_token"
    ]) {
      assert(!url.searchParams.has(key));
    }
  });

  await test("Wrong or malformed challenge rejected", async () => {
    for (const value of ["x".repeat(43), "", null, "short"]) {
      await rejects(() => build(transaction(), value));
    }
    await rejects(() => build({
      ...transaction(), verifier:"v".repeat(43)
    }));
  });

  await test("Expired or mismatched transaction rejected", async () => {
    await rejects(() => buildSpotifyAuthorizationURL(
      transaction(), pkce.challenge, client, now + 600000
    ));
    await rejects(() => buildSpotifyAuthorizationURL(
      transaction(), pkce.challenge, "b".repeat(32), now
    ));
    await rejects(() => build({
      ...transaction(), redirectUri:"https://other.example/"
    }));
  });

  await test("Missing or failing cryptography fails closed", async () => {
    for (const provider of [null, {}, {subtle:{}}]) {
      await rejects(() => buildSpotifyAuthorizationURL(
        transaction(), pkce.challenge, client, now, provider
      ));
    }
    await rejects(() => buildSpotifyAuthorizationURL(
      transaction(), pkce.challenge, client, now, {
        subtle: {digest() { return Promise.reject(new Error("fixture")); }}
      }
    ));
  });

  const failed = results.filter(line => line.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : "6 passed; 0 failed");
})();
