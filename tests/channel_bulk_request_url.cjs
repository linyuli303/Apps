"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function buildMyTubeBulkRequest\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

function compile(code) {
  return new Function(
    code + "\nreturn buildMyTubeBulkRequest;"
  )();
}
const build = compile(matches[0][0]);
const id = n => "UC" + String(n).padStart(22, "0");
const input = [id(1), id(2)];
const result = build(input);
const url = new URL(result.url);

assert.equal(url.origin, "https://github.com");
assert.equal(url.pathname, "/linyuli303/Apps/issues/new");
assert.equal(url.searchParams.get("template"), "channel-bulk-add.yml");
assert.equal(url.searchParams.get("title"), "[MyTube] Channel change");
assert.equal(url.searchParams.get("operation"), "Add multiple");
assert.equal(url.searchParams.get("channel_ids"), input.join("\n"));
assert(!url.searchParams.has("confirmation"));
assert.equal(result.channelText, input.join("\n"));
assert.equal(result.count, 2);
assert.equal(result.requiresPaste, false);
assert(Object.isFrozen(result));

input[0] = id(99);
assert(result.channelText.startsWith(id(1)));

const maximum = build(Array.from({length:50}, (_,i)=>id(i)));
assert.equal(maximum.count, 50);
assert.equal(maximum.requiresPaste, false);
assert(new URL(maximum.url).searchParams.has("channel_ids"));

for (const invalid of [
  null, [], id(1), [id(1), id(1)], ["@handle"],
  ["https://www.youtube.com/channel/" + id(1)],
  [id(1) + "\n"], Array.from({length:51}, (_,i)=>id(i))
]) {
  assert.throws(() => build(invalid));
}

// Force only the URL threshold in this test copy to exercise the fallback.
assert(matches[0][0].includes("url.href.length > 6500"));
const fallbackBuilder = compile(
  matches[0][0].replace("url.href.length > 6500", "url.href.length > 1")
);
const fallback = fallbackBuilder([id(1)]);
const fallbackURL = new URL(fallback.url);
assert(fallback.requiresPaste);
assert(!fallbackURL.searchParams.has("channel_ids"));
assert.equal(fallbackURL.searchParams.get("template"), "channel-bulk-add.yml");
assert.equal(fallback.channelText, id(1));

assert(!/\bfetch\s*\(|window\.open|localStorage|sessionStorage/.test(
  matches[0][0]
));
console.log("PASS: fixed GitHub destination, bounded IDs, exact form fields, manual confirmation, immutable output and copy fallback.");