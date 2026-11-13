"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const marker = "(function initializeSpotifyArtworkPreference()";
assert.equal(source.split(marker).length - 1, 1);
const start = source.indexOf(marker);
const end = source.indexOf("\n})();", start);
assert(end > start);
const initializer = source.slice(start, end + "\n})();".length);

function fixture(missing = null) {
  const events = [];
  const listeners = {};
  const page = {
    dataset: {},
    dispatchEvent(event) { events.push(event.type); }
  };
  const toggle = {
    checked: true,
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  new Function("$", "Event", initializer)(
    id => {
      if (id === missing) return null;
      if (id === "spotify-page") return page;
      if (id === "spotify-thumbnails") return toggle;
      throw new Error("Unexpected DOM lookup");
    },
    class Event {
      constructor(type) { this.type = type; }
    }
  );
  return {page, toggle, events, listeners};
}

const f = fixture();

// Browser-restored checked state must not enable artwork automatically.
assert.equal(f.toggle.checked, false);
assert.equal(f.page.dataset.spotifyArtwork, "off");
assert.deepEqual(f.events, []);

// Opt-in and opt-out emit a local rendering notification only.
f.toggle.checked = true;
f.listeners.change();
assert.equal(f.page.dataset.spotifyArtwork, "on");
assert.deepEqual(f.events, ["spotifyartworkchange"]);

f.toggle.checked = false;
f.listeners.change();
assert.equal(f.page.dataset.spotifyArtwork, "off");
assert.deepEqual(f.events, [
  "spotifyartworkchange", "spotifyartworkchange"
]);

// Fresh initialization resets the preference.
assert.equal(fixture().page.dataset.spotifyArtwork, "off");

// Missing page/control is harmless.
assert.deepEqual(fixture("spotify-page").events, []);
assert.deepEqual(fixture("spotify-thumbnails").events, []);

assert(!/\bfetch\s*\(|localStorage|sessionStorage|createElement|\.src\s*=/.test(
  initializer
));
console.log("PASS: restored checkbox reset, default off, explicit opt-in/out, local notifications, missing-control guards, no storage or image requests.");