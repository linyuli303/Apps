"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function createSpotifyFocusView\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.events = {};
    this.hidden = false;
  }
  get firstElementChild() { return this.children[0] || null; }
  querySelector(selector) {
    assert.equal(selector,
      '.music-library-toolbar input[type="search"]');
    return this.searchInput || null;
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(n => n !== this);
    }
    this.parent = null;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  insertAdjacent(node, offset) {
    assert(this.parent);
    const parent = this.parent;
    node.remove();
    const index = parent.children.indexOf(this);
    node.parent = parent;
    parent.children.splice(index + offset, 0, node);
  }
  after(node) { this.insertAdjacent(node, 1); }
  before(node) { this.insertAdjacent(node, 0); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  removeEventListener(name, callback) {
    if (this.events[name] === callback) delete this.events[name];
  }
}

function fixture() {
  const root = new Node("main");
  const status = new Node("p");
  const playlists = new Node("section");
  playlists.hidden = true;
  root.append(status, playlists);
  const calls = [];
  const callbacks = [];
  const latestCalls = [];
  const artistHooks = {};
  artistHooks.songEvents = [];
  let expired = 0;
  const controller = {};
  const element = (tag, className, text) => {
    const node = new Node(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const create = new Function(
    "element", "$", "createSpotifyArtistView", "createSpotifyPlaylistView",
    "createSpotifyEmbedPlayer", "createSpotifyArtistReleaseView",
    "createSpotifyLatestView", "createSpotifyAlbumSongView", "createSpotifyPlaylistSongView",
    matches[0][0] + "\nreturn createSpotifyFocusView;"
  )(
    element,
    id => {
      assert(["spotify-status", "spotify-playlists"].includes(id));
      return id === "spotify-status" ? status : playlists;
    },
    (host, received, onReauthorize, onSelect, onRefresh, onLoaded) => {
      assert.equal(received, controller);
      assert.equal(typeof onSelect, "function");
      assert.equal(typeof onRefresh, "function");
      assert.equal(typeof onLoaded, "function");
      artistHooks.select = onSelect;
      artistHooks.refresh = onRefresh;
      artistHooks.loaded = onLoaded;
      callbacks.push(onReauthorize);
      calls.push("artists-create");
      return {
        load() { calls.push("artists-load"); return Promise.resolve(); },
        clear() { calls.push("artists-clear"); }
      };
    },
    (received, onReauthorize, playerHost, sharedPlayer, onBrowse, onRefresh) => {
      assert.equal(typeof onBrowse, "function");
      assert.equal(typeof onRefresh, "function");
      artistHooks.browsePlaylist = onBrowse;
      artistHooks.refreshPlaylists = onRefresh;
      assert.equal(received, controller);
      assert(playerHost, "Playlist view must receive a shared player host");
      assert.equal(playerHost.className, "music-shared-player");
      assert(sharedPlayer && typeof sharedPlayer.open === "function");
      callbacks.push(onReauthorize);
      calls.push("playlists-create");
      return {
        load() { calls.push("playlists-load"); playlists.hidden = false; },
        clear() {
          calls.push("playlists-clear");
          playlists.hidden = true;
          // Shared player cleanup belongs to the coordinator.
        }
      };
    },
    playerHost => {
      const fakePlayer = new Node("fake-player");
      playerHost.append(fakePlayer);
      return {
        open() { calls.push("player-open"); },
        dispose() {
          calls.push("player-dispose");
          fakePlayer.remove();
        }
      };
    },
    (releaseHost, received, onReauthorize, onPlay, onBrowseSongs) => {
      assert.equal(received, controller);
      assert.equal(typeof onPlay, "function");
      assert.equal(typeof onBrowseSongs, "function");
      artistHooks.browseRelease = onBrowseSongs;
      const panel = new Node("release-panel");
      releaseHost.append(panel);
      callbacks.push(onReauthorize);
      return {
        open() { calls.push("releases-open"); },
        close() { calls.push("releases-close"); },
        clear() {
          calls.push("releases-clear");
          panel.remove();
        }
      };
    },
    (latestHost, received, onReauthorize, onPlay, automatic, onBrowseSongs) => {
      assert.equal(received, controller);
      assert.equal(typeof onReauthorize, "function");
      assert.equal(typeof onPlay, "function");
      assert.equal(automatic, true);
      assert.equal(typeof onBrowseSongs, "function");
      artistHooks.browseLatest = onBrowseSongs;
      artistHooks.playLatest = onPlay;
      return {
        setArtists(ids) {
          latestCalls.push({action:"artists", ids:[...ids]});
        },
        cancel() { latestCalls.push({action:"cancel"}); },
        clear() { latestCalls.push({action:"clear"}); }
      };
    },
    (songHost, received, onReauthorize, onPlay) => {
      assert.equal(received, controller);
      assert.equal(typeof onReauthorize, "function");
      assert.equal(typeof onPlay, "function");
      artistHooks.playSong = onPlay;
      artistHooks.songReauthorize = onReauthorize;
      return {
        open(album, trigger) {
          artistHooks.songEvents.push({action:"open", album, trigger});
        },
        close(restoreFocus) {
          artistHooks.songEvents.push({action:"close", restoreFocus});
        },
        clear() {
          artistHooks.songEvents.push({action:"clear"});
        }
      };
    },
    (playlistSongHost, received, onReauthorize, onPlay) => {
      assert.equal(received, controller);
      assert.equal(typeof onReauthorize, "function");
      assert.equal(typeof onPlay, "function");
      artistHooks.playPlaylistSong = onPlay;
      artistHooks.playlistExpiry = onReauthorize;
      artistHooks.playlistSongEvents = [];
      return {
        open(item, trigger) {
          artistHooks.playlistSongEvents.push({action:"open", item, trigger});
        },
        close(restoreFocus) {
          artistHooks.playlistSongEvents.push({action:"close", restoreFocus});
        },
        clear() {
          artistHooks.playlistSongEvents.push({action:"clear"});
        }
      };
    }
  );
  const make = () => create(controller, () => { expired++; });
  const view = make();
  const host = root.children.find(n => n.className === "music-focus");
  const [nav, artistHost, libraryHost] = host.children;
  const [searchButton, artistsButton, libraryButton] = nav.children;
  return {
    root, status, playlists, calls, callbacks, latestCalls, artistHooks, view, host,
    artistHost, libraryHost, searchButton, artistsButton, libraryButton,
    make, expired: () => expired
  };
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log("PASS: " + name);
}

(async () => {
  await test("Construction creates views without loading account data", () => {
    const f = fixture();
    assert.deepEqual(f.calls, ["artists-create", "playlists-create"]);
    assert(f.host.hidden);
    assert.equal(f.playlists.parent, f.libraryHost);
    assert.equal(f.artistsButton.attrs["aria-controls"], f.artistHost.id);
    assert.equal(f.libraryButton.attrs["aria-controls"], f.libraryHost.id);
    f.view.clear();
  });

  await test("Initial load selects followed artists only", async () => {
    const f = fixture();
    await f.view.load();
    assert(!f.host.hidden);
    assert(!f.artistHost.hidden);
    assert(f.libraryHost.hidden);
    assert.equal(f.artistsButton.attrs["aria-pressed"], "true");
    assert.equal(f.libraryButton.attrs["aria-pressed"], "false");
    assert.equal(f.calls.filter(x => x === "artists-load").length, 1);
    assert(!f.calls.includes("playlists-load"));
    f.view.clear();
  });

  await test("Library loads once; section switching does not clear views", async () => {
    const f = fixture();
    await f.view.load();
    f.libraryButton.events.click();
    assert(f.artistHost.hidden);
    assert(!f.libraryHost.hidden);
    assert.equal(f.libraryButton.attrs["aria-pressed"], "true");
    const sharedHost = f.host.children[3];
    const player = sharedHost.children[0];
    assert.equal(sharedHost.parent, f.host);
    assert.notEqual(sharedHost, f.libraryHost);
    assert.notEqual(sharedHost, f.artistHost);
    assert(player);

    f.artistsButton.events.click();
    assert(f.libraryHost.hidden);
    assert(!sharedHost.hidden);
    assert.equal(player.parent, sharedHost);

    f.libraryButton.events.click();
    assert(!sharedHost.hidden);
    assert.equal(sharedHost.children[0], player);
    assert.equal(f.calls.filter(x => x === "playlists-load").length, 1);
    assert.equal(f.calls.filter(x => x === "artists-load").length, 1);
    assert(!f.calls.some(x => x.endsWith("-clear")));
    f.view.clear();
  });

  await test("Clear disposes both views and restores playlist DOM", async () => {
    const f = fixture();
    await f.view.load();
    const savedLibraryClick = f.libraryButton.events.click;
    f.view.clear();
    f.view.clear();
    await f.view.load();
    savedLibraryClick();

    assert.equal(f.calls.filter(x => x === "artists-clear").length, 1);
    assert.equal(f.calls.filter(x => x === "playlists-clear").length, 1);
    assert.equal(f.calls.filter(x => x === "releases-clear").length, 1);
    assert.equal(f.calls.filter(x => x === "player-dispose").length, 1);
    assert(!f.calls.includes("playlists-load"));
    assert.equal(f.artistsButton.events.click, undefined);
    assert.equal(f.libraryButton.events.click, undefined);
    assert.deepEqual(f.root.children, [f.status, f.playlists]);
    assert(f.playlists.hidden);

    const replacement = f.make();
    await replacement.load();
    assert.equal(f.calls.filter(x => x === "artists-load").length, 2);
    replacement.clear();
    assert.deepEqual(f.root.children, [f.status, f.playlists]);
  });

  await test("Both views receive the session-expiry cleanup callback", () => {
    const f = fixture();
    assert.equal(f.callbacks.length, 3);
    f.callbacks[0]();
    f.callbacks[1]();
    f.callbacks[2]();
    assert.equal(f.expired(), 3);
    f.view.clear();
  });

  await test("Search focuses the selected collection without loading data",
    async () => {
      const f = fixture();
      await f.view.load();

      const focusCalls = [];
      function input(name) {
        return {
          focus() { focusCalls.push(name + "-focus"); },
          scrollIntoView(options) {
            assert.equal(options.block, "nearest");
            assert.equal(options.behavior, "auto");
            focusCalls.push(name + "-scroll");
          }
        };
      }

      f.artistHost.searchInput = input("artists");
      f.libraryHost.searchInput = input("playlists");

      assert.equal(f.searchButton.textContent, "Search");
      assert.equal(f.artistsButton.textContent, "Artists");
      assert.equal(f.libraryButton.textContent, "Playlists");

      const beforeArtistSearch = [...f.calls];
      f.searchButton.events.click();
      assert.deepEqual(f.calls, beforeArtistSearch);
      assert.deepEqual(focusCalls, ["artists-focus", "artists-scroll"]);
      assert.equal(f.artistsButton.attrs["aria-pressed"], "true");

      f.libraryButton.events.click();
      const beforePlaylistSearch = [...f.calls];
      f.searchButton.events.click();
      assert.deepEqual(f.calls, beforePlaylistSearch);
      assert.deepEqual(focusCalls.slice(-2),
        ["playlists-focus", "playlists-scroll"]);
      assert.equal(f.libraryButton.attrs["aria-pressed"], "true");

      // Missing search fields must be harmless.
      f.libraryHost.searchInput = null;
      f.searchButton.events.click();
      assert.deepEqual(f.calls, beforePlaylistSearch);

      const savedClick = f.searchButton.events.click;
      const focusCount = focusCalls.length;
      f.view.clear();
      assert.equal(f.searchButton.events.click, undefined);
      savedClick();
      assert.equal(focusCalls.length, focusCount);
    }
  );

  await test("Overview receives loaded artists and shares playback safely",
    async () => {
      const f = fixture();
      await f.view.load();

      // Construction and initial artist load do not load overview releases.
      assert.deepEqual(f.latestCalls, []);

      const ids = ["A".repeat(22), "B".repeat(22)];
      f.artistHooks.loaded(ids);
      assert.deepEqual(f.latestCalls.at(-1), {action:"artists", ids});

      f.artistHooks.refresh();
      assert.deepEqual(f.latestCalls.at(-1), {action:"artists", ids:[]});
      assert(f.calls.includes("releases-close"));

      f.artistHooks.loaded(ids);
      f.artistHooks.select({id:ids[0], name:"Sample"}, {});
      assert.equal(f.latestCalls.at(-1).action, "cancel");
      assert(f.calls.includes("releases-open"));

      f.artistHooks.playLatest({id:"C".repeat(22), type:"album"}, {});
      assert.equal(f.calls.filter(x => x === "player-open").length, 1);

      f.libraryButton.events.click();
      assert.equal(f.latestCalls.at(-1).action, "cancel");

      f.view.clear();
      assert.equal(
        f.latestCalls.filter(x => x.action === "clear").length, 1
      );
      const count = f.calls.filter(x => x === "player-open").length;
      f.artistHooks.playLatest({id:"D".repeat(22), type:"album"}, {});
      assert.equal(
        f.calls.filter(x => x === "player-open").length, count
      );
    }
  );

  await test("Album browsing callbacks use the song view and shared player",
    async () => {
      const f = fixture();
      await f.view.load();

      const album = {
        id:"E".repeat(22), type:"album",
        name:"Sample album", releaseDate:"2025-06"
      };
      const trigger = {};

      // Overview cards and individual artist releases share the same action.
      f.artistHooks.browseLatest(album, trigger);
      assert.deepEqual(f.artistHooks.songEvents.at(-1), {
        action:"open", album, trigger
      });
      assert.equal(f.latestCalls.at(-1).action, "cancel");

      const secondAlbum = {...album, id:"F".repeat(22)};
      f.artistHooks.browseRelease(secondAlbum, trigger);
      assert.equal(f.artistHooks.songEvents.at(-1).album, secondAlbum);

      // Browsing itself must not create another player or select playback.
      assert.equal(f.calls.filter(x => x === "player-open").length, 0);

      f.artistHooks.playSong({
        id:"G".repeat(22), type:"track", name:"Sample song"
      }, trigger);
      assert.equal(f.calls.filter(x => x === "player-open").length, 1);

      // Changing artist and refreshing the collection close stale song views.
      f.artistHooks.select({id:"H".repeat(22), name:"Artist"}, trigger);
      assert.deepEqual(f.artistHooks.songEvents.at(-1), {
        action:"close", restoreFocus:false
      });

      f.artistHooks.refresh();
      assert.deepEqual(f.artistHooks.songEvents.at(-1), {
        action:"close", restoreFocus:false
      });

      // Switching to playlists closes songs without disposing the player.
      const disposals = f.calls.filter(x => x === "player-dispose").length;
      f.libraryButton.events.click();
      assert.deepEqual(f.artistHooks.songEvents.at(-1), {
        action:"close", restoreFocus:false
      });
      assert.equal(
        f.calls.filter(x => x === "player-dispose").length, disposals
      );

      // The song view receives the same session-expiry notification.
      f.artistHooks.songReauthorize();
      assert.equal(f.expired(), 1);

      f.view.clear();
      f.view.clear();
      assert.equal(
        f.artistHooks.songEvents.filter(x => x.action === "clear").length,
        1
      );

      // Late callbacks cannot reopen songs or start playback after disposal.
      const songEvents = f.artistHooks.songEvents.length;
      const plays = f.calls.filter(x => x === "player-open").length;
      f.artistHooks.browseLatest(album, trigger);
      f.artistHooks.browseRelease(album, trigger);
      f.artistHooks.playSong({id:"G".repeat(22), type:"track"}, trigger);
      assert.equal(f.artistHooks.songEvents.length, songEvents);
      assert.equal(
        f.calls.filter(x => x === "player-open").length, plays
      );
    }
  );

  await test("Playlist browsing shares playback and cleans up safely", async () => {
    const f = fixture();
    await f.view.load();
    f.libraryButton.events.click();

    const playlist = {
      id:"P".repeat(22), name:"Saved playlist"
    };
    const trigger = {};

    f.artistHooks.browsePlaylist(playlist, trigger);
    assert.deepEqual(f.artistHooks.playlistSongEvents.at(-1), {
      action:"open", item:playlist, trigger
    });
    assert.equal(f.calls.filter(x => x === "player-open").length, 0);

    f.artistHooks.playPlaylistSong({
      id:"T".repeat(22), type:"track", name:"Song"
    }, trigger);
    assert.equal(f.calls.filter(x => x === "player-open").length, 1);

    f.artistHooks.refreshPlaylists();
    assert.deepEqual(f.artistHooks.playlistSongEvents.at(-1), {
      action:"close", restoreFocus:false
    });

    f.artistsButton.events.click();
    assert.deepEqual(f.artistHooks.playlistSongEvents.at(-1), {
      action:"close", restoreFocus:false
    });
    assert.equal(f.calls.filter(x => x === "player-dispose").length, 0);

    f.artistHooks.playlistExpiry();
    assert.equal(f.expired(), 1);

    f.view.clear();
    f.view.clear();
    assert.equal(
      f.artistHooks.playlistSongEvents.filter(x => x.action === "clear").length,
      1
    );

    const events = f.artistHooks.playlistSongEvents.length;
    const plays = f.calls.filter(x => x === "player-open").length;
    f.artistHooks.browsePlaylist(playlist, trigger);
    f.artistHooks.playPlaylistSong({id:"T".repeat(22), type:"track"}, trigger);
    assert.equal(f.artistHooks.playlistSongEvents.length, events);
    assert.equal(f.calls.filter(x => x === "player-open").length, plays);
  });

  console.log(passed + " focus-coordinator tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});