// For enforced anti-framing, use the documented HTTP response headers on a capable host.
"use strict";
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
async function load() {
  $("refresh").disabled = true;
  $("status").textContent = "Loading approved feed…";
  try {
    const response = await fetch("data/feed.json", { cache: "no-store" });
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
    $("title").textContent = data.title || "My Channels";
    document.title = data.title || "My Channels";
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
  const fragment = document.createDocumentFragment();
  page = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1));
  visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((v) => {
    const card = element("button", "card");
    card.type = "button";
    card.dataset.video = v.id;
    const img = element("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = $("thumbnails").checked
      ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`
      : "icon.svg";
    const body = element("span", "card-body");
    body.append(
      element("span", "card-title", v.title),
      element(
        "span",
        "meta",
        `${channels.get(v.channelId)} · ${dateLabel(v.publishedAt)}`,
      ),
    );
    card.append(img, body);
    card.setAttribute(
      "aria-label",
      `${v.title} - Open on YouTube in a new tab`,
    );
    card.title = "Open on YouTube in a new tab";
    card.addEventListener("click", () => openOfficialVideo(v.id));
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
function openPlayer(id) {
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
  if ($("player").hidden) returnFocus = document.activeElement;
  current = id;
  $("playing-title").textContent = video.title;
  $("official").href = `https://www.youtube.com/watch?v=${id}`;
  const iframe = document.createElement("iframe");
  const params = new URLSearchParams({
    autoplay: "1",
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
  document.querySelector("header").inert = true;
  document.querySelector("main").inert = true;
  document.body.style.overflow = "hidden";
  $("close").focus();
  $("next").disabled = visible.length < 2;
}
function closePlayer() {
  const wasOpen = !$("player").hidden;
  $("frame").replaceChildren();
  $("player").hidden = true;
  current = null;
  document.querySelector("header").inert = false;
  document.querySelector("main").inert = false;
  document.body.style.overflow = "";
  if (wasOpen && returnFocus && returnFocus.isConnected) returnFocus.focus();
}
$("close").addEventListener("click", closePlayer);
$("next").addEventListener("click", () => {
  if (!visible.length) return;
  const index = visible.findIndex((v) => v.id === current);
  openPlayer(visible[(index + 1) % visible.length].id);
});
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
  if (!$("player").hidden) {
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
        $("close"),
        $("frame").querySelector("iframe"),
        $("official"),
        $("next"),
      ].filter((el) => el && !el.disabled);
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
      document.activeElement.tagName !== "IFRAME"
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
  location.pathname.replace(/[^/]*$/, ""),
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
    "https://github.com/linyuli303/MyTube/issues/new",
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
  const themes = [{"id": "kimono", "ja": "着物", "name": "Kimono"}, {"id": "hanami", "ja": "花見", "name": "Hanami"}, {"id": "ukiyoe", "ja": "浮世絵", "name": "Ukiyo-e"}, {"id": "japandi", "ja": "和北欧", "name": "Japandi"}, {"id": "edo", "ja": "江戸", "name": "Edo"}, {"id": "wabisabi", "ja": "侘寂", "name": "Wabi-sabi"}, {"id": "nadeshiko", "ja": "撫子", "name": "Nadeshiko"}, {"id": "akabeni", "ja": "赤紅", "name": "Akabeni"}, {"id": "kaki", "ja": "柿", "name": "Kaki"}, {"id": "yamabuki", "ja": "山吹", "name": "Yamabuki"}, {"id": "karashi", "ja": "芥子", "name": "Karashi"}, {"id": "kihada", "ja": "黄檗", "name": "Kihada"}, {"id": "wakana", "ja": "若菜", "name": "Wakana"}, {"id": "moegi", "ja": "萌黄", "name": "Moegi"}, {"id": "matsuba", "ja": "松葉", "name": "Matsuba"}, {"id": "tokiwa", "ja": "常磐", "name": "Tokiwa"}, {"id": "seiji", "ja": "青磁", "name": "Seiji"}, {"id": "asagi", "ja": "浅葱", "name": "Asagi"}, {"id": "hanada", "ja": "縹", "name": "Hanada"}, {"id": "ruri", "ja": "瑠璃", "name": "Ruri"}, {"id": "kikyo", "ja": "桔梗", "name": "Kikyo"}, {"id": "fuji", "ja": "藤", "name": "Fuji"}, {"id": "ayame", "ja": "菖蒲", "name": "Ayame"}, {"id": "botan", "ja": "牡丹", "name": "Botan"}, {"id": "sakura", "ja": "桜", "name": "Sakura"}, {"id": "kohbai", "ja": "紅梅", "name": "Kohbai"}, {"id": "enji", "ja": "臙脂", "name": "Enji"}, {"id": "shu", "ja": "朱", "name": "Shu"}, {"id": "hiwada", "ja": "檜皮", "name": "Hiwada"}, {"id": "taisha", "ja": "代赭", "name": "Taisha"}, {"id": "kohaku", "ja": "琥珀", "name": "Kohaku"}, {"id": "kuchinashi", "ja": "梔子", "name": "Kuchinashi"}, {"id": "ukon", "ja": "鬱金", "name": "Ukon"}, {"id": "ominaeshi", "ja": "女郎花", "name": "Ominaeshi"}, {"id": "uguisu", "ja": "鶯", "name": "Uguisu"}, {"id": "yanagi", "ja": "柳", "name": "Yanagi"}, {"id": "byakuroku", "ja": "白緑", "name": "Byakuroku"}, {"id": "rokusho", "ja": "緑青", "name": "Rokusho"}, {"id": "aotake", "ja": "青竹", "name": "Aotake"}, {"id": "tokusa", "ja": "木賊", "name": "Tokusa"}, {"id": "sabiseiji", "ja": "錆青磁", "name": "Sabiseiji"}, {"id": "mizuasagi", "ja": "水浅葱", "name": "Mizuasagi"}, {"id": "sora", "ja": "空", "name": "Sora"}, {"id": "ai", "ja": "藍", "name": "Ai"}, {"id": "kon", "ja": "紺", "name": "Kon"}, {"id": "sumire", "ja": "菫", "name": "Sumire"}, {"id": "murasaki", "ja": "紫", "name": "Murasaki"}, {"id": "shion", "ja": "紫苑", "name": "Shion"}, {"id": "sumi", "ja": "墨", "name": "Sumi"}, {"id": "ginnezumi", "ja": "銀鼠", "name": "Ginnezumi"}];
  const scope = encodeURIComponent(location.pathname.replace(/[^/]*$/, ""));
  const themeKey = "approved-yt-theme-v2:" + scope;
  const modeKey = "approved-yt-appearance-v1:" + scope;
  let selected = "fuji", mode = "light";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function readPreferences() {
    selected = "fuji"; mode = "light";
    try {
      const savedTheme = localStorage.getItem(themeKey);
      const savedMode = localStorage.getItem(modeKey);
      if (themes.some(t => t.id === savedTheme)) selected = savedTheme;
      if (["light", "dark", "system"].includes(savedMode)) mode = savedMode;
    } catch {}
  }
  readPreferences();
  const header = document.querySelector("header"), refresh = $("refresh");
  if (!header || !refresh || $("mytube-theme-picker")) return;
  const actions = element("div", "header-actions");
  const picker = element("details", "palette-picker"); picker.id = "mytube-theme-picker";
  const summary = element("summary"); summary.setAttribute("aria-label", "Choose color palette");
  const heading = element("span");
  const name = element("span", "palette-name");
  heading.append(element("span", "palette-caption", "色のパレット · 50 palettes"), name);
  const trigger = element("span", "palette-trigger-colors");
  const arrow = element("span", "", "⌄"); arrow.setAttribute("aria-hidden", "true");
  summary.append(heading, trigger);
  const panel = element("section", "palette-panel"); panel.setAttribute("aria-label", "Available palettes");
  const panelHeading = element("div", "palette-panel-heading", "Find your atmosphere");
  panelHeading.append(element("small", "", "50 palettes · Each available in light and dark mode."));
  const list = element("div", "palette-list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Choose one of 50 palettes");
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
  function apply(persist = false, speak = false) {
    const theme = themes.find(t => t.id === selected);
    const dark = mode === "dark" || (mode === "system" && system.matches);
    document.documentElement.dataset.theme = selected;
    document.documentElement.dataset.appearance = dark ? "dark" : "light";
    name.textContent = theme.ja + " · " + theme.name;
    trigger.replaceChildren(swatches(selected), arrow);
    appearance.value = mode;
    buttons.forEach((b, i) => {
      b.setAttribute("aria-pressed", String(themes[i].id === selected));
      b.querySelector(".palette-check").textContent = themes[i].id === selected ? "✓" : "";
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
    if (persist) try { localStorage.setItem(themeKey, selected); localStorage.setItem(modeKey, mode); } catch {}
    if (speak) announce.textContent = theme.name + " theme applied in " + (dark ? "dark" : "light") + " mode.";
  }
  themes.forEach((theme, i) => {
    const b = element("button", "palette-option"); b.type = "button";
    const check = element("span", "palette-check"); check.setAttribute("aria-hidden", "true");
    b.append(element("span", "palette-option-name", theme.ja + " · " + theme.name),
      element("span", "palette-option-note", (i < 6 ? "Signature palette" : "Traditional-color inspired") + " · Light + dark"), swatches(theme.id), check);
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
  panel.append(panelHeading, list, element("div", "palette-footnote", "Selection remembered on this browser. No account or external service needed."));
  picker.append(summary, panel);
  actions.append(picker, refresh, announce); header.append(actions);
  appearance.addEventListener("change", () => { mode = appearance.value; apply(true, true); });
  document.addEventListener("click", event => { if (!picker.contains(event.target)) picker.open = false; });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && picker.open) { picker.open = false; summary.focus(); } });
  function systemChanged() { if (mode === "system") apply(); }
  if (system.addEventListener) system.addEventListener("change", systemChanged);
  else system.addListener(systemChanged);
  window.addEventListener("storage", event => {
    if (event.key === themeKey || event.key === modeKey || event.key === null) { readPreferences(); apply(); }
  });
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
    $("rss-toggle").addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && !state.open) setOpen(true);
    });
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
        `${video.title} - Open on YouTube in a new tab`,
      );
      title.addEventListener("click", () => openOfficialVideo(video.id));

      row.append(date, title);
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

  feed.channels.filter((channel) => draftAllows(channel.id)).forEach((channel) => {
    grouped.set(channel.id, { channel, videos: [], latest: null });
  });

  feed.videos.forEach((video) => {
    const group = grouped.get(video.channelId);
    if (
      group &&
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
