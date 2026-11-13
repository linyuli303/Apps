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
  assert.equal(matches.length, 1, name);
  return matches[0][0];
}
const read = new Function([
  extract("validateSpotifyTrackMetadata"),
  extract("validateSpotifyAlbumTrackPage"),
  extract("readSpotifyAlbumTrackPage", "async "),
  "return readSpotifyAlbumTrackPage;"
].join("\n"))();

const token = "FAKE.album-token";
const album = "A".repeat(22);
const failure = "Spotify album tracks could not be loaded or were cancelled.";

function page(offset = 0) {
  return {
    offset, limit:20, total:offset + 1,
    next:"https://untrusted.example/",
    items:[{
      id:"B".repeat(22), type:"track", name:"Sample song",
      artists:[{id:"C".repeat(22), name:"Sample artist"}],
      duration_ms:180000
    }]
  };
}
function response(url, data = page()) {
  let sent = false;
  const record = {
    url, status:200, redirected:false, reads:0, cancelled:false,
    headers:new Headers({"Content-Type":"application/json"}),
    bytes:new TextEncoder().encode(JSON.stringify(data))
  };
  record.body = {getReader() {
    return {
      async read() {
        record.reads++;
        if (sent) return {done:true};
        sent = true;
        return {done:false, value:record.bytes};
      },
      cancel() {
        record.cancelled = true;
        return Promise.resolve();
      }
    };
  }};
  return record;
}

(async () => {
  let calls = 0;
  const result = await read(token, album, 20, {
    async request(url, options) {
      calls++;
      assert.equal(url,
        "https://api.spotify.com/v1/albums/" + album +
        "/tracks?limit=20&offset=20");
      assert.equal(options.method, "GET");
      assert.equal(options.mode, "cors");
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.equal(options.headers.Authorization, "Bearer " + token);
      assert(!url.includes(token));
      return response(url, page(20));
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.albumId, album);
  assert.equal(result.items[0].position, 21);
  assert.equal(result.items[0].track.durationMs, 180000);
  assert(Object.isFrozen(result.items[0].track));
  assert(!("next" in result));
  assert(!JSON.stringify(result).includes(token));
  console.log("PASS: fixed endpoint, request privacy and reduced song data");

  for (const [code, state] of [
    [401,"reauthorize"], [403,"restricted"], [429,"rate_limited"]
  ]) {
    let record, count = 0;
    const output = await read(token, album, 0, {
      async request(url) {
        count++;
        record = response(url);
        record.status = code;
        return record;
      }
    });
    assert.deepEqual(output, {status:state});
    assert.equal(count, 1);
    assert.equal(record.reads, 0);
  }
  console.log("PASS: fixed authorization/access/rate-limit states without retries");

  for (const [credential, albumId, offset] of [
    ["",album,0], ["with space",album,0], [token,"../escape",0],
    [token,album,1], [token,album,-1], [token,album,10020]
  ]) {
    let count = 0;
    await assert.rejects(() => read(credential, albumId, offset, {
      async request(url) { count++; return response(url); }
    }), {message:"Invalid Spotify album-track request."});
    assert.equal(count, 0);
  }

  const before = new AbortController();
  before.abort();
  let count = 0;
  await assert.rejects(() => read(token, album, 0, {
    signal:before.signal,
    async request(url) { count++; return response(url); }
  }), {message:failure});
  assert.equal(count, 0);

  const during = new AbortController();
  let abortedRecord;
  await assert.rejects(() => read(token, album, 0, {
    signal:during.signal,
    async request(url) {
      abortedRecord = response(url);
      abortedRecord.body.getReader = () => ({
        async read() {
          during.abort();
          return {done:false, value:abortedRecord.bytes};
        },
        cancel() {
          abortedRecord.cancelled = true;
          return Promise.resolve();
        }
      });
      return abortedRecord;
    }
  }), {message:failure});
  assert(abortedRecord.cancelled);
  console.log("PASS: invalid inputs and cancellation prevent metadata delivery");

  for (const kind of [
    "redirect","destination","server","type","large","utf8","json","offset","track"
  ]) {
    let count = 0;
    await assert.rejects(() => read(token, album, 0, {
      async request(url) {
        count++;
        const record = response(url);
        if (kind === "redirect") record.redirected = true;
        if (kind === "destination") record.url = "https://untrusted.example/";
        if (kind === "server") record.status = 500;
        if (kind === "type") {
          record.headers = new Headers({"Content-Type":"text/html"});
        }
        if (kind === "large") record.bytes = new Uint8Array(1000001);
        if (kind === "utf8") record.bytes = new Uint8Array([255]);
        if (kind === "json") record.bytes = new TextEncoder().encode("{");
        if (kind === "offset") return response(url, page(20));
        if (kind === "track") {
          const invalid = page();
          invalid.items[0].id = "../escape";
          return response(url, invalid);
        }
        return record;
      }
    }), {message:failure});
    assert.equal(count, 1);
  }
  await assert.rejects(() => read(token, album, 0, {
    async request() { throw new Error("PRIVATE PROVIDER DETAILS"); }
  }), {message:failure});
  console.log("PASS: response boundaries and malformed metadata fail closed");
  console.log("Album-track reader checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});