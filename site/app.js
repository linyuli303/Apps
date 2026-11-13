// Privacy default: page-memory preferences.
// For enforced anti-framing, use the documented HTTP response headers on a capable host.
"use strict";

// Synchronous callback cleanup precedes feed loading and application routing.
// Function declarations below are hoisted; no storage or token exchange here.
const SPOTIFY_STARTUP_CALLBACK = captureSpotifyStartupCallback({
  readURL:() => window.location.href,
  replaceURL:url => window.history.replaceState(null, "", url),
});
if (SPOTIFY_STARTUP_CALLBACK.status === "failed") {
  // Stop initialization rather than propagate authorization material.
  throw new Error("Spotify callback cleanup failed. Reopen MyApps using its clean URL.");
}
const SHARED_CATEGORY_SNAPSHOT = null; // Replaced only in the published artifact.
const $ = (id) => document.getElementById(id);
let feed = null,
  visible = [],
  current = null,
  returnFocus = null;
let page = 0,
  enabledIDs = new Set();
const PAGE_SIZE = 48,
  MAX_FEED_AGE_MS = 24 * 60 * 60 * 1000;
const safeID = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
const dateLabel = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
};
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
// Shared asset root remains stable during History API navigation.
const MYAPPS_ROOT = new URL(".", document.currentScript.src);

async function load() {
  $("refresh").disabled = true;
  $("status").textContent = "Loading approved feed…";
  try {
    const response = await fetch(new URL("data/feed.json", MYAPPS_ROOT), { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("Feed unavailable");
    const raw = await response.text();
    if (raw.length > 25000000) throw new Error("Feed too large");
    const data = JSON.parse(raw);
    if (!freshFeed(data)) throw new Error("Expired feed");
    if (
      !Array.isArray(data.channels) ||
      !Array.isArray(data.videos) ||
      data.channels.length > 1000 ||
      data.videos.length > 50000 ||
      typeof data.title !== "string" ||
      typeof data.generatedAt !== "string"
    )
      throw new Error("Invalid feed");
    if (
      data.channels.some(
        (c) =>
          !c ||
          typeof c.id !== "string" ||
          !/^UC[A-Za-z0-9_-]{22}$/.test(c.id) ||
          typeof c.title !== "string",
      )
    )
      throw new Error("Invalid channels");
    const allowed = new Set(data.channels.map((c) => c.id));
    // Enforce whitelist again in the browser; never fall back to an unfiltered feed.
    data.videos = data.videos.filter(
      (v) =>
        v &&
        allowed.has(v.channelId) &&
        safeID(v.id) &&
        typeof v.title === "string" &&
        typeof v.publishedAt === "string",
    );
    feed = data;
    initializeDraft(data);
    $("title").textContent = "MyApps";
    document.title = "MyApps";
    const previous = $("channel").value;
    $("channel").replaceChildren(new Option("All approved channels", ""));
    data.channels
      .filter((c) => draftAllows(c.id))
      .forEach((c) => $("channel").append(new Option(c.title, c.id)));
    if (allowed.has(previous)) $("channel").value = previous;
    closePlayer();
    render();
    renderManager();
  } catch (error) {
    closePlayer();
    feed = null;
    visible = [];
    $("grid").replaceChildren();
    $("empty").hidden = true;
    renderManager();
    $("status").textContent =
      "Feed unavailable, invalid, or expired (24-hour limit). Run the GitHub publish workflow, check its logs, then refresh. Playback is blocked; no fallback is loaded.";
  } finally {
    $("refresh").disabled = false;
  }
}
function render() {
  if (!feed) return;
  if (!freshFeed(feed)) {
    expireFeed();
    return;
  }
  const query = $("search").value.trim().toLocaleLowerCase();
  const channels = new Map(feed.channels.map((c) => [c.id, c.title]));
  visible = feed.videos.filter(
    (v) =>
      draftAllows(v.channelId) &&
      categoryAllows(v.channelId) &&
      (!$("channel").value || v.channelId === $("channel").value) &&
      `${v.title} ${channels.get(v.channelId)}`
        .toLocaleLowerCase()
        .includes(query),
  );
  visible.sort((a, b) =>
    $("sort").value === "title"
      ? a.title.localeCompare(b.title)
      : $("sort").value === "old"
        ? a.publishedAt.localeCompare(b.publishedAt)
        : b.publishedAt.localeCompare(a.publishedAt),
  );
  render.navigationVideos = visible.slice();
  visible = visible.filter(shortVideoAllows);
  updatePlaybackNavigation();
  const fragment = document.createDocumentFragment();
  const thumbnails = $("thumbnails").checked;
  $("grid").classList.toggle("plain-feed", !thumbnails);
  $("grid").setAttribute(
    "aria-label",
    thumbnails ? "Approved video cards" : "Approved videos: text feed",
  );
  page = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1));
  visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((v) => {
    const card = element("button", "card");
    card.type = "button";
    card.dataset.video = v.id;

    if (thumbnails) {
      const img = element("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
      const body = element("span", "card-body");
      body.append(
        element("span", "card-title", v.title),
        element(
          "span",
          "meta",
          `${channels.get(v.channelId)} ? ${dateLabel(v.publishedAt)}`,
        ),
      );
      card.append(img, body);
    } else {
      const date = element("time", "text-feed-date", dateLabel(v.publishedAt));
      date.dateTime = v.publishedAt;
      date.title = v.publishedAt;

      let count = "Unavailable";
      if (
        typeof v.viewCount === "string" &&
        /^[0-9]{1,20}$/.test(v.viewCount)
      ) {
        try {
          count = BigInt(v.viewCount).toLocaleString();
        } catch {
          count = v.viewCount;
        }
      }
      const views = element(
        "span", "text-feed-views",
        count === "Unavailable" ? count : `${count} views`,
      );
      views.title = count === "Unavailable"
        ? "View count unavailable in this snapshot"
        : `${count} views at the last successful refresh`;

      card.append(
        date,
        element("span", "text-feed-channel", channels.get(v.channelId)),
        element("span", "text-feed-title", v.title),
        views,
      );
    }

    const categoryModel = categoryState().model;
    const assignedTags = new Set(categoryModel.assignments[v.channelId] || []);
    const badges = element("span", "video-category-tags");
    for (const category of categoryModel.categories) {
      if (assignedTags.has(category.id)) badges.append(element("span", "video-category-tag", category.name));
    }
    if (badges.childElementCount) {
      const host = thumbnails ? card.querySelector(".card-body") : card;
      if (host) host.append(badges);
    }
    const durationHost = thumbnails ? card.querySelector(".meta") : viewsForDuration(card);
    if (durationHost) durationHost.append(element("span", "feed-duration", " | " + playbackDurationLabel(v.duration)));
    card.setAttribute("aria-label", `${v.title} - Play inside MyTube`);
    card.title = `${v.title} - Play inside MyTube`;
    card.addEventListener("click", () => openPlayer(v.id));
    fragment.append(card);
  });
  $("grid").replaceChildren(fragment);
  $("page-prev").disabled = page === 0;
  $("page-next").disabled = (page + 1) * PAGE_SIZE >= visible.length;
  $("page-status").textContent =
    `Page ${page + 1} of ${Math.max(1, Math.ceil(visible.length / PAGE_SIZE))}`;
  $("empty").hidden = visible.length > 0;
  if (!feed.channels.length) {
    $("empty").textContent =
      "Your whitelist is empty. Convert your Takeout CSV locally, review channels.json, commit only that JSON, and run the publish workflow.";
  } else
    $("empty").textContent =
      "No matching playable videos in this snapshot. Try another filter or wait for the next refresh.";
  $("status").textContent =
    `${visible.length} videos · ${feed.channels.filter((c) => draftAllows(c.id)).length} enabled published channels · Feed built ${dateLabel(feed.generatedAt)} ${new Date(feed.generatedAt).toLocaleTimeString()}`;
  renderPlayerFeed();
}
function openOfficialVideo(id) {
  if (!feed || !freshFeed(feed)) {
    expireFeed();
    return;
  }
  if (!safeID(id)) return;
  const video = feed.videos.find(
    (v) =>
      v.id === id &&
      feed.channels.some((c) => c.id === v.channelId),
  );
  if (!video || !draftAllows(video.channelId)) return;

  window.open(
    `https://www.youtube.com/watch?v=${id}`,
    "_blank",
    "noopener,noreferrer",
  );
}
function syncKinoControls() {
  const kino = $("player").classList.contains("kino");
  $("kino-toggle").textContent = kino ? "Exit Kino" : "Kino mode";
  $("kino-toggle").setAttribute("aria-pressed", String(kino));
}

function openPlayer(id) {
  closePlayerFeed(false);
  if (window.MyAppsPodcastPlayer) window.MyAppsPodcastPlayer.pauseForVideo();
  const video =
    feed &&
    feed.videos.find(
      (v) => v.id === id && feed.channels.some((c) => c.id === v.channelId),
    );
  if (!feed || !freshFeed(feed)) {
    expireFeed();
    return;
  }
  if (!video || !safeID(id) || !draftAllows(video.channelId)) return;
  if ($("player").hidden) {
    returnFocus = document.activeElement;
    $("player").classList.add("kino");
  }
  syncKinoControls();
  $("playback-mode-status").textContent = "";
  current = id;
  closePlayerCategories(false);
  renderPlayerCategories();
  resetTubeExtrasForVideo(video);
  $("playing-title").textContent = video.title;
  $("official").href = `https://www.youtube.com/watch?v=${id}`;
  stopSpeedController();
  const iframe = document.createElement("iframe");
  iframe.id = "mytube-video-iframe";
  const params = new URLSearchParams({
    autoplay: "1",
    enablejsapi: "1",
    rel: "0",
    playsinline: "1",
    origin: location.origin,
  });
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?${params}`;
  iframe.title = video.title;
  iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  $("frame").replaceChildren(iframe);
  $("player").hidden = false;
  document.querySelector("main").inert = true;
  $("rss-catalogue").inert = true;
  document.body.style.overflow = "hidden";
  $("close").focus();
  updatePlaybackNavigation();
  attachSpeedController(iframe, id);
}
function closePlayer() {
  closePlayerFeed(false);
  closePlayerCategories(false);
  stopSpeedController();
  const wasOpen = !$("player").hidden;
  if (document.fullscreenElement === $("frame")) {
    document.exitFullscreen().catch(() => {});
  }
  $("frame").replaceChildren();
  $("player").hidden = true;
  current = null;
  document.querySelector("main").inert = false;
  $("rss-catalogue").inert = false;
  document.body.style.overflow = "";
  if (wasOpen && returnFocus && returnFocus.isConnected) returnFocus.focus();
}
$("close").addEventListener("click", closePlayer);
$("kino-toggle").addEventListener("click", () => {
  $("player").classList.toggle("kino");
  syncKinoControls();
});
$("player-fullscreen").addEventListener("click", async () => {
  closePlayerFeed(false);
  const frame = $("frame");
  const iframe = frame.querySelector("iframe");
  if (!iframe) {
    $("playback-mode-status").textContent =
      "Select a video again before entering fullscreen.";
    return;
  }
  closePlayerCategories(false);
  try {
    if (!frame.requestFullscreen) throw new Error("Unsupported");
    await frame.requestFullscreen();
    iframe.focus();
  } catch {
    $("playback-mode-status").textContent =
      "Browser fullscreen is unavailable. Try the YouTube player's fullscreen control.";
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !$("player").hidden) {
    $("player-fullscreen").focus();
  }
});
$("official").addEventListener("click", () => {
  closePlayerFeed(false);
  // Stop embedded playback while allowing normal external link navigation.
  stopSpeedController();
  $("frame").replaceChildren();
});
$("next").addEventListener("click", () => navigateApprovedVideo(1));
$("refresh").addEventListener("click", load);
$("search").addEventListener("input", () => {
  page = 0;
  render();
});
$("channel").addEventListener("change", () => {
  page = 0;
  render();
});
$("sort").addEventListener("change", () => {
  page = 0;
  render();
});
$("thumbnails").addEventListener("change", render);
document.addEventListener("keydown", (event) => {
  if ($("category-editor")?.open || $("category-review")?.open ||
      $("configuration-dialog")?.open || $("whitelist-dialog")?.open || $("podcast-config-dialog")?.open) return;
  if (!$("player").hidden) {
    if (document.fullscreenElement) return;
    if (!$("player-feed-panel").hidden &&
        (event.key === "Escape" || event.key === "BrowserBack" ||
         event.keyCode === 10009 || event.keyCode === 461)) {
      event.preventDefault();
      closePlayerFeed(true);
      return;
    }
    if (
      !$("player-category-panel").hidden &&
      (
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461
      )
    ) {
      event.preventDefault();
      closePlayerCategories(true);
      return;
    }
    if (
      event.key === "Escape" ||
      event.key === "BrowserBack" ||
      event.keyCode === 10009 ||
      event.keyCode === 461
    ) {
      event.preventDefault();
      closePlayer();
    }
    if (event.key === "Tab") {
      const controls = [
        $("frame").querySelector("iframe"),
        $("kino-toggle"),
        $("player-fullscreen"),
        $("official"),
        $("previous"),
        $("next"),
        $("loop-video"),
        $("auto-next"),
        $("player-appearance"),
        $("speed-preset"),
        $("speed-slider"),
        $("tube-description-toggle"), $("tube-captions"), $("tube-mute"), $("tube-volume"),
        ...Array.from(document.querySelectorAll(".tube-popover:not([hidden]) button, .tube-popover:not([hidden]) input, .tube-popover:not([hidden]) a")),
        $("tube-preview-config"),
        $("skip-short-videos"),
        $("player-category-toggle"),
        ...(
          $("player-category-panel").hidden ? [] :
          [
            ...$("player-category-options").querySelectorAll("input"),
            $("player-category-save"),
            $("player-category-done"),
          ]
        ),
        $("player-feed-toggle"),
        $("close"),
        ...($("player-feed-panel").hidden ? [] :
          Array.from($("player-feed-panel").querySelectorAll("button"))),
      ].filter((el) => el && !el.disabled).sort((a, b) =>
        a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === controls[controls.length - 1]
      ) {
        event.preventDefault();
        controls[0].focus();
      }
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
      !["IFRAME", "SELECT", "INPUT", "TEXTAREA"].includes(
        document.activeElement.tagName,
      )
    ) {
      event.preventDefault();
      if (event.key === "ArrowDown")
        $("frame").querySelector("iframe")?.focus();
      else if (event.key === "ArrowUp" || $("next").disabled)
        $("close").focus();
      else
        (document.activeElement === $("close")
          ? $("next")
          : $("close")
        ).focus();
    }
    return;
  }
  const card = document.activeElement.closest(".card");
  if (
    !card ||
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  )
    return;
  event.preventDefault();
  const cards = Array.from($("grid").children);
  const index = cards.indexOf(card);
  const rect = card.getBoundingClientRect();
  let best = null,
    score = Infinity;
  for (let i = 0; i < cards.length; i++) {
    if (i === index) continue;
    const r = cards[i].getBoundingClientRect();
    const dx = r.left - rect.left,
      dy = r.top - rect.top;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const forward =
      event.key === "ArrowLeft"
        ? dx < -5
        : event.key === "ArrowRight"
          ? dx > 5
          : event.key === "ArrowUp"
            ? dy < -5
            : dy > 5;
    if (!forward) continue;
    const s = horizontal
      ? Math.abs(dx) + Math.abs(dy) * 10
      : Math.abs(dy) + Math.abs(dx) * 2;
    if (s < score) {
      score = s;
      best = cards[i];
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest" });
  }
});

// Local draft only: no credential storage, write API, or public mutation endpoint.
const STORAGE_SCOPE = encodeURIComponent(
  MYAPPS_ROOT.pathname,
);
const DRAFT_KEY = "approved-yt-whitelist-v2:" + STORAGE_SCOPE;
const REPO_KEY = "approved-yt-repository-v2:" + STORAGE_SCOPE;
let draft = null,
  baseSignature = "",
  managerNotice = "";
function parseChannel(value) {
  if (typeof value !== "string" || value.length > 240)
    throw new Error("Invalid channel input.");
  let input = value.trim();
  if (/^https?:\/\//i.test(input)) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error("Invalid channel URL.");
    }
    if (
      ![
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !["https:", "http:"].includes(url.protocol)
    )
      throw new Error(
        "Use a plain YouTube channel URL without query parameters.",
      );
    let path;
    try {
      path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    } catch {
      throw new Error("Invalid URL encoding.");
    }
    if (/^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(path)) input = path.slice(9);
    else if (/^\/@[^/]+$/.test(path))
      throw new Error(
        "Resolve this handle locally and review its immutable channel ID first.",
      );
    else
      throw new Error(
        "Use /channel/UC… or /@handle, not a video or playlist URL.",
      );
  }
  if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) return { id: input };
  if (input.startsWith("@"))
    throw new Error(
      "Resolve the handle locally, verify its identity, then add the channel ID.",
    );
  throw new Error("Enter a full 24-character immutable channel ID.");
}
function entryKey(entry) {
  return entry.id || entry.handle.toLocaleLowerCase();
}
function validDraft(list) {
  if (!Array.isArray(list) || list.length > 1000)
    throw new Error("Invalid saved draft.");
  const seen = new Set();
  return list.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 1 ||
      Object.keys(entry)[0] !== "id"
    )
      throw new Error("Invalid draft entry.");
    const parsed = parseChannel(entry.id || entry.handle);
    if ((entry.id && !parsed.id) || (entry.handle && !parsed.handle))
      throw new Error("Invalid draft entry.");
    const key = entryKey(parsed);
    if (seen.has(key)) throw new Error("Duplicate draft entry.");
    seen.add(key);
    return parsed;
  });
}
function draftAllows(id) {
  return enabledIDs.has(id);
}
function indexDraft() {
  enabledIDs = new Set((draft || []).map((c) => c.id));
}
function initializeDraft(data) {
  const signature = JSON.stringify(data.channels.map((c) => c.id).sort());
  if (draft !== null && baseSignature === signature) return;
  baseSignature = signature;
  draft = data.channels.map((c) => ({ id: c.id }));
  managerNotice = "";
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw && raw.length <= 200000) {
      const saved = JSON.parse(raw);
      if (saved.base === signature) {
        draft = validDraft(saved.channels);
        $("remember-draft").checked = true;
      } else {
        localStorage.removeItem(DRAFT_KEY);
        managerNotice =
          "Published channels changed: the local draft was reset to the published list. Export unfinished drafts before a deployment.";
      }
    } else if (raw) throw new Error("Oversized saved draft");
  } catch {
    managerNotice =
      "Saved draft unavailable or invalid. Using the published whitelist.";
  }
  if ($("remember-draft").checked) {
    try {
      $("repo-name").value = localStorage.getItem(REPO_KEY) || "";
    } catch {}
  }
  indexDraft();
}
function saveDraft() {
  indexDraft();
  page = 0;
  if (!$("remember-draft").checked) {
    try {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(REPO_KEY);
    } catch {}
    managerNotice =
      "Session-only draft. Export before closing this page. Shared publication still requires a reviewed GitHub commit.";
    return;
  }
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ base: baseSignature, channels: draft }),
    );
    managerNotice =
      "Draft saved on this browser only. Publish the exported JSON to update all devices.";
  } catch {
    managerNotice =
      "Browser storage unavailable. Changes last only until this page closes; export now to keep them.";
  }
}
function updateAfterEdit() {
  closePlayer();
  saveDraft();
  const previous = $("channel").value;
  $("channel").replaceChildren(
    new Option("All enabled published channels", ""),
  );
  feed.channels
    .filter((c) => draftAllows(c.id))
    .forEach((c) => $("channel").append(new Option(c.title, c.id)));
  if (draftAllows(previous)) $("channel").value = previous;
  render();
  renderManager();
}
function channelRequestURL(operation, channelID) {
  if (
    !["Add", "Remove"].includes(operation) ||
    typeof channelID !== "string" ||
    !/^UC[A-Za-z0-9_-]{22}$/.test(channelID)
  ) {
    throw new Error("Use a valid immutable channel ID.");
  }
  const url = new URL(
    "https://github.com/linyuli303/Apps/issues/new",
  );
  url.search = new URLSearchParams({
    template: "channel-change.yml",
    title: "[MyTube] Channel change",
    operation,
    channel_id: channelID,
  }).toString();
  return url.href;
}

function renderManager() {
  renderRSSCatalogue();
  const ready = Boolean(feed && draft);
  [
    "add-channel",
    "request-add-channel",
    "whitelist-search",
    "export-whitelist",
    "reset-whitelist",
  ].forEach((id) => ($(id).disabled = !ready));
  $("whitelist-list").replaceChildren();
  if (!ready) {
    $("whitelist-search-results").textContent = "";
    $("manager-status").textContent =
      "Published feed unavailable. Reload it before editing. No draft has been published.";
    return;
  }

  const names = new Map(feed.channels.map((c) => [c.id, c.title]));
  const query = $("whitelist-search").value.trim().toLocaleLowerCase();
  const fragment = document.createDocumentFragment();

  // Keep published channels visible in the manager even when hidden locally,
  // so their GitHub removal links remain accessible.
  const rows = new Map();
  feed.channels.forEach((channel) => {
    rows.set(channel.id, { id: channel.id });
  });
  draft.forEach((entry) => {
    rows.set(entryKey(entry), entry);
  });

  let matches = 0;
  rows.forEach((entry) => {
    const key = entryKey(entry);
    const title = names.get(entry.id) || entry.id || entry.handle;
    const searchable = `${title} ${entry.id || entry.handle}`.toLocaleLowerCase();
    if (query && !searchable.includes(query)) return;
    matches++;

    const inDraft = draft.some((item) => entryKey(item) === key);
    const published = names.has(entry.id);
    const li = element("li");
    const text = element("span", "manager-channel");
    if (typeof entry.id === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(entry.id)) {
      const channelLink = element("a", "manager-channel-link", title);
      channelLink.href = `https://www.youtube.com/channel/${entry.id}`;
      channelLink.target = "_blank";
      channelLink.rel = "noopener noreferrer";
      channelLink.setAttribute(
        "aria-label",
        `Open ${title} on YouTube (opens a new tab)`,
      );
      text.append(channelLink);
    } else {
      text.append(document.createTextNode(title));
    }
    const state = published
      ? inDraft
        ? "Published; included in this local draft."
        : "Published; hidden by this local draft only."
      : "Local draft only; no videos fetched until publication.";

    text.append(
      element("small", "", entry.id || entry.handle),
      element("small", "", state),
    );

    const actions = element("div", "manager-row-actions");

    if (entry.id && /^UC[A-Za-z0-9_-]{22}$/.test(entry.id)) {
      const operation = published ? "Remove" : "Add";
      const request = element(
        "a",
        "official",
        published
          ? "Request removal via GitHub"
          : "Request addition via GitHub",
      );
      request.href = channelRequestURL(operation, entry.id);
      request.target = "_blank";
      request.rel = "noopener noreferrer";
      request.setAttribute(
        "aria-label",
        `Request ${operation.toLowerCase()} for ${title} (${entry.id}) via GitHub; opens a new tab`,
      );
      actions.append(request);
    }

    const local = element(
      "button",
      "",
      inDraft ? "Remove locally" : "Restore locally",
    );
    local.type = "button";
    local.disabled = !inDraft && draft.length >= 1000;
    local.setAttribute(
      "aria-label",
      `${inDraft ? "Remove" : "Restore"} ${title} (${key}) locally`,
    );
    local.addEventListener("click", () => {
      // Find the actual draft entry, never a filtered-list index.
      const actualIndex = draft.findIndex((item) => entryKey(item) === key);
      if (actualIndex >= 0) {
        draft.splice(actualIndex, 1);
      } else if (draft.length < 1000) {
        draft.push({ id: entry.id });
      } else {
        $("manager-status").textContent =
          "At most 1000 local draft channels are supported.";
        return;
      }
      updateAfterEdit();
      $("whitelist-search").focus();
    });

    actions.append(local);
    li.append(text, actions);
    fragment.append(li);
  });

  if (matches === 0) {
    fragment.append(element("li", "", "No matching channels."));
  }
  $("whitelist-list").append(fragment);
  $("whitelist-search-results").textContent =
    `${matches} of ${rows.size} channels shown.`;
  $("manager-status").textContent =
    `${draft.length} local draft channels. ` +
    `${managerNotice || "No changes published from this editor."} ` +
    "GitHub links open request forms only; review and submit on GitHub, " +
    "then wait for successful processing and publication.";
}

