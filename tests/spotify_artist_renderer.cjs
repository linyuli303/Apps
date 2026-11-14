"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function createSpotifyArtistView\([\s\S]*?^\}/gm
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
  matches[0][0] + "\nreturn createSpotifyArtistView;"
)(element, document);

const id = n => String(n).padStart(22, "0");
function page(numbers = [1], nextAfter = null) {
  return {
    status: "ready", nextAfter,
    items: numbers.map(n => ({
      id: id(n),
      name: n === 1 ? "<img src=x>" : "Artist " + n,
      spotifyURL: "https://open.spotify.com/artist/" + id(n)
    }))
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function fixture(reader) {
  const host = new FakeNode("section");
  let expired = 0;
  const view = create(host, {readArtists: reader}, () => {
    expired++;
    view.clear();
  });
  const panel = host.children[0];
  const [heading, toolbar, rows, status, more] = panel.children;
  return {
    host, view, panel, rows, status, more,
    search: toolbar.children[0],
    refresh: heading.children[1],
    expired: () => expired
  };
}
function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("No eager read; labels remain text and links are restricted",
    async () => {
      let calls = 0;
      const f = fixture(async () => { calls++; return page(); });
      assert.equal(calls, 0);
      assert(f.panel.hidden);
      await f.view.load();
      assert.equal(calls, 1);
      assert(!f.panel.hidden);
      assert.equal(f.rows.children.length, 1);
      const nodes = descendants(f.rows);
      assert(!nodes.some(n => ["img", "iframe", "audio"].includes(n.tag)));
      assert(nodes.some(n => n.textContent === "<img src=x>"));
      const link = nodes.find(n => n.tag === "a");
      assert.equal(link.href, "https://open.spotify.com/artist/" + id(1));
      assert.equal(link.rel, "noopener noreferrer");
      assert.equal(link.referrerPolicy, "no-referrer");
      assert.equal(link.target, "_blank");
      f.view.clear();
    }
  );

  await test("Manual pagination deduplicates; search covers loaded records",
    async () => {
      const calls = [];
      const f = fixture(async cursor => {
        calls.push(cursor);
        return cursor === null ? page([1], id(1)) : page([1, 2]);
      });
      await f.view.load();
      assert.deepEqual(calls, [null]);
      assert(!f.more.hidden);
      await f.view.load(true);
      assert.deepEqual(calls, [null, id(1)]);
      assert.equal(f.rows.children.length, 2);
      assert(f.more.hidden);
      f.search.value = "Artist 2";
      f.search.events.input();
      assert.equal(f.rows.children.length, 1);
      assert(f.status.textContent.includes("1 shown / 2"));
      f.view.clear();
    }
  );

  await test("Clear removes metadata and ignores late results", async () => {
    const pending = deferred();
    let calls = 0;
    const f = fixture(() => { calls++; return pending.promise; });
    const work = f.view.load();
    f.view.clear();
    pending.resolve(page());
    await work;
    assert.equal(f.rows.children.length, 0);
    assert.equal(f.status.textContent, "");
    assert.equal(f.host.children.length, 0);
    assert.equal(f.refresh.events.click, undefined);
    assert.equal(f.more.events.click, undefined);
    assert.equal(f.search.events.input, undefined);
    await f.view.load();
    assert.equal(calls, 1);
    f.view.clear();
  });

  await test("New refresh wins over old response", async () => {
    const old = deferred();
    let calls = 0;
    const f = fixture(() => ++calls === 1 ? old.promise : page([2]));
    const first = f.view.load();
    await f.view.load();
    old.resolve(page([1]));
    await first;
    const link = descendants(f.rows).find(n => n.tag === "a");
    assert(link.href.endsWith(id(2)));
    assert.equal(f.rows.children.length, 1);
    assert(!f.refresh.disabled);
    f.view.clear();
  });

  await test("Expiry delegates cleanup; failures do not retry or leak details",
    async () => {
      const expired = fixture(async () => ({status: "reauthorize"}));
      await expired.view.load();
      assert.equal(expired.expired(), 1);
      assert.equal(expired.host.children.length, 0);

      for (const state of [
        "restricted", "rate_limited", "cancelled", "failed"
      ]) {
        let calls = 0;
        const f = fixture(async () => {
          calls++;
          return {status: state, privateDetails: "PRIVATE"};
        });
        await f.view.load();
        assert.equal(calls, 1);
        assert(!f.status.textContent.includes("PRIVATE"));
        assert(!f.refresh.disabled);
        assert(f.more.hidden);
        f.view.clear();
      }

      const f = fixture(async () => { throw new Error("PRIVATE"); });
      await f.view.load();
      assert.equal(f.status.textContent,
        "Artists could not be loaded. Try Refresh.");
      f.view.clear();
    }
  );

  await test("Repeated cursor stops pagination; concurrent append is blocked",
    async () => {
      const pending = deferred();
      let calls = 0;
      const f = fixture(async () => {
        calls++;
        return calls === 1 ? page([1], id(1)) : pending.promise;
      });
      await f.view.load();
      const append = f.view.load(true);
      await f.view.load(true);
      assert.equal(calls, 2);
      pending.resolve(page([2], id(1)));
      await append;
      assert.equal(f.rows.children.length, 1);
      assert(f.more.hidden);
      assert.equal(f.status.textContent,
        "Artists could not be loaded. Try Refresh.");
      f.view.clear();
    }
  );

  await test("Scrolling loads one page and respects request boundaries",
    async () => {
      const pending = deferred();
      const calls = [];
      const f = fixture(cursor => {
        calls.push(cursor);
        return cursor === null
          ? Promise.resolve(page([1], id(1)))
          : pending.promise;
      });
      await f.view.load();

      f.host.clientHeight = 400;
      f.host.scrollHeight = 1200;
      f.host.scrollTop = 0;
      const scroll = f.host.events.scroll;
      assert.equal(typeof scroll, "function");

      // Not near the end.
      scroll();
      assert.equal(calls.length, 1);

      // Search must not silently fetch more account data.
      f.host.scrollTop = 750;
      f.search.value = "Artist";
      scroll();
      assert.equal(calls.length, 1);
      f.search.value = "";

      // Hidden collections must not fetch.
      f.host.hidden = true;
      scroll();
      assert.equal(calls.length, 1);
      f.host.hidden = false;

      // One near-bottom request; repeated scrolls cannot overlap it.
      scroll();
      scroll();
      assert.deepEqual(calls, [null, id(1)]);

      pending.resolve(page([2]));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.rows.children.length, 2);
      assert(f.more.hidden);

      // Terminal page stops further requests.
      scroll();
      assert.equal(calls.length, 2);
      f.view.clear();
      assert.equal(f.host.events.scroll, undefined);
      scroll();
      assert.equal(calls.length, 2);

      // A rate limit stops automatic loading; no scroll-driven retries.
      let reads = 0;
      const limited = fixture(async () => ++reads === 1
        ? page([1], id(1))
        : {status:"rate_limited"});
      await limited.view.load();
      limited.host.clientHeight = 400;
      limited.host.scrollHeight = 1200;
      limited.host.scrollTop = 750;
      limited.host.events.scroll();
      await new Promise(resolve => setImmediate(resolve));
      limited.host.events.scroll();
      assert.equal(reads, 2);
      assert(limited.more.hidden);
      assert(!limited.refresh.disabled);
      limited.view.clear();
    }
  );

  await test("Artist title opens releases; hidden panel pauses auto-loading",
    async () => {
      const host = new FakeNode("section");
      const selected = [], calls = [];
      const view = create(host, {
        readArtists: async cursor => {
          calls.push(cursor);
          return cursor === null ? page([1, 2], id(2)) : page([3]);
        }
      }, () => {}, (artist, trigger) => selected.push({artist, trigger}),
      () => {}, () => {});
      await view.load();
      const panel = host.children[0];
      const rows = panel.children[2];
      const card = rows.children.find(n =>
        descendants(n).some(c => c.textContent === "Artist 2"));
      const title = descendants(card).find(n =>
        n.className === "music-library-title");
      assert.equal(title.tag, "button");
      assert.equal(title.attrs["aria-label"], "View releases by Artist 2");
      // No separate text buttons: title, cover and one icon link only.
      assert(!descendants(card).some(n =>
        n.textContent === "View releases" || n.textContent === "Open in Spotify"));
      const link = descendants(card).find(n => n.tag === "a");
      assert.equal(link.attrs["aria-label"],
        "Open Artist 2 in Spotify (new tab)");
      assert.equal(link.rel, "noopener noreferrer");
      title.events.click();
      assert.equal(selected.length, 1);
      assert.equal(selected[0].artist.id, id(2));
      assert.equal(selected[0].trigger, title);

      // The coordinator hides this panel while releases are shown.
      panel.hidden = true;
      host.clientHeight = 400;
      host.scrollHeight = 1200;
      host.scrollTop = 750;
      host.events.scroll();
      assert.deepEqual(calls, [null]);
      panel.hidden = false;
      host.events.scroll();
      assert.deepEqual(calls, [null, id(2)]);
      view.clear();
    }
  );

  console.log(passed + " artist-renderer tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});