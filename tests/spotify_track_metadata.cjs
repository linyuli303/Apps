"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function validateSpotifyTrackMetadata\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);
const validate = new Function(
  matches[0][0] + "\nreturn validateSpotifyTrackMetadata;"
)();
const id = n => String(n).padStart(22, "0");
const track = changes => ({
  id:id(1), type:"track", name:" Sample Song ",
  artists:[{id:id(2), name:" Sample Artist "}],
  duration_ms:222000,
  ...changes
});

const input = track({
  external_urls:{spotify:"https://untrusted.example/"},
  preview_url:"https://untrusted.example/audio",
  album:{images:[{url:"https://untrusted.example/image"}]},
  privateDetails:"PRIVATE"
});
const result = validate(input);
assert.equal(result.name, "Sample Song");
assert.equal(result.durationMs, 222000);
assert.equal(result.availability, "unknown");
assert.equal(result.spotifyURL,
  "https://open.spotify.com/track/" + id(1));
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.artists));
assert(Object.isFrozen(result.artists[0]));
input.artists[0].name = "Changed";
assert.equal(result.artists[0].name, "Sample Artist");
assert.equal(Object.keys(result).sort().join(","),
  "artists,availability,durationMs,id,name,spotifyURL,type");
assert(!JSON.stringify(result).includes("PRIVATE"));
assert(!JSON.stringify(result).includes("untrusted.example"));

assert.equal(validate(track({duration_ms:null})).durationMs, null);
assert.equal(validate(track({duration_ms:undefined})).durationMs, null);
assert.equal(validate(track({is_playable:false})).availability, "unavailable");
assert.equal(validate(track({is_playable:true})).availability, "available");
assert.equal(validate(null), null);
assert.equal(validate({type:"episode"}), null);
assert.equal(validate({type:"track", is_local:true}), null);

for (const changes of [
  {id:"../escape"}, {type:"album"}, {name:""},
  {name:"bad\nname"}, {name:"x".repeat(301)},
  {artists:[]}, {artists:[{id:id(2), name:null}]},
  {artists:[{id:"bad", name:"Artist"}]},
  {duration_ms:-1}, {duration_ms:1.5}, {duration_ms:"222000"},
  {duration_ms:Infinity}, {duration_ms:86400001},
  {is_playable:"true"}, {is_local:"false"}
]) {
  assert.throws(() => validate(track(changes)));
}
for (const value of [undefined, [], "track"]) {
  assert.throws(() => validate(value));
}
assert.equal(validate(track({name:"落日大道"})).name, "落日大道");
assert.equal(validate(track({name:"<b>Song</b>"})).name, "<b>Song</b>");
console.log("PASS: reduced immutable track data, duration/availability handling, unsupported-item fallback, hostile metadata rejection, fixed links and plain-text labels.");