"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);

function extract(name, asyncFunction = false) {
  const pattern = new RegExp(
    "^" + (asyncFunction ? "async " : "") +
    "function " + name + "\\([\\s\\S]*?^\\}", "gm"
  );
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, "Unique function required: " + name);
  return matches[0][0];
}

const read = new Function(
  (extract("selectSpotifyArtworkURL") + "\n" + extract("validateSpotifyFollowedArtistPage")) + "\n" +
  extract("readSpotifyFollowedArtistPage", true) +
  "\nreturn readSpotifyFollowedArtistPage;"
)();

const token = "FAKE.artist-token";
const id = n => String(n).padStart(22, "0");
const failure =
  "Spotify followed artists could not be loaded or were cancelled.";

function page() {
  return {
    artists: {
      limit: 20, total: 1, cursors: {after: null},
      items: [{
        id: id(1), type: "artist", name: "Sample artist",
        images: [{url: "https://untrusted.example/image"}],
        external_urls: {spotify: "https://untrusted.example/"}
      }],
      next: "https://untrusted.example/next"
    }
  };
}

function response(url, data = page()) {
  let sent = false;
  const record = {
    url, status: 200, redirected: false, reads: 0, cancelled: false,
    headers: new Headers({"Content-Type": "application/json"}),
    bytes: new TextEncoder().encode(JSON.stringify(data))
  };
  record.body = {
    getReader() {
      return {
        async read() {
          record.reads++;
          if (sent) return {done: true};
          sent = true;
          return {done: false, value: record.bytes};
        },
        cancel() {
          record.cancelled = true;
          return Promise.resolve();
        }
      };
    }
  };
  return record;
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("Fixed endpoint and private request options", async () => {
    let calls = 0;
    const result = await read(token, null, {
      async request(url, options) {
        calls++;
        assert.equal(url,
          "https://api.spotify.com/v1/me/following?type=artist&limit=20");
        assert.equal(options.method, "GET");
        assert.equal(options.mode, "cors");
        assert.equal(options.credentials, "omit");
        assert.equal(options.cache, "no-store");
        assert.equal(options.redirect, "error");
        assert.equal(options.referrerPolicy, "no-referrer");
        assert.equal(options.headers.Authorization, "Bearer " + token);
        assert(!url.includes(token));
        return response(url);
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "ready");
    assert(Object.isFrozen(result));
    assert(Object.isFrozen(result.items));
    assert.equal(result.items[0].spotifyURL,
      "https://open.spotify.com/artist/" + id(1));
    assert(!("images" in result.items[0]));
    assert(!("next" in result));
    assert(!JSON.stringify(result).includes(token));
  });

  await test("Cursor built locally; no automatic pagination", async () => {
    let calls = 0;
    const result = await read(token, id(9), {
      async request(url) {
        calls++;
        const parsed = new URL(url);
        assert.equal(parsed.origin, "https://api.spotify.com");
        assert.equal(parsed.searchParams.get("after"), id(9));
        const data = page();
        data.artists.cursors.after = id(1);
        data.artists.total = 40;
        return response(url, data);
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.nextAfter, id(1));
  });

  await test("401/403/429 return fixed states without retries or body reads",
    async () => {
      for (const [status, expected] of [
        [401, "reauthorize"], [403, "restricted"], [429, "rate_limited"]
      ]) {
        let calls = 0;
        let record;
        const result = await read(token, null, {
          async request(url) {
            calls++;
            record = response(url);
            record.status = status;
            return record;
          }
        });
        assert.deepEqual(result, {status: expected});
        assert.equal(calls, 1);
        assert.equal(record.reads, 0);
      }
    }
  );

  await test("Invalid input rejected before transport", async () => {
    for (const [credential, cursor] of [
      ["", null], ["with space", null],
      [token, "../escape"], [token, 42], [token, ""]
    ]) {
      let calls = 0;
      await assert.rejects(() => read(credential, cursor, {
        async request(url) {
          calls++;
          return response(url);
        }
      }), {message: "Invalid Spotify followed-artist request."});
      assert.equal(calls, 0);
    }
  });

  await test("Already-aborted requests never reach transport", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(() => read(token, null, {
      signal: controller.signal,
      async request(url) {
        calls++;
        return response(url);
      }
    }), {message: failure});
    assert.equal(calls, 0);
  });

  await test("Abort during body reading discards metadata", async () => {
    const controller = new AbortController();
    let record;
    await assert.rejects(() => read(token, null, {
      signal: controller.signal,
      async request(url) {
        record = response(url);
        record.body.getReader = () => ({
          async read() {
            controller.abort();
            return {done: false, value: record.bytes};
          },
          cancel() {
            record.cancelled = true;
            return Promise.resolve();
          }
        });
        return record;
      }
    }), {message: failure});
    assert(record.cancelled);
  });

  await test("Redirects, wrong destinations and malformed responses rejected",
    async () => {
      for (const kind of [
        "redirect", "destination", "server", "type",
        "large", "utf8", "json", "metadata"
      ]) {
        let calls = 0;
        await assert.rejects(() => read(token, null, {
          async request(url) {
            calls++;
            const record = response(url);
            if (kind === "redirect") record.redirected = true;
            if (kind === "destination") record.url = "https://untrusted.example/";
            if (kind === "server") record.status = 500;
            if (kind === "type") {
              record.headers = new Headers({"Content-Type": "text/html"});
            }
            if (kind === "large") record.bytes = new Uint8Array(1000001);
            if (kind === "utf8") record.bytes = new Uint8Array([255]);
            if (kind === "json") {
              record.bytes = new TextEncoder().encode("{");
            }
            if (kind === "metadata") {
              const data = page();
              data.artists.items[0].id = "../escape";
              return response(url, data);
            }
            return record;
          }
        }), {message: failure});
        assert.equal(calls, 1);
      }
    }
  );

  await test("Raw provider failures never escape", async () => {
    let calls = 0;
    await assert.rejects(() => read(token, null, {
      async request() {
        calls++;
        throw new Error("PRIVATE PROVIDER DETAILS");
      }
    }), {message: failure});
    assert.equal(calls, 1);
  });

  console.log(passed + " followed-artist reader tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});