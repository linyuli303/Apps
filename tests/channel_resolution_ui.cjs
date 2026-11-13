"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);

function extract(name) {
  const matches = [...source.matchAll(
    new RegExp("^function " + name + "\\([\\s\\S]*?^\\}", "gm")
  )];
  assert.equal(matches.length, 1, name);
  return matches[0][0];
}

const helperSource = extract("buildMyTubeResolutionRequest");
const uiSource = extract("initializeMyTubeResolutionChannels");
const build = new Function(
  helperSource + "\nreturn buildMyTubeResolutionRequest;"
)();

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
  }
  append(...children) { this.children.push(...children); }
  before(node) { this.inserted = node; }
  closest() { return this.controls || null; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  focus() { this.focused = true; }
  fire(name) {
    const event = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    };
    if (this.listeners[name]) this.listeners[name](event);
    return event;
  }
}

function mount(builder = build, hasControls = true) {
  const nodes = [];
  const element = (tag, cls = "", text = "") => {
    const node = new FakeElement(tag);
    node.className = cls;
    node.textContent = text;
    nodes.push(node);
    return node;
  };
  const controls = new FakeElement("div");
  const input = element("input");
  input.id = "new-channel";
  input.controls = hasControls ? controls : null;
  const find = id => nodes.find(node => node.id === id);
  const init = new Function(
    "$", "element", "buildMyTubeResolutionRequest",
    uiSource + "\nreturn initializeMyTubeResolutionChannels;"
  )(find, element, builder);
  init();
  return {find, init, nodes, controls};
}

const ui = mount();
const get = suffix => ui.find("channel-resolution-" + suffix);
const input = get("input");
const prepare = get("prepare");
const link = get("link");
const results = get("results");
const copy = get("copy");
const status = get("status");

assert(results.hidden);
assert.equal(link.href, undefined);
assert.equal(input.maxLength, 16000);
assert.equal(input.autocomplete, "off");
assert(copy.readOnly);
assert.equal(link.target, "_blank");
assert.equal(link.rel, "noopener noreferrer");
assert.equal(link.referrerPolicy, "no-referrer");
assert.equal(status.role, "status");

input.value = "@Example\n@Example";
prepare.fire("click");
assert(!results.hidden);
assert.equal(copy.value, input.value);
const url = new URL(link.href);
assert.equal(url.origin, "https://github.com");
assert.equal(url.pathname, "/linyuli303/Apps/issues/new");
assert.equal(url.searchParams.get("template"), "channel-resolve.yml");
assert(!url.searchParams.has("confirmation"));
assert(!link.fire("click").defaultPrevented);

// Editing invalidates the prepared link and clears the copy.
input.value = "@Other";
input.fire("input");
assert(results.hidden);
assert.equal(link.href, undefined);
assert.equal(copy.value, "");

// Programmatic edits without an input event cannot use a stale link.
prepare.fire("click");
input.value = "@Changed";
assert(link.fire("click").defaultPrevented);
assert(results.hidden);
assert.equal(link.href, undefined);
assert.match(status.textContent, /Prepare.*again/);

// Invalid input must not retain a previously prepared request.
input.value = "@Example";
prepare.fire("click");
input.value = "https://youtube.com/@Example?private=yes";
prepare.fire("click");
assert(results.hidden);
assert.equal(link.href, undefined);
assert.equal(copy.value, "");
assert(status.textContent.length > 0);

// Clear removes all prepared state and returns focus to the input.
input.value = "@Example";
prepare.fire("click");
get("clear").fire("click");
assert.equal(input.value, "");
assert.equal(copy.value, "");
assert(results.hidden);
assert.equal(link.href, undefined);
assert(input.focused);

// Force the oversized-link branch while retaining real validation.
const fallback = mount(text => {
  const prepared = build(text);
  const url = new URL(prepared.url);
  url.searchParams.delete("channels");
  return {...prepared, url: url.href, requiresPaste: true};
});
fallback.find("channel-resolution-input").value = "@Example";
fallback.find("channel-resolution-prepare").fire("click");
assert.match(
  fallback.find("channel-resolution-status").textContent,
  /Copy the prepared inputs/
);
assert.equal(fallback.find("channel-resolution-copy").value, "@Example");
assert(!new URL(
  fallback.find("channel-resolution-link").href
).searchParams.has("channels"));

// Initialization is idempotent and safe on pages without Config controls.
const count = ui.nodes.length;
ui.init();
assert.equal(ui.nodes.length, count);
assert.equal(mount(build, false).find("channel-resolution-manager"), undefined);

// No automatic navigation, network, persistence, or HTML interpolation.
assert(!/fetch\s*\(|window\.open|location\s*[.=]|localStorage|sessionStorage|document\.cookie|innerHTML|setInterval/.test(uiSource));

console.log(
  "PASS: lookup UI preparation, explicit link, invalidation, stale-input " +
  "guard, validation, clear, copy fallback and idempotent initialization."
);