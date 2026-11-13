"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const marker = "(function initializeSpotifyGridPlacement()";
assert.equal(source.split(marker).length - 1, 1);
const start = source.indexOf(marker);
const end = source.indexOf("\n})();", start);
assert(end > start);
const initializer = source.slice(start, end + "\n})();".length);

class Node {
  constructor() { this.children = []; this.parentElement = null; }
  append(node) {
    if (node.parentElement) {
      node.parentElement.children =
        node.parentElement.children.filter(child => child !== node);
    }
    this.children.push(node);
    node.parentElement = this;
  }
}

const page = new Node();
const controls = new Node();
controls.value = "70";
controls.listener = () => {};
const originalListener = controls.listener;
page.append(controls);

let navigation = null, notify, moves = 0;
for (const node of [page]) {
  const append = node.append.bind(node);
  node.append = child => { moves++; append(child); };
}
page.querySelector = selector => {
  if (selector === ".spotify-grid-controls") return controls;
  if (selector === ".music-focus > nav") return navigation;
  throw new Error("Unexpected selector");
};
class Observer {
  constructor(callback) { notify = callback; }
  observe(target, options) {
    assert.equal(target, page);
    assert.deepEqual(options, {childList:true, subtree:true});
  }
}

new Function("$", "MutationObserver", initializer)(
  id => id === "spotify-page" ? page : null,
  Observer
);

// No navigation: leave the existing control where it is.
assert.equal(controls.parentElement, page);
assert.equal(moves, 0);

// Connection: move, never clone.
navigation = new Node();
notify();
assert.equal(controls.parentElement, navigation);
assert.equal(navigation.children[0], controls);
assert.equal(controls.value, "70");
assert.equal(controls.listener, originalListener);

// A subsequent mutation must not move it repeatedly.
notify();
assert.equal(navigation.children.length, 1);

// View removed: the observer retains the detached control reference.
const previousNavigation = navigation;
navigation = null;
notify();
assert.equal(controls.parentElement, page);
assert.equal(previousNavigation.children.length, 0);
assert.equal(moves, 1);

// Reconnect: reuse exactly the same control and state.
controls.value = "85";
navigation = new Node();
notify();
assert.equal(navigation.children[0], controls);
assert.equal(controls.value, "85");
assert.equal(controls.listener, originalListener);

assert(!/localStorage|sessionStorage|\bfetch\s*\(/.test(initializer));
console.log("PASS: original control preserved, placement stable, disconnect recovery, reconnect state retained, no storage or requests.");