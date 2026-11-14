"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function createSpotifyArtistReleaseView\([\s\S]*?^\}/gm
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
  matches[0][0] + "\nreturn createSpotifyArtistReleaseView;"
)(element, document);

FakeNode.prototype.focus = function() { this.focused = true; };
FakeNode.prototype.scrollIntoView = function() {};

const id = n => String(n).padStart(22, "0");
const artist = n => ({id: id(n), name: "Artist " + n});
function release(n, type = "album") {
  return {
    id: id(100 + n), type: "album",
    name: n === 1 ? "<img src=x>" : "Release " + n,
    releaseType: type,
    releaseDate: "2024",
    releaseDatePrecision: "year",
    dateLowerBound: "2024-01-01",
    spotifyURL: "https://open.spotify.com/album/" + id(100 + n)
  };
}
function page(items = [release(1)], nextOffset = null) {
  return {status: "ready", items, nextOffset};
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function allNodes(node) {
  return node.children.flatMap(child => [child, ...allNodes(child)]);
}
function fixture(reader, onVisibility) {
  const host = new FakeNode("section");
  const calls = [], plays = [];
  let expired = 0, cancellations = 0;
  const view = create(host, {
    cancelArtistReleases() { cancellations++; },
    async readArtistReleases(artistId, offset) {
      calls.push({artistId, offset});
      return reader ? reader(artistId, offset) : page();
    }
  }, () => { expired++; }, (item, trigger) => {
    plays.push({item, trigger});
  }, undefined, onVisibility);
  const panel = host.children[0];
  // Approved order inside the releases view: Singles & EPs, then Albums.
  const [heading, toolbar, notice, singles, albums, status, more] =
    panel.children;
  assert.equal(singles.children[0].textContent, "Singles & EPs");
  assert.equal(albums.children[0].textContent, "Albums");
  // Combined view over both groups for counting and searching.
  const rows = {
    get children() {
      return [...singles.children[1].children, ...albums.children[1].children];
    }
  };
  const trigger = new FakeNode("button");
  trigger.isConnected = true;
  return {
    host, view, panel, rows, status, more, trigger, singles, albums,
    closeButton: heading.children[0],
    title: heading.children[1],
    period: toolbar.children[0], type: toolbar.children[1],
    calls, plays, expired: () => expired, cancellations: () => cancellations
  };
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("No eager request; safe labels, links and explicit player action",
    async () => {
      const f = fixture();
      assert.equal(f.calls.length, 0);
      assert(f.panel.hidden);
      await f.view.open(artist(1), f.trigger);
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].artistId, id(1));
      assert(!f.panel.hidden);
      assert(f.closeButton.focused);

      const nodes = [f.singles, f.albums].flatMap(allNodes);
      assert(!nodes.some(n => ["img", "iframe", "audio"].includes(n.tag)));
      assert(nodes.some(n => n.textContent === "<img src=x>"));
      const link = nodes.find(n => n.tag === "a");
      assert.equal(link.href,
        "https://open.spotify.com/album/" + id(101));
      assert.equal(link.rel, "noopener noreferrer");
      assert.equal(link.referrerPolicy, "no-referrer");
      assert.equal(f.plays.length, 0);
      // Without a song browser, the title opens the player explicitly.
      nodes.find(n => n.tag === "button").events.click();
      assert.equal(f.plays.length, 1);
      assert.equal(f.plays[0].item.type, "album");
      const play = nodes.find(n => n.className.includes("music-library-play"));
      play.events.click();
      assert.equal(f.plays.length, 2);
      assert.equal(play.attrs["aria-label"],
        "Open Spotify player for <img src=x>");
      assert.equal(link.attrs["aria-label"],
        "Open <img src=x> in Spotify (new tab)");
      f.view.clear();
    }
  );

  await test("Singles and albums render in separate ordered groups",
    async () => {
      const f = fixture(async () => page([
        release(1, "album"), release(2, "single"), release(3, "single")
      ]));
      await f.view.open(artist(1), f.trigger);
      assert(!f.singles.hidden);
      assert(!f.albums.hidden);
      assert.equal(f.singles.children[1].children.length, 2);
      assert.equal(f.albums.children[1].children.length, 1);
      f.type.value = "album";
      f.type.events.change();
      assert(f.singles.hidden);
      assert(!f.albums.hidden);
      f.view.clear();
    }
  );

  await test("Album titles browse songs; single titles open the player",
    async () => {
      const host = new FakeNode("section");
      const browsed = [], played = [];
      const view = create(host, {
        cancelArtistReleases() {},
        async readArtistReleases() {
          return page([release(1, "album"), release(2, "single")]);
        }
      }, () => {}, item => played.push(item), item => browsed.push(item));
      const trigger = new FakeNode("button");
      await view.open(artist(1), trigger);
      const [, , , singles, albums] = host.children[0].children;
      const title = group => allNodes(group).find(n =>
        n.className === "music-library-title");
      title(albums).events.click();
      assert.equal(browsed.length, 1);
      assert.equal(played.length, 0);
      title(singles).events.click();
      assert.equal(browsed.length, 1);
      assert.equal(played.length, 1);
      view.clear();
    }
  );

  await test("Visibility hook reports open and user/automatic close",
    async () => {
      const events = [];
      const f = fixture(undefined, (open, byUser) =>
        events.push([open, byUser]));
      await f.view.open(artist(1), f.trigger);
      assert.deepEqual(events, [[true, undefined]]);
      f.closeButton.events.click();
      assert.deepEqual(events.at(-1), [false, true]);
      assert(f.panel.hidden);
      assert(f.trigger.focused);
      f.view.close(false);
      assert.equal(events.length, 2);
      await f.view.open(artist(2), f.trigger);
      f.view.clear();
      assert.deepEqual(events.at(-1), [false, false]);
    }
  );

  await test("Latest/all and type filters operate on loaded records only",
    async () => {
      const items = Array.from({length: 8}, (_, i) =>
        release(i + 1, i % 2 ? "single" : "album"));
      const f = fixture(async () => page(items));
      await f.view.open(artist(1), f.trigger);
      assert.equal(f.rows.children.length, 6);
      f.period.value = "all";
      f.period.events.change();
      assert.equal(f.rows.children.length, 8);
      f.type.value = "single";
      f.type.events.change();
      assert.equal(f.rows.children.length, 4);
      assert.equal(f.calls.length, 1);
      f.view.clear();
    }
  );

  await test("Manual pagination deduplicates IDs and preserves empty-page continuation",
    async () => {
      const f = fixture(async (artistId, offset) =>
        offset === 0 ? page([], 20) : page([release(1), release(2)]));
      await f.view.open(artist(1), f.trigger);
      assert(!f.more.hidden);
      assert.equal(f.calls.length, 1);
      await f.more.events.click();
      assert.deepEqual(f.calls.map(call => call.offset), [0, 20]);
      assert.equal(f.rows.children.length, 2);
      assert(f.more.hidden);
      f.view.clear();

      const duplicate = fixture(async (artistId, offset) =>
        offset === 0
          ? page([release(1)], 20)
          : page([release(1), release(2)]));
      await duplicate.view.open(artist(1), duplicate.trigger);
      await duplicate.more.events.click();
      assert.equal(duplicate.rows.children.length, 2);
      duplicate.view.clear();
    }
  );

  await test("Closing discards late results and restores opener focus",
    async () => {
      const pending = deferred();
      const f = fixture(() => pending.promise);
      assert.equal(f.cancellations(), 0);
      const work = f.view.open(artist(1), f.trigger);
      assert.equal(f.cancellations(), 0);
      f.view.close();
      assert.equal(f.cancellations(), 1);
      f.view.close();
      assert.equal(f.cancellations(), 1);
      pending.resolve(page());
      await work;
      assert(f.panel.hidden);
      assert.equal(f.rows.children.length, 0);
      assert(f.singles.hidden);
      assert(f.albums.hidden);
      assert.equal(f.status.textContent, "");
      assert(f.trigger.focused);
      f.view.clear();
    }
  );

  await test("Switching artists ignores an older response; clear removes listeners",
    async () => {
      const old = deferred();
      const f = fixture(async artistId =>
        artistId === id(1) ? old.promise : page([release(2)]));
      const first = f.view.open(artist(1), f.trigger);
      await f.view.open(artist(2), f.trigger);
      assert.equal(f.cancellations(), 1);
      old.resolve(page([release(1)]));
      await first;
      assert.equal(f.title.textContent, "Artist 2 · releases");
      const shown = [f.singles, f.albums].flatMap(allNodes);
      assert(shown.some(n => n.textContent === "Release 2"));
      assert(!shown.some(n => n.textContent === "<img src=x>"));

      f.view.clear();
      assert.equal(f.host.children.length, 0);
      assert.equal(f.more.events.click, undefined);
      assert.equal(f.closeButton.events.click, undefined);
      assert.equal(f.period.events.change, undefined);
      assert.equal(f.type.events.change, undefined);
      const count = f.calls.length;
      await f.view.open(artist(1), f.trigger);
      assert.equal(f.calls.length, count);
    }
  );

  await test("Fixed error messages, explicit retry and expiry handling",
    async () => {
      for (const state of ["restricted", "rate_limited", "failed", "cancelled"]) {
        let reads = 0;
        const f = fixture(async () => ++reads === 1
          ? {status: state, privateDetails: "PRIVATE"} : page());
        await f.view.open(artist(1), f.trigger);
        assert.equal(reads, 1);
        assert(!f.status.textContent.includes("PRIVATE"));
        assert(!f.more.hidden);
        await f.more.events.click();
        assert.equal(reads, 2);
        assert.equal(f.rows.children.length, 1);
        f.view.clear();
      }

      const expired = fixture(async () => ({status: "reauthorize"}));
      await expired.view.open(artist(1), expired.trigger);
      assert.equal(expired.expired(), 1);
      assert(expired.panel.hidden);
      expired.view.clear();
    }
  );

  console.log(passed + " release-renderer tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});