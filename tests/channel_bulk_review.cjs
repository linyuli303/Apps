"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function reviewMyTubeChannelBatch\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);
const review = new Function(
  matches[0][0] + "\nreturn reviewMyTubeChannelBatch;"
)();
const id = n => "UC" + String(n).padStart(22, "0");

const mixed = review([
  id(2),
  "https://www.youtube.com/channel/" + id(3),
  id(2),
  id(1),
  "@invalid"
].join("\n"), [id(1)]);

assert.deepEqual(mixed.rows.map(row => row.status),
  ["new", "new", "duplicate", "existing", "invalid"]);
assert.deepEqual(mixed.additions, [id(2), id(3)]);
assert.equal(mixed.invalidCount, 1);
assert.equal(mixed.canSubmit, false);
assert(Object.isFrozen(mixed));
assert(Object.isFrozen(mixed.rows));
assert(Object.isFrozen(mixed.rows[0]));
assert(Object.isFrozen(mixed.additions));

for (const host of [
  "youtube.com", "www.youtube.com",
  "m.youtube.com", "music.youtube.com"
]) {
  const result = review("https://" + host + "/channel/" + id(2) + "/", []);
  assert.equal(result.canSubmit, true);
  assert.deepEqual(result.additions, [id(2)]);
}

for (const invalid of [
  "http://youtube.com/channel/" + id(2),
  "https://user@youtube.com/channel/" + id(2),
  "https://youtube.com:443/channel/" + id(2),
  "https://youtube.com.evil.example/channel/" + id(2),
  "https://youtube.com/channel/" + id(2) + "?token=private",
  "https://youtube.com/channel/" + id(2) + "#fragment",
  "https://youtube.com/@handle",
  "https://youtube.com/watch?v=example",
  id(2) + ", " + id(3)
]) {
  const result = review(invalid, []);
  assert.equal(result.canSubmit, false);
  assert.equal(result.rows[0].status, "invalid");
}

assert.equal(review(id(1), [id(1)]).canSubmit, false);
assert.equal(review("\n " + id(2) + "\r\n\n", []).rows[0].line, 2);
assert.equal(review(Array.from({length:50}, (_,i)=>id(i)).join("\n"), [])
  .additions.length, 50);

for (const text of ["", " \n ", "x".repeat(16001),
  Array.from({length:51}, (_,i)=>id(i)).join("\n")]) {
  assert.throws(() => review(text, []));
}
assert.throws(() => review(id(2), ["bad"]));

const full = Array.from({length:1000}, (_,i)=>id(i));
const capacity = review(id(1001), full);
assert(capacity.capacityExceeded);
assert(!capacity.canSubmit);

assert(!/\bfetch\s*\(|localStorage|sessionStorage/.test(matches[0][0]));
console.log("PASS: bounded batch review, HTTPS normalization, explicit statuses, invalid-line blocking, capacity and immutable results; no requests or storage.");