# MyApps — All your favourites, one place

**Attention Is All You Need.** A shared, RSS-style home for browsing approved YouTube channels and listening to public podcasts—without added analytics or advertising scripts.

[Launch MyApps](https://linyuli303.github.io/Apps/)

- **MyTube** — approved YouTube channels, searchable text feeds, shared categories, and embedded playback.
- **MyPodcasts** — approved public RSS shows, episode browsing, and an audio player with an editable playlist.
- **MySpotify** — under development; the current account-connection and playback implementation should be verified before being described as production-ready.

Direct section URLs:

- MyTube: https://linyuli303.github.io/Apps/MyTube/
- MyPodcasts: https://linyuli303.github.io/Apps/MyPodcasts/

Clean URLs support direct opening, reload, and browser Back/Forward. Switching sections does not reload the shared shell; podcast playback and its playlist remain available until stopped or the page reloads.

> **Public by design:** source configurations, category names and assignments, published metadata, repository history, and change-request Issues are public. Never submit or commit credentials, cookies, private subscription links, tokenized feeds, or raw Takeout exports.

## Implementation and verification status

The repository includes:

- Automatic device layouts and manual view selection.
- Responsive RSS catalogue navigation.
- Podcast volume, collapse, side docking, and phone title gestures.
- Anonymous-first podcast playback with one disclosed standard-mode fallback.
- Isolated onboarding preflight and proposal-only draft-PR creation.
- MyTube playback defaults of enabled Auto-play next, maximum configured Feed height, and 5% Feed background transparency.
- Removal of the custom MyTube Caption control.

Latest local verification for the MyTube playback changes:

- JavaScript syntax check passed.
- Spotify embed-player regression check passed.
- Full unit suite passed: **400 tests, no failures or skips**.
- Browser checks confirmed Feed defaults/reset behavior, custom Caption-button removal, and Auto-play next behavior.

These local results do not establish the current remote CI, deployment, or production status.

Important verification limits:

- Anonymous-first playback was pushed in **`31e729b`**. Its production publication and CI results still require confirmation unless separately verified.
- Local browser tests verified anonymous playback for **KI verstehen** and standard fallback for **AI FIRST Podcast**, including Pause/Resume, seeking, collapse/dock/restore, and Close.
- Those playback tests used localhost, whose Origin differs from production.
- Production-origin, iPhone, and LG verification remain necessary for this playback change.
- The new-host onboarding path has offline tests and a synthetic committed-code preflight, but its live Issue-to-draft-PR flow has not yet been verified.
- Actions PR creation was last documented as disabled. Verify the current repository setting; leave it disabled until the proposal flow is ready for controlled live verification.
- Passing tests or deployment does not establish complete browser, network, or security correctness.

## Device layouts and appearance

### Automatic and manual views

The **View** selector offers:

- **Auto** — detects supported TV identifiers and uses viewport/pointer information for responsive layouts.
- **TV** — spacious presentation with larger controls and visible focus outlines.
- **Phone** — compact rows and icon-only action buttons.

Ordinary desktop browsers retain the desktop layout in Auto mode. Detection is best-effort; manual overrides remain available.

View selection:

- Is kept in page memory only.
- Does not reload the application.
- Does not restart audio or clear the playlist.
- Is separate from playback compatibility restrictions.

Phone library toolbars place search beside the channel/show selector. Filters and action buttons occupy the following row, with narrow-screen wrapping where needed.

MyTube actions are grouped as **Refresh → RSS Catalogue → Config**, using icon-only buttons with accessible names and tooltips. Podcast Config is also icon-only.

### Themes

- **51 palettes**.
- **Yugure / 夕暮れ**, light appearance by default.
- Shared Light, Dark, and System appearance.
- Phone palette panel is constrained to the viewport with a scrollable palette list.
- Palette and appearance selections remain in page memory.

Device-layout changes do not alter MyTube’s video-frame, Kino, or fullscreen dimensions.

## MyTube

### Browsing

- Search, channel/category filters, sorting, and 48-item pagination.
- Image-free text feed by default; YouTube thumbnails are opt-in.
- Text-feed columns show **Date | Channel | Title | Category tags | Views and duration**.
- Multiple categories per channel.
- In Phone view, **Newest first** precedes the YouTube source selector, aligning the sort control’s starting position with MyPodcasts.
- Disabled provider entries are placeholders, not implemented integrations.

The current configuration requests **15 recent uploads per channel**, not full history. Private, unavailable, upcoming, or non-embeddable videos may be excluded. Short-video filtering can reduce the visible count further.

### Playback

- Embedded playback through **`youtube-nocookie.com`**, YouTube’s privacy-enhanced embed domain.
- **Kino mode**, video-only fullscreen, and **Open in YouTube / App**.
- Previous/Next follows the filtered, sorted list and wraps at its ends.
- **Auto-play next** is enabled by default, can be switched off, and stops at the end of the list.
- **Loop** repeats the current video and takes priority over Auto-play next.
- **Skip videos <60s** is enabled by default. Exactly 60-second videos and unknown durations remain included.
- Short filtering applies to browsing, RSS catalogue, playback Feed menu, and navigation without interrupting the current video.
- The duration rule is not YouTube’s official Shorts classification and does not fetch replacement uploads.
- Preferred speed: **0.25×–2×**, in 0.25 increments. YouTube determines supported rates.
- Missing durations display **Unavailable**.
- Playback preferences reset on reload.
- The custom Caption button is not displayed. Captions remain controlled through YouTube’s native player when available.

The collapsible **Feed** menu previews the filtered list, highlights the current video, and shows channel, date, views, and duration. It uses 48-row pagination and overlays rather than resizes the video window.

Feed preview defaults:

| Setting                 | Default                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| Width                   | 720px, constrained to fit the screen                             |
| Height                  | 85vh, the current slider maximum, capped to the available screen |
| Background transparency | 5% transparency, equivalent to 95% opacity                       |
| Text and controls       | Fully opaque                                                     |

**Reset defaults** restores these Feed settings. Changes apply immediately and remain in page memory until reload.

Playback controls use the published snapshot and official iframe API, not additional YouTube Data API collection requests. Autoplay restrictions may require pressing Play.

**Privacy-enhanced embedding is not a guarantee of cookie-free, cache-free, or tracking-free playback.** It does not delete existing browser data or guarantee Premium recognition.

### RSS-style catalogue

Open the catalogue by clicking or activating its **RSS icon**. Hovering over that icon does not open it.

The catalogue is positioned below the shared header, aligned with the content margins, and constrained to the visible browser area.

**Desktop and TV:**

- Initial channel panel occupies one-third of the available content width.
- Selecting a channel reveals its uploads in the remaining two-thirds.
- Channel and upload lists scroll independently.
- Channels are ranked by newest available upload.
- Channel hover/focus previews and click-to-pin behavior remain available.

**Phone:**

- Initial channel list occupies the full available width.
- Tap/Enter selects a channel and replaces the list with that channel’s full-width uploads.
- Swipe left on uploads to return to channels.
- Swipe left on channels to close the catalogue.
- Back and icon-only Close buttons provide alternatives to gestures.
- Hover/focus does not automatically open a channel.
- Search controls and vertical scrolling are excluded from horizontal navigation gestures.

This is an **RSS-style webpage**, not an XML subscription feed.

### Website Refresh

MyTube’s Refresh button reloads the published feed. It:

- Does not request new YouTube collection.
- Does not clear podcast-provider cookies, cached audio, or browser storage.
- Closes the MyTube video player.
- Does not reset podcast playback.

## MyPodcasts

### Sources and browsing

- Approved public HTTPS RSS sources.
- Search episodes and shows, filter by show, sort, and paginate.
- Pending/unavailable sources remain visible in source availability and Config.
- No automatic artwork loading.
- No upcoming-episode audio prefetch.
- Audio starts after an explicit playback action; automatic advancement may request the next episode after the current one ends.

The collector includes all eligible entries supplied by each RSS response, within safety limits. This does not guarantee a publisher’s complete historical archive.

### Audio player and playlist

- Play/Pause, Previous/Next, seeking, and −15/+15 seconds.
- Speed choices: **0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×**, where supported.
- Dedicated volume slider, percentage display, and mute/unmute.
- Initial application volume is 100%; device/browser volume restrictions still apply.
- Unmute restores the previous nonzero application level.
- Volume changes do not start playback or assign an audio source.
- Podcast Auto-next is **always enabled**; its toggle is not displayed.
- Repeat **Off / List / One**; Repeat One takes priority.
- Without Repeat List, playback ends after the last queued episode.

Playlist behavior:

- Initial Play builds a queue from filtered results, starting at the selected episode.
- Playing another library episode replaces the queue.
- Playing the current library episode toggles Play/Pause.
- Add to playlist appends without starting playback.
- Library sorting does not reorder an established playlist.
- Upcoming episodes can be reordered by drag/drop or arrow controls.
- Move to top means next-to-play, not before the current episode.
- Double-click a playlist title, or use Enter/Space, to play it without rebuilding the queue.
- Large playlists render in chunks of 100.
- Close stops playback and clears the playlist and audio source.

Starting YouTube pauses podcast audio. Starting a podcast closes the YouTube player. Section navigation alone does not stop podcast playback.

Queue, progress, repeat, speed, volume, and player presentation are memory-only and reset on reload.

### Collapse and side docking

The podcast player supports three states:

1. **Expanded** — full playback controls.
2. **Collapsed** — slim title, Play/Pause, dock, and expand controls.
3. **Side-docked** — an edge tab restores the collapsed bar.

Buttons provide collapse, dock, restore, and expand actions in every layout.

In Phone view:

- Swipe left or right on the expanded title area to collapse.
- Swipe left or right on the collapsed title to dock to that edge.
- Use the side tab to restore, then expand if desired.
- Sliders and buttons are excluded from title gestures.

Presentation changes do not stop audio, clear the queue, or change playback position. Collapsing/docking closes an open playlist panel without deleting its contents.

### LG/webOS compatibility

On detected LG/webOS browsers, podcast speed is restricted to **1×** because non-normal native audio rates can produce silent playback on affected devices.

- The restriction is independent of selected layout.
- Selecting Phone view on an LG TV does not re-enable unsupported rates.
- MyTube’s separate playback-speed controls are unchanged.

Device detection and firmware behavior vary; verify on the target TV.

### Anonymous-first playback and standard fallback

Each newly selected episode starts with:

```javascript
audio.crossOrigin = "anonymous";
```

This uses anonymous CORS media loading, excluding credentials from cross-origin requests. Publishers and redirects must support the browser’s CORS requirements.

If an eligible media-loading error occurs while playback is still requested:

- MyApps retries the same episode **once** using ordinary media loading.
- A persistent notice explains that **provider cookies may be used**, subject to browser settings.
- Collapsed and docked views show an **STD** badge.
- Queue, volume, speed, and presentation state are retained.
- Position restoration is best-effort; playback may briefly begin at the start before seeking.

Fallback safeguards:

- A rejected Play promise alone does not initiate fallback.
- Network/source media errors do not establish that CORS caused the failure.
- Abort/decode errors, waiting/stalled events, and timers do not trigger this downgrade.
- Pause, Close, video handoff, and stale episode/attempt checks prevent pending automatic restarts.
- Standard mode does not receive another automatic fallback.
- A new episode starts anonymously again.

**Neither mode disables browser buffering/caching, erases cookies, or bypasses CSP.** Standard mode cannot override browser cookie restrictions. Anonymous mode does not make requests invisible to publishers.

Preliminary HEAD inspection of sampled approved sources found both promising CORS responses and obstacles. HEAD headers do not prove media GET/range behavior, seeking support, or every episode’s compatibility.

An observed redirect host is not automatically approved. New permissions require separate review.

### Podcast requests and owner-reviewed onboarding

Open **MyPodcasts → Config** to review additions/removals through public GitHub Issues.

- Add: public Apple Podcasts show link or plain public HTTPS RSS URL.
- Remove: stable show ID.
- Opening the form does not submit it.
- Only owner-authorized requests are eligible.
- Private, tokenized, credential-bearing, and subscription feeds are not accepted.

#### Existing approved initial media hosts

An isolated read-only resolver validates source identity and public RSS metadata. Sources using existing approved initial media hosts retain automatic activation.

The apply processor rechecks the live unchanged Issue and configuration before a SHA-aware write. Podcast publication explicitly requests validated YouTube feed reuse.

#### New media hosts

Unfamiliar initial hosts remain approval-required:

1. Sample up to three eligible episodes: newest, middle, oldest.
2. Inspect audio redirect chains using HEAD only.
3. Require successful coverage of every candidate initial host before proposal generation.
4. Generate tightly scoped changes to:
   - `podcasts.json`
   - `site/app.js`
   - `site/index.html`
5. Bind the proposal to the exact base commit, Issue snapshot, configuration, resolution envelope, and base/proposed file hashes.
6. Test it in a disposable repository in a read-only job.
7. Transfer the bounded data bundle and digest through the same workflow run.
8. A separate privileged writer independently revalidates provenance, live Issue/main state, base files, and regenerated output.
9. Create a proposal branch and **draft PR for owner review only**.

There is **no automatic approval, merge, or production activation of new-host proposals**. The writer does not check out or execute proposal code with its write token.

Bot-created PRs must not be assumed to trigger CI. Preflight therefore runs before PR creation.

HEAD observations are not permissions, browser-playback proof, complete episode coverage, or cookie/ad-free guarantees. Failures or incomplete inspections stop proposal creation.

Preflight environment separation is not an OS-level network sandbox. Hashes alone do not prove that tests ran; workflow provenance and independent writer checks remain necessary.

Failures may leave Git objects or a proposal branch. Inspect actual GitHub state before retrying; do not blindly repeat writes.

## Shared YouTube categories

Categories live in **`categories.json`** and are embedded into the published application.

- Add, rename, delete, and assign categories through Config.
- Search channels by name or immutable ID.
- Label the playing channel without restarting its video.
- Multiple categories apply to every video from a channel.
- Renaming preserves IDs and assignments.
- Deleting categories removes assignments, not channels/videos.
- JSON export/import remains available.
- Explicit legacy draft recovery reads old saved data without deleting originals.

Shared podcast categories are not implemented.

### Save changes for all devices

1. Edit categories or channel assignments in page memory.
2. For a rename, use Save name to apply it to the temporary draft.
3. Select Save to GitHub and review the changes.
4. Review, confirm, and submit the public Issue as owner.
5. Check category processing and its separate publication run.
6. Reload other devices after publication.

Unpublished edits disappear on reload. Export or finish publication before leaving.

Compact requests send changed assignments, protected by owner, unchanged-Issue, and revision checks. Stale requests fail closed.

Category publication uses explicit YouTube feed reuse. A config commit can succeed even if later publication fails; inspect both workflows.

## YouTube channel management

Current functionality still includes:

- Published-channel search and official channel links.
- Owner-authorized GitHub addition/removal requests, one channel per request.
- Local whitelist draft controls.
- Page-memory drafts by default.
- Optional Remember storage.
- Export, Forget, and advanced repository/editor controls.

**GitHub-request-only simplification has been discussed but is not implemented.** Do not assume persistent draft support or its old data has been removed.

Accepted channel requests, including removals and no-ops, currently dispatch a full refresh.

Approvals live in **`channels.json`**. Categories do not approve channels.

Existing browser drafts are not silently migrated between paths. Avoid clearing all origin storage: GitHub Pages projects share an origin.

## Privacy and browser data

MyApps adds no analytics, advertising scripts, service worker, or app-managed offline cache.

| Data                                    | Behavior                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| Podcast queue and progress              | Page memory only; no persistent listening-history feature |
| Speed, volume, repeat, presentation     | Page memory only                                          |
| MyTube Auto-play next and Feed settings | Page memory only                                          |
| View, theme, appearance                 | Page memory only                                          |
| Category edits                          | Page memory until publication/reload                      |
| Optional remembered whitelist draft     | Existing `localStorage` feature                           |
| Audio buffer/cache                      | Browser-managed; not disabled by MyApps                   |
| Provider cookies                        | Possible in standard playback, subject to browser rules   |

MyApps cannot delete cookies belonging to podcast-provider origins or guarantee deletion of cached audio. Releasing the audio source on Close is not cache erasure.

Browser privacy settings can block cookies or clear browsing data. Clearing MyApps site data may also erase optional saved drafts. The application does not call `localStorage.clear()` to perform global cleanup.

YouTube thumbnails contact its image servers when enabled. Video playback contacts YouTube and loads the official iframe API.

Embedded playback may not recognize Premium. Use official YouTube while signed in for its account benefits. MyApps does not authenticate to Google or read membership status.

## Architecture and publication

| Component                | Responsibility                                                 |
| ------------------------ | -------------------------------------------------------------- |
| `channels.json`          | Approved YouTube channels                                      |
| `categories.json`        | Shared YouTube categories                                      |
| `podcasts.json`          | Approved/pending podcast sources                               |
| Issues and Actions       | Owner requests, validation, proposals, collection, publication |
| GitHub Pages             | Static hosting                                                 |
| Page memory              | Temporary editing, filters, layouts, playback                  |
| Optional browser storage | Remembered whitelist drafts and legacy data                    |

No application database, continuously running backend, or direct authenticated frontend save API is used.

Workflow-provided tokens stay in processing steps; no repository-write token is embedded in the frontend.

The documented publication boundary contains exactly seven public files:

```text
index.html
MyTube/index.html
MyPodcasts/index.html
style.css
app.js
icon.svg
data/feed.json
```

Section pages share the same assets. Validated categories and podcast metadata/media URLs are embedded into `app.js`.

Raw podcast catalogues, repository configs, exports, and credentials are excluded from the website artifact. Public configs remain available in the repository.

Publication is main-only. Proposal branches are not a Pages deployment path.

Verify the packaging implementation and generated artifact when changing this boundary.

## Collection, scheduling, and feed reuse

### Scheduled YouTube refresh

The repository variable was last documented as:

```text
YOUTUBE_REFRESH_HOURS_UTC=08,11,15,19
```

Verify the live repository setting before relying on this schedule.

| UTC   | Germany winter/CET | Germany summer/CEST |
| ----- | ------------------ | ------------------- |
| 08:00 | 09:00              | 10:00               |
| 11:00 | 12:00              | 13:00               |
| 15:00 | 16:00              | 17:00               |
| 19:00 | 20:00              | 21:00               |

Fixed UTC hours do not adjust for daylight saving time.

The workflow has 24 hourly cron entries and selects by intended cron hour, not delayed actual start time. Missing/empty configuration defaults to `09,12,18,22`; empty does not disable schedules.

Pushes and manual dispatches bypass the scheduled-hour gate. GitHub start times are not guaranteed.

Scheduling diagnostics/investigation remain paused and unchanged; scheduling irregularity has not been established as resolved.

### Collection selection

| Event                                                                                     | YouTube collection |
| ----------------------------------------------------------------------------------------- | ------------------ |
| Selected schedule                                                                         | Refresh            |
| Unselected schedule                                                                       | Build skipped      |
| Ordinary manual run                                                                       | Refresh            |
| Accepted channel request, including removal/no-op                                         | Refresh            |
| Push changing `channels.json`, `scripts/build_feed.py`, or `scripts/reuse_public_feed.py` | Refresh            |
| Other pushes: frontend, packaging, categories, podcasts                                   | Validated reuse    |
| Category/podcast publication dispatch                                                     | Explicit reuse     |
| Manual run with reuse checked                                                             | Validated reuse    |
| Browsing, website Refresh, editing, local-only commit                                     | No collection      |

Unknown changed-file context conservatively refreshes. Multi-commit pushes use the overall change set.

Every executing publication build reaching podcast collection independently fetches approved RSS metadata—never audio/artwork—regardless of YouTube mode.

### Publish without collecting YouTube

In Actions → Refresh and publish:

1. Run on `main`.
2. Check **Deploy frontend using published feed; no YouTube calls**.
3. Verify build and deployment.

The checkbox defaults to unchecked.

Reuse reads only:

```text
https://linyuli303.github.io/Apps/data/feed.json
```

Safeguards include no redirects, schema/size/credential/config validation, and a 24-hour freshness bound with bounded future tolerance.

- Original generation time is preserved.
- Removal-only reconciliation can remove deleted channels/videos.
- New channels absent from the snapshot require collection.
- Invalid or expired reuse stops publication.
- No silent fallback from reuse to YouTube collection, or from failed collection to reuse.

The channel processor still requests full refresh for removals; it does not automatically select removal-only reuse.

## Quota, freshness, and collection failures

The YouTube allowance was last documented as **10,000 units/day**, resetting at midnight Pacific Time. Verify the actual allowance in the relevant Google Cloud project; fork owners must check their own quota.

Collection uses channel metadata, uploads playlists, and batched video details including statistics.

- Views reflect the last successful collection, not live totals.
- Missing statistics show Unavailable, not zero.
- Frontend-only publication does not refresh view counts.
- Failed collection publishes no new feed.
- Video playback is blocked when its snapshot exceeds 24 hours.
- The quota notice is descriptive, not a remaining-quota counter.
- HTTP 400/403 alone does not establish quota exhaustion.

Podcast source failures are isolated during collection; all enabled sources failing stops publication. There is no per-show last-known-good retention.

Official quota documentation:
https://developers.google.com/youtube/v3/determine_quota_cost

## Set up your own fork

### 1. Review authorization and automation

Adding an API key is not enough. Review workflows, public configs, URLs, owner checks, branch rules, and permissions.

The supplied request design assumes a personal-account-owned repository. Organization ownership needs an authorization redesign.

### 2. Replace installation-specific references

Search tracked files for:

```text
linyuli303/Apps
linyuli303.github.io/Apps/
42029941
```

Review frontend request destinations, feed selection/reuse URLs, validators, processors, proposal bindings/writer provenance, workflow owner/repository gates, tests, and documentation.

Update tests consistently; do not weaken authorization to make a fork run.

### 3. Review public configurations

Review/replace `channels.json`, `categories.json`, and `podcasts.json`.

- Independently verify immutable channel IDs.
- Preserve stable category IDs when renaming.
- Convert Takeout locally; commit reviewed JSON, not raw exports.
- Do not treat imported subscriptions as automatic approval.
- Use public HTTPS podcast sources.
- Never bypass TLS verification or introduce wildcard media permissions.

### 4. Configure Google Cloud and GitHub

Enable YouTube Data API v3 and restrict the key to that API.

For the supplied GitHub-hosted runner design, application restrictions are None. Home-IP or website-referrer restrictions do not match runner collection; fixed-egress restrictions require another design.

| Environment       | Configuration                          |
| ----------------- | -------------------------------------- |
| `youtube-refresh` | Allow `main`; secret `YOUTUBE_API_KEY` |
| `github-pages`    | Allow `main`                           |

The key is injected only into YouTube collection—not frontend files, variables, or Issues.

Enable Issues and review policies for declared workflow permissions and configuration commits.

For proposal PR creation, the repository’s Actions PR setting must eventually permit creation. Enable it only after implementation/security review and controlled testing. The application must never use that permission to approve or merge PRs. No PAT is required by this design.

### 5. Configure Pages and schedule

- Settings → Pages → GitHub Actions.
- Configure the final HTTPS snapshot URL; reuse refuses redirects.
- Set desired hours and update static notices consistently.
- Review environments, reviewers, timers, and branch rules.
- Repository renaming does not guarantee old Pages URL redirects.

### 6. Test locally

Python **3.12** is the documented CI baseline; confirm the current workflow before relying on that version. Runtime Python scripts use the standard library. Node is needed for executable JavaScript tests.

Run from PowerShell using your installed executable paths:

```powershell
$nodeExe = 'C:\path\to\node.exe'
$pythonExe = 'C:\path\to\python.exe'

foreach ($$exe in @($$nodeExe, $pythonExe)) {
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "Executable missing: $exe"
    }
}

# Allow Python tests to discover Node in this session.
$$nodeDir = Split-Path -Parent $$nodeExe
if (($$env:Path -split ';') -notcontains $$nodeDir) {
    $$env:Path = "$$nodeDir;$env:Path"
}

& {
    git diff --check
    if ($LASTEXITCODE -ne 0) { throw "Whitespace check failed." }

    & $nodeExe --check site/app.js
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed." }

    & $nodeExe tests/spotify_embed_player_regression.cjs
    if ($LASTEXITCODE -ne 0) { throw "Spotify regression test failed." }

    & $pythonExe -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw "Unit test suite failed." }

    & $pythonExe scripts/security_check.py
    if ($LASTEXITCODE -ne 0) { throw "Security check failed." }

    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw "Staged whitespace check failed." }

    Write-Host "`nAll validation commands passed." -ForegroundColor Green
}
```

Review and stage intended new files before relying on security-check coverage; it scans tracked files.

Node-dependent tests are skipped if unavailable. Report skips explicitly and read actual CI logs rather than assuming those checks ran.

Fake-media tests cover retry policy and simulated event ordering, not browser CORS or provider behavior. Offline tests do not prove live authorization, playback, or deployment.

### 7. Commit and synchronize safely

- Inspect the working tree and review the diff.
- Run required tests before committing.
- Verify affected UI behavior in the browser.
- Stage only intended files and review the staged diff.
- Commit only after validation passes.
- Before pushing, fetch and compare:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "Fetch failed." }

git rev-list --left-right --count HEAD...origin/main
if ($LASTEXITCODE -ne 0) { throw "Branch comparison failed." }
```

