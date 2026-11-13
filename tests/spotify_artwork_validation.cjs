"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function selectSpotifyArtworkURL\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

const select = new Function(
  matches[0][0] + "\nreturn selectSpotifyArtworkURL;"
)();

const url = digit =>
  "https://i.scdn.co/image/" + digit.repeat(40);
const image = (digit, width) => ({
  url:url(digit), width, height:width
});

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log("PASS: " + name);
}

test("Selects the smallest known image at least 140px wide", () => {
  const input = [image("a", 640), image("b", 64), image("c", 300)];
  assert.equal(select(input), url("c"));
  assert.equal(input[0].width, 640);
  assert.equal(select([image("a", 140), image("b", 300)]), url("a"));
});

test("Falls back to the largest smaller image or unknown dimensions", () => {
  assert.equal(select([image("a", 32), image("b", 64)]), url("b"));
  assert.equal(select([{url:url("a"), width:null, height:null}]), url("a"));
  assert.equal(select([{url:url("b")}]), url("b"));
  assert.equal(select([
    {url:url("a")}, image("b", 64)
  ]), url("b"));
});

test("Rejects foreign origins, credentials and nonplain image URLs", () => {
  for (const value of [
    "http://i.scdn.co/image/" + "a".repeat(40),
    "https://untrusted.example/image/" + "a".repeat(40),
    "https://i.scdn.co.evil.example/image/" + "a".repeat(40),
    "https://user@i.scdn.co/image/" + "a".repeat(40),
    "https://i.scdn.co:443/image/" + "a".repeat(40),
    url("a") + "?token=private",
    url("a") + "#fragment",
    url("a") + "/extra",
    "https://i.scdn.co/image/../escape",
    "https://i.scdn.co/image/%61".repeat(10),
    "https://i.scdn.co/image/" + "g".repeat(40),
    "data:image/svg+xml,<svg/>",
    "javascript:alert(1)",
    " " + url("a"),
    url("a") + "\n"
  ]) {
    assert.equal(select([{url:value}]), null, value);
  }
});

test("Rejects malformed or oversized inputs without throwing", () => {
  for (const value of [null, undefined, {}, "images", []]) {
    assert.equal(select(value), null);
  }
  assert.equal(select(Array(21).fill(image("a", 300))), null);
  assert.equal(select([
    null, [], {}, {url:42}, {url:"x".repeat(2049)}
  ]), null);

  for (const dimension of [0, -1, 1.5, "300", Infinity, 10001]) {
    assert.equal(select([{
      url:url("a"), width:dimension, height:300
    }]), null);
    assert.equal(select([{
      url:url("a"), width:300, height:dimension
    }]), null);
  }
});

test("Invalid candidates do not prevent a valid fallback", () => {
  assert.equal(select([
    {url:"https://untrusted.example/image"},
    {url:url("a"), width:-1},
    image("b", 300)
  ]), url("b"));
  assert.equal(select([{
    url:"https://i.scdn.co/image/" + "A".repeat(40)
  }]), "https://i.scdn.co/image/" + "A".repeat(40));
});

assert(!/\bfetch\s*\(|localStorage|sessionStorage|createElement/.test(
  matches[0][0]
));
console.log(passed + " artwork validation tests passed.");