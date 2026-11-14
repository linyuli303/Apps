"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
function extract(name, prefix = "") {
  const matches = [...source.matchAll(new RegExp(
    "^" + prefix + "function " + name + "\\([\\s\\S]*?^\\}", "gm"
  ))];
  assert.equal(matches.length, 1, "Unique function required: " + name);
  return matches[0][0];
}

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.events = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tag === "fragment") this.append(...node.children);
      else {
        node.parent = this;
        this.children.push(node);
      }
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  removeEventListener(name, callback) {
    if (this.events[name] === callback) delete this.events[name];
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(n => n !== this);
    }
  }
}
const document = {
  createDocumentFragment: () => new Node("fragment")
};
const element = (tag, className, text) => {
  const node = new Node(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const create = new Function("element", "document", [
  extract("groupSpotifyLatestReleases"),
  extract("loadSpotifyLatestReleaseBatch", "async "),
  extract("createSpotifyLatestView"),
  "return createSpotifyLatestView;"
].join("\n"))(element, document);

const id = n => String(n).padStart(22, "0");
function page(artistId, type = "album") {
  return {
    status: "ready", artistId, offset: 0, nextOffset: null,
    items: [{
      id: artistId, type: "album", name: "<b>Sample release</b>",
      releaseType: type, releaseDate: "2025",
      dateLowerBound: "2025-01-01", artistIds: [artistId],
      spotifyURL: "https://open.spotify.com/album/" + artistId
    }]
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}
function fixture(reader = async artistId => page(artistId)) {
  const host = new Node("section");
  const calls = [], plays = [];
  let cancelled = 0, expired = 0;
  const view = create(host, {
    async readArtistReleases(artistId, offset) {
      calls.push({artistId, offset});
      return reader(artistId, offset);
    },
    cancelArtistReleases() { cancelled++; }
  }, () => { expired++; }, (item, trigger) => {
    plays.push({item, trigger});
  });
  const panel = host.children[0];
  return {
    view, host, panel, calls, plays,
    button: panel.children[0].children[0],
    status: panel.children[1],
    // Approved order: Singles before Albums.
    singles: panel.children[2].children[1],
    albums: panel.children[3].children[1],
    cancelled: () => cancelled,
    expired: () => expired
  };
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("No eager reads; setArtists only prepares the overview", async () => {
    const f = fixture();
    assert(f.button.disabled);
    f.view.setArtists([id(1)]);
    assert(!f.button.disabled);
    assert.equal(f.calls.length, 0);
    assert.throws(() => f.view.setArtists(["bad"]));
    assert.throws(() => f.view.setArtists([id(1), id(1)]));
    f.view.clear();
  });

  await test("Explicit load separates releases and renders safe labels/links", async () => {
    const f = fixture(async artistId =>
      page(artistId, artistId === id(1) ? "single" : "album"));
    f.view.setArtists([id(1), id(2)]);
    await f.view.load();
    assert.equal(f.calls.length, 2);
    assert.equal(f.panel.children[2].children[0].textContent, "Singles");
    assert.equal(f.panel.children[3].children[0].textContent, "Albums");
    assert.equal(f.singles.children.length, 1);
    assert.equal(f.albums.children.length, 1);
    const nodes = descendants(f.panel);
    assert(!nodes.some(n => ["img", "iframe", "audio"].includes(n.tag)));
    assert(nodes.some(n => n.textContent === "<b>Sample release</b>"));
    const link = descendants(f.singles).find(n => n.tag === "a");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.referrerPolicy, "no-referrer");
    assert.equal(f.plays.length, 0);
    descendants(f.singles).find(n => n.tag === "button").events.click();
    assert.equal(f.plays.length, 1);
    assert.equal(f.plays[0].item.type, "album");
    assert(f.button.hidden);
    f.view.clear();
  });

  await test("Three-artist batches require explicit continuation", async () => {
    const f = fixture();
    f.view.setArtists([1, 2, 3, 4].map(id));
    await f.view.load();
    assert.equal(f.calls.length, 3);
    assert(!f.button.hidden);
    assert.equal(f.button.textContent, "Load next artists");
    assert(f.status.textContent.includes("Partial release coverage"));
    await f.view.load();
    assert.equal(f.calls.length, 4);
    assert(f.button.hidden);
    f.view.clear();
  });

  await test("Cancellation aborts through controller and ignores late results", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    f.view.setArtists([id(1)]);
    const work = f.view.load();
    await f.view.load();
    assert.equal(f.calls.length, 1);
    f.view.cancel();
    assert.equal(f.cancelled(), 1);
    pending.resolve(page(id(1)));
    await work;
    assert.equal(f.albums.children.length, 0);
    assert(!f.button.disabled);
    f.view.clear();
  });

  await test("Artist refresh clears old results; clear removes listener", async () => {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    f.view.setArtists([id(1)]);
    const work = f.view.load();
    f.view.setArtists([id(2)]);
    assert.equal(f.cancelled(), 1);
    pending.resolve(page(id(1)));
    await work;
    assert.equal(f.albums.children.length, 0);
    assert.equal(f.singles.children.length, 0);

    const savedLoad = f.button.events.click;
    f.view.clear();
    f.view.clear();
    assert.equal(f.host.children.length, 0);
    assert.equal(f.button.events.click, undefined);
    await savedLoad();
    assert.equal(f.calls.length, 1);
  });

  await test("Errors stop loading and require retry; expiry clears metadata", async () => {
    for (const state of ["restricted", "rate_limited", "failed"]) {
      let reads = 0;
      const f = fixture(async artistId => ++reads === 1
        ? {status: state, privateDetails: "PRIVATE"}
        : page(artistId));
      f.view.setArtists([id(1)]);
      await f.view.load();
      assert.equal(reads, 1);
      assert.equal(f.button.textContent, "Retry");
      assert(!f.button.disabled);
      assert(!f.status.textContent.includes("PRIVATE"));
      await f.view.load();
      assert.equal(reads, 2);
      assert(f.button.hidden);
      f.view.clear();
    }

    const f = fixture(async () => ({status: "reauthorize"}));
    f.view.setArtists([id(1)]);
    await f.view.load();
    assert.equal(f.expired(), 1);
    assert.equal(f.albums.children.length, 0);
    assert.equal(f.singles.children.length, 0);
    assert(f.button.disabled);
    f.view.clear();
  });

  console.log(passed + " latest-view tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});