The first number is local commits ahead; the second is commits behind.

- Ahead only: no pull is required.
- Behind or diverged: inspect and integrate remote changes before pushing.
- Protect uncommitted work; do not pull or stash blindly.
- After integration or code changes, rerun validation.
- Do not force-push or discard changes as a shortcut.
- A successful push does not establish successful CI or deployment.

Use the correct upstream when working on a branch other than `main`.

### 8. First publication and verification

Run initial publication with reuse unchecked; a new installation has no published snapshot.

Verify:

- Tests, collection, packaging, and deploy.
- Main/section direct URLs, reload, Back/Forward.
- Device layouts and manual override.
- RSS panel geometry, search, Back/Close, phone swipes, and scrolling.
- MyTube playback, filtering, speed, Kino, fullscreen.
- MyTube Auto-play next defaults to enabled, remains switchable, and stops at the list end.
- Feed defaults/reset restore 720px width, 85vh height, and 5% background transparency, constrained to the screen.
- The custom Caption button is absent; native YouTube caption controls remain provider-controlled.
- Podcast playback, volume, queue, repeat, automatic advancement, and section continuity.
- Collapse/dock/restore without interrupting audio.
- Anonymous and fallback playback from the actual hosting Origin.
- Disclosure in expanded, collapsed, and docked states.
- Pause/Close and rapid episode changes do not restart stale attempts.
- LG normal-speed compatibility and phone seeking.
- Feed reuse skips YouTube collection.
- Existing-host activation/removal still works.
- New-host PRs contain only intended changes and cannot auto-activate.
- Other devices receive published changes after reload.

