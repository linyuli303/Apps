"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function buildMyTubeResolutionRequest\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);
const build = new Function(
  matches[0][0] + "\nreturn buildMyTubeResolutionRequest;"
)();

const cid = "UC" + "a".repeat(22);
const inputs = [
  "@Example", cid, "https://www.youtube.com/@Other", "@Example"
];
const result = build("\n" + inputs.join("\r\n") + "\n");
const url = new URL(result.url);

assert.equal(url.origin, "https://github.com");
assert.equal(url.pathname, "/linyuli303/Apps/issues/new");
assert.equal(url.searchParams.get("template"), "channel-resolve.yml");
assert.equal(url.searchParams.get("title"), "[MyTube] Resolve channels");
assert.equal(url.searchParams.get("channels"), inputs.join("\n"));
assert(!url.searchParams.has("confirmation"));
assert.equal(result.count, 4);
assert.equal(result.channelText, inputs.join("\n"));
assert(Object.isFrozen(result));

for (const invalid of [
  "", null, "Display Name", "@ab", "@" + "a".repeat(31),
  "@例子频道", "@bad/extra",
  "https://youtube.com/@Example?token=private",
  "https://user@youtube.com/@Example",
  "https://youtube.com:443/@Example",
  "https://youtube.com.evil.example/@Example",
  "@Example\u007f",
  "@Example\r",
  "x".repeat(16001),
  Array(51).fill("@Example").join("\n")
]) {
  assert.throws(() => build(invalid));
}

assert.equal(build(Array(50).fill("@Example").join("\n")).count, 50);
assert.equal(build(" \t@Example\t ").channelText, "@Example");

// Exercise the oversized-URL fallback without weakening production limits.
const fallbackBuild = new Function(
  matches[0][0].replace("url.href.length > 6500", "url.href.length > 1") +
  "\nreturn buildMyTubeResolutionRequest;"
)();
const fallback = fallbackBuild("@Example");
assert(fallback.requiresPaste);
assert.equal(fallback.channelText, "@Example");
assert(!new URL(fallback.url).searchParams.has("channels"));

assert(!/\bfetch\s*\(|window\.open|localStorage|sessionStorage/.test(
  matches[0][0]
));
console.log("PASS: bounded handle inputs, fixed lookup-only form, manual confirmation, duplicate preservation and copy fallback.");