$("whitelist-search").addEventListener("input", renderManager);
$("request-add-channel").addEventListener("click", () => {
  if (!feed || !draft) return;
  try {
    const entry = parseChannel($("new-channel").value);
    const url = channelRequestURL("Add", entry.id);
    window.open(url, "_blank", "noopener,noreferrer");
    $("manager-status").textContent =
      "GitHub request form opened in a new tab (if popups are allowed). " +
      "No local draft change was made. Review the ID, choose Add, check " +
      "the confirmation, and submit as linyuli303. Publication is not immediate.";
  } catch (error) {
    $("manager-status").textContent = error.message;
  }
});

function addDraftChannel() {
  if (!feed || !draft) return;
  try {
    const entry = parseChannel($("new-channel").value);
    if (draft.length >= 1000)
      throw new Error("At most 1000 channels are supported.");
    if (draft.some((c) => entryKey(c) === entryKey(entry)))
      throw new Error("This entry is already in your draft.");
    draft.push(entry);
    $("new-channel").value = "";
    updateAfterEdit();
    $("new-channel").focus();
  } catch (error) {
    $("manager-status").textContent = error.message;
  }
}
$("add-channel").addEventListener("click", addDraftChannel);
$("new-channel").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addDraftChannel();
  }
});
$("export-whitelist").addEventListener("click", () => {
  if (!feed || !draft) return;
  try {
    const config = {
      title: feed.title.slice(0, 120),
      max_videos_per_channel: 15,
      channels: validDraft(draft),
    };
    const blob = new Blob([JSON.stringify(config, null, 2) + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = element("a");
    a.href = url;
    a.download = "channels.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("manager-status").textContent =
      "Exported local draft; nothing has been published. For individual changes, use the GitHub request links. Advanced bulk editing: replace channels.json with the exported contents in GitHub, then review and commit. Some TV browsers may not support downloads; use a phone or laptop.";
  } catch {
    $("manager-status").textContent =
      "Export failed. Try a modern laptop/phone browser.";
  }
});
$("reset-whitelist").addEventListener("click", () => {
  if (
    !feed ||
    !confirm(
      "Discard this browser’s draft and restore the published whitelist?",
    )
  )
    return;
  draft = feed.channels.map((c) => ({ id: c.id }));
  updateAfterEdit();
});
$("github-edit").addEventListener("click", () => {
  const repo = $("repo-name").value.trim();
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
    [".", ".."].includes(repo.split("/")[1])
  ) {
    $("manager-status").textContent =
      "Enter owner/repository, not a URL or a token.";
    return;
  }
  if ($("remember-draft").checked) {
    try {
      localStorage.setItem(REPO_KEY, repo);
    } catch {}
  }
  window.open(
    `https://github.com/${repo}/edit/main/channels.json`,
    "_blank",
    "noopener,noreferrer",
  );
});
function freshFeed(data, now = Date.now()) {
  const timestamp = Date.parse(data && data.generatedAt);
  return (
    Number.isFinite(timestamp) &&
    now - timestamp <= MAX_FEED_AGE_MS &&
    timestamp - now <= 300000
  );
}
function expireFeed() {
  closePlayer();
  feed = null;
  visible = [];
  enabledIDs.clear();
  $("grid").replaceChildren();
  $("empty").hidden = true;
  $("page-prev").disabled = true;
  $("page-next").disabled = true;
  $("status").textContent =
    "Feed unavailable or more than 24 hours old. Run a successful GitHub refresh and reload. Playback is blocked until a fresh feed is loaded.";
  renderManager();
}
$("remember-draft").addEventListener("change", () => {
  if (feed && draft) {
    saveDraft();
    renderManager();
  }
});
$("forget-draft").addEventListener("click", () => {
  $("remember-draft").checked = false;
  $("repo-name").value = "";
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(REPO_KEY);
    localStorage.removeItem("approved-yt-whitelist-draft-v1");
    localStorage.removeItem("approved-yt-repository-v1");
  } catch {}
  if (feed) {
    draft = feed.channels.map((c) => ({ id: c.id }));
    updateAfterEdit();
  }
});
$("page-prev").addEventListener("click", () => {
  if (page > 0) {
    page--;
    render();
    $("grid").querySelector("button")?.focus();
  }
});
$("page-next").addEventListener("click", () => {
  if ((page + 1) * PAGE_SIZE < visible.length) {
    page++;
    render();
    $("grid").querySelector("button")?.focus();
  }
});
setInterval(() => {
  if (feed && !freshFeed(feed)) expireFeed();
}, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && feed && !freshFeed(feed)) expireFeed();
});
renderManager();
load();

// Palette UI: validated names only; colors are defined in external style.css.
(function initializeThemePicker() {
  const themes = [{"id": "yugure", "ja": "\u5915\u66ae\u308c", "name": "Yugure"}, {"id": "kimono", "ja": "\u7740\u7269", "name": "Kimono"}, {"id": "hanami", "ja": "\u82b1\u898b", "name": "Hanami"}, {"id": "ukiyoe", "ja": "\u6d6e\u4e16\u7d75", "name": "Ukiyo-e"}, {"id": "japandi", "ja": "\u548c\u5317\u6b27", "name": "Japandi"}, {"id": "edo", "ja": "\u6c5f\u6238", "name": "Edo"}, {"id": "wabisabi", "ja": "\u4f98\u5bc2", "name": "Wabi-sabi"}, {"id": "nadeshiko", "ja": "\u64ab\u5b50", "name": "Nadeshiko"}, {"id": "akabeni", "ja": "\u8d64\u7d05", "name": "Akabeni"}, {"id": "kaki", "ja": "\u67ff", "name": "Kaki"}, {"id": "yamabuki", "ja": "\u5c71\u5439", "name": "Yamabuki"}, {"id": "karashi", "ja": "\u82a5\u5b50", "name": "Karashi"}, {"id": "kihada", "ja": "\u9ec4\u6a97", "name": "Kihada"}, {"id": "wakana", "ja": "\u82e5\u83dc", "name": "Wakana"}, {"id": "moegi", "ja": "\u840c\u9ec4", "name": "Moegi"}, {"id": "matsuba", "ja": "\u677e\u8449", "name": "Matsuba"}, {"id": "tokiwa", "ja": "\u5e38\u78d0", "name": "Tokiwa"}, {"id": "seiji", "ja": "\u9752\u78c1", "name": "Seiji"}, {"id": "asagi", "ja": "\u6d45\u8471", "name": "Asagi"}, {"id": "hanada", "ja": "\u7e39", "name": "Hanada"}, {"id": "ruri", "ja": "\u7460\u7483", "name": "Ruri"}, {"id": "kikyo", "ja": "\u6854\u6897", "name": "Kikyo"}, {"id": "fuji", "ja": "\u85e4", "name": "Fuji"}, {"id": "ayame", "ja": "\u83d6\u84b2", "name": "Ayame"}, {"id": "botan", "ja": "\u7261\u4e39", "name": "Botan"}, {"id": "sakura", "ja": "\u685c", "name": "Sakura"}, {"id": "kohbai", "ja": "\u7d05\u6885", "name": "Kohbai"}, {"id": "enji", "ja": "\u81d9\u8102", "name": "Enji"}, {"id": "shu", "ja": "\u6731", "name": "Shu"}, {"id": "hiwada", "ja": "\u6a9c\u76ae", "name": "Hiwada"}, {"id": "taisha", "ja": "\u4ee3\u8d6d", "name": "Taisha"}, {"id": "kohaku", "ja": "\u7425\u73c0", "name": "Kohaku"}, {"id": "kuchinashi", "ja": "\u6894\u5b50", "name": "Kuchinashi"}, {"id": "ukon", "ja": "\u9b31\u91d1", "name": "Ukon"}, {"id": "ominaeshi", "ja": "\u5973\u90ce\u82b1", "name": "Ominaeshi"}, {"id": "uguisu", "ja": "\u9daf", "name": "Uguisu"}, {"id": "yanagi", "ja": "\u67f3", "name": "Yanagi"}, {"id": "byakuroku", "ja": "\u767d\u7dd1", "name": "Byakuroku"}, {"id": "rokusho", "ja": "\u7dd1\u9752", "name": "Rokusho"}, {"id": "aotake", "ja": "\u9752\u7af9", "name": "Aotake"}, {"id": "tokusa", "ja": "\u6728\u8cca", "name": "Tokusa"}, {"id": "sabiseiji", "ja": "\u9306\u9752\u78c1", "name": "Sabiseiji"}, {"id": "mizuasagi", "ja": "\u6c34\u6d45\u8471", "name": "Mizuasagi"}, {"id": "sora", "ja": "\u7a7a", "name": "Sora"}, {"id": "ai", "ja": "\u85cd", "name": "Ai"}, {"id": "kon", "ja": "\u7d3a", "name": "Kon"}, {"id": "sumire", "ja": "\u83eb", "name": "Sumire"}, {"id": "murasaki", "ja": "\u7d2b", "name": "Murasaki"}, {"id": "shion", "ja": "\u7d2b\u82d1", "name": "Shion"}, {"id": "sumi", "ja": "\u58a8", "name": "Sumi"}, {"id": "ginnezumi", "ja": "\u9280\u9f20", "name": "Ginnezumi"}];
  const scope = encodeURIComponent(MYAPPS_ROOT.pathname);
  const themeKey = "approved-yt-theme-v2:" + scope;
  const modeKey = "approved-yt-appearance-v1:" + scope;
  let selected = "yugure", mode = "light";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function readPreferences() {
    selected = "yugure"; mode = "light";
  }
  readPreferences();
  const header = document.querySelector(".myapps-header-actions"), refresh = $("refresh");
  if (!header || !refresh || $("mytube-theme-picker")) return;
  const actions = element("div", "landing-palette-actions");
  const picker = element("details", "palette-picker"); picker.id = "mytube-theme-picker";
  const summary = element("summary"); summary.setAttribute("aria-label", "Choose color palette");
  const heading = element("span", "sr-only");
  const name = element("span", "palette-name");
  heading.append(element("span", "palette-caption", "色のパレット · 51 palettes"), name);
  const trigger = element("span", "palette-trigger-colors");
  const arrow = element("span", "", "⌄"); arrow.setAttribute("aria-hidden", "true");
  summary.append(heading, trigger);
  const panel = element("section", "palette-panel"); panel.setAttribute("aria-label", "Available palettes");
  const panelHeading = element("div", "palette-panel-heading", "Find your atmosphere");
  panelHeading.append(element("small", "", "51 palettes · Each available in light and dark mode."));
  const list = element("div", "palette-list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Choose one of 51 palettes");
  const buttons = [];
  function swatches(id) {
    const el = element("span", "palette-swatches"); el.dataset.palette = id; el.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 5; i++) el.append(document.createElement("i"));
    return el;
  }
  const announce = element("span", "sr-only"); announce.setAttribute("role", "status"); announce.setAttribute("aria-live", "polite");
  const modeLabel = element("label", "appearance-label", "Appearance");
  const appearance = element("select"); appearance.id = "appearance";
  appearance.append(new Option("Light", "light"), new Option("Dark", "dark"), new Option("System", "system"));
  modeLabel.append(appearance);
  modeLabel.hidden = true;
  const appearanceToggle = element("button", "apps-appearance-toggle");
  appearanceToggle.type = "button";
  appearanceToggle.id = "appearance-toggle";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "apps-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const circle = document.createElementNS(icon.namespaceURI, "circle");
  circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "9");
  const half = document.createElementNS(icon.namespaceURI, "path");
  half.setAttribute("d", "M12 3a9 9 0 0 1 0 18z");
  half.setAttribute("class", "appearance-half");
  icon.append(circle, half); appearanceToggle.append(icon);
  function apply(persist = false, speak = false) {
    const theme = themes.find(t => t.id === selected);
    const dark = mode === "dark" || (mode === "system" && system.matches);
    document.documentElement.dataset.theme = selected;
    document.documentElement.dataset.appearance = dark ? "dark" : "light";
    name.textContent = theme.ja + " · " + theme.name;
    trigger.replaceChildren(swatches(selected), arrow);
    appearance.value = mode;
    appearanceToggle.setAttribute("aria-pressed", String(dark));
    appearanceToggle.setAttribute("aria-label", "Toggle appearance; currently " + (dark ? "dark" : "light"));
    appearanceToggle.title = "Toggle appearance: " + (dark ? "dark" : "light");
    if ($("player-appearance")) $("player-appearance").value = mode;
    buttons.forEach((b, i) => {
      b.setAttribute("aria-pressed", String(themes[i].id === selected));
      b.querySelector(".palette-check").textContent = themes[i].id === selected ? "✓" : "";
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
    if (speak) announce.textContent = theme.name + " theme applied in " + (dark ? "dark" : "light") + " mode.";
  }
  themes.forEach((theme, i) => {
    const b = element("button", "palette-option"); b.type = "button";
    const check = element("span", "palette-check"); check.setAttribute("aria-hidden", "true");
    b.append(element("span", "palette-option-name", theme.ja + " · " + theme.name),
      element("span", "palette-option-note", (i < 7 ? "Signature palette" : "Traditional-color inspired") + " · Light + dark"), swatches(theme.id), check);
    b.addEventListener("click", () => { selected = theme.id; apply(true, true); picker.open = false; summary.focus(); });
    b.addEventListener("keydown", event => {
      let next = i;
      if (event.key === "ArrowRight") next = (i + 1) % themes.length;
      else if (event.key === "ArrowLeft") next = (i + themes.length - 1) % themes.length;
      else if (event.key === "ArrowDown") next = Math.min(themes.length - 1, i + 2);
      else if (event.key === "ArrowUp") next = Math.max(0, i - 2);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = themes.length - 1;
      else return;
      event.preventDefault(); buttons[next].focus();
    });
    buttons.push(b); list.append(b);
  });
  panelHeading.append(modeLabel);
  panel.append(panelHeading, list, element("div", "palette-footnote", "Selection lasts until this page reloads. Nothing is saved to browser storage."));
  picker.append(summary, panel);
  actions.append(picker, appearanceToggle, announce); header.prepend(actions);
  function changeAppearance(value) {
    if (!["light", "dark", "system"].includes(value)) return;
    mode = value;
    apply(true, true);
  }
  appearanceToggle.addEventListener("click", () => {
    changeAppearance(document.documentElement.dataset.appearance === "dark" ? "light" : "dark");
  });
  appearance.addEventListener("change", () => {
    changeAppearance(appearance.value);
  });
  $("player-appearance").addEventListener("change", () => {
    changeAppearance($("player-appearance").value);
  });
  document.addEventListener("click", event => { if (!picker.contains(event.target)) picker.open = false; });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && picker.open) { picker.open = false; summary.focus(); } });
  function systemChanged() { if (mode === "system") apply(); }
  if (system.addEventListener) system.addEventListener("change", systemChanged);
  else system.addListener(systemChanged);
  apply();
})();


// RSS-style catalogue. Reads the already-loaded feed; no network requests.
function renderRSSCatalogue() {
  const panel = $("rss-panel");
  if (!panel) return;

  let state = renderRSSCatalogue.state;
  if (!state) {
    state = { open: false, active: null, pinned: null };
    renderRSSCatalogue.state = state;

    const setOpen = (open) => {
      state.open = open;
      panel.hidden = !open;
      $("rss-catalogue").classList.toggle("rss-open", open);
      $("rss-toggle").setAttribute("aria-expanded", String(open));
      if (open) {
        renderRSSCatalogue();
      } else {
        state.active = null;
        state.pinned = null;
        state.activate(null);
        $("rss-toggle").focus();
      }
    };

    $("rss-toggle").addEventListener("click", () => setOpen(!state.open));

    $("rss-back").addEventListener("click", () => {
      const previous = state.active;
      state.pinned = null;
      state.activate(null);
      state.suppressPreview = true;
      const button = previous && document.getElementById(`rss-channel-${previous}`);
      if (button) button.focus();
      state.suppressPreview = false;
    });
    $("rss-close").addEventListener("click", () => setOpen(false));
    $("rss-close").title = "Close RSS catalogue";
    $("rss-back").setAttribute("aria-label", "Back to channels");
    $("rss-back").title = "Back to channels";

    const detailClose = element("button", "rss-detail-close", "\u00d7");
    detailClose.id = "rss-detail-close";
    detailClose.type = "button";
    detailClose.setAttribute("aria-label", "Close RSS catalogue");
    detailClose.title = "Close RSS catalogue";
    detailClose.addEventListener("click", () => setOpen(false));
    $("rss-detail").querySelector(".rss-detail-heading").append(detailClose);

    // Phone gestures navigate catalogue views only, never start playback.
    const catalogue = $("rss-catalogue");
    let rssSwipe = null;
    let suppressRSSClickUntil = 0;
    const phoneCatalogue = () =>
      document.documentElement.dataset.deviceLayout === "phone";

    catalogue.addEventListener("pointerdown", event => {
      rssSwipe = null;
      if (!phoneCatalogue() || !state.open ||
          !event.isPrimary || event.button !== 0 ||
          event.target.closest(
            "input,select,textarea,label,#rss-close,#rss-back,#rss-detail-close"
          )) return;

      rssSwipe = {
        id:event.pointerId, x:event.clientX, y:event.clientY,
        started:performance.now(), active:state.active,
      };
    });

    catalogue.addEventListener("pointerup", event => {
      const start = rssSwipe;
      rssSwipe = null;
      if (!start || event.pointerId !== start.id ||
          !phoneCatalogue() || !state.open ||
          state.active !== start.active ||
          performance.now() - start.started > 1200) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (dx > -60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      // Reuse existing Back/Close actions and their focus restoration.
      if (state.active !== null) {
        $("rss-back").click();
      } else {
        setOpen(false);
      }
      suppressRSSClickUntil = performance.now() + 500;
    });

    catalogue.addEventListener("pointercancel", () => { rssSwipe = null; });
    catalogue.addEventListener("lostpointercapture", () => { rssSwipe = null; });
    catalogue.addEventListener("click", event => {
      // Only suppress the pointer-generated click following a completed swipe.
      // Keyboard activation (detail === 0) remains available.
      if (event.detail !== 0 && performance.now() < suppressRSSClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    $("rss-search").addEventListener("input", () => {
      state.active = null;
      state.pinned = null;
      renderRSSCatalogue();
    });
    $("rss-catalogue").addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    });
    // Crossing from catalogue to feed must not collapse the feed.
    // Leaving both panels may clear an unpinned preview, never the catalogue.
    $("rss-catalogue").addEventListener("pointerleave", (event) => {
      if (
        event.pointerType === "mouse" &&
        state.pinned === null &&
        !$("rss-catalogue").contains(document.activeElement)
      ) {
        state.activate(null);
      }
    });
    $("rss-catalogue").addEventListener("focusout", () => {
      setTimeout(() => {
        if (
          state.pinned === null &&
          !$("rss-catalogue").contains(document.activeElement)
        ) {
          state.activate(null);
        }
      }, 0);
    });
  }

  const container = $("rss-channels");
  const rows = new Map();

  const makeVideos = (record) => {
    const fragment = document.createDocumentFragment();
    if (!record.videos.length) {
      fragment.append(
        element("p", "rss-no-videos", "No available uploads in this snapshot."),
      );
      return fragment;
    }

    const headings = element("div", "rss-column-head");
    headings.append(
      element("span", "", "PUBLISHED"),
      element("span", "", "VIDEO TITLE"),
      element("span", "rss-views", "VIEWS | TIME"),
    );
    fragment.append(headings);

    record.videos.forEach((video) => {
      const row = element("div", "rss-video");
      const date = element("time", "rss-date", dateLabel(video.publishedAt));
      date.dateTime = video.publishedAt;
      date.title = video.publishedAt;

      const title = element("button", "rss-video-title", video.title);
      title.type = "button";
      title.title = video.title;
      title.setAttribute(
        "aria-label",
        `${video.title} - Play inside MyTube`,
      );
      title.addEventListener("click", () => openPlayer(video.id));

      const count = video.viewCount;
      let countLabel = "Unavailable";
      if (
        typeof count === "string" &&
        /^[0-9]{1,20}$/.test(count)
      ) {
        try {
          countLabel = BigInt(count).toLocaleString();
        } catch {
          // Retain exact digits if BigInt formatting is unsupported.
          countLabel = count;
        }
      }
      const views = element("span", "rss-views", countLabel);
      views.title = countLabel === "Unavailable"
        ? "View count unavailable in this snapshot"
        : `${countLabel} views at the last feed refresh`;

      views.append(element("span", "feed-duration", " | " + playbackDurationLabel(video.duration)));
      row.append(date, title, views);
      fragment.append(row);
    });
    return fragment;
  };

  state.activate = (id) => {
    state.active = id;
    $("rss-catalogue").classList.toggle("rss-wide", id !== null);
    $("rss-detail").hidden = id === null;
    // Hidden phone channel controls must not receive keyboard focus.
    panel.inert = id !== null &&
      document.documentElement.dataset.deviceLayout === "phone";
    const selected = rows.get(id);
    $("rss-detail-title").textContent = selected
      ? selected.title
      : "Channel feed";
    rows.forEach((record, channelID) => {
      const expanded = channelID === id;
      record.section.classList.toggle("rss-active", expanded);
      record.button.setAttribute("aria-expanded", String(expanded));
      record.content.hidden = !expanded;
      if (expanded && !record.built) {
        record.content.append(makeVideos(record));
        record.built = true;
      }
    });
  };

  container.replaceChildren();
  $("rss-detail-body").replaceChildren();

  if (!state.open) {
    state.activate(null);
    return;
  }

  if (!feed || !freshFeed(feed)) {
    state.active = null;
    state.pinned = null;
    state.activate(null);
    $("rss-status").textContent =
      "A fresh published feed is required. Refresh the main page.";
    return;
  }

  const query = $("rss-search").value.trim().toLocaleLowerCase();
  const grouped = new Map();

  feed.channels.filter((channel) => draftAllows(channel.id) && categoryAllows(channel.id)).forEach((channel) => {
    grouped.set(channel.id, { channel, videos: [], latest: null });
  });

  feed.videos.forEach((video) => {
    const group = grouped.get(video.channelId);
    if (
      group && shortVideoAllows(video) &&
      safeID(video.id) &&
      Number.isFinite(Date.parse(video.publishedAt))
    ) {
      group.videos.push(video);
    }
  });

  const groups = Array.from(grouped.values());
  groups.forEach((group) => {
    group.videos.sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
    group.latest = group.videos[0] || null;
  });
  groups.sort((a, b) => {
    if (!a.latest && !b.latest)
      return a.channel.title.localeCompare(b.channel.title);
    if (!a.latest) return 1;
    if (!b.latest) return -1;
    return (
      Date.parse(b.latest.publishedAt) - Date.parse(a.latest.publishedAt) ||
      a.channel.title.localeCompare(b.channel.title)
    );
  });

  let videoCount = 0;
  const fragment = document.createDocumentFragment();

  groups.forEach((group) => {
    const channel = group.channel;
    const channelMatch = `${channel.title} ${channel.id}`
      .toLocaleLowerCase()
      .includes(query);
    const matchingVideos = channelMatch
      ? group.videos
      : group.videos.filter((video) =>
          video.title.toLocaleLowerCase().includes(query),
        );

    if (!channelMatch && !matchingVideos.length) return;
    videoCount += matchingVideos.length;

    const section = element("section", "rss-channel");
    const button = element("button", "rss-channel-button");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.id = `rss-channel-${channel.id}`;
    button.setAttribute("aria-controls", "rss-detail");

    const name = element("span", "rss-channel-name", channel.title);
    const updated = element(
      "span",
      "rss-updated",
      group.latest ? dateLabel(group.latest.publishedAt) : "No uploads",
    );
    button.append(name, updated);

    const content = element("div", "rss-videos");
    content.id = `rss-videos-${channel.id}`;
    content.hidden = true;

    const info = element("div", "rss-channel-info");
    const channelLink = element("a", "", "Open channel on YouTube");
    channelLink.href = `https://www.youtube.com/channel/${channel.id}`;
    channelLink.target = "_blank";
    channelLink.rel = "noopener noreferrer";
    info.append(
      channelLink,
      element("span", "", `${matchingVideos.length} uploads in this view`),
    );
    content.append(info);

    const record = {
      section,
      button,
      content,
      title: channel.title,
      videos: matchingVideos,
      built: false,
    };
    rows.set(channel.id, record);

    section.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && state.pinned === null &&
          document.documentElement.dataset.deviceLayout !== "phone") {
        state.activate(channel.id);
      }
    });
    button.addEventListener("focus", () => {
      if (state.pinned === null && !state.suppressPreview &&
          document.documentElement.dataset.deviceLayout !== "phone") {
        state.activate(channel.id);
      }
    });
    button.addEventListener("click", () => {
      if (state.pinned === channel.id) {
        state.pinned = null;
        state.activate(null);
      } else {
        state.pinned = channel.id;
        state.activate(channel.id);
      }
    });

    button.addEventListener("click", () => {
      if (document.documentElement.dataset.deviceLayout === "phone" &&
          state.active === channel.id) {
        $("rss-back").focus({preventScroll:true});
      }
    });

    section.append(button);
    $("rss-detail-body").append(content);
    fragment.append(section);
  });

  if (!rows.size) {
    fragment.append(element("p", "rss-no-videos", "No matching channels or videos."));
  }

  container.append(fragment);
  if (!rows.has(state.active)) state.active = null;
  if (!rows.has(state.pinned)) state.pinned = null;
  state.activate(state.active);
  $("rss-status").textContent =
    `${rows.size} channels / ${videoCount} videos. Newest upload first. ` +
    `Feed refreshed ${dateLabel(feed.generatedAt)}.`;
}


