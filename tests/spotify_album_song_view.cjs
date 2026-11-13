"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function createSpotifyAlbumSongView\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.events = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tag === "fragment") {
        this.append(...node.children);
      } else {
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
    this.removed = true;
    if (this.parent) {
      this.parent.children = this.parent.children.filter(n => n !== this);
    }
  }
}

const document = {
  createElement: tag => new FakeNode(tag),
  createDocumentFragment: () => new FakeNode("fragment")
};
const element = (tag, className, text) => {
  const node = new FakeNode(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const create = new Function(
  "element", "document",
  matches[0][0] + "\nreturn createSpotifyAlbumSongView;"
)(element, document);

FakeNode.prototype.focus = function() { this.focused = true; };
FakeNode.prototype.scrollIntoView = function() {};

FakeNode.prototype.getClientRects = function() { return [{}]; };

const id = n => String(n).padStart(22, "0");
const album = n => ({
  id:id(n), type:"album", name:"Album " + n, releaseDate:"2025-06"
});
const track = (n, changes = {}) => ({
  id:id(100 + n), type:"track",
  name:n === 1 ? "<b>Song</b>" : "Song " + n,
  artists:[{id:id(900), name:"Sample artist"}],
  durationMs:222000, availability:"unknown",
  ...changes
});
function page(offset = 0, nextOffset = null) {
  return {
    status:"ready", nextOffset,
    items:[
      {position:offset + 1, track:track(1)},
      {position:offset + 2, track:null},
      {position:offset + 3, track:track(3, {
        durationMs:null, availability:"unavailable"
      })}
    ]
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function walk(node) {
  return node.children.flatMap(child => [child, ...walk(child)]);
}
function fixture(reader = async () => page()) {
  const host = new FakeNode("section");
  const calls = [], plays = [];
  let cancellations = 0, expirations = 0;

  const view = create(host, {
    async readAlbumTracks(albumId, offset) {
      calls.push({albumId, offset});
      return reader(albumId, offset);
    },
    cancelAlbumTracks() { cancellations++; }
  }, () => { expirations++; }, (item, trigger) => {
    plays.push({item, trigger});
  });

  const panel = host.children[0];
  const [heading, table, status, more] = panel.children;
  const trigger = new FakeNode("button");
  trigger.isConnected = true;

  return {
    view, host, panel, status, more, calls, plays, trigger,
    rows:table.children[1],
    closeButton:heading.children[1],
    cancellations:() => cancellations,
    expirations:() => expirations
  };
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("No eager reads; safe song labels, durations and release dates",
    async () => {
      const f = fixture();
      assert.equal(f.calls.length, 0);
      assert(f.panel.hidden);

      await f.view.open(album(1), f.trigger);
      assert.deepEqual(f.calls, [{albumId:id(1), offset:0}]);
      assert.equal(f.rows.children.length, 3);

      const first = f.rows.children[0];
      assert.equal(first.children[1].textContent, "<b>Song</b>");
      assert.equal(first.children[1].children[0].textContent,
        "Sample artist");
      assert.equal(first.children[2].textContent, "3:42");
      assert.equal(first.children[3].textContent, "2025-06");

      assert.equal(f.rows.children[1].children[0].textContent, "—");
      assert.equal(f.rows.children[1].children[1].textContent, "Unavailable");
      assert.equal(f.rows.children[2].children[2].textContent, "Unavailable");
      assert(!walk(f.rows).some(node =>
        ["img", "iframe", "audio"].includes(node.tag)));
      f.view.clear();
    }
  );

  await test("Player action is explicit; unavailable tracks cannot play",
    async () => {
      const f = fixture();
      await f.view.open(album(1), f.trigger);
      assert.equal(f.plays.length, 0);

      const play = f.rows.children[0].children[0].children[0];
      play.events.click();
      assert.equal(f.plays.length, 1);
      assert.equal(f.plays[0].item.type, "track");

      const unavailable = f.rows.children[2].children[0].children[0];
      assert(unavailable.disabled);
      unavailable.events.click();
      assert.equal(f.plays.length, 1);

      f.view.close();
      play.events.click();
      assert.equal(f.plays.length, 1);
      f.view.clear();
    }
  );

  await test("Pagination retains positions and prevents overlapping reads",
    async () => {
      const pending = deferred();
      const f = fixture((albumId, offset) =>
        offset === 0 ? Promise.resolve(page(0, 20)) : pending.promise);

      await f.view.open(album(1), f.trigger);
      assert(!f.more.hidden);

      const append = f.more.events.click();
      await f.more.events.click();
      assert.deepEqual(f.calls.map(call => call.offset), [0, 20]);

      pending.resolve(page(20));
      await append;
      assert.equal(f.rows.children.length, 6);
      assert(f.more.hidden);
      f.view.clear();
    }
  );

  await test("Close cancels pending reads, restores focus and discards late data",
    async () => {
      const pending = deferred();
      const f = fixture(() => pending.promise);
      const work = f.view.open(album(1), f.trigger);
      f.view.close();
      assert.equal(f.cancellations(), 1);
      assert(f.trigger.focused);

      pending.resolve(page());
      await work;
      assert(f.panel.hidden);
      assert.equal(f.rows.children.length, 0);
      assert.equal(f.status.textContent, "");
      f.view.clear();
      assert.equal(f.host.children.length, 0);
      assert.equal(f.more.events.click, undefined);
    }
  );

  await test("Switching albums ignores older results; errors require explicit retry",
    async () => {
      const pending = deferred();
      const f = fixture(albumId =>
        albumId === id(1) ? pending.promise : Promise.resolve(page()));
      const first = f.view.open(album(1), f.trigger);
      await f.view.open(album(2), f.trigger);
      assert.equal(f.cancellations(), 1);
      pending.resolve({status:"failed"});
      await first;
      assert.equal(f.rows.children.length, 3);
      f.view.clear();

      for (const state of ["restricted","rate_limited","failed"]) {
        let reads = 0;
        const error = fixture(async () => ++reads === 1
          ? {status:state, privateDetails:"PRIVATE"} : page());
        await error.view.open(album(1), error.trigger);
        assert.equal(reads, 1);
        assert(!error.status.textContent.includes("PRIVATE"));
        assert.equal(error.more.textContent, "Retry");
        await error.more.events.click();
        assert.equal(reads, 2);
        assert.equal(error.rows.children.length, 3);
        error.view.clear();
      }

      const expired = fixture(async () => ({status:"reauthorize"}));
      await expired.view.open(album(1), expired.trigger);
      assert.equal(expired.expirations(), 1);
      assert(expired.panel.hidden);
      assert.equal(expired.rows.children.length, 0);
      expired.view.clear();
    }
  );

  console.log(passed + " album-song view tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});