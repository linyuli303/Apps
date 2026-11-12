
"use strict";
function fixture() {
  let episode = {id:"one", mediaUrl:"https://example.org/one.mp3"};
  let generation = 0;
  const speed = 1.5;
  let notice = "none";
  let status = "";
  class FakeAudio {
    constructor() {
      this.attrs = {};
      this.listeners = {};
      this.paused = true;
      this.currentTime = 0;
      this.duration = 100;
      this.volume = 0.4;
      this.muted = false;
      this.error = null;
      this.loads = 0;
      this.plays = 0;
      this.rejectPlay = false;
      this.order = [];
    }
    set crossOrigin(value) {
      this.attrs.crossorigin = value;
      this.order.push("cors:" + value);
    }
    set src(value) {
      this.attrs.src = value;
      this.order.push("src");
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    addEventListener(name, callback) {
      (this.listeners[name] ||= new Set()).add(callback);
    }
    removeEventListener(name, callback) {
      this.listeners[name]?.delete(callback);
    }
    emit(name) {
      for (const callback of [...(this.listeners[name] || [])]) callback();
    }
    pause() { this.paused = true; }
    load() {
      this.loads++;
      this.error = null;
      this.currentTime = 0;
    }
    play() {
      this.plays++;
      if (this.rejectPlay) return Promise.reject(new Error("blocked"));
      this.paused = false;
      return Promise.resolve();
    }
  }
  const audio = new FakeAudio();
  const active = () => episode;
  const safeMedia = value => value === episode;
  const sync = () => {};
  const message = value => { status = value; };
  const reportPodcastPrivacy = value => { notice = value; };
/* MYAPPS_CURRENT_PLAYBACK_FUNCTIONS */
  return {
    audio,
    begin() {
      clearSource();
      loadPodcastAttempt(privacyPolicy.begin(episode.id));
    },
    fail(code) {
      audio.error = {code};
      audio.emit("error");
    },
    toggle,
    pause:pausePodcast,
    close:clearSource,
    changeEpisode() {
      episode = {id:"two", mediaUrl:"https://example.org/two.mp3"};
      this.begin();
    },
    position(value) {
      audio.currentTime = value;
      audio.emit("timeupdate");
    },
    notice:() => notice,
    status:() => status,
  };
}
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
const results = [];
async function test(name, run) {
  try {
    await run(fixture());
    results.push("PASS: " + name);
  } catch (error) {
    results.push("FAIL: " + name + " — " + error.message);
  }
}
(async () => {
  await test("Anonymous attribute is set before assigning source", f => {
    f.begin();
    assert(f.audio.getAttribute("crossorigin") === "anonymous");
    assert(f.audio.order.indexOf("cors:anonymous") < f.audio.order.indexOf("src"));
    assert(f.notice() === "anonymous");
  });

  await test("One standard fallback, never repeated", f => {
    f.begin();
    f.fail(4);
    assert(f.audio.getAttribute("crossorigin") === null);
    assert(f.notice() === "standard");
    const loads = f.audio.loads;
    f.fail(2);
    assert(f.audio.loads === loads);
    assert(f.status().includes("No further automatic retry"));
  });

  await test("Pause prevents automatic fallback", f => {
    f.begin();
    f.pause();
    const loads = f.audio.loads;
    f.fail(2);
    assert(f.audio.loads === loads);
    assert(f.notice() === "anonymous");
  });

  await test("Close removes listeners and prevents restart", async f => {
    f.begin();
    f.close();
    const loads = f.audio.loads;
    const plays = f.audio.plays;
    f.fail(4);
    await Promise.resolve();
    assert(f.audio.loads === loads && f.audio.plays === plays);
    assert(f.audio.getAttribute("src") === null);
    assert(f.notice() === "none");
  });

  await test("Old captured error callback cannot retry new episode", f => {
    f.begin();
    const old = [...f.audio.listeners.error][0];
    f.changeEpisode();
    const loads = f.audio.loads;
    f.audio.error = {code:4};
    old();
    assert(f.audio.loads === loads);
    assert(f.audio.getAttribute("crossorigin") === "anonymous");
  });

  await test("Autoplay rejection alone does not trigger fallback", async f => {
    f.audio.rejectPlay = true;
    f.begin();
    await Promise.resolve();
    await Promise.resolve();
    assert(f.notice() === "anonymous");
    assert(f.audio.getAttribute("crossorigin") === "anonymous");
    assert(f.audio.plays === 1);
  });

  await test("Fallback restores position, speed and volume", f => {
    f.begin();
    f.position(25);
    f.fail(2);
    f.audio.emit("loadedmetadata");
    assert(f.audio.currentTime === 25);
    assert(f.audio.playbackRate === 1.5);
    assert(f.audio.volume === 0.4 && !f.audio.muted);
  });

  await test("Pause during fallback metadata wait prevents restart", f => {
    f.begin();
    f.position(25);
    f.fail(4);
    f.pause();
    const plays = f.audio.plays;
    f.audio.emit("loadedmetadata");
    assert(f.audio.plays === plays);
  });

  await test("Explicit retry after Play rejection works on first tap", async f => {
    f.audio.rejectPlay = true;
    f.begin();
    await Promise.resolve();
    await Promise.resolve();
    f.audio.rejectPlay = false;
    const plays = f.audio.plays;
    f.toggle();
    await Promise.resolve();
    assert(f.audio.plays === plays + 1);
    assert(f.notice() === "anonymous");
  });

  await test("Immediate nonzero-position fallback loading", f => {
    f.begin();
    f.position(25);
    const plays = f.audio.plays;
    f.fail(2);
    assert(f.notice() === "standard");
    assert(f.audio.plays === plays + 1);
    // Metadata has not been emitted: Play must already initiate loading.
    assert(f.audio.currentTime === 0);
  });

  await test("Repeated metadata restores position only once", f => {
    f.begin();
    f.position(25);
    f.fail(4);
    f.audio.emit("loadedmetadata");
    assert(f.audio.currentTime === 25);
    f.position(40);
    const plays = f.audio.plays;
    f.audio.emit("loadedmetadata");
    assert(f.audio.currentTime === 40);
    assert(f.audio.plays === plays);
  });

  await test("Metadata after Pause neither resumes nor issues Play", f => {
    f.begin();
    f.position(25);
    f.fail(4);
    f.pause();
    const plays = f.audio.plays;
    f.audio.emit("loadedmetadata");
    f.audio.emit("loadedmetadata");
    assert(f.audio.paused);
    assert(f.audio.plays === plays);
  });

  await test("Play rejection before media error still permits one fallback", async f => {
    // Model a media-source failure whose promise rejection arrives first.
    f.audio.play = function () {
      this.plays++;
      this.paused = true;
      const error = new Error("Source unavailable");
      error.name = "NotSupportedError";
      return Promise.reject(error);
    };
    f.begin();
    await Promise.resolve();
    await Promise.resolve();

    // Now deliver the browser's media error event.
    f.fail(4);
    assert(f.notice() === "standard");
    assert(f.audio.getAttribute("crossorigin") === null);
  });

  const failed = results.filter(x => x.startsWith("FAIL:")).length;
  document.getElementById("results").textContent =
    results.join("\n") + "\n\n" +
    (failed ? failed + " failed" : (results.length + " passed; 0 failed"));
})();