// Personal categories: browser-local, independent of whitelist approval.
function validateCategoryData(value) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "assignments,categories,version" ||
    value.version !== 1 || !Array.isArray(value.categories) ||
    value.categories.length > 50 ||
    !value.assignments || typeof value.assignments !== "object" ||
    Array.isArray(value.assignments) ||
    Object.keys(value.assignments).length > 1000
  ) throw new Error("Invalid category backup.");

  const ids = new Set(), names = new Set();
  for (const category of value.categories) {
    if (
      !category || typeof category !== "object" ||
      Object.keys(category).sort().join(",") !== "id,name" ||
      typeof category.id !== "string" ||
      !/^cat-[A-Za-z0-9-]{1,64}$/.test(category.id) ||
      typeof category.name !== "string" ||
      !category.name.trim() || category.name !== category.name.trim() ||
      category.name.length > 50 ||
      /[\u0000-\u001f\u007f]/.test(category.name) ||
      ids.has(category.id) ||
      names.has(category.name.toLocaleLowerCase()) ||
      ["all categories", "uncategorized"].includes(
        category.name.toLocaleLowerCase()
      )
    ) throw new Error("Invalid or duplicate category.");
    ids.add(category.id);
    names.add(category.name.toLocaleLowerCase());
  }

  for (const [id, tags] of Object.entries(value.assignments)) {
    if (
      !/^UC[A-Za-z0-9_-]{22}$/.test(id) ||
      !Array.isArray(tags) || tags.length > 50 ||
      new Set(tags).size !== tags.length ||
      tags.some(tag => !ids.has(tag))
    ) throw new Error("Invalid channel assignments.");
  }
  return true;
}

function categoryState() {
  if (categoryState.saved) return categoryState.saved;
  const scope = encodeURIComponent(MYAPPS_ROOT.pathname);
  const key = "approved-yt-category-draft-v2:" + scope;
  const legacyKey = "approved-yt-categories-v1:" + scope;
  const fallback = {version:1, categories:[
    "Data & AI", "IT & Cyber", "Travel", "Music", "Skills", "News",
    "Talk Shows & Podcasts", "Entertainment"
  ].map((name,index)=>({id:"cat-"+index,name})), assignments:{}};
  const snapshot = SHARED_CATEGORY_SNAPSHOT;
  const published = snapshot ? snapshot.model : fallback;
  validateCategoryData(published);
  const revision = snapshot ? snapshot.revision : null;
  let model = JSON.parse(JSON.stringify(published)), baseRevision = revision;
  let warning = snapshot ? "" : "Local source preview: shared saving requires a published snapshot.";
  return categoryState.saved = {key, legacyKey, model, published,
    revision, baseRevision, warning, search:""};
}

function categoryAllows(channelID) {
  const selected = $("category-filter")?.value || "all";
  const tags = categoryState().model.assignments[channelID] || [];
  return selected === "all" ||
    (selected === "uncategorized" ? tags.length === 0 : tags.includes(selected));
}

function updateCategoryFilter() {
  const select = $("category-filter");
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(new Option("All", "all"));
  for (const category of categoryState().model.categories) {
    select.append(new Option(category.name, category.id));
  }
  select.append(new Option("Uncategorized", "uncategorized"));
  select.value = Array.from(select.options).some(option => option.value === previous)
    ? previous : "all";
  renderCategoryTabs();
}

function refreshCategoryViews() {
  updateCategoryFilter();
  page = 0;
  if (feed) render();
  renderRSSCatalogue();
}

function saveCategoryData() {
  const state = categoryState();
  validateCategoryData(state.model);
  const raw = JSON.stringify({baseRevision:state.baseRevision,model:state.model});
  if (raw.length > 2000000) throw new Error("Category draft too large.");
  $("category-editor-status").textContent =
    "Draft kept in page memory only. Reloading loses edits; export or publish before leaving.";
  refreshCategoryViews();
  updateSharedCategoryStatus();
}

function renderCategoryEditor() {
  updateSharedCategoryStatus();
  const state = categoryState(), model = state.model;
  const definitions = $("category-definitions");
  definitions.replaceChildren();

  for (const category of model.categories) {
    const row = element("div", "category-edit-row");
    const input = element("input");
    input.value = category.name;
    input.maxLength = 50;
    input.setAttribute("aria-label", "Rename " + category.name);

    const save = element("button", "", "Save name");
    save.type = "button";
    save.addEventListener("click", () => {
      const old = category.name;
      category.name = input.value.trim();
      try {
        validateCategoryData(model);
      } catch {
        category.name = old;
        $("category-editor-status").textContent =
          "Use a unique name of 1-50 characters. Built-in filter names are reserved.";
        return;
      }
      saveCategoryData();
      renderCategoryEditor();
      $("category-menu").setAttribute("aria-expanded", "true");
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        save.click();
      }
    });

    const remove = element("button", "", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (!confirm(
        `Delete "${category.name}" and its assignments? No channels or videos will be deleted.`
      )) return;
      model.categories = model.categories.filter(item => item.id !== category.id);
      for (const id of Object.keys(model.assignments)) {
        model.assignments[id] = model.assignments[id].filter(
          tag => tag !== category.id
        );
      }
      saveCategoryData();
      renderCategoryEditor();
      $("category-new-name").focus();
    });

    row.append(input, save, remove);
    definitions.append(row);
  }

  const list = $("category-channel-list");
  list.replaceChildren();
  if (!feed || !freshFeed(feed)) {
    list.append(element("p", "", "Load a fresh feed to assign channel categories."));
    return;
  }
  const query = state.search.toLocaleLowerCase();
  const channels = feed.channels
    .filter(channel =>
      `${channel.title} ${channel.id}`.toLocaleLowerCase().includes(query)
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  for (const channel of channels) {
    const field = element("fieldset", "category-assignment");
    field.append(element("legend", "", channel.title));
    const tags = new Set(model.assignments[channel.id] || []);

    for (const category of model.categories) {
      const label = element("label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = tags.has(category.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) tags.add(category.id);
        else tags.delete(category.id);

        const assignments = {...model.assignments};
        const selectedTags = Array.from(tags);
        if (selectedTags.length) assignments[channel.id] = selectedTags;
        else delete assignments[channel.id];

        try {
          validateCategoryData({...model, assignments});
        } catch {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) tags.add(category.id);
          else tags.delete(category.id);
          $("category-editor-status").textContent =
            "Assignment limit reached. Remove unused assignments from your backup.";
          return;
        }
        model.assignments = assignments;
        saveCategoryData();
      });
      label.append(checkbox, document.createTextNode(" " + category.name));
      field.append(label);
    }
    if (!model.categories.length) {
      field.append(element("span", "", "Add a category above to assign it."));
    }
    list.append(field);
  }
  if (!channels.length) list.append(element("p", "", "No matching channels."));
}

(function initializeCategories() {
  updateCategoryFilter();
  $("category-filter").addEventListener("change", () => {
    page = 0;
    if (feed) render();
    renderRSSCatalogue();
  });

  const dialog = $("category-editor"), opener = $("category-menu");
  opener.addEventListener("click", () => {
    $("configuration-dialog").close();
    $("category-editor-status").textContent = categoryState().warning;
    renderCategoryEditor();
    dialog.showModal();
    opener.setAttribute("aria-expanded", "true");
  });
  $("category-editor-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    opener.setAttribute("aria-expanded", "false");
    $("configuration-toggle").focus();
  });
  // Keep native Escape/dialog behavior, without triggering page shortcuts.
  dialog.addEventListener("keydown", event => event.stopPropagation());

  $("category-channel-search").addEventListener("input", () => {
    categoryState().search = $("category-channel-search").value;
    renderCategoryEditor();
  });

  $("category-add").addEventListener("click", () => {
    const state = categoryState();
    const id = "cat-" + Array.from(
      crypto.getRandomValues(new Uint32Array(4)),
      value => value.toString(16).padStart(8, "0")
    ).join("");
    const next = {
      ...state.model,
      categories: [
        ...state.model.categories,
        {id, name: $("category-new-name").value.trim()},
      ],
    };
    try {
      validateCategoryData(next);
    } catch {
      $("category-editor-status").textContent =
        "Use a unique name of 1-50 characters, up to 50 categories. Built-in names are reserved.";
      return;
    }
    state.model = next;
    $("category-new-name").value = "";
    saveCategoryData();
    renderCategoryEditor();
    $("category-new-name").focus();
  });
  $("category-new-name").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("category-add").click();
    }
  });

  $("category-export").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(categoryState().model, null, 2)],
      {type: "application/json"}
    ));
    const anchor = element("a");
    anchor.href = url;
    anchor.download = "MyTube_categories.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  $("category-import").addEventListener("change", async () => {
    try {
      const file = $("category-import").files[0];
      if (!file) return;
      if (file.size > 2000000) throw new Error();
      const value = JSON.parse(await file.text());
      validateCategoryData(value);
      if (!confirm(
        "Replace this browser's categories and assignments with this backup?"
      )) return;
      categoryState().model = value;
      saveCategoryData();
      renderCategoryEditor();
    } catch {
      $("category-editor-status").textContent =
        "Import rejected. Current categories were not changed.";
    } finally {
      $("category-import").value = "";
    }
  });
})();


// Preferred speed lasts until reload; actual rate is confirmed by YouTube.
function normalizePlaybackSpeed(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.25, Math.min(2, Math.round(value * 4) / 4));
}

function speedState() {
  if (speedState.saved) return speedState.saved;
  return speedState.saved = {
    preferred: 1, player: null, frame: null, ready: false,
    timer: null, stored: true,
  };
}

function updateSpeedControls() {
  const value = speedState().preferred;
  $("speed-slider").value = String(value);
  $("speed-value").textContent = `${value}x`;
  $("speed-preset").value = String(value);
}

function setPreferredSpeed(value) {
  if (!Number.isFinite(value) || value < 0.25 || value > 2) return;
  const state = speedState();
  state.preferred = normalizePlaybackSpeed(value);
  updateSpeedControls();
  $("speed-status").textContent = "";
  clearTimeout(state.timer);
  state.timer = setTimeout(applyPreferredSpeed, 180);
}

function stopSpeedController() {
  stopTubeExtras();
  const state = speedState();
  clearTimeout(state.timer);
  const player = state.player;
  state.player = null;
  state.frame = null;
  state.ready = false;
  if (player) {
    try { player.destroy(); } catch {}
  }
}

function loadSpeedAPI() {
  if (window.YT && typeof window.YT.Player === "function") {
    return Promise.resolve();
  }
  if (loadSpeedAPI.promise) return loadSpeedAPI.promise;
  loadSpeedAPI.promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Player API unavailable")), 15000
    );
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") {
        try { previous(); } catch {}
      }
      clearTimeout(timeout);
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Player API unavailable"));
    };
    document.head.append(script);
  });
  return loadSpeedAPI.promise;
}

function attachSpeedController(iframe, id) {
  const state = speedState();
  state.frame = iframe;
  $("speed-status").textContent = "";

  const valid = () =>
    state.frame === iframe && iframe.isConnected &&
    current === id && !$("player").hidden &&
    feed && freshFeed(feed) &&
    feed.videos.some(video =>
      video.id === id && draftAllows(video.channelId) &&
      feed.channels.some(channel => channel.id === video.channelId)
    );

  let endedHandled = false;
  loadSpeedAPI().then(() => {
    if (!valid()) return;
    state.player = new window.YT.Player(iframe, {
      events: {
        onReady: () => {
          if (!valid()) return;
          state.ready = true;
          readyTubeExtras();
          applyPreferredSpeed();
        },
        onStateChange: event => {
          if (!valid()) return;
          if (event.data === 1) {
            endedHandled = false;
            applyPreferredSpeed();
          }
          if (event.data === 0 && !endedHandled) {
            endedHandled = true;
            if (playbackOptions().loop) {
              setTimeout(() => {
                if (!valid() || !playbackOptions().loop) return;
                try {
                  if (state.player.getPlayerState() !== 0) return;
                  state.player.seekTo(0, true);
                  state.player.playVideo();
                } catch {
                  $("playback-mode-status").textContent = "Cannot repeat this video. Press Play.";
                }
              }, 0);
              return;
            }
            if (!autoNextState().enabled) return;
            // Defer destruction of the old player until its callback returns.
            setTimeout(() => {
              if (!valid() || !autoNextState().enabled) return;
              if (playbackOptions().loop) return;
              try {
                if (state.player.getPlayerState() !== 0) return;
              } catch { return; }
              advanceAutoNext();
            }, 0);
          }
        },
        onAutoplayBlocked: () => {
          if (valid()) $("playback-mode-status").textContent =
            "Autoplay blocked. Press Play in the video.";
        },
        onApiChange: () => { if (valid()) syncTubeCaptions(); },
        onPlaybackRateChange: () => {
          if (valid()) reportPlaybackSpeed();
        },
        onError: () => {
          if (valid()) {
            $("speed-status").textContent =
              "YouTube reported a playback error. Try Open in YouTube / App.";
          }
        },
      },
    });
  }).catch(() => {
    if (valid()) {
      $("speed-status").textContent =
        "Speed control unavailable. Use YouTube's player controls.";
    }
  });
}

function reportPlaybackSpeed() {
  const state = speedState();
  if (
    !state.ready || !state.player ||
    !state.frame?.isConnected || $("player").hidden
  ) return;
  try {
    const actual = state.player.getPlaybackRate();
    if (!Number.isFinite(actual) || actual <= 0) {
      $("speed-status").textContent = "Unable to confirm playback speed.";
      return;
    }
    if (Math.abs(actual - state.preferred) >= 0.001) {
      $("speed-status").textContent =
        `Selected speed unavailable; playing ${actual}x.`;
    } else {
      $("speed-status").textContent = state.stored
        ? "" : "Cannot save speed; using it for this session.";
    }
  } catch {
    $("speed-status").textContent = "Unable to confirm playback speed.";
  }
}

function applyPreferredSpeed() {
  const state = speedState();
  if (
    !state.ready || !state.player ||
    !state.frame?.isConnected || $("player").hidden
  ) return;
  if (!feed || !freshFeed(feed)) {
    expireFeed();
    return;
  }
  try {
    const rates = state.player.getAvailablePlaybackRates()
      .filter(rate =>
        Number.isFinite(rate) &&
        rate >= 0.25 && rate <= 2 &&
        Number.isInteger(rate * 4)
      )
      .sort((a, b) => a - b);

    if (!rates.length) {
      $("speed-status").textContent = "Speed control unavailable for this video.";
      return;
    }

    const exact = rates.find(
      rate => Math.abs(rate - state.preferred) < 0.001
    );
    const target = exact ??
      rates.filter(rate => rate <= state.preferred).pop() ?? rates[0];

    if (Math.abs(state.player.getPlaybackRate() - target) > 0.001) {
      $("speed-status").textContent = "";
      state.player.setPlaybackRate(target);
    } else {
      reportPlaybackSpeed();
    }
    clearTimeout(state.timer);
    state.timer = setTimeout(reportPlaybackSpeed, 700);
  } catch {
    $("speed-status").textContent = "Unable to apply playback speed.";
  }
}

(function initializeSpeedControls() {
  for (let index = 1; index <= 8; index++) {
    const value = index / 4;
    $("speed-preset").append(new Option(`${value}x`, String(value)));
  }
  updateSpeedControls();
  $("speed-preset").addEventListener("change", () => {
    setPreferredSpeed(Number($("speed-preset").value));
  });
  $("speed-slider").addEventListener("input", () => {
    setPreferredSpeed(Number($("speed-slider").value));
  });
})();


// Categorize the playing channel using the shared category model.
function closePlayerCategories(restoreFocus = false) {
  const panel = $("player-category-panel");
  if (!panel) return;
  panel.hidden = true;
  $("player-category-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus && !$("player").hidden) {
    $("player-category-toggle").focus();
  }
}

function renderPlayerCategories() {
  const options = $("player-category-options");
  options.replaceChildren();
  $("player-category-status").textContent = "";
  updateSharedCategoryStatus();

  const video = feed && feed.videos.find(item => item.id === current);
  const channel = video && feed.channels.find(
    item => item.id === video.channelId
  );
  const ready = Boolean(
    feed && freshFeed(feed) && video && channel &&
    draftAllows(channel.id)
  );
  $("player-category-toggle").disabled = !ready;

  if (!ready) {
    $("player-category-heading").textContent = "Channel unavailable";
    $("player-category-toggle").textContent = "Channel categories";
    return;
  }

  const channelID = channel.id;
  $("player-category-heading").textContent = channel.title;
  const model = categoryState().model;
  const assigned = model.assignments[channelID] || [];
  $("player-category-toggle").textContent =
    "Channel categories" + (assigned.length ? ` (${assigned.length})` : "");

  for (const category of model.categories) {
    const label = element("label");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = assigned.includes(category.id);
    const text = element("span", "", category.name);

    checkbox.addEventListener("change", () => {
      // Recheck the playing channel and freshness before saving.
      const playing = feed && feed.videos.find(item => item.id === current);
      if (
        !feed || !freshFeed(feed) || !playing ||
        playing.channelId !== channelID || !draftAllows(channelID)
      ) {
        checkbox.checked = !checkbox.checked;
        $("player-category-status").textContent =
          "Channel or feed changed. Reopen this panel.";
        return;
      }

      const state = categoryState();
      const tags = new Set(state.model.assignments[channelID] || []);
      if (checkbox.checked) tags.add(category.id);
      else tags.delete(category.id);

      const assignments = {...state.model.assignments};
      if (tags.size) assignments[channelID] = Array.from(tags);
      else delete assignments[channelID];

      try {
        validateCategoryData({...state.model, assignments});
      } catch {
        checkbox.checked = !checkbox.checked;
        $("player-category-status").textContent =
          "Unable to save this assignment. Check category limits.";
        return;
      }

      state.model.assignments = assignments;
      // Updates browsing filters without closing/reloading the player.
      saveCategoryData();
      $("player-category-toggle").textContent =
        "Channel categories" + (tags.size ? ` (${tags.size})` : "");
      $("player-category-status").textContent =
        $("category-editor-status").textContent;
      updatePlaybackNavigation();
    });

    label.append(checkbox, text);
    options.append(label);
  }

  if (!model.categories.length) {
    options.append(element(
      "p", "",
      "No categories yet. Add one using the landing-page category menu."
    ));
  }
}

(function initializePlayerCategories() {
  const panel = $("player-category-panel");
  const toggle = $("player-category-toggle");

  toggle.addEventListener("click", () => {
    if (!panel.hidden) {
      closePlayerCategories(false);
      return;
    }
    closePlayerFeed(false);
    renderPlayerCategories();
    if (toggle.disabled) return;
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    const first = $("player-category-options").querySelector("input");
    (first || $("player-category-done")).focus();
  });

  $("player-category-done").addEventListener("click", () => {
    closePlayerCategories(true);
  });

  // Allow native checkbox/Done keyboard behavior inside this panel.
  panel.addEventListener("keydown", event => {
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) event.stopPropagation();
  });

  document.addEventListener("pointerdown", event => {
    if (!panel.contains(event.target) && !toggle.contains(event.target)) {
      closePlayerCategories(false);
    }
  });
})();


