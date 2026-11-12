// Privacy default: page-memory preferences.
// For enforced anti-framing, use the documented HTTP response headers on a capable host.
"use strict";
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
      if (event.pointerType === "mouse" && state.pinned === null) {
        state.activate(channel.id);
      }
    });
    button.addEventListener("focus", () => {
      if (state.pinned === null && !state.suppressPreview) {
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
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) {
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
    const legacy = location.hash === "#/podcasts" ? "MyPodcasts"
      : location.hash === "#/tube" ? "MyTube" : null;
    const podcastPath = new URL("MyPodcasts/", MYAPPS_ROOT).pathname;
    const podcast = legacy ? legacy === "MyPodcasts"
      : location.pathname === podcastPath;
    if (legacy) {
      const target = new URL(legacy + "/", MYAPPS_ROOT);
      target.search = location.search;
      history.replaceState(history.state, "", target.href);
    }
    if (podcast && !$("player").hidden) closePlayer();
    $("tube-page").hidden = podcast;
    $("podcast-page").hidden = !podcast;
    $("rss-catalogue").hidden = podcast;
    for (const [id, active] of [["myapps-tube", !podcast], ["myapps-podcasts", podcast]]) {
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
function createPodcastPlayer(episodes, names, filtered, rerender) {
  const audio = document.createElement("audio");
  audio.preload = "none";
  audio.setAttribute("aria-hidden", "true");
  audio.hidden = true;
  $("podcast-player").append(audio);
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
  function clearSource() { generation++;audio.pause();audio.removeAttribute("src");audio.load(); }
  function attemptPlay() {
    const token=generation;
    audio.play().then(()=>{if(token===generation){message("");sync();}}).catch(()=>{if(token===generation){message("Playback blocked or unavailable. Press Play to retry. A media host or browser restriction may apply.");sync();}});
  }
  function start(i) {
    const e=byID.get(queue[i]);if(!safeMedia(e)){message("Episode has no approved audio URL.");return;}
    clearSource();index=i;
    if (!$("player").hidden) closePlayer();
    $("podcast-player").hidden=false;document.body.classList.add("podcast-player-open");
    audio.src=e.mediaUrl;audio.playbackRate=speed;message("Loading audio...");
    sync();renderQueue();attemptPlay();
  }
  function toggle() {if(!active()){if(queue.length)start(0);return;}if(audio.paused){if(audio.ended)audio.currentTime=0;attemptPlay();}else audio.pause();}
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
    compactStatus.textContent = presentation === "expanded"
      ? "" : $("podcast-playback-status").textContent;
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
  audio.addEventListener("error",()=>{if(!audio.hasAttribute("src"))return;message("Audio unavailable. Check media-host permissions, network access, or try another episode. No automatic fallback.");sync();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("podcast-queue").hidden){showQueue(false);$("podcast-queue-toggle").focus();}});
  // Podcast auto-next is always enabled; retain the existing hidden input.
  $("podcast-auto-next").checked = true;
  $("podcast-auto-next").disabled = true;
  $("podcast-auto-next").parentElement.hidden = true;
  decorate($("podcast-stop"),"close","Stop playback and clear playlist");
  $("podcast-repeat").replaceChildren(icon("repeat"),document.createTextNode("Off"));$("podcast-repeat").setAttribute("aria-label","Repeat off; click to change mode");
  window.MyAppsPodcastPlayer={pauseForVideo:()=>{audio.pause();showQueue(false);}};
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
  window.addEventListener("resize", applyLayout);
  applyLayout();
})();

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
