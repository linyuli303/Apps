
"use strict";
/* CURRENT_SPOTIFY_EXCHANGE_HELPERS */
const results = [];
const endpoint = "https://accounts.spotify.com/api/token";
const failure = "Spotify connection failed or was cancelled. Connect again.";
const authorization = {
  status:"authorized", code:"FAKE-code", verifier:"v".repeat(43),
  clientId:"a".repeat(32),
  redirectUri:"https://linyuli303.github.io/Apps/"
};
const scopes = [
  "user-follow-read", "playlist-read-private", "playlist-read-collaborative",
  "user-library-read", "user-library-modify", "streaming",
  "user-modify-playback-state", "user-read-private", "user-read-email"
];
function tokenResponse() {
  return {
    access_token:"FAKE.access-token", refresh_token:"FAKE.refresh-token",
    token_type:"Bearer", expires_in:3600, scope:scopes.join(" ")
  };
}
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
async function rejects(run, expected = failure) {
  try { await run(); }
  catch (error) {
    assert(error.message === expected);
    return;
  }
  throw new Error("Expected rejection");
}
function response(bytes = new TextEncoder().encode(JSON.stringify(tokenResponse()))) {
  let sent = false;
  const record = {
    cancelled:false,
    status:200, redirected:false, url:endpoint,
    headers:new Headers({"Content-Type":"application/json; charset=utf-8"})
  };
  record.body = {
    getReader() {
      return {
        async read() {
          if (sent) return {done:true};
          sent = true;
          return {done:false, value:bytes};
        },
        cancel() { record.cancelled = true; return Promise.resolve(); }
      };
    }
  };
  return record;
}
async function test(name, run) {
  try { await run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

(async () => {
  await test("Fixed endpoint, PKCE body and cookie-free request options", async () => {
    let calls = 0;
    const tokens = await exchangeSpotifyAuthorization(authorization, {
      async request(url, options) {
        calls++;
        assert(url === endpoint);
        assert(options.method === "POST" && options.mode === "cors");
        assert(options.credentials === "omit");
        assert(options.cache === "no-store" && options.redirect === "error");
        assert(options.referrerPolicy === "no-referrer");
        assert(!("Authorization" in options.headers));
        const body = new URLSearchParams(options.body);
        assert([...body.keys()].sort().join(",") ===
          "client_id,code,code_verifier,grant_type,redirect_uri");
        assert(body.get("code_verifier") === authorization.verifier);
        assert(body.get("code") === authorization.code);
        assert(body.get("grant_type") === "authorization_code");
        assert(body.get("client_id") === authorization.clientId);
        assert(body.get("redirect_uri") === authorization.redirectUri);
        assert(!body.has("client_secret"));
        return response();
      }
    });
    assert(calls === 1 && tokens.accessToken === "FAKE.access-token");
    assert(Object.isFrozen(tokens));
  });

  await test("Already-cancelled exchange makes no request", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await rejects(() => exchangeSpotifyAuthorization(authorization, {
      signal:controller.signal,
      async request() { calls++; return response(); }
    }));
    assert(calls === 0);
  });

  await test("Cancellation during response reading discards tokens", async () => {
    const controller = new AbortController();
    const record = response();
    record.body.getReader = () => ({
      async read() {
        controller.abort();
        return {done:false, value:new TextEncoder().encode("{}")};
      },
      cancel() { record.cancelled = true; return Promise.resolve(); }
    });
    await rejects(() => exchangeSpotifyAuthorization(authorization, {
      signal:controller.signal,
      async request() { return record; }
    }));
    assert(record.cancelled);
  });

  await test("Network failure is fixed-message and never retried", async () => {
    let calls = 0;
    await rejects(() => exchangeSpotifyAuthorization(authorization, {
      async request() {
        calls++;
        throw new Error("PRIVATE PROVIDER DETAILS");
      }
    }));
    assert(calls === 1);
  });

  await test("Bad status, redirects and wrong response origins rejected", async () => {
    for (const changes of [
      {status:400}, {status:429}, {status:500}, {redirected:true},
      {url:"https://other.example/api/token"}
    ]) {
      let calls = 0;
      await rejects(() => exchangeSpotifyAuthorization(authorization, {
        async request() {
          calls++;
          return Object.assign(response(), changes);
        }
      }));
      assert(calls === 1);
    }
  });

  await test("Non-JSON, malformed UTF-8 and oversized bodies rejected", async () => {
    const wrongType = response();
    wrongType.headers = new Headers({"Content-Type":"text/html"});
    for (const record of [
      wrongType,
      response(new Uint8Array([255])),
      response(new TextEncoder().encode("{")),
      response(new Uint8Array(32769))
    ]) {
      await rejects(() => exchangeSpotifyAuthorization(authorization, {
        async request() { return record; }
      }));
    }
  });

  await test("Missing granted permissions rejected without leaking response", async () => {
    const value = tokenResponse();
    value.scope = "streaming";
    await rejects(() => exchangeSpotifyAuthorization(authorization, {
      async request() {
        return response(new TextEncoder().encode(JSON.stringify(value)));
      }
    }));
  });

  await test("Invalid authorization inputs rejected before request", async () => {
    for (const value of [
      null, {...authorization, extra:true},
      {...authorization, status:"denied"},
      {...authorization, redirectUri:"https://other.example/"},
      {...authorization, verifier:"short"},
      {...authorization, code:"with space"}
    ]) {
      let calls = 0;
      await rejects(() => exchangeSpotifyAuthorization(value, {
        async request() { calls++; return response(); }
      }), "Invalid Spotify exchange inputs.");
      assert(calls === 0);
    }
  });

  await test("Actual timeout aborts a waiting request without retry", async () => {
    let calls = 0;
    let aborted = false;
    const started = performance.now();

    await rejects(() => exchangeSpotifyAuthorization(authorization, {
      request(url, options) {
        calls++;
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("Fake request cancelled"));
          }, {once:true});
        });
      }
    }));

    assert(calls === 1 && aborted);
    // Allow scheduling delays, but ensure this was not immediate cancellation.
    assert(performance.now() - started >= 14000);
  });

  const failed = results.filter(line => line.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : "9 passed; 0 failed");
})();