// Repository-backed categories: drafts never imply successful publication.
function categoryDraftDirty() {
  const state = categoryState();
  return JSON.stringify(state.model) !== JSON.stringify(state.published);
}
function updateSharedCategoryStatus() {
  const state = categoryState();
  const stale = state.baseRevision !== state.revision;
  const dirty = categoryDraftDirty();
  const status = !state.revision ? "Source preview: shared snapshot unavailable." :
    stale ? "Stale local draft. Export a backup, reload published categories, then reapply edits." :
    dirty ? "Memory-only draft. Reloading loses edits; export or submit through GitHub and wait for publication." :
    "Published categories loaded. No unsaved changes.";
  if ($("category-sync-status")) $("category-sync-status").textContent = status;
  for (const id of ["category-save-shared", "player-category-save"]) {
    if ($(id)) $(id).disabled = !state.revision || !dirty || stale;
  }
}
function compactCategoryOperations(published, model) {
  const operations = [];
  if (JSON.stringify(published.categories) !== JSON.stringify(model.categories)) {
    operations.push({op:"setCategories", categories:model.categories});
  }
  const categoryIDs = new Set(model.categories.map(category => category.id));
  const channels = new Set([...Object.keys(published.assignments), ...Object.keys(model.assignments)]);
  for (const channelId of channels) {
    const before = (published.assignments[channelId] || []).filter(id => categoryIDs.has(id));
    const after = model.assignments[channelId] || [];
    if (JSON.stringify([...before].sort()) !== JSON.stringify([...after].sort())) {
      operations.push({op:"setChannelCategories",channelId,categoryIds:after});
    }
  }
  return operations;
}
function categoryChangeSummary(published, model) {
  const lines = [];
  const before = new Map(published.categories.map(category => [category.id,category.name]));
  const after = new Map(model.categories.map(category => [category.id,category.name]));
  for (const [id,name] of before) {
    if (!after.has(id)) lines.push("Delete category: " + name + " (remove its assignments only)");
    else if (after.get(id) !== name) lines.push("Rename category: " + name + " -> " + after.get(id));
  }
  for (const [id,name] of after) if (!before.has(id)) lines.push("Add category: " + name);
  if (!lines.length && JSON.stringify(published.categories) !== JSON.stringify(model.categories)) {
    lines.push("Update category order");
  }
  const names = new Map((feed?.channels || []).map(channel => [channel.id,channel.title]));
  for (const operation of compactCategoryOperations(published,model)) {
    if (operation.op !== "setChannelCategories") continue;
    const previous = (published.assignments[operation.channelId] || []).map(id => before.get(id)).filter(Boolean);
    const next = operation.categoryIds.map(id => after.get(id));
    lines.push((names.get(operation.channelId) || operation.channelId) + ": " +
      (previous.join(", ") || "Uncategorized") + " -> " + (next.join(", ") || "Uncategorized"));
  }
  return lines;
}
function prepareSharedCategoryRequest() {
  const state = categoryState();
  try {
    validateCategoryData(state.model);
    if (!state.revision || state.baseRevision !== state.revision || !categoryDraftDirty()) {
      throw new Error("Reload published categories before submitting; export any draft first.");
    }
    if (!feed || !freshFeed(feed)) throw new Error("Load a fresh feed before reviewing assignments.");
    const operations = compactCategoryOperations(state.published,state.model);
    if (!operations.length) throw new Error("No effective changes to submit.");
    const allowed = new Set(feed.channels.map(channel => channel.id));
    if (operations.some(operation => operation.op === "setChannelCategories" && !allowed.has(operation.channelId))) {
      throw new Error("A changed channel is outside the current approved feed. Export a backup and remove that edit before submitting.");
    }
    const ascii = value => JSON.stringify(value).replace(/[\u007f-\uffff<>`&]/g,
      ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4,"0"));
    const encoded = ascii({baseRevision:state.baseRevision,operations});
    if (encoded.length > 47000) throw new Error("Too many changes for one Issue. Export a backup and submit smaller groups.");
    const payload = "```json\n" + encoded + "\n```";
    $("category-request-text").value = payload;
    const list = $("category-review-changes");
    list.replaceChildren();
    const lines = categoryChangeSummary(state.published,state.model);
    for (const line of lines) list.append(element("li", "", line));
    $("category-review-count").textContent = lines.length + (lines.length === 1 ? " change to share" : " changes to share");
    $("category-review-details").open = false;
    const url = new URL("https://github.com/linyuli303/Apps/issues/new");
    url.searchParams.set("template", "category-change.yml");
    url.searchParams.set("title", "[MyTube] Category change");
    url.searchParams.set("category_request", payload);
    const large = url.href.length > 6500;
    if (large) url.searchParams.delete("category_request");
    $("category-open-issue").href = url.href;
    $("category-review-message").textContent = large ? "Copy the compact request under Technical details and paste it into Category request on GitHub, including both code fences." : "Only your changes will be prefilled on GitHub. Nothing has been submitted yet.";
    $("category-review").showModal();
  } catch (error) {
    $("category-editor-status").textContent = error.message;
    $("player-category-status").textContent = error.message;
  }
}
(function initializeSharedCategoryControls() {
  for (const id of ["category-save-shared", "player-category-save"]) {
    $(id).addEventListener("click", prepareSharedCategoryRequest);
  }
  $("category-reload-published").addEventListener("click", () => {
    if (!confirm("Discard this browser's draft and reload the published page? Export a backup first if needed.")) return;
    location.reload();
  });
  $("category-migrate-local").addEventListener("click", () => {
    try {
      const state = categoryState();
      // Explicit recovery only; never copy or remove old browser storage.
      const previousScope = encodeURIComponent("/MyTube/");
      const candidates = [
        [state.key, true],
        [state.legacyKey, false],
        ["approved-yt-category-draft-v2:" + previousScope, true],
        ["approved-yt-categories-v1:" + previousScope, false],
      ];
      let recovered = null;
      for (const [key, wrapped] of candidates) {
        const stored = localStorage.getItem(key);
        if (stored !== null) {
          recovered = {stored, wrapped};
          break;
        }
      }
      if (!recovered || !recovered.stored || recovered.stored.length > 2000000) throw new Error();
      const parsed = JSON.parse(recovered.stored);
      const value = recovered.wrapped ? parsed.model : parsed;
      const baseRevision = recovered.wrapped ? parsed.baseRevision : state.revision;
      if (!(baseRevision === null ||
          (typeof baseRevision === "string" && /^[0-9a-f]{40}$/.test(baseRevision)))) {
        throw new Error();
      }
      validateCategoryData(value);
      if (!confirm("Restore old browser categories into page memory? Reloading loses these edits. Existing storage stays unchanged; export a backup before leaving.")) return;
      state.model = value;
      state.baseRevision = baseRevision;
      saveCategoryData();
      renderCategoryEditor();
    } catch { $("category-editor-status").textContent = "No valid previous browser categories found. You can import your exported JSON backup instead."; }
  });
  $("category-review-close").addEventListener("click", () => $("category-review").close());
  $("category-review").addEventListener("keydown", event => event.stopPropagation());
  $("category-copy-request").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("category-request-text").value);
      $("category-review-message").textContent = "Copied. Paste into Category request on GitHub if the form is not prefilled. Still not submitted.";
    } catch {
      $("category-request-text").focus(); $("category-request-text").select();
      $("category-review-message").textContent = "Select and copy the request manually, including its code fences.";
    }
  });
  $("category-review").addEventListener("close", () => {
    const target = $("category-editor").open ? $("category-save-shared") :
      !$("player").hidden && !$("player-category-panel").hidden ? $("player-category-save") : $("configuration-toggle");
    if (!target.disabled) target.focus();
  });
  updateSharedCategoryStatus();
})();


// Page-memory auto-next preference; never changes channel approval.
function autoNextState() {
  if (autoNextState.saved) return autoNextState.saved;
  return autoNextState.saved = {enabled:false};
}

function nextAutoVideoID(items, playing, eligible) {
  const index = items.findIndex(video => video.id === playing);
  if (index < 0) return null;
  for (let offset = index + 1; offset < items.length; offset++) {
    const video = items[offset];
    if (video.id !== playing && eligible(video)) return video.id;
  }
  return null;
}
function advanceAutoNext() {
  if (!autoNextState().enabled || $("player").hidden || !current) return;
  if (!feed || !freshFeed(feed)) {
    expireFeed();
    return;
  }
  const nextID = nextAutoVideoID(render.navigationVideos || visible, current, video =>
    shortVideoAllows(video) && safeID(video.id) && draftAllows(video.channelId) && categoryAllows(video.channelId) &&
    feed.channels.some(channel => channel.id === video.channelId) &&
    feed.videos.some(item => item.id === video.id && item.channelId === video.channelId)
  );
  if (nextID) openPlayer(nextID);
}
(function initializeAutoNext() {
  const toggle = $("auto-next"), state = autoNextState();
  toggle.checked = state.enabled;
  toggle.addEventListener("change", () => {
    state.enabled = toggle.checked;
  });
})();


// Playback Feed menu: reads the existing filtered list; no network requests.
function playerFeedState() {
  if (!playerFeedState.saved) playerFeedState.saved = {page: 0};
  return playerFeedState.saved;
}
function playbackDurationSeconds(value) {
  if (typeof value !== "string" || value.length > 100) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some(part => part !== undefined)) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 + Number(match[4] || 0);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 315360000 ? seconds : null;
}
function playbackDurationLabel(value) {
  const seconds = playbackDurationSeconds(value);
  if (seconds === null) return "Unavailable";
  const whole = Math.floor(seconds), hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const tail = String(whole % 60).padStart(2, "0");
  return hours ? hours + ":" + String(minutes).padStart(2, "0") + ":" + tail : minutes + ":" + tail;
}
function playbackFeedItems() {
  if (!feed || !freshFeed(feed) || $("player").hidden) return [];
  const approved = new Set(feed.channels.map(channel => channel.id));
  const membership = new Map(feed.videos.map(video => [video.id, video.channelId]));
  return visible.filter(video => shortVideoAllows(video) && safeID(video.id) && approved.has(video.channelId) &&
    membership.get(video.id) === video.channelId && draftAllows(video.channelId) &&
    categoryAllows(video.channelId));
}
function closePlayerFeed(restoreFocus = false) {
  const panel = $("player-feed-panel"), toggle = $("player-feed-toggle");
  if (!panel || !toggle) return;
  panel.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Show feed");
  toggle.title = "Show feed";
  if (restoreFocus && !$("player").hidden) toggle.focus();
}
function renderPlayerFeed() {
  const panel = $("player-feed-panel");
  if (!panel || panel.hidden) return;
  const items = playbackFeedItems(), state = playerFeedState();
  const pages = Math.max(1, Math.ceil(items.length / 48));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const names = new Map((feed?.channels || []).map(channel => [channel.id, channel.title]));
  const list = $("player-feed-list");
  list.replaceChildren();
  for (const video of items.slice(state.page * 48, (state.page + 1) * 48)) {
    const button = element("button", "player-feed-row");
    button.type = "button";
    button.setAttribute("aria-current", String(video.id === current));
    button.setAttribute("aria-label", video.title + " - " + (names.get(video.channelId) || "") +
      " - " + playbackDurationLabel(video.duration));
    const title = element("span", "player-feed-title", video.title);
    const duration = element("span", "player-feed-duration", playbackDurationLabel(video.duration));
    duration.title = "Video duration";
    let count = "Views unavailable";
    if (typeof video.viewCount === "string" && /^[0-9]{1,20}$/.test(video.viewCount)) {
      try { count = BigInt(video.viewCount).toLocaleString() + " views"; }
      catch { count = video.viewCount + " views"; }
    }
    const meta = element("span", "player-feed-meta",
      (names.get(video.channelId) || "") + " | " + dateLabel(video.publishedAt) + " | " + count);
    button.append(title, duration, meta);
    button.addEventListener("click", () => {
      // Revalidate the current list, snapshot and approval at click time.
      if (!playbackFeedItems().some(item => item.id === video.id)) {
        renderPlayerFeed();
        return;
      }
      openPlayer(video.id);
    });
    list.append(button);
  }
  if (!items.length) list.append(element("p", "", "No eligible videos in the current filtered list."));
  $("player-feed-page").textContent = "Page " + (state.page + 1) + " of " + pages;
  $("player-feed-prev-page").disabled = state.page === 0;
  $("player-feed-next-page").disabled = state.page + 1 >= pages;
}
(function initializePlayerFeed() {
  const panel = $("player-feed-panel"), toggle = $("player-feed-toggle");
  toggle.addEventListener("click", () => {
    if (!panel.hidden) { closePlayerFeed(false); return; }
    if ($("player").hidden || !feed || !freshFeed(feed)) {
      if (feed && !freshFeed(feed)) expireFeed();
      return;
    }
    closePlayerCategories(false);
    const items = playbackFeedItems(), index = items.findIndex(video => video.id === current);
    playerFeedState().page = index < 0 ? 0 : Math.floor(index / 48);
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Hide feed");
    toggle.title = "Hide feed";
    renderPlayerFeed();
  });
  for (const [id, direction] of [["player-feed-prev-page", -1], ["player-feed-next-page", 1]]) {
    $(id).addEventListener("click", () => {
      playerFeedState().page += direction;
      renderPlayerFeed();
      $(direction < 0 ? "player-feed-next-page" : "player-feed-prev-page").focus();
    });
  }
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "BrowserBack" ||
        event.keyCode === 10009 || event.keyCode === 461) {
      event.preventDefault(); event.stopPropagation(); closePlayerFeed(true);
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.stopPropagation();
    }
  });
  document.addEventListener("pointerdown", event => {
    if (
      !panel.hidden &&
      !panel.contains(event.target) &&
      !toggle.contains(event.target) &&
      !$("tube-preview-settings")?.contains(event.target) &&
      !$("tube-preview-config")?.contains(event.target)
    ) {
      closePlayerFeed(panel.contains(document.activeElement));
    }
  });
})();


// Navigation/short-duration preferences do not modify the approved whitelist.
function playbackOptions() {
  if (playbackOptions.saved) return playbackOptions.saved;
  return playbackOptions.saved = {skipShort:true, loop:false};
}

function shortVideoAllows(video) {
  const seconds = playbackDurationSeconds(video.duration);
  return !playbackOptions().skipShort || seconds === null || seconds >= 60;
}
function viewsForDuration(card) { return card.querySelector(".text-feed-views"); }
function eligibleNavigationVideo(video) {
  return feed && freshFeed(feed) && safeID(video.id) && shortVideoAllows(video) &&
    draftAllows(video.channelId) && categoryAllows(video.channelId) &&
    feed.channels.some(channel => channel.id === video.channelId) &&
    feed.videos.some(item => item.id === video.id && item.channelId === video.channelId);
}
function adjacentApprovedID(items, playing, direction, eligible) {
  if (!items.length) return null;
  const index = items.findIndex(video => video.id === playing);
  for (let step = 1; step <= items.length; step++) {
    const offset = index < 0 ? (direction > 0 ? step - 1 : items.length - step) :
      (index + direction * step + items.length * 2) % items.length;
    const video = items[offset];
    if (video.id !== playing && eligible(video)) return video.id;
  }
  return null;
}
function updatePlaybackNavigation() {
  const items = render.navigationVideos || visible;
  for (const [id,direction] of [["previous",-1],["next",1]]) {
    if ($(id)) $(id).disabled = !adjacentApprovedID(items,current,direction,eligibleNavigationVideo);
  }
}
function navigateApprovedVideo(direction) {
  if (!feed || !freshFeed(feed)) { expireFeed(); return; }
  const id = adjacentApprovedID(render.navigationVideos || visible,current,direction,eligibleNavigationVideo);
  if (id) openPlayer(id);
}
(function initializePlaybackOptions() {
  const state = playbackOptions();
  $("skip-short-videos").checked = state.skipShort;
  $("skip-short-videos").addEventListener("change", () => {
    state.skipShort = $("skip-short-videos").checked;
    page = 0;
    playerFeedState().page = 0;
    if (feed) render();
    renderRSSCatalogue();
    updatePlaybackNavigation();
  });
  $("previous").addEventListener("click", () => navigateApprovedVideo(-1));
  $("loop-video").addEventListener("click", () => {
    state.loop = !state.loop;
    $("loop-video").setAttribute("aria-pressed",String(state.loop));
  });
})();


// Category buttons retain the existing filter and its change-event pipeline.
function renderCategoryTabs() {
  const select = $("category-filter"), tabs = $("category-tabs");
  if (!select || !tabs) return;
  const activeID = tabs.contains(document.activeElement)
    ? document.activeElement.dataset.category : null;
  const scroll = tabs.scrollLeft;
  tabs.replaceChildren();
  for (const option of Array.from(select.options)) {
    const button = element("button", "category-tab");
    button.type = "button";
    button.dataset.category = option.value;
    button.textContent = option.value === "all" ? "All" : option.textContent;
    button.setAttribute("aria-pressed", String(option.value === select.value));
    button.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", {bubbles:true}));
      renderCategoryTabs();
      const chosen = Array.from(tabs.children).find(item => item.dataset.category === select.value);
      if (chosen) chosen.focus({preventScroll:true});
    });
    tabs.append(button);
  }
  tabs.scrollLeft = scroll;
  if (activeID !== null) {
    const replacement = Array.from(tabs.children).find(item => item.dataset.category === activeID);
    if (replacement) replacement.focus({preventScroll:true});
  }
}
(function initializeConfiguration() {
  const config = $("configuration-dialog"), toggle = $("configuration-toggle");
  const whitelistDialog = $("whitelist-dialog"), manager = $("whitelist-manager");
  // Move the existing node, not a copy: IDs, controls and listeners are preserved.
  $("whitelist-dialog-content").append(manager);
  manager.open = true;
  toggle.addEventListener("click", () => {
    if (config.open) return;
    config.showModal();
    toggle.setAttribute("aria-expanded", "true");
  });
  $("configuration-close").addEventListener("click", () => config.close());
  config.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    // A management dialog may have opened in the same interaction.
    queueMicrotask(() => {
      if (!$("category-editor").open && !whitelistDialog.open && !config.open) toggle.focus();
    });
  });
  $("configuration-whitelist").addEventListener("click", () => {
    config.close();
    manager.open = true;
    renderManager();
    whitelistDialog.showModal();
  });
  $("whitelist-dialog-close").addEventListener("click", () => whitelistDialog.close());
  whitelistDialog.addEventListener("close", () => toggle.focus());
  for (const dialog of [config, whitelistDialog]) {
    dialog.addEventListener("keydown", event => event.stopPropagation());
  }
  $("category-filter").addEventListener("change", renderCategoryTabs);
  renderCategoryTabs();
})();


// Replaced by prepare_site.py only. Validated public media URLs; requested only on Play.
const PODCAST_PUBLIC_SNAPSHOT = null;
(function initializePodcastBrowsing() {
  const snapshot = PODCAST_PUBLIC_SNAPSHOT;
  const ready = snapshot && snapshot.version === 1;
  const shows = ready ? snapshot.shows : [];
  const episodes = ready ? snapshot.episodes : [];
  const names = new Map(shows.map(show => [show.id, show.title]));
  initializePodcastConfiguration(shows);
  let podcastPage = 0;
  let matches = [];
  const playback = createPodcastPlayer(episodes, names, () => matches, () => renderPodcasts());
  function duration(seconds) {
    if (seconds === null) return "Duration unavailable";
    const hours = Math.floor(seconds / 3600);
    return hours ? hours + ":" + String(Math.floor(seconds % 3600 / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0") : Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }
  for (const show of shows) {
    if (show.status === "ok") $("podcast-show").append(new Option(show.title, show.id));
    $("podcast-sources").append(element("li", "", show.title + " - " + (show.status === "ok" ? show.episodeCount + " episodes" : show.status === "pending" ? "Pending source verification" : "Unavailable at collection")));
  }
  function renderPodcasts(reset = false) {
    if (reset) podcastPage = 0;
    const query = $("podcast-search").value.trim().toLocaleLowerCase();
    matches = episodes.filter(e => (!$("podcast-show").value || e.showId === $("podcast-show").value) && (e.title + " " + names.get(e.showId)).toLocaleLowerCase().includes(query));
    matches.sort((a,b) => $("podcast-sort").value === "title" ? a.title.localeCompare(b.title) : $("podcast-sort").value === "old" ? a.publishedAt.localeCompare(b.publishedAt) : b.publishedAt.localeCompare(a.publishedAt));
    podcastPage = Math.min(podcastPage, Math.max(0, Math.ceil(matches.length / 48) - 1));
    const fragment = document.createDocumentFragment();
    for (const episode of matches.slice(podcastPage * 48, (podcastPage + 1) * 48)) {
      const row = element("article", "podcast-row");
      const date = element("time", "podcast-date", dateLabel(episode.publishedAt));
      date.dateTime = episode.publishedAt;
      row.dataset.episode = episode.id;
      const controls = element("span", "podcast-row-controls");
      controls.append(playback.rowPlay(episode), playback.rowAdd(episode));
      row.classList.toggle("podcast-current", playback.currentID() === episode.id);
      row.append(date, element("span", "podcast-show-name", names.get(episode.showId)), element("span", "podcast-episode-title", episode.title), controls, element("span", "podcast-duration", duration(episode.durationSeconds)));
      fragment.append(row);
    }
    if (!matches.length) fragment.append(element("p", "", ready ? "No matching episodes." : "Podcast catalogue not packaged yet. Local source alone contains no podcast data."));
    $("podcast-results").replaceChildren(fragment);
    $("podcast-status").textContent = ready ? matches.length + " episodes | " + shows.filter(s => s.status === "ok").length + " available shows | Collected " + dateLabel(snapshot.generatedAt) + ". Audio starts only on Play." : "Podcast metadata unavailable. YouTube remains independent.";
    $("podcast-prev").disabled = podcastPage === 0;
    $("podcast-next").disabled = (podcastPage + 1) * 48 >= matches.length;
    $("podcast-page-status").textContent = "Page " + (podcastPage + 1) + " of " + Math.max(1, Math.ceil(matches.length / 48));
  }
  function route() {
    const spotify = location.hash === "#/spotify";
    const legacy = location.hash === "#/podcasts" ? "MyPodcasts"
      : location.hash === "#/tube" ? "MyTube" : null;
    const podcastPath = new URL("MyPodcasts/", MYAPPS_ROOT).pathname;
    const podcast = !spotify && (legacy ? legacy === "MyPodcasts"
      : location.pathname === podcastPath);
    const tube = !spotify && !podcast;

    if (legacy) {
      const target = new URL(legacy + "/", MYAPPS_ROOT);
      target.search = location.search;
      history.replaceState(history.state, "", target.href);
    }
    if (!tube && !$("player").hidden) closePlayer();
    $("tube-page").hidden = !tube;
    $("podcast-page").hidden = !podcast;
    $("spotify-page").hidden = !spotify;
    $("rss-catalogue").hidden = !tube;

    for (const [id, active] of [
      ["myapps-tube", tube],
      ["myapps-podcasts", podcast],
      ["myapps-spotify", spotify],
    ]) {
      if (active) $(id).setAttribute("aria-current", "page");
      else $(id).removeAttribute("aria-current");
    }
    if (podcast) renderPodcasts();
  }
  function navigate(section) {
    const target = new URL(section + "/", MYAPPS_ROOT);
    target.search = location.search;
    if (location.pathname !== target.pathname || location.hash) {
      history.pushState(null, "", target.href);
    }
    route();
  }
  $("myapps-spotify").addEventListener("click", () => {
    const target = new URL(MYAPPS_ROOT.href);
    target.search = location.search;
    target.hash = "/spotify";
    if (location.href !== target.href) {
      history.pushState(null, "", target.href);
    }
    route();
  });
  $("myapps-tube").addEventListener("click", () => navigate("MyTube"));
  $("myapps-podcasts").addEventListener("click", () => navigate("MyPodcasts"));
  $("podcast-search").addEventListener("input", () => renderPodcasts(true));
  for (const id of ["podcast-show", "podcast-sort"]) $(id).addEventListener("change", () => renderPodcasts(true));
  $("podcast-prev").addEventListener("click", () => { podcastPage--; renderPodcasts(); });
  $("podcast-next").addEventListener("click", () => { podcastPage++; renderPodcasts(); });
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);
  route();
})();


// Podcast playback uses one audio element, no autoplay source or next-episode prefetch.
// Native media may use browser caching and provider cookies; no credential-free claim.
// Pure attempt policy: no media requests, storage, or automatic playback.
function createPodcastPrivacyPolicy() {
  let current = null;
  let wantsPlayback = false;

  function makeAttempt(episodeId, mode, position) {
    return Object.freeze({episodeId, mode, position});
  }

  function begin(episodeId) {
    if (typeof episodeId !== "string" || !episodeId) {
      throw new Error("Invalid podcast episode identity");
    }
    current = makeAttempt(episodeId, "anonymous", 0);
    wantsPlayback = true;
    return current;
  }

  function isCurrent(attempt) {
    return current !== null && attempt === current;
  }

  function shouldPlay(attempt) {
    return isCurrent(attempt) && wantsPlayback;
  }

  function pause() {
    wantsPlayback = false;
  }

  function resume(attempt) {
    if (!isCurrent(attempt)) return false;
    wantsPlayback = true;
    return true;
  }

  function invalidate() {
    current = null;
    wantsPlayback = false;
  }

  function fallback(attempt, mediaErrorCode, position) {
    // MediaError 2 = network; 4 = unsupported source (can include CORS).
    // Neither establishes that CORS caused the failure.
    // Do not downgrade on abort (1), decode failure (3), autoplay rejection,
    // waiting/stalled events, or a timer.
    if (!shouldPlay(attempt) || attempt.mode !== "anonymous" ||
        ![2, 4].includes(mediaErrorCode)) {
      return null;
    }

    const safePosition = Number.isFinite(position) && position >= 0
      ? position : 0;
    current = makeAttempt(attempt.episodeId, "standard", safePosition);
    return current;
  }

  return Object.freeze({
    begin, isCurrent, shouldPlay, pause, resume, invalidate, fallback,
  });
}
function createPodcastPlayer(episodes, names, filtered, rerender) {
  const audio = document.createElement("audio");
  audio.preload = "none";
  audio.setAttribute("aria-hidden", "true");
  audio.hidden = true;
  $("podcast-player").append(audio);
  // Persistent disclosure is separate from loading/error status.
  const privacyNotice = element("p", "podcast-privacy-notice");
  privacyNotice.id = "podcast-privacy-status";
  privacyNotice.setAttribute("role", "status");
  privacyNotice.setAttribute("aria-live", "polite");
  privacyNotice.hidden = true;
  $("podcast-player").querySelector(".podcast-transport-area").append(privacyNotice);

  let refreshPrivacyPresentation = () => {};
  function reportPodcastPrivacy(mode) {
    if (!["anonymous", "standard", "none"].includes(mode)) return;
    $("podcast-player").dataset.privacyMode = mode;
    privacyNotice.hidden = mode === "none";
    privacyNotice.textContent = mode === "anonymous"
      ? "Anonymous audio mode: cross-origin credentials excluded. Browser caching may occur."
      : mode === "standard"
        ? "Standard playback fallback: provider cookies may be used, subject to browser settings. Browser caching may occur."
        : "";
    refreshPrivacyPresentation();
  }
  const byID = new Map(episodes.map(e => [e.id, e]));
  const allowedHosts = new Set(["adswizz.podigee-cdn.net", "anchor.fm", "audio.podigee-cdn.net", "cdn.audiorella.com", "d3ctxlq1ktw2nl.cloudfront.net", "dcs-cached.megaphone.fm", "dts.podtrac.com", "npr.simplecastaudio.com", "play.podtrac.com", "podcast-mp3.dradio.de", "podfileszdf-a.akamaihd.net", "prfx.byspotify.com", "radiodownloaddw-a.akamaihd.net", "traffic.megaphone.fm", "wdrmedien-a.akamaihd.net", "cdn-storage.br.de", "media.neuland.br.de"]);
  let queue = [], index = -1, repeat = "off", speed = 1, generation = 0, drag = null;
  const icons = {
    play:["M8 5l11 7-11 7z"], pause:["M9 5v14M16 5v14"],
    back:["M5 8a9 9 0 1 1-1 8M5 3v5h5"], forward:["M19 8a9 9 0 1 0 1 8M19 3v5h-5"],
    previous:["M5 5v14M19 5l-10 7 10 7z"], next:["M19 5v14M5 5l10 7-10 7z"],
    add:["M4 6h12M4 11h8M4 16h8M18 12v8M14 16h8"],
    top:["M5 4h14M12 20V8M6 14l6-6 6 6"],
    up:["M6 14l6-6 6 6"], down:["M6 10l6 6 6-6"], close:["M6 6l12 12M18 6L6 18"],
    repeat:["M4 10V8a3 3 0 0 1 3-3h13m-4-4 4 4-4 4M20 14v2a3 3 0 0 1-3 3H4m4-4-4 4 4 4"],
    speaker:["M11 5 6 9H3v6h3l5 4V5Z","M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"],
    muted:["M11 5 6 9H3v6h3l5 4V5Z","M16 9l6 6M22 9l-6 6"],
    queue:["M4 6h16M4 11h16M4 16h8M16 15l5 3-5 3z"]
  };
  function icon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns,"svg");
    svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("class","apps-icon");
    svg.setAttribute("aria-hidden","true"); svg.setAttribute("focusable","false");
    for (const d of icons[name]) { const path=document.createElementNS(ns,"path"); path.setAttribute("d",d); svg.append(path); }
    if (name === "back" || name === "forward") {
      const text=document.createElementNS(ns,"text"); text.setAttribute("x","12");text.setAttribute("y","15");text.setAttribute("text-anchor","middle");text.setAttribute("class","podcast-skip-number");text.textContent="15";svg.append(text);
    }
    return svg;
  }
  function decorate(button,name,label) { button.replaceChildren(icon(name));button.setAttribute("aria-label",label);button.title=label; }
  function button(name,label,action) { const b=element("button","podcast-icon-button");b.type="button";decorate(b,name,label);b.addEventListener("click",action);return b; }
  const active = () => byID.get(queue[index]) || null;
  const time = value => { if (!Number.isFinite(value)) return "--:--";const n=Math.max(0,Math.floor(value));return n>=3600?Math.floor(n/3600)+":"+String(Math.floor(n%3600/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0"):Math.floor(n/60)+":"+String(n%60).padStart(2,"0"); };
  function safeMedia(e) {
    if (!e || typeof e.mediaUrl !== "string") return false;
    try { const u=new URL(e.mediaUrl);return u.protocol==="https:" && !u.username && !u.password && !u.hash && (!u.port || u.port==="443") && allowedHosts.has(u.hostname); } catch { return false; }
  }
  function message(text) { $("podcast-playback-status").textContent=text; }
  function showQueue(open) { $("podcast-queue").hidden=!open;$("podcast-queue-toggle").setAttribute("aria-expanded",String(open)); }
  function sync() {
    const e=active();if(e){$("podcast-now-title").textContent=e.title;$("podcast-now-show").textContent=names.get(e.showId)||"";}
    decorate(play,audio.paused?"play":"pause",audio.paused?"Resume podcast":"Pause podcast");
    previous.disabled=index<=0;next.disabled=index<0||index+1>=queue.length;
    const duration=Number.isFinite(audio.duration)?audio.duration:null;
    $("podcast-seek").disabled=duration===null||duration<=0;
    $("podcast-seek").max=duration||1;$("podcast-seek").value=Number.isFinite(audio.currentTime)?audio.currentTime:0;
    $("podcast-elapsed").textContent=time(audio.currentTime);$("podcast-total").textContent=time(duration===null?e?.durationSeconds:duration);
    for(const row of $("podcast-results").querySelectorAll("[data-episode]")) {
      const current=row.dataset.episode===e?.id;row.classList.toggle("podcast-current",current);
      const b=row.querySelector(".podcast-row-play");if(b)decorate(b,current&&!audio.paused?"pause":"play",(current&&!audio.paused?"Pause ":"Play ")+(byID.get(row.dataset.episode)?.title||"episode"));
    }
  }
  const privacyPolicy = createPodcastPrivacyPolicy();
  let privacyAttempt = null;
  let releaseAttemptListeners = () => {};
  let playSequence = 0;
  let lastPlaybackPosition = 0;

  function pausePodcast() {
    privacyPolicy.pause();
    playSequence++;
    audio.pause();
    sync();
  }

  function clearSource() {
    generation++;
    playSequence++;
    privacyPolicy.invalidate();
    privacyAttempt = null;
    releaseAttemptListeners();
    releaseAttemptListeners = () => {};
    lastPlaybackPosition = 0;
    audio.pause();
    audio.removeAttribute("src");
    audio.removeAttribute("crossorigin");
    audio.load();
    reportPodcastPrivacy("none");
  }

  function attemptPlay() {
    const attempt = privacyAttempt;
    if (!attempt || !privacyPolicy.resume(attempt)) return;
    const token = generation;
    const sequence = ++playSequence;

    audio.play().then(() => {
      if (token !== generation || sequence !== playSequence ||
          !privacyPolicy.shouldPlay(attempt)) return;
      message("");
      sync();
    }).catch(error => {
      if (token !== generation || sequence !== playSequence ||
          !privacyPolicy.shouldPlay(attempt)) return;
      // A source rejection can precede the corresponding media error event.
      // Keep that event eligible; the rejection itself never causes fallback.
      if (error && error.name === "NotSupportedError") {
        message("Source could not start. Waiting for media error details; Pause cancels.");
        sync();
        return;
      }
      // Autoplay/other rejection: the next explicit tap should retry.
      privacyPolicy.pause();
      message("Playback blocked or unavailable. Press Play to retry.");
      sync();
    });
  }

  function loadPodcastAttempt(attempt) {
    const episode = active();
    if (!episode || !safeMedia(episode) ||
        episode.id !== attempt.episodeId ||
        !privacyPolicy.isCurrent(attempt)) return;

    releaseAttemptListeners();
    const token = ++generation;
    playSequence++;
    privacyAttempt = attempt;

    const valid = () =>
      token === generation && privacyPolicy.isCurrent(attempt) &&
      active()?.id === attempt.episodeId &&
      audio.getAttribute("src") === episode.mediaUrl;

    const onTime = () => {
      if (valid() && Number.isFinite(audio.currentTime)) {
        lastPlaybackPosition = Math.max(0, audio.currentTime);
      }
    };

    let restorePositionPending = attempt.position > 0;
    const onMetadata = () => {
      if (!valid()) return;
      if (restorePositionPending) {
        restorePositionPending = false;
        try {
          const maximum = Number.isFinite(audio.duration)
            ? Math.max(0, audio.duration - 0.05) : attempt.position;
          audio.currentTime = Math.min(attempt.position, maximum);
        } catch {
          message("Playback position could not be restored.");
        }
        // Metadata may restore position, but must never restart playback.
      }
    };

    const onError = () => {
      if (!valid() || !audio.error) return;
      const retry = privacyPolicy.fallback(
        attempt, audio.error.code, lastPlaybackPosition
      );
      if (retry) {
        loadPodcastAttempt(retry);
        return;
      }
      if (!privacyPolicy.shouldPlay(attempt)) return;
      privacyPolicy.pause();
      message(
        "Audio unavailable. Check media permissions, network access, or try another episode. No further automatic retry."
      );
      sync();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("error", onError);
    releaseAttemptListeners = () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("error", onError);
    };

    audio.pause();
    audio.removeAttribute("src");
    if (attempt.mode === "anonymous") {
      audio.crossOrigin = "anonymous";
    } else {
      // Removing the attribute restores ordinary, non-CORS media loading.
      audio.removeAttribute("crossorigin");
    }
    reportPodcastPrivacy(attempt.mode);
    lastPlaybackPosition = attempt.position;
    audio.src = episode.mediaUrl;
    audio.playbackRate = speed;
    message(attempt.mode === "standard"
      ? "Retrying using standard playback..." : "Loading anonymous audio...");
    audio.load();
    // With preload="none", Play initiates loading even for a position retry.
    // The metadata handler restores position once without issuing another Play.
    if (privacyPolicy.shouldPlay(attempt)) {
      attemptPlay();
    }
  }
  function start(i) {
    const e=byID.get(queue[i]);if(!safeMedia(e)){message("Episode has no approved audio URL.");return;}
    clearSource();index=i;
    if (!$("player").hidden) closePlayer();
    $("podcast-player").hidden=false;document.body.classList.add("podcast-player-open");
    const attempt = privacyPolicy.begin(e.id);
    sync();renderQueue();
    loadPodcastAttempt(attempt);
  }
  function toggle() {
    if (!active()) {
      if (queue.length) start(0);
      return;
    }
    // A loading request can be pending while audio.paused is still true.
    if (!audio.paused || privacyPolicy.shouldPlay(privacyAttempt)) {
      pausePodcast();
      return;
    }
    if (audio.ended) audio.currentTime = 0;
    attemptPlay();
  }
  function selectEpisode(e) {
    if(active()?.id===e.id){toggle();return;}
    const list=filtered();const pos=list.findIndex(x=>x.id===e.id);queue=list.slice(Math.max(0,pos)).filter(safeMedia).map(x=>x.id);start(0);
  }
  function add(e) {if(!safeMedia(e))return;if(!queue.includes(e.id))queue.push(e.id);showQueue(true);renderQueue();}
  function move(from,to) {if(from<=index||to<=index||to<0||to>=queue.length)return;const item=queue.splice(from,1)[0];queue.splice(to,0,item);renderQueue();const target=$("podcast-queue-rows").querySelector('[data-position="'+to+'"] button');target?.focus();}
  function renderQueue() {
    const host=$("podcast-queue-rows");host.replaceChildren();
    // Queue may hold the whole catalogue; render it in bounded chunks on demand.
    let drawn=0;
    function more() {
      host.querySelector(".podcast-queue-more")?.remove();
      const end=Math.min(queue.length,drawn+100);
      for(let i=drawn;i<end;i++) {
        const e=byID.get(queue[i]);if(!e)continue;
        const row=element("div","podcast-queue-row");row.dataset.position=String(i);
        if(i===index)row.setAttribute("aria-current","true");
        row.addEventListener("dblclick",event=>{
          if(event.target.closest("button,select,input,a"))return;
          start(i);
        });
        const title=element("span","podcast-queue-title",e.title);title.append(element("small","",(names.get(e.showId)||"")+(i===index?" - Now playing":i<index?" - Played":"")));row.append(title);
        title.tabIndex=0;
        title.setAttribute("role","button");
        title.setAttribute("aria-label","Play "+e.title);
        title.title="Double-click to play; keyboard: Enter or Space";
        title.addEventListener("keydown",event=>{
          if(event.key==="Enter" || event.key===" ") {
            event.preventDefault();
            event.stopPropagation();
            start(i);
          }
        });
        if(i>index) {
          row.draggable=true;
          const up=button("up","Move episode up",()=>move(i,i-1));up.disabled=i<=index+1;
          const down=button("down","Move episode down",()=>move(i,i+1));down.disabled=i===queue.length-1;
          const remove=button("close","Remove episode from playlist",()=>{queue.splice(i,1);renderQueue();sync();});
          const top=button(
            "top","Move to top of upcoming episodes",
            ()=>move(i,index+1)
          );
          top.disabled=i===index+1;
          row.append(top,up,down,remove);
          row.addEventListener("dragstart",event=>{drag=i;event.dataTransfer.setData("text/plain",String(i));});
          row.addEventListener("dragover",event=>event.preventDefault());
          row.addEventListener("drop",event=>{event.preventDefault();if(drag!==null)move(drag,i);drag=null;});
          row.addEventListener("dragend",()=>{drag=null;});
        }
        host.append(row);
      }
      drawn=end;if(drawn<queue.length){const b=element("button","podcast-queue-more","Show next 100 queued episodes");b.type="button";b.addEventListener("click",more);host.append(b);}
    }
    more();if(!queue.length)host.append(element("p","","Playlist empty. Add episodes with the list button."));
    $("podcast-queue-toggle").replaceChildren(icon("queue"),document.createTextNode("Playlist ("+queue.length+")"));
  }
  function skip(offset) {if(!active())return;try{audio.currentTime=Math.max(0,Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,audio.currentTime+offset));}catch{}sync();}
  const transport=$("podcast-transport");
  const previous=button("previous","Previous episode",()=>{if(index>0)start(index-1);});
  const play=button("play","Resume podcast",toggle);play.classList.add("podcast-main-play");
  const next=button("next","Next episode",()=>{if(index+1<queue.length)start(index+1);});
  const rate=element("select");rate.setAttribute("aria-label","Podcast playback speed");
  for(const n of [.5,.75,1,1.25,1.5,1.75,2])rate.append(new Option(n+"x",String(n)));rate.value="1";
  // Device compatibility is independent of the selected visual layout.
  const lgSpeedLimited = /web[o0]s|netcast/i.test(navigator.userAgent || "");
  function applyPodcastSpeed() {
    const requested = Number(rate.value);
    const target = lgSpeedLimited ? 1 : requested;
    if (![.5, .75, 1, 1.25, 1.5, 1.75, 2].includes(target)) return;
    try {
      audio.playbackRate = target;
      speed = target;
      rate.value = String(target);
    } catch {
      speed = 1;
      rate.value = "1";
      try { audio.playbackRate = 1; } catch {}
      message("Playback speed unavailable. Use normal speed.");
    }
  }
  rate.addEventListener("change", applyPodcastSpeed);
  if (lgSpeedLimited) {
    rate.value = "1";
    rate.disabled = true;
    rate.title = "LG/webOS compatibility: podcast audio uses normal speed.";
    const speedNotice = element(
      "p", "podcast-speed-notice",
      "LG/webOS: podcasts use 1× speed because other speeds may silence audio."
    );
    speedNotice.id = "podcast-speed-compatibility";
    rate.setAttribute("aria-describedby", speedNotice.id);
    $("podcast-player").querySelector(".podcast-transport-area").append(speedNotice);
    audio.addEventListener("ratechange", () => {
      if (audio.playbackRate !== 1) applyPodcastSpeed();
    });
  }
  // Volume is page-memory only; controls never start playback or set a source.
  let lastAudibleVolume = 1;
  const volumeGroup = element("div", "podcast-volume");
  volumeGroup.setAttribute("role", "group");
  volumeGroup.setAttribute("aria-label", "Volume controls");
  const mute = button("speaker", "Mute podcast", () => {
    const silent = audio.muted || audio.volume === 0;
    setVolume(silent ? lastAudibleVolume : 0);
  });
  mute.id = "podcast-mute";
  const volumeLabel = element("label", "sr-only", "Podcast volume");
  volumeLabel.htmlFor = "podcast-volume";
  const volume = element("input");
  volume.id = "podcast-volume";
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.step = "1";
  volume.value = "100";
  volume.autocomplete = "off";
  const volumeValue = element("output", "podcast-volume-value");
  volumeValue.id = "podcast-volume-value";
  volumeValue.setAttribute("for", "podcast-volume");
  function syncVolume() {
    const silent = audio.muted || audio.volume === 0;
    if (!silent) lastAudibleVolume = audio.volume;
    const percent = silent ? 0 : Math.round(audio.volume * 100);
    volume.value = String(percent);
    volume.setAttribute("aria-valuetext", percent + " percent");
    volumeValue.value = percent + "%";
    decorate(mute, silent ? "muted" : "speaker",
      silent ? "Unmute podcast" : "Mute podcast");
    mute.setAttribute("aria-pressed", String(silent));
  }
  function setVolume(level) {
    if (!Number.isFinite(level) || level < 0 || level > 1) return;
    if (!audio.muted && audio.volume > 0) lastAudibleVolume = audio.volume;
    try {
      audio.volume = level;
      audio.muted = level === 0;
      if (Math.abs(audio.volume - level) > 0.001) {
        message("This browser requires device volume controls.");
      }
    } catch {
      message("Volume adjustment unavailable. Use device volume controls.");
    }
    syncVolume();
  }
  volume.addEventListener("input", () => setVolume(Number(volume.value) / 100));
  audio.addEventListener("volumechange", syncVolume);
  volumeGroup.append(mute, volumeLabel, volume, volumeValue);
  transport.append(previous,button("back","Back 15 seconds",()=>skip(-15)),play,button("forward","Forward 15 seconds",()=>skip(15)),next,rate,volumeGroup);
  syncVolume();
  // Presentation only: never change audio, queue, speed or playback position.
  const playerBar = $("podcast-player");
  const expandedParts = [
    playerBar.querySelector(".podcast-now"),
    playerBar.querySelector(".podcast-transport-area"),
    playerBar.querySelector(".podcast-player-options"),
  ];
  if (expandedParts.some(part => !part)) {
    throw new Error("Missing podcast presentation structure");
  }
  let presentation = "expanded";
  let dockSide = "right";

  function presentationIcon(path) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "apps-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const line = document.createElementNS(ns, "path");
    line.setAttribute("d", path);
    svg.append(line);
    return svg;
  }
  function presentationButton(id, label, path, action) {
    const control = element("button", "podcast-presentation-button");
    control.type = "button";
    control.id = id;
    control.title = label;
    control.setAttribute("aria-label", label);
    control.append(presentationIcon(path));
    control.addEventListener("click", action);
    return control;
  }

  const compact = element("div", "podcast-compact");
  compact.id = "podcast-compact";
  const compactTitle = element("strong", "podcast-compact-title");
  compactTitle.id = "podcast-compact-title";
  const compactPlay = button("play", "Resume podcast", toggle);
  compactPlay.id = "podcast-compact-play";

  const collapse = presentationButton(
    "podcast-collapse", "Collapse podcast player",
    "m6 9 6 6 6-6",
    () => setPodcastPresentation("collapsed")
  );
  collapse.setAttribute("aria-controls", "podcast-transport podcast-compact");
  collapse.setAttribute("aria-expanded", "true");

  const dock = presentationButton(
    "podcast-dock", "Dock podcast player to right edge",
    "m9 5 7 7-7 7",
    () => setPodcastPresentation("docked", "right")
  );
  const expand = presentationButton(
    "podcast-expand", "Expand podcast player",
    "m6 15 6-6 6 6",
    () => setPodcastPresentation("expanded")
  );
  expand.setAttribute("aria-controls", "podcast-transport");
  expand.setAttribute("aria-expanded", "false");

  const restore = presentationButton(
    "podcast-restore", "Restore podcast player",
    "m14 6-6 6 6 6",
    () => setPodcastPresentation("collapsed")
  );
  restore.setAttribute("aria-controls", "podcast-compact");
  restore.setAttribute("aria-expanded", "false");

  // The mockup's expanded-side arrow collapses first; it never skips a state.
  const collapseBeforeDock = presentationButton(
    "podcast-collapse-before-dock", "Collapse player before docking",
    "m9 5 7 7-7 7",
    () => setPodcastPresentation("collapsed")
  );
  compact.append(compactTitle, compactPlay, dock, expand);
  expandedParts[0].append(collapse);
  expandedParts[2].append(collapseBeforeDock);
  playerBar.append(compact, restore);

  // Announce errors even when the full player is hidden.
  const compactStatus = element("span", "sr-only");
  compactStatus.setAttribute("role", "status");
  compactStatus.setAttribute("aria-live", "polite");
  playerBar.append(compactStatus);

  function syncPodcastPresentation() {
    compactTitle.textContent = $("podcast-now-title").textContent;
    compactTitle.title = compactTitle.textContent;
    decorate(
      compactPlay, audio.paused ? "play" : "pause",
      audio.paused ? "Resume podcast" : "Pause podcast"
    );
    const standard = playerBar.dataset.privacyMode === "standard";
    compactStatus.textContent = presentation === "expanded" ? "" : [
      standard ? privacyNotice.textContent : "",
      $("podcast-playback-status").textContent,
    ].filter(Boolean).join(" ");

    const restoreLabel = standard
      ? "Restore podcast player. Standard playback fallback; provider cookies may be used."
      : "Restore podcast player";
    restore.setAttribute("aria-label", restoreLabel);
    restore.title = restoreLabel;
    compactPlay.title = standard
      ? compactPlay.getAttribute("aria-label") +
        ". Standard playback fallback; provider cookies may be used."
      : compactPlay.getAttribute("aria-label");
  }

  function setPodcastPresentation(nextState, side = dockSide, focus = true) {
    if (!["expanded", "collapsed", "docked"].includes(nextState) ||
        !["left", "right"].includes(side)) return;

    const previousFocus = document.activeElement;
    presentation = nextState;
    dockSide = side;
    playerBar.dataset.presentation = presentation;
    playerBar.dataset.dockSide = dockSide;

    for (const part of expandedParts) {
      part.hidden = presentation !== "expanded";
    }
    compact.hidden = presentation !== "collapsed";
    restore.hidden = presentation !== "docked";
    restore.replaceChildren(presentationIcon(
      dockSide === "left" ? "m10 6 6 6-6 6" : "m14 6-6 6 6 6"
    ));

    document.body.classList.toggle(
      "podcast-player-collapsed", presentation === "collapsed"
    );
    document.body.classList.toggle(
      "podcast-player-docked", presentation === "docked"
    );
    if (presentation !== "expanded") showQueue(false);
    syncPodcastPresentation();

    if (focus && !playerBar.hidden) {
      const target = presentation === "expanded" ? collapse
        : presentation === "collapsed" ? expand : restore;
      target.focus({preventScroll:true});
    } else if (previousFocus && playerBar.hidden &&
               playerBar.contains(previousFocus)) {
      $("myapps-podcasts").focus();
    }
  }

  // Gestures belong only to title areas, never transport/seek/volume controls.
  function bindPodcastTitleSwipe(titleArea, expectedState) {
    let gesture = null;
    const phoneMode = () =>
      document.documentElement.dataset.deviceLayout === "phone";

    titleArea.addEventListener("pointerdown", event => {
      if (!phoneMode() || presentation !== expectedState ||
          !event.isPrimary || event.button !== 0 ||
          event.target.closest("button,input,select,a,textarea,label")) {
        gesture = null;
        return;
      }
      gesture = {
        id:event.pointerId, x:event.clientX, y:event.clientY,
        started:performance.now(), state:presentation,
      };
      try {
        titleArea.setPointerCapture(event.pointerId);
      } catch {
        gesture = null;
      }
    });

    titleArea.addEventListener("pointerup", event => {
      const start = gesture;
      gesture = null;
      if (!start || event.pointerId !== start.id) return;

      if (titleArea.hasPointerCapture(event.pointerId)) {
        titleArea.releasePointerCapture(event.pointerId);
      }
      if (!phoneMode() || presentation !== start.state ||
          playerBar.hidden || performance.now() - start.started > 1200) {
        return;
      }

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      if (presentation === "expanded") {
        setPodcastPresentation("collapsed");
      } else if (presentation === "collapsed") {
        setPodcastPresentation("docked", dx < 0 ? "left" : "right");
      }
    });

    titleArea.addEventListener("pointercancel", () => { gesture = null; });
    titleArea.addEventListener("lostpointercapture", () => { gesture = null; });
  }
  bindPodcastTitleSwipe(expandedParts[0], "expanded");
  bindPodcastTitleSwipe(compactTitle, "collapsed");
  refreshPrivacyPresentation = syncPodcastPresentation;
  // Observe display text only; no polling, media requests or storage.
  const presentationObserver = new MutationObserver(syncPodcastPresentation);
  presentationObserver.observe($("podcast-now-title"), {
    childList:true, characterData:true, subtree:true,
  });
  presentationObserver.observe($("podcast-playback-status"), {
    childList:true, characterData:true, subtree:true,
  });
  for (const event of ["play", "pause", "ended", "emptied"]) {
    audio.addEventListener(event, syncPodcastPresentation);
  }

  // Reset presentation on Stop; the existing handler then clears playback.
  $("podcast-stop").addEventListener("click", () => {
    setPodcastPresentation("expanded", "right", false);
  });
  setPodcastPresentation("expanded", "right", false);
  $("podcast-seek").addEventListener("input",()=>{if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,Number($("podcast-seek").value));sync();});
  $("podcast-repeat").addEventListener("click",()=>{repeat=repeat==="off"?"all":repeat==="all"?"one":"off";$("podcast-repeat").replaceChildren(icon("repeat"),document.createTextNode(repeat==="one"?"One":repeat==="all"?"List":"Off"));$("podcast-repeat").setAttribute("aria-label","Repeat "+repeat+"; click to change mode");$("podcast-repeat").dataset.mode=repeat;});
  $("podcast-queue-toggle").addEventListener("click",()=>{showQueue($("podcast-queue").hidden);renderQueue();});
  $("podcast-queue").addEventListener("pointerleave",event=>{
    if(event.pointerType==="mouse" && drag===null)showQueue(false);
  });
  $("podcast-queue-close").addEventListener("click",()=>{showQueue(false);$("podcast-queue-toggle").focus();});
  $("podcast-stop").addEventListener("click",()=>{clearSource();queue=[];index=-1;repeat="off";speed=1;rate.value="1";$("podcast-auto-next").checked=true;$("podcast-repeat").replaceChildren(icon("repeat"),document.createTextNode("Off"));$("podcast-repeat").dataset.mode="off";$("podcast-player").hidden=true;document.body.classList.remove("podcast-player-open");showQueue(false);message("");rerender();$("myapps-podcasts").focus();});
  audio.addEventListener("ended",()=>{if(repeat==="one"){audio.currentTime=0;attemptPlay();return;}if(queue.length){if(index+1<queue.length){start(index+1);return;}if(repeat==="all"&&queue.length){start(0);return;}}message("Playlist playback finished.");sync();});
  for(const event of ["play","pause","loadedmetadata","timeupdate","durationchange"])audio.addEventListener(event,sync);
  // Attempt-scoped media error handling is installed by loadPodcastAttempt.
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("podcast-queue").hidden){showQueue(false);$("podcast-queue-toggle").focus();}});
  // Podcast auto-next is always enabled; retain the existing hidden input.
  $("podcast-auto-next").checked = true;
  $("podcast-auto-next").disabled = true;
  $("podcast-auto-next").parentElement.hidden = true;
  decorate($("podcast-stop"),"close","Stop playback and clear playlist");
  $("podcast-repeat").replaceChildren(icon("repeat"),document.createTextNode("Off"));$("podcast-repeat").setAttribute("aria-label","Repeat off; click to change mode");
  window.MyAppsPodcastPlayer={pauseForVideo:()=>{pausePodcast();showQueue(false);}};
  return {
    currentID:()=>active()?.id||null,
    rowPlay:e=>{const b=button(active()?.id===e.id&&!audio.paused?"pause":"play","Play "+e.title,()=>selectEpisode(e));b.classList.add("podcast-row-play");b.disabled=!safeMedia(e);return b;},
    rowAdd:e=>{const b=button("add","Add "+e.title+" to playlist",()=>add(e));b.disabled=!safeMedia(e);return b;}
  };
}


// Device layout is independent of media permissions and playback state.
function detectMyAppsLayout(userAgent, width, coarsePointer) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  // webOS TV identifiers vary; do not classify every LG phone as a TV.
  const lgTV = /web[o0]s|netcast/i.test(ua);
  const otherTV = /smart-tv|smarttv|hbbtv|googletv|appletv|aft[a-z0-9]+/i.test(ua);
  if (lgTV || otherTV) return "tv";
  const mobile = /iphone|ipod|android.*mobile|windows phone/i.test(ua);
  if (Number.isFinite(width) &&
      (width <= 600 || (width <= 750 && (mobile || coarsePointer)))) {
    return "phone";
  }
  return "desktop";
}

(function initializeMyAppsLayout() {
  const host = document.querySelector(".myapps-header-actions");
  if (!host || $("myapps-layout")) return;

  const label = element("label", "myapps-layout-control");
  const caption = element("span", "", "View");
  const select = element("select");
  select.id = "myapps-layout";
  select.setAttribute("aria-label", "Device layout");
  select.append(
    new Option("Auto", "auto"),
    new Option("TV", "tv"),
    new Option("Phone", "phone")
  );
  label.append(caption, select);
  host.append(label);

  const userAgent = navigator.userAgent || "";
  // Compatibility is a separate device signal, never a layout override.
  const lgWebOS = /web[o0]s|netcast/i.test(userAgent);
  document.documentElement.dataset.lgWebos = String(lgWebOS);

  // Decorate existing controls; never replace controls or their listeners.
  function layoutIcon(paths) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "apps-icon myapps-layout-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const value of paths) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", value);
      svg.append(path);
    }
    return svg;
  }
  function labelExistingControl(control, name) {
    if (!control) return;
    control.setAttribute("aria-label", name);
    control.title = name;
    for (const node of Array.from(control.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const caption = element("span", "myapps-action-caption", node.textContent);
        node.replaceWith(caption);
      }
    }
  }
  for (const [id, name] of [
    ["myapps-tube", "MyTube"],
    ["myapps-podcasts", "MyPodcasts"],
    ["configuration-toggle", "Configuration"],
    ["podcast-config", "Podcast configuration"],
    ["rss-toggle", "RSS Catalogue"],
    ["refresh", "Refresh published feed"],
  ]) {
    labelExistingControl($(id), name);
  }
  const rssButton = $("rss-toggle");
  if (rssButton) {
    rssButton.prepend(layoutIcon([
      "M4 4a16 16 0 0 1 16 16",
      "M4 10a10 10 0 0 1 10 10",
      "M4 19h1",
    ]));
  }
  const autoNext = $("podcast-auto-next");
  if (autoNext && autoNext.parentElement) {
    const label = autoNext.parentElement;
    label.classList.add("podcast-auto-next-option");
    labelExistingControl(label, "Auto-next");
    autoNext.insertAdjacentElement("afterend", layoutIcon([
      "m4 5 10 7-10 7z",
      "M18 5v14m-3-3 3 3 3-3",
    ]));
  }

  let preference = "auto";
  function applyLayout() {
    const width = document.documentElement.clientWidth || window.innerWidth;
    const coarse = typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const detected = detectMyAppsLayout(userAgent, width, coarse);
    const effective = preference === "auto" ? detected : preference;
    document.documentElement.dataset.deviceLayout = effective;
    const rssToggle = $("rss-toggle");
    const rssHome = $("rss-catalogue");
    const toolbar = document.querySelector(
      "#tube-page .category-toolbar-actions"
    );
    if (rssToggle && rssHome && toolbar) {
      const destination = toolbar;
      if (rssToggle.parentElement !== destination) {
        destination.append(rssToggle);
      }
    }
    document.documentElement.dataset.layoutPreference = preference;
    select.title = preference === "auto"
      ? "Automatic layout: " + effective
      : "Manual layout: " + effective;
  }

  select.addEventListener("change", () => {
    if (!["auto", "tv", "phone"].includes(select.value)) return;
    preference = select.value;
    applyLayout();
  });
  // Measure the real shared header and content edges, not device guesses.
  function measureRSSCatalogue() {
    const catalogue = $("rss-catalogue");
    const main = document.querySelector("main");
    const header = document.querySelector(".myapps-header");
    if (!catalogue || !main || !header) return;

    const bounds = main.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const style = getComputedStyle(main);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, bounds.left + paddingLeft);
    const right = Math.min(
      viewportWidth - 8, bounds.right - paddingRight
    );
    const top = Math.max(8, headerBounds.bottom + 12);

    catalogue.style.setProperty("--rss-region-left", left + "px");
    catalogue.style.setProperty("--rss-region-top", top + "px");
    catalogue.style.setProperty(
      "--rss-region-width", Math.max(0, right - left) + "px"
    );
    catalogue.style.setProperty(
      "--rss-region-height",
      Math.max(0, viewportHeight - top - 12) + "px"
    );
  }

  window.addEventListener("resize", measureRSSCatalogue);
  window.addEventListener("scroll", measureRSSCatalogue, {passive:true});
  if (typeof ResizeObserver === "function") {
    const catalogueGeometryObserver = new ResizeObserver(measureRSSCatalogue);
    catalogueGeometryObserver.observe(document.querySelector(".myapps-header"));
    catalogueGeometryObserver.observe(document.querySelector("main"));
  }
  measureRSSCatalogue();
  window.addEventListener("resize", applyLayout);
  applyLayout();
})();

// Spotify authorization foundation: generation only, no requests or storage.
// Public application identity. Never add a client secret here.
const MYAPPS_SPOTIFY_CONFIG = Object.freeze({
  clientId: "f900eeb7bfba4a1fa35d0e37ec84c4ec",
  redirectUri: "https://linyuli303.github.io/Apps/",
});

// Lazy adapter: called only by the forthcoming authorization integration.
// Local previews must use injected fake storage, not production login state.
function openSpotifyLoginStore(browser) {
  const expected = new URL(MYAPPS_SPOTIFY_CONFIG.redirectUri);
  if (!browser || !browser.location ||
      browser.location.origin !== expected.origin ||
      !browser.location.pathname.startsWith(expected.pathname)) {
    throw new Error("Spotify login is unavailable on this preview origin.");
  }

  try {
    return createSpotifyTransactionStore(browser.sessionStorage);
  } catch {
    throw new Error("Temporary Spotify login storage unavailable.");
  }
}

async function createSpotifyPKCE(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider ||
      typeof cryptoProvider.getRandomValues !== "function" ||
      !cryptoProvider.subtle ||
      typeof cryptoProvider.subtle.digest !== "function") {
    throw new Error("Secure Spotify authorization unavailable.");
  }

  function base64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  const verifierBytes = new Uint8Array(32);
  const stateBytes = new Uint8Array(32);
  cryptoProvider.getRandomValues(verifierBytes);
  cryptoProvider.getRandomValues(stateBytes);

  const verifier = base64url(verifierBytes);
  const state = base64url(stateBytes);
  const hashed = await cryptoProvider.subtle.digest(
    "SHA-256", new TextEncoder().encode(verifier)
  );
  const challenge = base64url(new Uint8Array(hashed));

  if (![verifier, state, challenge].every(
    value => /^[A-Za-z0-9_-]{43}$/.test(value)
  )) {
    throw new Error("Invalid Spotify authorization material.");
  }

  // Do not log or place the verifier in an authorization URL.
  return Object.freeze({
    verifier,
    state,
    challenge,
    challengeMethod: "S256",
  });
}

// Pure authorization transaction checks; no requests, redirects or storage.
function validateSpotifyAuthTransaction(value, clientId, now = Date.now()) {
  const redirectUri = "https://linyuli303.github.io/Apps/";
  const fields = [
    "version", "clientId", "redirectUri", "verifier",
    "state", "createdAt", "expiresAt"
  ].sort().join(",");

  if (typeof clientId !== "string" ||
      !/^[a-f0-9]{32}$/.test(clientId) ||
      !Number.isSafeInteger(now) || now < 0 ||
      !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== fields ||
      value.version !== 1 ||
      value.clientId !== clientId ||
      value.redirectUri !== redirectUri ||
      typeof value.verifier !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.verifier) ||
      typeof value.state !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.state) ||
      !Number.isSafeInteger(value.createdAt) ||
      value.createdAt < 0 ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt - value.createdAt !== 10 * 60 * 1000 ||
      value.createdAt > now ||
      now >= value.expiresAt) {
    throw new Error("Spotify login transaction invalid or expired.");
  }

  // Return a detached record so callers cannot mutate the supplied object.
  return Object.freeze({
    version: 1,
    clientId: value.clientId,
    redirectUri: value.redirectUri,
    verifier: value.verifier,
    state: value.state,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  });
}

function createSpotifyAuthTransaction(pkce, clientId, now = Date.now()) {
  if (!pkce || typeof pkce !== "object" ||
      pkce.challengeMethod !== "S256" ||
      typeof pkce.challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(pkce.challenge)) {
    throw new Error("Invalid Spotify PKCE material.");
  }

  return validateSpotifyAuthTransaction({
    version: 1,
    clientId,
    redirectUri: "https://linyuli303.github.io/Apps/",
    verifier: pkce.verifier,
    state: pkce.state,
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
  }, clientId, now);
}

// Pure callback validation. Never log callback URLs or authorization codes.
function validateSpotifyCallback(
  callbackUrl, transaction, clientId, now = Date.now()
) {
  const checked = validateSpotifyAuthTransaction(transaction, clientId, now);
  if (typeof callbackUrl !== "string" || callbackUrl.length > 12000) {
    throw new Error("Invalid Spotify callback.");
  }

  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("Invalid Spotify callback.");
  }

  const expected = new URL(checked.redirectUri);
  if (url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.username || url.password || url.hash) {
    throw new Error("Unexpected Spotify callback destination.");
  }

  const allowed = new Set([
    "code", "state", "error", "error_description", "error_uri"
  ]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error("Unexpected Spotify callback parameters.");
    }
  }

  if (url.searchParams.get("state") !== checked.state) {
    throw new Error("Spotify callback state mismatch.");
  }

  const hasCode = url.searchParams.has("code");
  const hasError = url.searchParams.has("error");
  if (hasCode === hasError) {
    throw new Error("Ambiguous Spotify callback.");
  }

  if (hasError) {
    const error = url.searchParams.get("error");
    if (!error || error.length > 200) {
      throw new Error("Invalid Spotify authorization error.");
    }
    // Do not render provider error text or follow error_uri.
    return Object.freeze({status:"denied"});
  }

  if (url.searchParams.has("error_description") ||
      url.searchParams.has("error_uri")) {
    throw new Error("Unexpected Spotify success parameters.");
  }

  const code = url.searchParams.get("code");
  if (!code || code.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(code)) {
    throw new Error("Invalid Spotify authorization code.");
  }

  return Object.freeze({
    status:"authorized",
    code,
    verifier:checked.verifier,
    clientId:checked.clientId,
    redirectUri:checked.redirectUri,
  });
}

// Injected storage adapter only. No browser storage instance or startup wiring.
function createSpotifyTransactionStore(storage) {
  const key = "myapps-spotify-auth-v1:/Apps/";
  if (!storage ||
      !["getItem", "setItem", "removeItem"].every(
        method => typeof storage[method] === "function"
      )) {
    throw new Error("Temporary Spotify login storage unavailable.");
  }

  function remove() {
    try {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw new Error("Removal failed");
    } catch {
      throw new Error("Temporary Spotify login cleanup failed.");
    }
  }

  function save(transaction, clientId, now = Date.now()) {
    // Starting a new transaction invalidates any previous login attempt.
    remove();
    const checked = validateSpotifyAuthTransaction(
      transaction, clientId, now
    );
    const raw = JSON.stringify(checked);
    if (raw.length > 2048) {
      throw new Error("Invalid Spotify login transaction size.");
    }

    try {
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) {
        throw new Error("Storage verification failed");
      }
    } catch {
      remove();
      throw new Error("Temporary Spotify login storage unavailable.");
    }
  }

  function consume(callbackUrl, clientId, now = Date.now()) {
    let raw;
    try {
      raw = storage.getItem(key);
    } catch {
      throw new Error("Temporary Spotify login storage unavailable.");
    }

    // Delete before parsing, validation, or returning exchange inputs.
    // No token exchange may proceed if deletion cannot be confirmed.
    remove();
    if (typeof raw !== "string" || !raw || raw.length > 2048) {
      throw new Error("Spotify login transaction missing or invalid.");
    }

    let transaction;
    try {
      transaction = JSON.parse(raw);
    } catch {
      throw new Error("Spotify login transaction missing or invalid.");
    }

    return validateSpotifyCallback(
      callbackUrl, transaction, clientId, now
    );
  }

  return Object.freeze({save, consume, clear:remove});
}

// Pure URL cleanup planning; does not validate or authorize a login.
// The future callback handler must capture inputs, clean browser history,
// then consume/validate the transaction before attempting token exchange.
function spotifyCallbackCleanupURL(callbackUrl) {
  const destination = "https://linyuli303.github.io/Apps/";
  if (typeof callbackUrl !== "string" || callbackUrl.length > 12000) {
    throw new Error("Invalid Spotify callback destination.");
  }

  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("Invalid Spotify callback destination.");
  }

  const expected = new URL(destination);
  if (url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.username || url.password) {
    throw new Error("Invalid Spotify callback destination.");
  }

  const callbackKeys = [
    "code", "state", "error", "error_description", "error_uri"
  ];
  if (!callbackKeys.some(key => url.searchParams.has(key))) {
    return null;
  }

  // Remove the entire callback query and fragment, including unexpected
  // parameters. Never carry authorization material into normal app routing.
  // Returning this URL does not make malformed callback inputs valid.
  return destination;
}

// URL construction only: no navigation, requests, storage, or token exchange.
async function buildSpotifyAuthorizationURL(
  transaction, challenge, clientId, now = Date.now(),
  cryptoProvider = globalThis.crypto
) {
  const checked = validateSpotifyAuthTransaction(
    transaction, clientId, now
  );
  if (typeof challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      !cryptoProvider || !cryptoProvider.subtle ||
      typeof cryptoProvider.subtle.digest !== "function") {
    throw new Error("Invalid Spotify authorization challenge.");
  }

  // Independently bind the supplied challenge to this transaction's verifier.
  const hashed = await cryptoProvider.subtle.digest(
    "SHA-256", new TextEncoder().encode(checked.verifier)
  );
  let binary = "";
  for (const byte of new Uint8Array(hashed)) {
    binary += String.fromCharCode(byte);
  }
  const expectedChallenge = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (challenge !== expectedChallenge) {
    throw new Error("Spotify authorization challenge mismatch.");
  }

  // Fixed, reviewed permissions. Never accept scopes from URL or user input.
  const scopes = [
    "user-follow-read",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "user-library-modify",
    "streaming",
    "user-modify-playback-state",
    "user-read-private",
    "user-read-email",
  ];

  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: checked.clientId,
    response_type: "code",
    redirect_uri: checked.redirectUri,
    state: checked.state,
    scope: scopes.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
  }).toString();

  // The verifier is sent only in the later token exchange, never this URL.
  return url.href;
}

// Pure token-response validation. Returned credentials must remain in memory.
// Never log this input, its return value, or provider response bodies.
function validateSpotifyTokenResponse(value, now = Date.now()) {
  const requiredScopes = [
    "user-follow-read",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "user-library-modify",
    "streaming",
    "user-modify-playback-state",
    "user-read-private",
    "user-read-email",
  ];
  const validToken = token =>
    typeof token === "string" &&
    token.length >= 1 && token.length <= 8192 &&
    /^[A-Za-z0-9._~+\/-]+=*$/.test(token);

  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isSafeInteger(now) || now < 0 ||
      !validToken(value.access_token) ||
      typeof value.token_type !== "string" ||
      value.token_type.toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(value.expires_in) ||
      value.expires_in < 1 || value.expires_in > 86400 ||
      !Number.isSafeInteger(now + value.expires_in * 1000) ||
      typeof value.scope !== "string" || value.scope.length > 2000 ||
      ("refresh_token" in value && !validToken(value.refresh_token))) {
    throw new Error("Invalid Spotify token response.");
  }

  const scopes = value.scope.split(" ");
  if (scopes.length !== requiredScopes.length ||
      new Set(scopes).size !== scopes.length ||
      scopes.some(scope => !requiredScopes.includes(scope))) {
    throw new Error("Spotify authorization permissions mismatch.");
  }

  // Discard unrelated response fields; do not retain account/provider metadata.
  return Object.freeze({
    accessToken: value.access_token,
    refreshToken: value.refresh_token ?? null,
    expiresAt: now + value.expires_in * 1000,
    scopes: Object.freeze([...scopes].sort()),
  });
}

// Unwired exchange adapter. Call only after one-time callback consumption.
// Never log inputs, response bodies, provider errors, or returned credentials.
async function exchangeSpotifyAuthorization(
  authorization, {request = globalThis.fetch, signal} = {}
) {
  const endpoint = "https://accounts.spotify.com/api/token";
  const fields = [
    "status", "code", "verifier", "clientId", "redirectUri"
  ].sort().join(",");

  if (!authorization || typeof authorization !== "object" ||
      Array.isArray(authorization) ||
      Object.keys(authorization).sort().join(",") !== fields ||
      authorization.status !== "authorized" ||
      typeof authorization.clientId !== "string" ||
      !/^[a-f0-9]{32}$/.test(authorization.clientId) ||
      authorization.redirectUri !== "https://linyuli303.github.io/Apps/" ||
      typeof authorization.verifier !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(authorization.verifier) ||
      typeof authorization.code !== "string" ||
      !authorization.code || authorization.code.length > 4096 ||
      /[\s\u0000-\u001f\u007f]/.test(authorization.code) ||
      typeof request !== "function") {
    throw new Error("Invalid Spotify exchange inputs.");
  }

  const controller = new AbortController();
  let reader = null;
  let completed = false;
  let listening = false;
  let timer;
  const cancel = () => controller.abort();

  try {
    if (signal) {
      if (typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function") {
        throw new Error("Invalid cancellation signal");
      }
      signal.addEventListener("abort", cancel, {once:true});
      listening = true;
      if (signal.aborted) cancel();
    }
    if (controller.signal.aborted) throw new Error("Cancelled");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorization.code,
      redirect_uri: authorization.redirectUri,
      client_id: authorization.clientId,
      code_verifier: authorization.verifier,
    });
    timer = setTimeout(cancel, 15000);

    const response = await request(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (controller.signal.aborted ||
        !response || response.status !== 200 ||
        response.redirected || response.url !== endpoint ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get("Content-Type") || ""
        ) ||
        !response.body || typeof response.body.getReader !== "function") {
      throw new Error("Invalid exchange response");
    }

    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (controller.signal.aborted) throw new Error("Cancelled");
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) {
        throw new Error("Invalid response chunk");
      }
      size += part.value.byteLength;
      if (size > 32768) throw new Error("Response too large");
      chunks.push(part.value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", {fatal:true}).decode(bytes)
    );
    const tokens = validateSpotifyTokenResponse(value);
    if (controller.signal.aborted) throw new Error("Cancelled");
    completed = true;
    return tokens;
  } catch {
    // Fixed feedback only; no raw errors or provider response content.
    throw new Error("Spotify connection failed or was cancelled. Connect again.");
  } finally {
    clearTimeout(timer);
    if (listening) signal.removeEventListener("abort", cancel);
    if (!completed) {
      controller.abort();
      if (reader) {
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      }
    }
  }
}

// Unwired callback lifecycle. Browser operations are explicitly injected.
// Credentials remain inside this closure; never include them in UI status.
function createSpotifyCallbackController({
  clientId, store, replaceURL,
  exchange = exchangeSpotifyAuthorization,
  playlistReader = readSpotifyPlaylistPage,
  clock = Date.now,
}) {
  if (typeof clientId !== "string" || !/^[a-f0-9]{32}$/.test(clientId) ||
      !store || typeof store.consume !== "function" ||
      typeof store.clear !== "function" ||
      typeof replaceURL !== "function" ||
      typeof exchange !== "function" ||
      typeof playlistReader !== "function" ||
      typeof clock !== "function") {
    throw new Error("Invalid Spotify callback controller.");
  }

  let generation = 0;
  let pending = null;
  let playlistPending = null;
  let session = null;
  let status = "disconnected";

  function invalidate() {
    generation++;
    if (pending) pending.abort();
    if (playlistPending) playlistPending.abort();
    playlistPending = null;
    pending = null;
    session = null;
    status = "disconnected";
  }

  function disconnect() {
    // Invalidate before cleanup: even failed cleanup cannot revive a response.
    invalidate();
    try {
      store.clear();
    } catch {
      status = "cleanup_failed";
    }
    return status;
  }

  async function completeCallback(callbackUrl) {
    invalidate();
    const token = generation;
    let cleanURL;
    try {
      cleanURL = spotifyCallbackCleanupURL(callbackUrl);
      if (cleanURL === null) return "not_callback";

      // Synchronous cleanup must succeed before consuming/exchanging a code.
      replaceURL(cleanURL);
      const authorization = store.consume(callbackUrl, clientId, clock());
      if (authorization.status === "denied") {
        status = "denied";
        return status;
      }

      const controller = new AbortController();
      pending = controller;
      status = "connecting";
      const received = await exchange(authorization, {
        signal:controller.signal,
      });

      if (token !== generation || controller.signal.aborted) {
        return "cancelled";
      }

      // Copy only validated session fields, including with injected exchanges.
      const checked = validateSpotifyTokenResponse({
        access_token:received.accessToken,
        ...(received.refreshToken === null ? {} : {
          refresh_token:received.refreshToken,
        }),
        token_type:"Bearer",
        expires_in:1,
        scope:received.scopes.join(" "),
      }, clock());
      if (!Number.isSafeInteger(received.expiresAt) ||
          received.expiresAt <= clock() ||
          received.expiresAt - clock() > 86400000) {
        throw new Error("Invalid Spotify session expiry");
      }

      session = Object.freeze({
        accessToken:checked.accessToken,
        refreshToken:checked.refreshToken,
        scopes:checked.scopes,
        expiresAt:received.expiresAt,
      });
      pending = null;
      status = "connected";
      return status;
    } catch {
      if (token !== generation) return "cancelled";
      invalidate();
      status = "failed";
      try {
        store.clear();
      } catch {
        status = "cleanup_failed";
      }
      return status;
    }
  }

  function getStatus() {
    if (session && clock() >= session.expiresAt) {
      invalidate();
      status = "expired";
    }
    return status;
  }

  async function readPlaylists(offset = 0) {
    if (!Number.isSafeInteger(offset) ||
        offset < 0 || offset > 10000 || offset % 20 !== 0) {
      return Object.freeze({status:"failed"});
    }
    if (getStatus() !== "connected") {
      return Object.freeze({status:"reauthorize"});
    }

    if (playlistPending) playlistPending.abort();
    const requestController = new AbortController();
    playlistPending = requestController;
    const token = generation;
    const currentSession = session;

    const current = () =>
      token === generation &&
      session === currentSession &&
      playlistPending === requestController &&
      !requestController.signal.aborted;

    try {
      const page = await playlistReader(currentSession.accessToken, offset, {
        signal:requestController.signal,
      });
      if (!current()) return Object.freeze({status:"cancelled"});
      if (getStatus() !== "connected") {
        return Object.freeze({status:"reauthorize"});
      }

      if (!page || typeof page !== "object") {
        throw new Error("Invalid playlist result");
      }
      if (page.status === "reauthorize") {
        invalidate();
        status = "expired";
        return Object.freeze({status:"reauthorize"});
      }
      if (["restricted", "rate_limited"].includes(page.status)) {
        return Object.freeze({status:page.status});
      }
      if (page.offset !== offset) {
        throw new Error("Playlist page mismatch");
      }

      const checked = validateSpotifyPlaylistPage(page);
      return Object.freeze({
        status:"ready",
        ...checked,
      });
    } catch {
      if (!current()) return Object.freeze({status:"cancelled"});
      if (getStatus() !== "connected") {
        return Object.freeze({status:"reauthorize"});
      }
      return Object.freeze({status:"failed"});
    } finally {
      requestController.abort();
      if (playlistPending === requestController) {
        playlistPending = null;
      }
    }
  }

  return Object.freeze({
    completeCallback, disconnect, getStatus, readPlaylists,
  });
}

// Unwired Connect lifecycle. Navigation and temporary storage are injected.
// Call connect only from an explicit user action; never log login material.
function createSpotifyConnectController({
  clientId, store, navigate,
  generatePKCE = createSpotifyPKCE,
  buildURL = buildSpotifyAuthorizationURL,
  clock = Date.now,
}) {
  if (typeof clientId !== "string" || !/^[a-f0-9]{32}$/.test(clientId) ||
      !store || typeof store.save !== "function" ||
      typeof store.clear !== "function" ||
      typeof navigate !== "function" ||
      typeof generatePKCE !== "function" ||
      typeof buildURL !== "function" || typeof clock !== "function") {
    throw new Error("Invalid Spotify Connect controller.");
  }

  let generation = 0;
  let status = "idle";

  function cancel() {
    generation++;
    status = "cancelled";
    try {
      store.clear();
    } catch {
      status = "cleanup_failed";
    }
    return status;
  }

  async function connect() {
    const token = ++generation;
    status = "preparing";
    try {
      // Clear any abandoned transaction before preparing a new login.
      store.clear();
      const pkce = await generatePKCE();
      if (token !== generation) return "cancelled";

      const transaction = createSpotifyAuthTransaction(
        pkce, clientId, clock()
      );
      const destination = await buildURL(
        transaction, pkce.challenge, clientId, clock()
      );
      if (token !== generation) return "cancelled";

      // Revalidate after asynchronous challenge hashing.
      validateSpotifyAuthTransaction(transaction, clientId, clock());

      // Defend the navigation boundary even with an injected URL builder.
      const url = new URL(destination);
      if (url.origin !== "https://accounts.spotify.com" ||
          url.pathname !== "/authorize" ||
          url.username || url.password || url.hash ||
          url.searchParams.getAll("client_id").length !== 1 ||
          url.searchParams.get("client_id") !== clientId ||
          url.searchParams.getAll("redirect_uri").length !== 1 ||
          url.searchParams.get("redirect_uri") !== transaction.redirectUri ||
          url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.get("state") !== transaction.state) {
        throw new Error("Invalid Spotify navigation destination");
      }

      // These injected operations must be synchronous.
      store.save(transaction, clientId, clock());
      if (token !== generation) return "cancelled";
      status = "redirecting";
      navigate(url.href);
      return "redirecting";
    } catch {
      // An old attempt must not clear a newer attempt's transaction/status.
      if (token !== generation) return "cancelled";
      status = "failed";
      try {
        store.clear();
      } catch {
        status = "cleanup_failed";
      }
      return status;
    }
  }

  return Object.freeze({
    connect,
    cancel,
    getStatus:() => status,
  });
}

// Unwired synchronous startup gate. No storage, exchange or normal app routing.
// Call before feed loading/routing when integration is ready.
// Captured callback material must never be logged or exposed in UI status.
function captureSpotifyStartupCallback({readURL, replaceURL}) {
  if (typeof readURL !== "function" || typeof replaceURL !== "function") {
    throw new Error("Invalid Spotify startup dependencies.");
  }

  let captured = null;
  let status = "not_callback";

  try {
    const original = readURL();
    const candidate = new URL(original);
    const callbackKeys = [
      "code", "state", "error", "error_description", "error_uri"
    ];
    // Normal section URLs and local previews need no callback processing.
    if (!callbackKeys.some(key => candidate.searchParams.has(key))) {
      return Object.freeze({status:"not_callback", take:() => null, discard() {}});
    }
    const cleaned = spotifyCallbackCleanupURL(original);
    if (cleaned !== null) {
      // Cleanup must be synchronous and complete before releasing the input.
      const result = replaceURL(cleaned);
      if (result && typeof result.then === "function") {
        throw new Error("Asynchronous callback cleanup is not supported");
      }

      // Independently confirm the browser no longer exposes the callback.
      if (readURL() !== cleaned) {
        throw new Error("Callback URL cleanup not confirmed");
      }

      captured = original;
      status = "callback";
    }
  } catch {
    captured = null;
    status = "failed";
  }

  function take() {
    const value = captured;
    captured = null;
    return value;
  }

  function discard() {
    captured = null;
  }

  return Object.freeze({status, take, discard});
}

// Unwired read-only adapter. Never log tokens, bodies or private playlist data.
// Callers must establish a current session and discard stale results.
async function readSpotifyPlaylistPage(
  accessToken, offset = 0, {request = globalThis.fetch, signal} = {}
) {
  if (typeof accessToken !== "string" ||
      accessToken.length < 1 || accessToken.length > 8192 ||
      !/^[A-Za-z0-9._~+\/-]+=*$/.test(accessToken) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 || offset > 10000 || offset % 20 !== 0 ||
      typeof request !== "function") {
    throw new Error("Invalid Spotify playlist request.");
  }

  // Construct pagination locally. Never send credentials to a supplied URL.
  const url = new URL("https://api.spotify.com/v1/me/playlists");
  url.search = new URLSearchParams({
    limit:"20", offset:String(offset),
  }).toString();

  const controller = new AbortController();
  let listening = false;
  let reader = null;
  let complete = false;
  let timer;
  const cancel = () => controller.abort();

  try {
    if (signal) {
      if (typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function") {
        throw new Error("Invalid cancellation signal");
      }
      signal.addEventListener("abort", cancel, {once:true});
      listening = true;
      if (signal.aborted) cancel();
    }
    if (controller.signal.aborted) throw new Error("Cancelled");
    timer = setTimeout(cancel, 15000);

    const response = await request(url.href, {
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store",
      redirect:"error",
      referrerPolicy:"no-referrer",
      headers:{
        Authorization:"Bearer " + accessToken,
        Accept:"application/json",
      },
      signal:controller.signal,
    });

    if (controller.signal.aborted || !response ||
        response.redirected || response.url !== url.href) {
      throw new Error("Invalid response destination");
    }

    // Return fixed states only, without reading provider error bodies.
    const stopped = {
      401:"reauthorize",
      403:"restricted",
      429:"rate_limited",
    }[response.status];
    if (stopped) {
      return Object.freeze({status:stopped});
    }

    if (response.status !== 200 ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get("Content-Type") || ""
        ) ||
        !response.body || typeof response.body.getReader !== "function") {
      throw new Error("Invalid playlist response");
    }

    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (controller.signal.aborted) throw new Error("Cancelled");
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) {
        throw new Error("Invalid response chunk");
      }
      size += part.value.byteLength;
      if (size > 1000000) throw new Error("Playlist response too large");
      chunks.push(part.value);
    }

    const bytes = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    const data = JSON.parse(
      new TextDecoder("utf-8", {fatal:true}).decode(bytes)
    );
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !Array.isArray(data.items) || data.items.length > 20 ||
        data.offset !== offset || data.limit !== 20 ||
        !Number.isSafeInteger(data.total) || data.total < 0 ||
        data.total > 100000) {
      throw new Error("Invalid playlist page");
    }

    if (controller.signal.aborted) throw new Error("Cancelled");
    complete = true;

    // Untrusted item metadata still requires validation before rendering.
    // Do not retain or follow provider-supplied href/next/previous values.
    return Object.freeze({
      status:"received",
      offset,
      total:data.total,
      items:data.items,
    });
  } catch {
    throw new Error("Spotify playlists could not be loaded or were cancelled.");
  } finally {
    clearTimeout(timer);
    if (listening) signal.removeEventListener("abort", cancel);
    if (!complete) {
      controller.abort();
      if (reader) {
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      }
    }
  }
}

// Pure metadata reduction. Render returned labels with textContent only.
// No artwork requests, HTML descriptions, provider links, or account storage.
function validateSpotifyPlaylistPage(page) {
  if (!page || typeof page !== "object" || Array.isArray(page) ||
      page.status !== "received" ||
      !Number.isSafeInteger(page.offset) ||
      page.offset < 0 || page.offset > 10000 || page.offset % 20 !== 0 ||
      !Number.isSafeInteger(page.total) ||
      page.total < 0 || page.total > 100000 ||
      !Array.isArray(page.items) || page.items.length > 20) {
    throw new Error("Invalid Spotify playlist metadata.");
  }

  function label(value, maximum) {
    return typeof value === "string" &&
      value.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(value);
  }

  const seen = new Set();
  const items = page.items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.id !== "string" ||
        !/^[A-Za-z0-9]{22}$/.test(item.id) ||
        seen.has(item.id) ||
        !label(item.name, 300) ||
        !item.owner || typeof item.owner !== "object" ||
        Array.isArray(item.owner) ||
        !label(item.owner.id, 128) || !item.owner.id.trim() ||
        (item.owner.display_name !== undefined &&
         item.owner.display_name !== null &&
         !label(item.owner.display_name, 200)) ||
        (item.collaborative !== undefined &&
         typeof item.collaborative !== "boolean")) {
      throw new Error("Invalid Spotify playlist record.");
    }

    seen.add(item.id);
    const ownerName = typeof item.owner.display_name === "string"
      ? item.owner.display_name.trim() : "";

    return Object.freeze({
      id: item.id,
      name: item.name.trim() || "Untitled playlist",
      ownerId: item.owner.id,
      ownerName: ownerName || "Spotify user",
      collaborative: item.collaborative === true,
      spotifyURL: "https://open.spotify.com/playlist/" + item.id,
    });
  });

  // Do not follow provider pagination URLs. An empty page never advances.
  const nextOffset = page.offset + 20;
  const hasMore = page.items.length === 20 &&
    page.offset + page.items.length < page.total &&
    nextOffset <= 10000;

  return Object.freeze({
    offset: page.offset,
    total: page.total,
    items: Object.freeze(items),
    nextOffset: hasMore ? nextOffset : null,
  });
}

// Playlist UI receives reduced data only, never credentials.
// All rendering is text/node based; provider HTML and image URLs are discarded.
// Official iframe only: no SDK, tokens, provider scripts, or autoplay.
function createSpotifyEmbedPlayer(host) {
  const panel = element("section", "spotify-embed-panel");
  panel.setAttribute("aria-label", "Spotify playlist player");
  panel.hidden = true;
  const heading = element("div", "spotify-embed-heading");
  const title = element("strong", "spotify-embed-title", "Spotify player");
  const toggle = element("button", "", "Dock ›");
  const closeButton = element("button", "", "Close player");
  toggle.type = closeButton.type = "button";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", "spotify-embed-content");
  const content = element("div", "spotify-embed-content");
  content.id = "spotify-embed-content";
  const notice = element("p", "spotify-embed-notice",
    "Spotify content loads only when you open a player. Spotify may use cookies and browser data. Playback depends on Spotify and your browser; use Open in Spotify if unavailable.");
  const frameHost = element("div", "spotify-embed-frame");
  content.append(notice, frameHost);
  heading.append(title, toggle, closeButton);
  const restore = element("button", "spotify-embed-restore", "‹ ♫");
  restore.type = "button";
  restore.hidden = true;
  restore.setAttribute("aria-label", "Restore Spotify playlist player");
  restore.setAttribute("aria-controls", "spotify-embed-content");
  panel.append(heading, content, restore);
  host.append(panel);
  let currentId = null;
  let opener = null;
  function expand(expanded) {
    content.hidden = !expanded;
    toggle.textContent = expanded ? "Dock ›" : "Expand";
    heading.hidden = !expanded;
    restore.hidden = expanded;
    restore.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-expanded", String(expanded));
    panel.dataset.collapsed = String(!expanded);
  }
  function close(restoreFocus = false) {
    frameHost.replaceChildren();
    currentId = null;
    panel.hidden = true;
    expand(true);
    if (restoreFocus && opener && opener.isConnected) opener.focus();
    opener = null;
  }
  function open(item, trigger) {
    if (!item || typeof item.id !== "string" ||
        !/^[A-Za-z0-9]{22}$/.test(item.id) || typeof item.name !== "string") return;
    opener = trigger;
    title.textContent = item.name;
    if (currentId !== item.id) {
      const frame = document.createElement("iframe");
      frame.title = "Spotify playlist: " + item.name;
      frame.src = "https://open.spotify.com/embed/playlist/" + item.id;
      frame.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
      frame.setAttribute("allowfullscreen", "");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frameHost.replaceChildren(frame);
      currentId = item.id;
    }
    panel.hidden = false;
    expand(true);
    toggle.focus();
    panel.scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  const toggleClick = () => {
    expand(false);
    restore.focus();
  };
  const restoreClick = () => { expand(true); toggle.focus(); };
  const closeClick = () => close(true);
  const escape = event => {
    if (event.key === "Escape" && !panel.hidden) { close(true); event.stopPropagation(); }
  };
  toggle.addEventListener("click", toggleClick);
  restore.addEventListener("click", restoreClick);
  closeButton.addEventListener("click", closeClick);
  panel.addEventListener("keydown", escape);
  // Stop this player when leaving Spotify; don't leave hidden audio behind.
  const page = $("spotify-page");
  const observer = page && typeof MutationObserver === "function"
    ? new MutationObserver(() => { if (page.hidden) close(); }) : null;
  if (observer) observer.observe(page, {attributes:true,attributeFilter:["hidden"]});
  function dispose() {
    close();
    if (observer) observer.disconnect();
    toggle.removeEventListener("click", toggleClick);
    restore.removeEventListener("click", restoreClick);
    closeButton.removeEventListener("click", closeClick);
    panel.removeEventListener("keydown", escape);
    panel.remove();
  }
  return Object.freeze({open, close, dispose});
}

function createSpotifyPlaylistView(controller, onReauthorize) {
  const panel = $("spotify-playlists");
  const rows = $("spotify-playlist-rows");
  const status = $("spotify-playlist-status");
  const refresh = $("spotify-playlists-refresh");
  const more = $("spotify-playlists-more");
  let generation = 0, nextOffset = null, disposed = false;
  const shown = new Set();
  const records = new Map();
  const embedPlayer = createSpotifyEmbedPlayer(panel);
  const toolbar = element("div", "music-library-toolbar");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search loaded playlists…";
  search.setAttribute("aria-label", "Search loaded playlist names and creators");
  const sort = document.createElement("select");
  sort.setAttribute("aria-label", "Sort loaded playlists");
  for (const [value, label] of [["spotify","Spotify order"],["name","Name A–Z"],["creator","Creator A–Z"]]) {
    const option = document.createElement("option");
    option.value = value; option.textContent = label; sort.append(option);
  }
  const grid = element("button", "", "Grid");
  const list = element("button", "", "List");
  grid.type = list.type = "button";
  grid.setAttribute("aria-pressed", "true");
  list.setAttribute("aria-pressed", "false");
  toolbar.append(search, sort, grid, list);
  rows.before(toolbar);
  rows.classList.add("music-library-rows");
  rows.dataset.view = "grid";
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const all = Array.from(records.values());
    const filtered = all.filter(item => (item.name + " " + item.ownerName).toLocaleLowerCase().includes(query));
    if (sort.value !== "spotify") {
      const key = sort.value === "creator" ? "ownerName" : "name";
      filtered.sort((a,b) => a[key].localeCompare(b[key], undefined, {sensitivity:"base",numeric:true}));
    }
    const fragment = document.createDocumentFragment();
    for (const item of filtered) {
      const row = element("div", "podcast-managed-show music-library-card");
      const cover = element("div", "music-library-cover", "♫");
      cover.setAttribute("aria-hidden", "true");
      const text = element("span", "music-library-label", item.name);
      text.title = item.name;
      text.append(element("small", "", "By " + item.ownerName + (item.collaborative ? " | Collaborative" : "")));
      const link = element("a", "official", "Open in Spotify");
      link.href = item.spotifyURL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      link.setAttribute("aria-label", "Open " + item.name + " in Spotify (new tab)");
      const openPlayer = element("button", "music-library-open-player", "Open player");
      openPlayer.type = "button";
      openPlayer.setAttribute("aria-label", "Open Spotify player for " + item.name);
      openPlayer.addEventListener("click", () => embedPlayer.open(item, openPlayer));
      row.append(cover, text, openPlayer, link);
      fragment.append(row);
    }
    if (!filtered.length && records.size) fragment.append(element("p", "music-library-empty", "No matching loaded playlists."));
    rows.replaceChildren(fragment);
    status.textContent = records.size
      ? (query ? filtered.length + " matches / " : "") + records.size + " playlists loaded. Search and sorting cover loaded playlists only."
      : "No playlists returned by Spotify.";
  }
  const selectGrid = () => {
    rows.dataset.view = "grid";
    grid.setAttribute("aria-pressed", "true"); list.setAttribute("aria-pressed", "false");
  };
  const selectList = () => {
    rows.dataset.view = "list";
    grid.setAttribute("aria-pressed", "false"); list.setAttribute("aria-pressed", "true");
  };
  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  grid.addEventListener("click", selectGrid);
  list.addEventListener("click", selectList);
  async function load(append = false) {
    if (disposed) return;
    const offset = append ? nextOffset : 0;
    if (offset === null) return;
    const token = ++generation;
    panel.hidden = false;
    refresh.disabled = true; more.disabled = true; more.hidden = true;
    if (!append) { rows.replaceChildren(); shown.clear(); records.clear(); nextOffset = null; }
    status.textContent = "Loading playlists...";
    try {
      const result = await controller.readPlaylists(offset);
      if (disposed || token !== generation) return;
      if (result.status === "reauthorize") { onReauthorize(); return; }
      if (result.status !== "ready") {
        const messages = {restricted:"Spotify did not permit this playlist request.",rate_limited:"Spotify rate limit reached. Wait before refreshing.",failed:"Playlists could not be loaded. Try Refresh.",cancelled:"Playlist request cancelled."};
        status.textContent = messages[result.status] || messages.failed;
        return;
      }
      for (const item of result.items) {
        if (shown.has(item.id)) continue;
        shown.add(item.id); records.set(item.id, item);
      }
      nextOffset = result.nextOffset;
      more.hidden = nextOffset === null;
      render();
    } catch {
      if (!disposed && token === generation) status.textContent = "Playlists could not be loaded. Try Refresh.";
    } finally {
      if (!disposed && token === generation) { refresh.disabled = false; more.disabled = false; }
    }
  }
  const refreshClick = () => load(false);
  const moreClick = () => load(true);
  refresh.addEventListener("click", refreshClick);
  more.addEventListener("click", moreClick);
  function clear() {
    disposed = true; generation++; shown.clear(); records.clear(); nextOffset = null;
    rows.replaceChildren(); status.textContent = ""; panel.hidden = true; more.hidden = true;
    refresh.removeEventListener("click", refreshClick); more.removeEventListener("click", moreClick);
    search.removeEventListener("input", render); sort.removeEventListener("change", render);
    grid.removeEventListener("click", selectGrid); list.removeEventListener("click", selectList);
    embedPlayer.dispose();
    toolbar.remove();
  }
  return Object.freeze({load, clear});
}

// Public GitHub request forms only: no token, persistent draft or source lookup.
function initializePodcastConfiguration(shows) {
  const dialog=$("podcast-config-dialog"), opener=$("podcast-config");
  const repo="https://github.com/linyuli303/Apps/issues/new";
  function request(data) {
    const payload="```json\n"+JSON.stringify(data)+"\n```";
    const url=new URL(repo);url.searchParams.set("template","podcast-change.yml");url.searchParams.set("title","[MyApps] Podcast change");
    url.searchParams.set("podcast_request",payload);
    if(url.href.length>6500)url.searchParams.delete("podcast_request");
    $("podcast-request-payload").value=payload;
    $("podcast-request-link").href=url.href;
    $("podcast-request-fallback").hidden=false;
    window.open(url.href,"_blank","noopener,noreferrer");
    $("podcast-config-status").textContent="GitHub form opened if popups are allowed. Nothing submitted yet. Review the public request, confirm and submit as the repository owner. Check processing and publication. Validated additions activate automatically with existing media permissions; unfamiliar hosts require approval.";
  }
  function renderShows() {
    const query=$("podcast-source-search").value.trim().toLocaleLowerCase();
    const list=$("podcast-managed-shows");list.replaceChildren();
    for(const show of shows.filter(s=>(s.title+" "+s.id).toLocaleLowerCase().includes(query))) {
      const row=element("div","podcast-managed-show");
      const text=element("span","",show.title);text.append(element("small","",show.id+" | "+(show.status==="ok"?"Published":show.status==="pending"?"Pending validation":"Unavailable at collection")));
      const remove=element("button","","Review removal");remove.type="button";
      remove.addEventListener("click",()=>{if(confirm("Open a public GitHub removal request for "+show.title+"? Nothing is removed until owner approval and publication."))request({operation:"Remove",showId:show.id});});
      row.append(text,remove);list.append(row);
    }
    if(!shows.length)list.append(element("p","","A packaged podcast catalogue is required to manage existing shows."));
  }
  opener.addEventListener("click",()=>{renderShows();dialog.showModal();opener.setAttribute("aria-expanded","true");});
  $("podcast-config-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{opener.setAttribute("aria-expanded","false");opener.focus();});
  dialog.addEventListener("keydown",event=>event.stopPropagation());
  $("podcast-source-search").addEventListener("input",renderShows);
  $("podcast-request-add").addEventListener("click",()=>{
    const source=$("podcast-new-source").value.trim();
    try {
      const u=new URL(source);
      if(source.length>2048||/[^\x21-\x7e]/.test(source)||source.includes("\\")||u.protocol!=="https:"||u.username||u.password||u.search||u.hash||(u.port&&u.port!=="443"))throw new Error();
      if(u.hostname==="podcasts.apple.com"&&!/^\/(?:[a-z]{2}\/)?podcast\/(?:[^/]+\/)?id[0-9]{1,20}\/?$/.test(u.pathname))throw new Error();
      if(!confirm("Confirm this is a PUBLIC show/feed URL with no private tokens or subscription credentials. The URL will be public in a GitHub Issue and repository. The source will be validated; unfamiliar media hosts require explicit approval."))return;
      request({operation:"Add",sourceUrl:source});
    }catch {$("podcast-config-status").textContent="Use a public HTTPS RSS or Apple show URL without credentials, query parameters or a fragment. Query-based/private feeds require separate review; do not submit them here.";}
  });
}

// Authorization-only screen integration. No SDK, library calls or token logging.
(function initializeSpotifyAuthorizationScreen() {
  const connectButton = $("spotify-connect");
  const disconnectButton = $("spotify-disconnect");
  const statusNode = $("spotify-status");
  const connectWarning = $("spotify-connect-warning");
  if (!connectButton || !disconnectButton || !statusNode ||
      !connectWarning) return;

  let connector = null;
  let callbackController = null;
  let uiGeneration = 0;
  let playlistView = null;

  const expected = new URL(MYAPPS_SPOTIFY_CONFIG.redirectUri);
  const supportedOrigin =
    location.origin === expected.origin &&
    location.pathname.startsWith(expected.pathname);

  const messages = Object.freeze({
    disconnected: "Spotify is disconnected.",
    preparing: "Preparing secure Spotify authorization...",
    redirecting: "Opening Spotify authorization...",
    connecting: "Completing Spotify authorization...",
    connected: "Connected · Open a playlist player to listen. Playback availability is controlled by Spotify.",
    denied: "Spotify authorization was declined. No connection was established.",
    failed: "Spotify connection failed. Connect again.",
    cleanup_failed: "Connection cancelled, but temporary login cleanup could not be confirmed. Close this tab before reconnecting.",
    expired: "Spotify authorization expired. Connect again.",
    cancelled: "Spotify connection cancelled.",
  });

  function display(state) {
    statusNode.textContent = messages[state] || messages.failed;
    if (state === "connected" && !playlistView) {
      playlistView = createSpotifyPlaylistView(
        callbackController,
        () => {
          uiGeneration++;
          display(cancelBoth() === "cleanup_failed" ? "cleanup_failed" : "expired");
        }
      );
      playlistView.load();
    }
    if (["expired", "failed", "cleanup_failed", "disconnected"].includes(state) &&
        playlistView) {
      playlistView.clear();
      playlistView = null;
    }
    const busy = ["preparing", "connecting", "redirecting"].includes(state);
    connectButton.hidden = state === "connected";
    connectWarning.hidden = state === "connected";
    connectButton.disabled =
      !supportedOrigin || busy || state === "connected" ||
      state === "cleanup_failed";
    disconnectButton.hidden =
      !busy && state !== "connected" && state !== "cleanup_failed";
  }

  function initializeControllers() {
    if (connector && callbackController) return;

    const store = openSpotifyLoginStore(window);
    const clientId = MYAPPS_SPOTIFY_CONFIG.clientId;
    const nextCallback = createSpotifyCallbackController({
      clientId,
      store,
      replaceURL:url => history.replaceState(null, "", url),
    });
    const nextConnector = createSpotifyConnectController({
      clientId,
      store,
      navigate:url => location.assign(url),
    });
    callbackController = nextCallback;
    connector = nextConnector;
  }

  function cancelBoth() {
    if (playlistView) {
      playlistView.clear();
      playlistView = null;
    }
    // Always attempt both cancellations, regardless of cleanup outcome.
    const connectStatus = connector ? connector.cancel() : "cancelled";
    const callbackStatus = callbackController
      ? callbackController.disconnect() : "disconnected";
    return [connectStatus, callbackStatus].includes("cleanup_failed")
      ? "cleanup_failed" : "disconnected";
  }

  connectButton.addEventListener("click", async () => {
    if (!supportedOrigin || connectButton.disabled) return;
    if (!window.confirm(
      "Connect to Spotify? Authorization leaves this page. " +
      "Unsaved edits, playback and the current playlist will be lost on return."
    )) return;

    const token = ++uiGeneration;
    try {
      initializeControllers();
      if (cancelBoth() === "cleanup_failed") {
        display("cleanup_failed");
        return;
      }
      display("preparing");
      const result = await connector.connect();
      if (token !== uiGeneration) return;
      display(result);
    } catch {
      if (token === uiGeneration) display("failed");
    }
  });

  disconnectButton.addEventListener("click", () => {
    uiGeneration++;
    display(cancelBoth());
  });

  // Readiness/expiry checks expose status only, never credentials.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && callbackController &&
        callbackController.getStatus() === "expired") {
      display("expired");
    }
  });

  const captured = SPOTIFY_STARTUP_CALLBACK.take();
  if (!supportedOrigin) {
    display("disconnected");
    statusNode.textContent =
      "Preview only: real Spotify authorization is available on the production origin.";
    return;
  }

  if (captured === null) {
    display("disconnected");
    return;
  }

  const token = ++uiGeneration;
  try {
    initializeControllers();
    display("connecting");

    // completeCallback synchronously cleans/consumes before its first await.
    const completion = callbackController.completeCallback(captured);

    // Use the existing hash router; never carry callback query parameters.
    const destination = new URL(MYAPPS_SPOTIFY_CONFIG.redirectUri);
    destination.hash = "/spotify";
    history.replaceState(null, "", destination.href);
    window.dispatchEvent(new Event("hashchange"));

    completion.then(result => {
      if (token === uiGeneration) display(result);
    }).catch(() => {
      if (token === uiGeneration) {
        display(cancelBoth() === "cleanup_failed" ? "cleanup_failed" : "failed");
      }
    });
  } catch {
    uiGeneration++;
    display(cancelBoth() === "cleanup_failed" ? "cleanup_failed" : "failed");
  }
})();


// MyTube extras use the existing, approved YouTube iframe only. No new API requests.
function tubeExtrasState() {
  return tubeExtrasState.saved ||= {volume:100, muted:false, captions:false, timer:null};
}
function closeTubePopover(id, restore=false) {
  $(id).hidden = true;
  const trigger = $(id === "tube-description-panel" ? "tube-description-toggle" : "tube-preview-config");
  trigger.setAttribute("aria-expanded", "false");
  if (restore) trigger.focus();
}
function resetTubeExtrasForVideo(video) {
  closeTubePopover("tube-description-panel");
  closeTubePopover("tube-preview-settings");
  $("tube-description-title").textContent = video.title || "";
  const description = typeof video.description === "string" ? video.description.trim() : "";
  $("tube-description-text").textContent = description || "This feed does not include the video description. Open the original YouTube page to read it.";
  $("tube-description-original").href = "https://www.youtube.com/watch?v=" + encodeURIComponent(video.id);
}
function stopTubeExtras() {
  const state = tubeExtrasState();
  clearInterval(state.timer); state.timer = null;
  for (const id of ["tube-captions", "tube-mute", "tube-volume"]) $(id).disabled = true;
  closeTubePopover("tube-description-panel");
  closeTubePopover("tube-preview-settings");
}
function syncTubeVolume() {
  const state = tubeExtrasState(), player = speedState().player;
  if (!speedState().ready || !player) return;
  try {
    const volume = player.getVolume();
    if (Number.isFinite(volume)) state.volume = Math.max(0,Math.min(100,volume));
    state.muted = player.isMuted();
    const percent = state.muted ? 0 : Math.round(state.volume);
    $("tube-volume").value = String(percent);
    $("tube-volume").setAttribute("aria-valuetext", percent + " percent");
    $("tube-volume-value").textContent = percent + "%";
    $("tube-mute").setAttribute("aria-pressed", String(state.muted || !percent));
    const label = state.muted || !percent ? "Unmute" : "Mute";
    $("tube-mute").setAttribute("aria-label", label); $("tube-mute").title = label;
  } catch {}
}
function syncTubeCaptions() {
  const state = tubeExtrasState(), player = speedState().player;
  if (!speedState().ready || !player) return;
  try {
    const available = player.getOptions().includes("captions");
    $("tube-captions").setAttribute("aria-pressed", String(state.captions && available));
    $("tube-captions").title = state.captions && available ? "Turn captions off" : "Turn captions on (when available)";
    $("tube-captions").setAttribute("aria-label", $("tube-captions").title);
  } catch {}
}
function readyTubeExtras() {
  const state = tubeExtrasState(), player = speedState().player;
  for (const id of ["tube-captions", "tube-mute", "tube-volume"]) $(id).disabled = false;
  try { player.setVolume(state.volume); state.muted ? player.mute() : player.unMute(); } catch {}
  try { state.captions ? player.loadModule("captions") : player.unloadModule("captions"); } catch {}
  syncTubeVolume(); syncTubeCaptions();
  clearInterval(state.timer);
  state.timer = setInterval(() => { syncTubeVolume(); syncTubeCaptions(); }, 700);
}
(function initializeTubeExtras() {
  for (const [trigger,id] of [["tube-description-toggle","tube-description-panel"],["tube-preview-config","tube-preview-settings"]]) {
    $(trigger).addEventListener("click", () => {
      const open = $(id).hidden;
      closeTubePopover("tube-description-panel"); closeTubePopover("tube-preview-settings");
      if (open) { $(id).hidden=false; $(trigger).setAttribute("aria-expanded","true"); $(id).querySelector("button").focus(); }
    });
  }
  $("tube-description-close").addEventListener("click",()=>closeTubePopover("tube-description-panel",true));
  $("tube-preview-settings-close").addEventListener("click",()=>closeTubePopover("tube-preview-settings",true));
  $("tube-description-original").addEventListener("click",()=>{
    stopSpeedController(); $("frame").replaceChildren();
  });
  // Capture Escape so it dismisses a popover before the existing player handler.
  document.addEventListener("keydown",event=>{
    if (event.key !== "Escape" || $("player").hidden) return;
    const id = ["tube-preview-settings","tube-description-panel"].find(id=>!$(id).hidden);
    if (id) { event.preventDefault(); event.stopImmediatePropagation(); closeTubePopover(id,true); }
  },true);
  $("tube-volume").addEventListener("input",()=>{
    const state=tubeExtrasState(), player=speedState().player;
    if (!speedState().ready || !player) return;
    state.volume=Number($("tube-volume").value); state.muted=state.volume===0;
    try { player.setVolume(state.volume); state.muted ? player.mute() : player.unMute(); syncTubeVolume(); }
    catch { $("playback-mode-status").textContent="Volume adjustment unavailable. Use device volume controls."; }
  });
  $("tube-mute").addEventListener("click",()=>{
    const state=tubeExtrasState(), player=speedState().player;
    if (!speedState().ready || !player) return;
    try {
      if (player.isMuted() || player.getVolume()===0) { if (!state.volume) {state.volume=50;player.setVolume(50);} player.unMute(); }
      else player.mute();
      syncTubeVolume();
    } catch { $("playback-mode-status").textContent="Use YouTube or device volume controls."; }
  });
  $("tube-captions").addEventListener("click",()=>{
    const state=tubeExtrasState(), player=speedState().player;
    if (!speedState().ready || !player) return;
    try {
      state.captions=!state.captions;
      state.captions ? player.loadModule("captions") : player.unloadModule("captions");
      syncTubeCaptions();
      $("playback-mode-status").textContent=state.captions ? "Captions requested. Availability and language are controlled by YouTube; use its CC/settings menu if needed." : "Captions off.";
    } catch { $("playback-mode-status").textContent="Use YouTube's CC control for this video."; }
  });
  const settings={width:720,height:55,transparency:75};
  function applyPreview() {
    const panel=$("player-feed-panel");
    panel.style.setProperty("--tube-preview-width",settings.width+"px");
    panel.style.setProperty("--tube-preview-height",settings.height+"vh");
    // Concrete rgba fallback also works on TVs without CSS color-mix support.
    const color=getComputedStyle(panel).getPropertyValue("--surface").trim();
    const match=/^#([0-9a-f]{6})$/i.exec(color);
    if (match) {
      const hex=match[1], rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
      panel.style.setProperty("--tube-preview-bg",`rgba(${rgb.join(",")},${1-settings.transparency/100})`);
    } else panel.style.setProperty("--tube-preview-bg",`color-mix(in srgb, var(--surface) ${100-settings.transparency}%, transparent)`);
    for (const [key,unit] of [["width","px"],["height","vh"],["transparency","%"]]) {
      $("tube-preview-"+key).value=String(settings[key]);
      $("tube-preview-"+key+"-value").textContent=settings[key]+unit;
    }
  }
  for (const key of Object.keys(settings)) $("tube-preview-"+key).addEventListener("input",()=>{settings[key]=Number($("tube-preview-"+key).value);applyPreview();});
  $("tube-preview-reset").addEventListener("click",()=>{Object.assign(settings,{width:720,height:55,transparency:75});applyPreview();});
  new MutationObserver(applyPreview).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","data-appearance"]});
  applyPreview();
})();

(function refineMyTubeToolbar(){
  const button=$("tube-mute");
  function updateSpeaker(){
    const muted=button.getAttribute("aria-pressed")==="true";
    button.querySelector("svg path:last-child").setAttribute("d",muted?"M16 9l6 6M22 9l-6 6":"M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14");
  }
  new MutationObserver(updateSpeaker).observe(button,{attributes:true,attributeFilter:["aria-pressed"]});updateSpeaker();
  // Keep focused controls visible when the single-row toolbar overflows on narrow devices.
  document.querySelector("#player .player-bottom").addEventListener("focusin",event=>{
    event.target.scrollIntoView({block:"nearest",inline:"nearest"});
  });
})();


// Universal display density: one browser preference for all MyApps applications.
(function initializeUniversalDensity() {
  const root=document.documentElement, view=$("myapps-layout");
  if(!view || $("myapps-density"))return;
  const allowed=new Set(["compact","comfort","spacious"]);
  const storageKey="myapps-display-density-v1";
  const label=element("label","myapps-density-control");
  const caption=element("span","","Display");
  const select=element("select");select.id="myapps-density";
  select.setAttribute("aria-label","Display density for all apps");
  select.title="Display density for all apps";
  select.append(new Option("Compact","compact"),new Option("Comfort","comfort"),new Option("Spacious","spacious"));
  label.append(caption,select);view.closest("label").after(label);
  const status=element("span","sr-only");status.id="myapps-density-status";status.setAttribute("role","status");
  label.after(status);
  function apply(value,announce=false) {
    const density=allowed.has(value)?value:"compact";
    root.dataset.displayDensity=density;select.value=density;
    if(announce)status.textContent=select.selectedOptions[0].textContent+" display applied to all apps.";
  }
  let initial="compact";
  try{initial=localStorage.getItem(storageKey)||"compact";}catch{}
  apply(initial);
  select.addEventListener("change",()=>{
    apply(select.value,true);
    try{localStorage.setItem(storageKey,select.value);}catch{status.textContent+=" Preference cannot be saved; applied until reload.";}
  });
  window.addEventListener("storage",event=>{
    if(event.key===storageKey || event.key===null)apply(event.newValue||"compact");
  });
})();
