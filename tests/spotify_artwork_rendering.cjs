"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const marker = "(function initializeSpotifyArtworkRendering()";
assert.equal(source.split(marker).length - 1, 1);
const start = source.indexOf(marker);
const end = source.indexOf("\n})();", start);
assert(end > start);
const initializer = source.slice(start, end + "\n})();".length);

const selector = ".music-library-cover[data-spotify-artwork-url]";
const events = {};
const covers = [];
let notify;
let renders = 0;

class Cover {
  constructor(url) {
    this.nodeType = 1;
    this.dataset = {spotifyArtworkUrl:url};
    this.children = [];
  }
  matches(value) {
    assert.equal(value, selector);
    return true;
  }
  querySelectorAll(value) {
    if (value === "img") return this.children.filter(n => n.tag === "img");
    assert.equal(value, selector);
    return [];
  }
  replaceChildren(...nodes) { this.children = nodes; }
}

const page = {
  dataset:{spotifyArtwork:"off"},
  contains(node) { return covers.includes(node); },
  querySelectorAll(value) {
    assert.equal(value, selector);
    return covers;
  },
  addEventListener(name, callback) { events[name] = callback; }
};

class Observer {
  constructor(callback) { notify = callback; }
  observe(target, options) {
    assert.equal(target, page);
    assert.deepEqual(options, {childList:true, subtree:true});
  }
}

// Fake component: test orchestration independently from image loading.
function createCover(url, enabled) {
  renders++;
  return {
    childNodes: enabled ? [{
      tag:"img", src:url, srcset:"sample",
      removeAttribute(name) { delete this[name]; }
    }] : [{tag:"text", textContent:"♫"}]
  };
}

const first = new Cover("https://i.scdn.co/image/" + "a".repeat(40));
covers.push(first);

new Function(
  "$", "MutationObserver", "createSpotifyArtworkCover", initializer
)(
  id => id === "spotify-page" ? page : null,
  Observer,
  createCover
);

assert.equal(first.children[0].tag, "text");
assert.equal(renders, 1);

// Opt-in updates existing cards.
page.dataset.spotifyArtwork = "on";
events.spotifyartworkchange();
const image = first.children[0];
assert.equal(image.tag, "img");
assert.equal(renders, 2);

// Repeated events must not reload unchanged artwork.
events.spotifyartworkchange();
assert.equal(first.children[0], image);
assert.equal(renders, 2);

// New cards inherit the current preference.
const second = new Cover("https://i.scdn.co/image/" + "b".repeat(40));
covers.push(second);
notify([{addedNodes:[second]}]);
const secondImage = second.children[0];
assert.equal(secondImage.tag, "img");
assert.equal(renders, 3);

// Image mutations must not recursively rerender covers.
notify([{addedNodes:[{
  nodeType:1,
  matches:() => false,
  querySelectorAll:() => []
}]}]);
assert.equal(renders, 3);

// Opt-out strips sources and restores placeholders.
page.dataset.spotifyArtwork = "off";
events.spotifyartworkchange();
assert.equal(image.src, undefined);
assert.equal(image.srcset, undefined);
assert.equal(secondImage.src, undefined);
assert.equal(first.children[0].tag, "text");
assert.equal(second.children[0].tag, "text");

// Detached cards must not load artwork.
const detached = new Cover("https://i.scdn.co/image/" + "c".repeat(40));
const before = renders;
notify([{addedNodes:[detached]}]);
assert.equal(renders, before);

assert(!/\bfetch\s*\(|localStorage|sessionStorage/.test(initializer));
console.log("PASS: thumbnail rendering integration — default off, opt-in, stable updates, new cards, source removal and detached-card guard.");