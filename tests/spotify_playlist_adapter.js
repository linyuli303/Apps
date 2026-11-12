
"use strict";
/* CURRENT_SPOTIFY_PLAYLIST_ADAPTER */
const results = [];
const token = "FAKE.playlist-token";
const failure = "Spotify playlists could not be loaded or were cancelled.";
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
function response(url, data = {
  items:[], offset:0, limit:20, total:0
}) {
  let sent = false;
  const record = {
    status:200, redirected:false, url,
    reads:0, cancelled:false,
    bytes:new TextEncoder().encode(JSON.stringify(data)),
    headers:new Headers({"Content-Type":"application/json"})
  };
  record.body = {
    getReader() {
      return {
        async read() {
          record.reads++;
          if (sent) return {done:true};
          sent = true;
          return {done:false, value:record.bytes};
        },
        cancel() { record.cancelled=true; return Promise.resolve(); }
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
  await test("Fixed endpoint and explicit credential boundaries", async () => {
    let calls = 0;
    const result = await readSpotifyPlaylistPage(token, 0, {
      async request(url, options) {
        calls++;
        assert(url ===
          "https://api.spotify.com/v1/me/playlists?limit=20&offset=0");
        assert(options.method === "GET" && options.mode === "cors");
        assert(options.credentials === "omit");
        assert(options.redirect === "error" && options.cache === "no-store");
        assert(options.referrerPolicy === "no-referrer");
        assert(options.headers.Authorization === "Bearer " + token);
        assert(!url.includes(token));
        return response(url);
      }
    });
    assert(calls === 1 && result.status === "received");
    assert(Object.isFrozen(result));
  });

  await test("Pagination constructed locally; returned next URL ignored", async () => {
    let calls = 0;
    const result = await readSpotifyPlaylistPage(token, 20, {
      async request(url) {
        calls++;
        assert(new URL(url).searchParams.get("offset") === "20");
        return response(url, {
          items:[], offset:20, limit:20, total:40,
          next:"https://untrusted.example/steal"
        });
      }
    });
    assert(calls === 1 && result.offset === 20);
    assert(!("next" in result) && !("href" in result));
  });

  await test("401, 403 and 429 yield fixed states without body reads or retries", async () => {
    for (const [code, expected] of [
      [401,"reauthorize"], [403,"restricted"], [429,"rate_limited"]
    ]) {
      let calls = 0;
      let record;
      const result = await readSpotifyPlaylistPage(token, 0, {
        async request(url) {
          calls++;
          record = response(url);
          record.status = code;
          return record;
        }
      });
      assert(result.status === expected);
      assert(Object.keys(result).join(",") === "status");
      assert(calls === 1 && record.reads === 0);
    }
  });

  await test("Wrong response destination, redirects and server errors rejected", async () => {
    for (const changes of [
      {url:"https://untrusted.example/"},
      {redirected:true}, {status:500}
    ]) {
      let calls = 0;
      await rejects(() => readSpotifyPlaylistPage(token, 0, {
        async request(url) {
          calls++;
          return Object.assign(response(url), changes);
        }
      }));
      assert(calls === 1);
    }
  });

  await test("Already-cancelled request never reaches transport", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await rejects(() => readSpotifyPlaylistPage(token, 0, {
      signal:controller.signal,
      async request(url) { calls++; return response(url); }
    }));
    assert(calls === 0);
  });

  await test("Cancellation during body reading discards data", async () => {
    const controller = new AbortController();
    let cancelled = false;
    await rejects(() => readSpotifyPlaylistPage(token, 0, {
      signal:controller.signal,
      async request(url) {
        const record = response(url);
        record.body.getReader = () => ({
          async read() {
            controller.abort();
            return {done:false, value:new TextEncoder().encode("{}")};
          },
          cancel() { cancelled=true; return Promise.resolve(); }
        });
        return record;
      }
    }));
    assert(cancelled);
  });

  await test("Oversized, malformed and invalid page responses rejected", async () => {
    for (const kind of ["large","utf8","json","offset","items","type"]) {
      await rejects(() => readSpotifyPlaylistPage(token, 0, {
        async request(url) {
          const record = response(url);
          if (kind === "large") record.bytes = new Uint8Array(1000001);
          if (kind === "utf8") record.bytes = new Uint8Array([255]);
          if (kind === "json") record.bytes = new TextEncoder().encode("{");
          if (kind === "offset") return response(url, {
            items:[], offset:20, limit:20, total:20
          });
          if (kind === "items") return response(url, {
            items:Array(21).fill({}), offset:0, limit:20, total:21
          });
          if (kind === "type") {
            record.headers = new Headers({"Content-Type":"text/html"});
          }
          return record;
        }
      }));
    }
  });

  await test("Invalid inputs fail before request; raw network errors are hidden", async () => {
    for (const [credential, offset] of [
      ["",0], ["with space",0], [token,-1],
      [token,1], [token,10020], [token,"20"]
    ]) {
      let calls = 0;
      await rejects(() => readSpotifyPlaylistPage(credential, offset, {
        async request(url) { calls++; return response(url); }
      }), "Invalid Spotify playlist request.");
      assert(calls === 0);
    }
    let calls = 0;
    await rejects(() => readSpotifyPlaylistPage(token, 0, {
      async request() {
        calls++;
        throw new Error("PRIVATE PROVIDER DETAILS");
      }
    }));
    assert(calls === 1);
  });

  const failed = results.filter(line => line.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : "8 passed; 0 failed");
})();
