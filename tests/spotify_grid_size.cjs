"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const marker = "(function initializeSpotifyGridSize()";
assert.equal(source.split(marker).length - 1, 1);
const start = source.indexOf(marker);
const end = source.indexOf("\n})();", start);
assert(end > start);
const initializer = source.slice(start, end + "\n})();".length);

function fixture({missingPage = false, existing = false} = {}) {
  const nodes = new Map();
  const values = new Map();
  let inserted = 0;
  function element(tag, className, text) {
    return {
      tag, className, textContent: text, attrs: {}, events: {}, children: [],
      append(...items) {
        this.children.push(...items);
        for (const item of items) {
          if (item.id) nodes.set(item.id, item);
        }
      },
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(name, callback) { this.events[name] = callback; }
    };
  }
  const page = {
    style: {setProperty(key, value) { values.set(key, value); }}
  };
  if (!missingPage) nodes.set("spotify-page", page);
  if (existing) nodes.set("spotify-grid-size", {});
  nodes.set("spotify-status", {after() { inserted++; }});

  const run = () => new Function("$", "element", initializer)(
    id => nodes.get(id), element
  );
  run();
  return {nodes, values, run, inserted: () => inserted};
}

const f = fixture();
const slider = f.nodes.get("spotify-grid-size");
const output = f.nodes.get("spotify-grid-size-value");

assert.equal(slider.value, "70");
assert.equal(slider.min, "50");
assert.equal(slider.max, "100");
assert.equal(slider.step, "5");
assert.equal(f.values.get("--spotify-cover-size"), "140px");
assert.equal(output.textContent, "70%");
assert.equal(slider.attrs["aria-valuetext"], "70 percent");

for (const percent of [50, 85, 100]) {
  slider.value = String(percent);
  slider.events.input();
  assert.equal(f.values.get("--spotify-cover-size"), percent * 2 + "px");
  assert.equal(output.textContent, percent + "%");
  assert.equal(slider.attrs["aria-valuetext"], percent + " percent");
}

for (const invalid of ["49", "101", "73", "bad", "Infinity", ""]) {
  slider.value = invalid;
  slider.events.input();
  assert.equal(f.values.get("--spotify-cover-size"), "200px");
  assert.equal(output.textContent, "100%");
}

f.run();
assert.equal(f.inserted(), 1);
assert.equal(fixture({existing: true}).inserted(), 0);
assert.equal(fixture({missingPage: true}).inserted(), 0);

assert(!/localStorage|sessionStorage|\bfetch\s*\(/.test(initializer));
console.log("PASS: 70% default, valid resizing, invalid-value rejection, accessible output, duplicate/missing-page guards, no storage or requests.");