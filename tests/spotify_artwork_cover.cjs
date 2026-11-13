"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);

function extract(name) {
  const matches = [...source.matchAll(new RegExp(
    "^function " + name + "\\([\\s\\S]*?^\\}", "gm"
  ))];
  assert.equal(matches.length, 1, "Unique helper required: " + name);
  return matches[0][0];
}

let createdImages = 0;
const assignments = [];
class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.events = {};
    this.source = undefined;
  }
  contains(node) { return this.children.includes(node); }
  setAttribute(key, value) { this.attrs[key] = value; }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, callback, options) {
    this.events[name] = callback;
    if (name === "error") this.errorOptions = options;
  }
  removeAttribute(name) {
    if (name === "src") this.source = undefined;
  }
  set src(value) {
    assignments.push({
      value,
      crossOrigin: this.crossOrigin,
      referrerPolicy: this.referrerPolicy,
      loading: this.loading
    });
    this.source = value;
  }
  get src() { return this.source; }
}

const element = (tag, className, text) => {
  const node = new FakeNode(tag);
  node.className = className;
  node.textContent = text;
  return node;
};
const document = {
  createElement(tag) {
    assert.equal(tag, "img");
    createdImages++;
    return new FakeNode(tag);
  },
  createTextNode(text) { return {tag: "text", textContent: text}; }
};

const create = new Function("element", "document",
  extract("selectSpotifyArtworkURL") + "\n" +
  extract("createSpotifyArtworkCover") +
  "\nreturn createSpotifyArtworkCover;"
)(element, document);

const url = "https://i.scdn.co/image/" + "a".repeat(40);

// Off by default and only literal true enables artwork.
for (const enabled of [undefined, false, null, 1, "true"]) {
  const cover = create(url, enabled);
  assert.equal(cover.textContent, "♫");
  assert.equal(cover.attrs["aria-hidden"], "true");
}
assert.equal(createdImages, 0);
assert.equal(assignments.length, 0);

// Invalid URLs must not create images even after opt-in.
for (const invalid of [
  null, "https://untrusted.example/image", url + "?token=private"
]) {
  create(invalid, true);
}
assert.equal(createdImages, 0);

// Request attributes must be configured before src is assigned.
const cover = create(url, true);
assert.equal(createdImages, 1);
assert.equal(cover.children.length, 1);
const image = cover.children[0];
assert.equal(image.alt, "");
assert.equal(image.decoding, "async");
assert.deepEqual(assignments[0], {
  value: url,
  crossOrigin: "anonymous",
  referrerPolicy: "no-referrer",
  loading: "lazy"
});
assert.deepEqual(image.errorOptions, {once: true});

// Error restores the placeholder without another source assignment.
image.events.error();
assert.equal(image.src, undefined);
assert.equal(cover.children[0].textContent, "♫");
assert.equal(assignments.length, 1);
assert.equal(createdImages, 1);

// Moved-image error regression.
const temporaryCover = create(url, true);
const movedImage = temporaryCover.children[0];
const actualCardCover = new FakeNode("div");

// Simulate moving the image out of its temporary wrapper.
temporaryCover.children = [];
actualCardCover.replaceChildren(movedImage);
movedImage.parentNode = actualCardCover;

const assignmentsBeforeError = assignments.length;
movedImage.events.error();

assert.equal(movedImage.src, undefined);
assert.equal(actualCardCover.children.length, 1);
assert.equal(actualCardCover.children[0].textContent, "♫");
assert.equal(temporaryCover.children.length, 0);
assert.equal(assignments.length, assignmentsBeforeError);

// A removed image's late error must not overwrite newer content.
const oldWrapper = create(url, true);
const detachedImage = oldWrapper.children[0];
oldWrapper.children = [];
detachedImage.parentNode = null;

const newerContent = {tag:"text", textContent:"Newer artwork"};
actualCardCover.replaceChildren(newerContent);
detachedImage.events.error();

assert.equal(actualCardCover.children[0], newerContent);
assert.equal(detachedImage.src, undefined);

console.log("PASS: moved-image failure updates the actual card; detached late errors preserve newer content.");

assert(!/\bfetch\s*\(|localStorage|sessionStorage/.test(
  extract("createSpotifyArtworkCover")
));
console.log("PASS: artwork off by default, strict opt-in, invalid URLs blocked, anonymous/lazy/no-referrer attributes set before src, error fallback without retry.");