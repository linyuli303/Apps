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
const settle = () => new Promise(resolve => setImmediate(resolve));

function page(artistId) {
  return {
    status:"ready", artistId, offset:0, nextOffset:null,
    items:[{
      id:artistId, type:"album", name:"Sample release",
      releaseType:"album", releaseDate:"2025",
      dateLowerBound:"2025-01-01", artistIds:[artistId],
      spotifyURL:"https://open.spotify.com/album/" + artistId
    }]
  };
}
function fixture(reader) {
  const host = new Node("section");
  const calls = [];
  let cancellations = 0;
  const view = create(host, {
    async readArtistReleases(artistId, offset) {
      calls.push({artistId, offset});
      return reader(artistId);
    },
    cancelArtistReleases() { cancellations++; }
  }, () => {}, () => {}, true);
  const panel = host.children[0];
  return {
    view, calls, host,
    button:panel.children[0].children[0],
    cancellations:() => cancellations
  };
}

(async () => {
  // Runs across the three-artist batch boundary without another click.
  const f = fixture(async artistId => page(artistId));
  assert.equal(f.calls.length, 0);
  f.view.setArtists([1,2,3,4,5].map(id));
  assert.equal(f.calls.length, 0);
  await settle();
  assert.deepEqual(f.calls.map(call => call.artistId),
    [1,2,3,4,5].map(id));
  assert(f.calls.every(call => call.offset === 0));
  assert(f.button.hidden);
  f.view.clear();
  console.log("PASS: automatic first-page loading across multiple batches");

  // A rate limit must stop automatic continuation.
  let reads = 0;
  const limited = fixture(async artistId =>
    ++reads === 2 ? {status:"rate_limited"} : page(artistId));
  limited.view.setArtists([1,2,3,4].map(id));
  await settle();
  await settle();
  assert.equal(reads, 2);
  assert.equal(limited.button.textContent, "Retry");
  assert(!limited.button.hidden);
  assert(!limited.button.disabled);
  await limited.button.events.click();
  await settle();
  assert.deepEqual(limited.calls.map(call => call.artistId),
    [id(1),id(2),id(2),id(3),id(4)]);
  limited.view.clear();
  console.log("PASS: rate limit stops loading; retry requires explicit action");

  // Cancel before the scheduled first request.
  const cancelled = fixture(async artistId => page(artistId));
  cancelled.view.setArtists([id(1)]);
  cancelled.view.cancel();
  await settle();
  assert.equal(cancelled.calls.length, 0);
  cancelled.view.clear();

  // Replacing the snapshot prevents the old queued snapshot from loading.
  const replaced = fixture(async artistId => page(artistId));
  replaced.view.setArtists([id(1)]);
  replaced.view.setArtists([id(2)]);
  await settle();
  assert.deepEqual(replaced.calls.map(call => call.artistId), [id(2)]);
  replaced.view.clear();

  const disposed = fixture(async artistId => page(artistId));
  disposed.view.setArtists([id(1)]);
  disposed.view.clear();
  await settle();
  assert.equal(disposed.calls.length, 0);
  console.log("PASS: cancellation, snapshot replacement and disposal invalidate queued work");

  // Cancel a pending request: no later artist request may begin.
  let finish;
  const pending = fixture(() => new Promise(resolve => { finish = resolve; }));
  pending.view.setArtists([id(1),id(2)]);
  await settle();
  assert.equal(pending.calls.length, 1);
  pending.view.cancel();
  assert.equal(pending.cancellations(), 1);
  finish(page(id(1)));
  await settle();
  assert.equal(pending.calls.length, 1);
  pending.view.clear();
  console.log("PASS: pending cancellation prevents further requests");

  // Append after the original collection has finished.
  const completed = fixture(async artistId => page(artistId));
  completed.view.setArtists([id(1), id(2)]);
  await settle();

  const completedPanel = completed.host.children[0];
  // Approved order: Singles (index 2) before Albums (index 3).
  const albumRows = completedPanel.children[3].children[1];
  assert.equal(albumRows.children.length, 2);

  completed.view.setArtists([id(1), id(2), id(3)]);
  // Existing releases remain visible before the next request completes.
  assert.equal(albumRows.children.length, 2);
  await settle();

  assert.deepEqual(completed.calls.map(call => call.artistId),
    [id(1), id(2), id(3)]);
  assert.equal(albumRows.children.length, 3);
  assert(completed.button.hidden);
  completed.view.clear();
  console.log("PASS: completed collection extends without reloading earlier artists");

  // Append while the first request is still pending.
  let finishFirst;
  let firstRead = true;
  const extending = fixture(artistId => {
    if (firstRead) {
      firstRead = false;
      return new Promise(resolve => { finishFirst = resolve; });
    }
    return Promise.resolve(page(artistId));
  });

  extending.view.setArtists([id(1), id(2)]);
  await settle();
  assert.equal(extending.calls.length, 1);

  extending.view.setArtists([id(1), id(2), id(3), id(4)]);
  assert.equal(extending.cancellations(), 0);
  assert.equal(extending.calls.length, 1);

  finishFirst(page(id(1)));
  await settle();
  await settle();

  assert.deepEqual(extending.calls.map(call => call.artistId),
    [id(1), id(2), id(3), id(4)]);
  const extendingAlbums =
    extending.host.children[0].children[3].children[1];
  assert.equal(extendingAlbums.children.length, 4);
  assert(extending.button.hidden);
  extending.view.clear();
  console.log("PASS: in-flight collection extension preserves work and loads new artists once");

  console.log("6 automatic-loading tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});