## Security boundaries and limitations

- Fixed repository/main boundaries and numeric owner authorization.
- Live unchanged-Issue checks and SHA/revision/digest bindings.
- Read-only source resolution and proposal preflight separated from privileged writes.
- Trusted writer code; no proposal execution with write credentials.
- Exact seven-file publication boundary.
- Safe text rendering and restrictive CSP.
- Credential-pattern, path, export, and size checks.
- Public-IP pinned HTTPS, TLS verification, checked redirects, bounded inputs, and safe XML.
- HEAD-only media inspection; no audio-body downloads during onboarding.
- Explicit media hosts, never unrestricted HTTPS/wildcard permissions.
- Network time budgets are bounded intentions, not absolute DNS/socket wall-clock guarantees.
- Browser controls are not authentication or parental-control boundaries.
- Shared CSP hosts are not per-show browser isolation.
- Path-scoped storage is not same-origin isolation.
- Existing browser data is not globally erased.
- Optional header/CODEOWNERS templates are not automatically enforced.
- Pinned Actions and passing tests do not establish complete security.

This is **not private hosting, instant revocation, parental access control, or a cookie-free/ad-free playback guarantee**. Providers may expose content beyond the approved catalogue.

See `VERIFICATION.md` for additional scope and limitations; reconcile it with current implementation before relying on it.

## Acknowledgements

The palette collection is inspired by traditional Japanese colors presented by **Nippon Colors**:

https://nipponcolors.com/

Interface and palette adaptations are independent work; no affiliation or endorsement is implied.

## License

MIT licensed. Not affiliated with or endorsed by YouTube, Google, GitHub, Apple, Spotify, podcast publishers, or Nippon Colors.
