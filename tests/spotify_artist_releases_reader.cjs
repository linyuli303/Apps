"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
function extract(name, prefix = "") {
  const matches = [...source.matchAll(new RegExp(
    "^" + prefix + "function " + name + "\\([\\s\\S]*?^\\}", "gm"
  ))];
  assert.equal(matches.length, 1, "Unique helper required: " + name);
  return matches[0][0];
}
const read = new Function(
  (extract("selectSpotifyArtworkURL") + "\n" + extract("validateSpotifyArtistReleasePage")) + "\n" +
  extract("readSpotifyArtistReleasePage", "async ") +
  "\nreturn readSpotifyArtistReleasePage;"
)();

const token = "FAKE.release-token";
const artistId = "A".repeat(22);
const releaseId = "B".repeat(22);
const failure =
  "Spotify artist releases could not be loaded or were cancelled.";

function page(offset = 0) {
  return {
    limit: 20, offset, total: offset + 1,
    next: "https://untrusted.example/next",
    items: [{
      id: releaseId, type: "album", name: "Sample release",
      album_type: "album", album_group: "album",
      release_date: "2024", release_date_precision: "year",
      artists: [{id: artistId}],
      images: [{url: "https://untrusted.example/image"}]
    }]
  };
}
function response(url, data = page()) {
  let sent = false;
  const record = {
    url, status: 200, redirected: false, reads: 0, cancelled: false,
    headers: new Headers({"Content-Type": "application/json"}),
    bytes: new TextEncoder().encode(JSON.stringify(data))
  };
  record.body = {getReader() {
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
  }};
  return record;
}
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("Fixed artist endpoint, filters and private request options", async () => {
    let calls = 0;
    const result = await read(token, artistId, 0, {
      async request(url, options) {
        calls++;
        const parsed = new URL(url);
        assert.equal(parsed.origin, "https://api.spotify.com");
        assert.equal(parsed.pathname, "/v1/artists/" + artistId + "/albums");
        assert.deepEqual([...parsed.searchParams.keys()].sort(),
          ["include_groups", "limit", "offset"]);
        assert.equal(parsed.searchParams.get("include_groups"), "album,single");
        assert.equal(parsed.searchParams.get("limit"), "20");
        assert.equal(parsed.searchParams.get("offset"), "0");
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
    assert.equal(result.artistId, artistId);
    assert(Object.isFrozen(result.items[0]));
    assert.equal(result.items[0].releaseDatePrecision, "year");
    assert(!("images" in result.items[0]));
    assert(!("next" in result));
    assert(!JSON.stringify(result).includes(token));
  });

  await test("Offset built locally; no automatic pagination", async () => {
    let calls = 0;
    const result = await read(token, artistId, 20, {
      async request(url) {
        calls++;
        assert.equal(new URL(url).searchParams.get("offset"), "20");
        return response(url, page(20));
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.offset, 20);
  });

  await test("401/403/429 return fixed states without reading error bodies", async () => {
    for (const [code, state] of [
      [401, "reauthorize"], [403, "restricted"], [429, "rate_limited"]
    ]) {
      let calls = 0, record;
      const result = await read(token, artistId, 0, {
        async request(url) {
          calls++;
          record = response(url);
          record.status = code;
          return record;
        }
      });
      assert.deepEqual(result, {status: state});
      assert.equal(calls, 1);
      assert.equal(record.reads, 0);
    }
  });

  await test("Invalid credentials, artist IDs and offsets never reach transport", async () => {
    for (const [credential, artist, offset] of [
      ["", artistId, 0], ["with space", artistId, 0],
      [token, "../escape", 0], [token, null, 0],
      [token, artistId, -1], [token, artistId, 1],
      [token, artistId, 10020], [token, artistId, "0"]
    ]) {
      let calls = 0;
      await assert.rejects(() => read(credential, artist, offset, {
        async request(url) { calls++; return response(url); }
      }), {message: "Invalid Spotify artist-release request."});
      assert.equal(calls, 0);
    }
  });

  await test("Pre-aborted and mid-response cancellation discard results", async () => {
    const before = new AbortController();
    before.abort();
    let calls = 0;
    await assert.rejects(() => read(token, artistId, 0, {
      signal: before.signal,
      async request(url) { calls++; return response(url); }
    }), {message: failure});
    assert.equal(calls, 0);

    const during = new AbortController();
    let record;
    await assert.rejects(() => read(token, artistId, 0, {
      signal: during.signal,
      async request(url) {
        record = response(url);
        record.body.getReader = () => ({
          async read() {
            during.abort();
            return {done: false, value: record.bytes};
          },
          cancel() { record.cancelled = true; return Promise.resolve(); }
        });
        return record;
      }
    }), {message: failure});
    assert(record.cancelled);
  });

  await test("Redirects, wrong destinations and malformed responses rejected", async () => {
    for (const kind of [
      "redirect", "destination", "server", "type",
      "large", "utf8", "json", "metadata", "offset"
    ]) {
      let calls = 0;
      await assert.rejects(() => read(token, artistId, 0, {
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
          if (kind === "json") record.bytes = new TextEncoder().encode("{");
          if (kind === "offset") return response(url, page(20));
          if (kind === "metadata") {
            const data = page();
            data.items[0].id = "../escape";
            return response(url, data);
          }
          return record;
        }
      }), {message: failure});
      assert.equal(calls, 1);
    }
  });

  await test("Raw network errors hidden; no automatic retry", async () => {
    let calls = 0;
    await assert.rejects(() => read(token, artistId, 0, {
      async request() {
        calls++;
        throw new Error("PRIVATE PROVIDER DETAILS");
      }
    }), {message: failure});
    assert.equal(calls, 1);
  });

  console.log(passed + " artist-release reader tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});