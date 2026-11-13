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
  extract("validateSpotifyPlaylistItemPage"),
  extract("readSpotifyPlaylistItemPage", "async "),
  "return readSpotifyPlaylistItemPage;"
].join("\n"))();

const playlistId = "A".repeat(22);
const token = "FAKE.playlist-token";
const failure = "Spotify playlist items could not be loaded or were cancelled.";

function page(offset = 0) {
  return {
    offset, limit:20, total:offset + 1,
    next:"https://untrusted.example/",
    items:[{
      item:{
        id:"B".repeat(22), type:"track", name:"Sample song",
        artists:[{id:"C".repeat(22), name:"Artist"}],
        duration_ms:180000
      },
      added_by:{id:"PRIVATE"}
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
  const result = await read(token, playlistId, 20, {
    async request(url, options) {
      calls++;
      assert.equal(url,
        "https://api.spotify.com/v1/playlists/" + playlistId +
        "/items?limit=20&offset=20");
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
  assert.equal(result.playlistId, playlistId);
  assert.equal(result.items[0].position, 21);
  assert.equal(result.items[0].track.durationMs, 180000);
  assert(Object.isFrozen(result.items[0].track));
  assert(!("next" in result));
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert(!JSON.stringify(result).includes(token));
  console.log("PASS: fixed playlist endpoint, private request options and reduced songs");

  for (const [code, state] of [
    [401,"reauthorize"], [403,"restricted"], [429,"rate_limited"]
  ]) {
    let record, count = 0;
    const output = await read(token, playlistId, 0, {
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
  console.log("PASS: denied access and rate limits stop without retries or error-body reads");

  for (const [credential, playlist, offset] of [
    ["",playlistId,0], ["with space",playlistId,0],
    [token,"../escape",0], [token,playlistId,1],
    [token,playlistId,-1], [token,playlistId,10020]
  ]) {
    let count = 0;
    await assert.rejects(() => read(credential, playlist, offset, {
      async request(url) { count++; return response(url); }
    }), {message:"Invalid Spotify playlist-item request."});
    assert.equal(count, 0);
  }

  const before = new AbortController();
  before.abort();
  let count = 0;
  await assert.rejects(() => read(token, playlistId, 0, {
    signal:before.signal,
    async request(url) { count++; return response(url); }
  }), {message:failure});
  assert.equal(count, 0);

  const during = new AbortController();
  let aborted;
  await assert.rejects(() => read(token, playlistId, 0, {
    signal:during.signal,
    async request(url) {
      aborted = response(url);
      aborted.body.getReader = () => ({
        async read() {
          during.abort();
          return {done:false, value:aborted.bytes};
        },
        cancel() {
          aborted.cancelled = true;
          return Promise.resolve();
        }
      });
      return aborted;
    }
  }), {message:failure});
  assert(aborted.cancelled);
  console.log("PASS: invalid inputs and cancellation prevent song delivery");

  for (const kind of [
    "redirect","destination","server","type","large",
    "utf8","json","offset","wrapper","track"
  ]) {
    let count = 0;
    await assert.rejects(() => read(token, playlistId, 0, {
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
        if (kind === "wrapper" || kind === "track") {
          const data = page();
          if (kind === "wrapper") {
            data.items[0] = {track:data.items[0].item};
          } else {
            data.items[0].item.id = "../escape";
          }
          return response(url, data);
        }
        return record;
      }
    }), {message:failure});
    assert.equal(count, 1);
  }

  await assert.rejects(() => read(token, playlistId, 0, {
    async request() { throw new Error("PRIVATE PROVIDER DETAILS"); }
  }), {message:failure});

  console.log("PASS: response boundaries, malformed wrappers and raw error suppression");
  console.log("Playlist-item reader checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});