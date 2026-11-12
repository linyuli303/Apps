# MyApps — All your favourites, one place

**Attention Is All You Need.** A shared, RSS-style home for browsing approved YouTube channels and listening to public podcasts—without added analytics or advertising scripts.

[Launch MyApps](https://linyuli303.github.io/Apps/)

MyApps brings together:

- **MyTube** — approved YouTube channels, searchable text feeds, shared categories, and embedded playback.
- **MyPodcasts** — approved public RSS shows, episode browsing, and a shared audio player with an editable playlist.
- **MySpotify** — coming soon; account connection is not implemented.

Switch between applications within one shared shell, or bookmark a section directly:

- MyTube: https://linyuli303.github.io/Apps/MyTube/
- MyPodcasts: https://linyuli303.github.io/Apps/MyPodcasts/

Clean section URLs support direct opening, reload, and browser Back/Forward. Switching sections does not reload the application shell; podcast playback and its playlist remain available until explicitly stopped or the page reloads.

> **Public by design:** the repository, approved source configurations, category names and assignments, published metadata, and change-request Issues are public. Never commit API keys, tokens, cookies, passwords, private subscription links, or raw Takeout exports.

The public viewer uses the owner’s approved sources and published categories. To create your own installation, review the fork setup below.

## MyTube

### Browsing

- Search, channel/category filters, sorting, and 48-item pagination.
- Image-free text feed by default; YouTube thumbnails are opt-in.
- Text-feed columns show **Date | Channel | Title | Category tags | Views and duration**.
- Multiple categories per channel, displayed across browsing views.
- Disabled “Coming soon” provider entries do not represent implemented integrations.

The current configuration requests **15 recent uploads per channel**, not full history. Private, unavailable, upcoming, or non-embeddable videos may be excluded. Short-video filtering can reduce the visible count further.

### Playback

- Embedded playback with **Kino mode**, video-only fullscreen, and **Open in YouTube / App**.
- **Previous / Next** follows the current filtered, sorted list and wraps at its ends.
- **Auto-play next** is off by default, advances when a video ends, and stops at the end of the list.
- **Loop** repeats the current video and takes priority over Auto-play next.
- **Skip videos <60s** is enabled by default. Videos exactly 60 seconds long and videos with unknown durations remain included.
- Short-video filtering applies to browsing, the RSS catalogue, playback Feed menu, and navigation. Changing it does not interrupt the current video.
- The duration rule is not YouTube’s official Shorts classification and does not fetch older uploads to replace skipped videos.
- Preferred speed ranges from **0.25× to 2×**, in **0.25 increments**. YouTube determines supported rates; unavailable selections use a supported fallback or display a status message.
- Video durations appear throughout browsing and playback views. Missing or unsupported values display **Unavailable**.
- Playback preferences remain in page memory and reset on reload.

The collapsible **Feed** menu previews the current filtered list, highlights the playing video, and shows channel, publication date, views, and duration. It uses 48-row pagination and overlays the player without resizing the video window.

Playback controls and filtering use the published snapshot and official iframe API; they do not make additional YouTube Data API requests. Browser autoplay restrictions may still require pressing Play.

### RSS-style catalogue

- Left-edge catalogue, collapsed by default, with hover, click, and keyboard support.
- Channels ranked by newest available upload.
- Click a channel to pin its adjacent feed.
- Compact rows with publication date, title, views, and duration.
- **Back to channels** navigation on narrow screens.

This is an RSS-style webpage, **not an XML subscription feed**.

## MyPodcasts

### Sources and browsing

- Browse approved public HTTPS RSS shows.
- Search episodes and shows, filter by show, sort, and paginate results.
- View unavailable or pending sources under source availability and Config.
- No automatic artwork loading.
- No upcoming-audio preloading.
- Audio is requested only after an explicit playback action; Auto-next may request the next episode after the current one ends.

The collector includes all eligible entries supplied by each approved RSS feed, subject to explicit safety limits. This is **not a guarantee of the publisher’s complete historical archive**.

### Audio player and playlist

- Play/Pause, Previous/Next, seeking, speed selection, and −15/+15 seconds.
- Auto-next enabled after playback starts.
- Repeat **Off / List / One**; Repeat One takes priority.
- Initial Play creates a queue from the current filtered results, starting at the selected episode.
- Playing another library episode silently replaces the queue.
- Playing the current library episode toggles Play/Pause.
- **Add to playlist** appends an episode without starting playback.
- Changing library sorting does not reorder an established playlist.
- Reorder upcoming episodes by drag/drop or arrow controls.
- **Move to top** means next-to-play, not before the current episode or listening history.
- Double-click a playlist title—or use Enter/Space—to play that item without rebuilding the queue.
- Large playlists render in chunks of 100.
- Close stops playback and clears the playlist and audio source.

Starting YouTube playback pauses podcast audio. Starting a podcast closes the YouTube player. Switching application sections alone does not stop podcast playback.

Queue, progress, repeat, and speed state are memory-only and reset on reload. A dedicated podcast volume control is not implemented yet; use browser or device volume controls.

### Podcast requests and automatic onboarding

Open **MyPodcasts → Config** to review additions or removals through public GitHub Issues.

- Additions accept public Apple Podcasts show links or plain public HTTPS RSS URLs.
- Removals use stable show IDs.
- Opening a prefilled Issue does **not** submit it.
- Only owner-authorized requests are eligible.
- Private subscription URLs, credentials, and tokenized links are not accepted.

Automatic onboarding resolves the source and validates RSS metadata using an isolated read-only job. Sources using existing approved initial media hosts can activate automatically. Unfamiliar media hosts, unsupported redirects, or validation failures require review.

The privileged apply job rechecks the live unchanged Issue and current configuration before a SHA-aware write. Resolution is bound to the Issue snapshot and configuration digest; concurrent changes fail closed.

Onboarding does not download audio, automatically expand CSP permissions, or probe downstream audio redirect chains. Podcast configuration publication explicitly requests YouTube feed reuse.

The onboarding implementation has passed offline and real-source resolver tests. Deployment success alone does not establish end-to-end verification of a genuinely new Issue-based activation.

## Shared YouTube categories

Categories are stored in **`categories.json`** and embedded in the published application, so devices load the same saved definitions and assignments.

- Open **Config → Manage categories** to add, rename, delete, or assign categories.
- Search channels by name or immutable ID.
- Label the current channel through **Channel categories** beneath the video without restarting playback.
- Assign multiple categories per channel; labels apply to every video from that channel.
- Renaming preserves category IDs and assignments.
- Deleting a category removes its assignments, not channels or videos.
- Export/import JSON backups.
- Explicitly recover older browser category drafts, including the previous `/MyTube/` scope, without deleting the stored originals.

Shared podcast category assignments are not implemented.

### Edit locally, then save for all devices

1. Edit in **Manage categories** or the player’s category panel. Click **Save name** to apply a rename to the draft.
2. Click **Save to GitHub…** and review the human-readable changes.
3. Open the prefilled GitHub Issue, review the public request, check its confirmation, and submit as the authorized owner.
4. Check **Apply owner category request**, then its separate **Refresh and publish** run.
5. Reload MyApps on other devices.

**Category edits remain in page memory until reload.** Export unfinished edits or complete publication before leaving. Opening a GitHub form does not submit or save anything.

Compact requests send changed assignments rather than the entire assignment map. Owner authorization, unchanged-Issue checks, and revision checks protect updates; stale requests are rejected.

Category requests dispatch **reuse-only publication**. The feed must still pass freshness and validation checks. A configuration commit can succeed even if the later publication fails—inspect both workflows.

## YouTube channel management

- Search approved channels by name or immutable ID.
- Channel names link to official YouTube pages.
- Local whitelist changes affect that browser’s draft only.
- Whitelist drafts are session-only by default; **Remember** explicitly enables browser storage.
- Export and Forget controls are available.
- Shared additions/removals use prefilled owner-authorized GitHub Issues.
- Each request currently covers one channel.
- Accepted channel requests—including removals and no-ops—currently dispatch a **full refresh**.

Approvals live in **`channels.json`**. Category labels do not approve channels.

Existing browser drafts are not silently migrated from `/MyTube/` to `/Apps/`. Export important whitelist drafts before a path migration. Do not clear all origin storage: GitHub Pages projects share an origin.

## Appearance and privacy

- **51 palettes**, with **Yugure / 夕暮れ** and light appearance as defaults.
- Shared Light, Dark, and System appearance.
- Palette and appearance selections remain in page memory.
- No added analytics, advertising scripts, service worker, or app-managed offline cache.
- No new persistent listening history or progress storage.

Native audio playback may use normal buffering and browser-managed caching. Audio providers may use cookies, and publisher-inserted advertising may remain. **MyApps does not guarantee cookie-free or ad-free provider playback.**

YouTube thumbnails contact YouTube’s image servers when enabled. Opening a video contacts YouTube and loads its official iframe API for playback controls.

Embedded playback may not recognize YouTube Premium. Use **Open in YouTube / App** while signed in for official playback; app opening depends on device settings. MyApps does not authenticate to your Google account or read your membership status.

## Architecture and publication

| Component | Responsibility |
| --- | --- |
| `channels.json` | Approved YouTube channels |
| `categories.json` | Shared YouTube category definitions and assignments |
| `podcasts.json` | Approved/pending podcast source configuration |
| GitHub Issues and Actions | Owner-authorized processing, collection, and publication |
| GitHub Pages | Static hosting |
| Page memory | Current drafts, filters, appearance, queue, and playback state |
| Optional browser storage | Explicitly remembered whitelist drafts and legacy saved data |

There is **no application database, continuously running backend, or direct authenticated frontend save API**.

Issue processors use workflow-provided GitHub tokens. The public frontend contains no repository-write token.

Publication allows exactly **seven files**:

```text
index.html
MyTube/index.html
MyPodcasts/index.html
style.css
app.js
icon.svg
data/feed.json
```

Both section pages use the same shared application assets. Validated category data and podcast metadata/media URLs are embedded in `app.js`.

Raw generated podcast catalogues, configuration files, exports, and credentials are not copied into the website artifact. Public configurations remain accessible in the repository.

## Collection and refresh

### YouTube schedule

The configured repository variable is:

```text
YOUTUBE_REFRESH_HOURS_UTC=08,11,15,19
```

| UTC | Germany: winter/CET | Germany: summer/CEST |
| --- | --- | --- |
| 08:00 | 09:00 | 10:00 |
| 11:00 | 12:00 | 13:00 |
| 15:00 | 16:00 | 17:00 |
| 19:00 | 20:00 | 21:00 |

These are fixed UTC hours and do not adjust automatically for daylight saving time.

The workflow contains 24 hourly cron entries. The existing gate selects scheduled runs by their intended cron hour, not their delayed actual start time. A missing or empty variable defaults to `09,12,18,22`; an empty value does not disable scheduling.

Pushes and manual dispatches bypass the scheduled-hour gate. Start times are targets, not guarantees. Scheduling diagnostics remain unchanged; irregular scheduling has not been established as resolved.

### What triggers YouTube collection?

| Event | New YouTube data? |
| --- | --- |
| Selected scheduled hour | Yes |
| Unselected scheduled hour | No—build skipped |
| Ordinary manual run, reuse unchecked | Yes |
| Accepted owner channel request, including removal/no-op | Yes |
| Push changing `channels.json`, `scripts/build_feed.py`, or `scripts/reuse_public_feed.py` | Yes |
| Other pushes, including frontend, packaging, or category-only changes | No—validated feed reuse |
| Owner category publication | No—explicit reuse-only dispatch |
| Podcast configuration publication | No—explicit reuse-only dispatch |
| Manual run with reuse checked | No—validated feed reuse |
| Browsing, searching, editing drafts, or using website Refresh | No |
| Local commit without pushing | No |

If changed-file detection is unreliable, the selector conservatively chooses a full refresh. Multi-commit pushes are evaluated by their overall changes.

Podcast RSS collection runs independently during publication builds that reach its collection step. It fetches metadata, not audio or artwork, and does not use the YouTube API key.

### Publish without refreshing YouTube

1. Open **Actions → Refresh and publish → Run workflow**.
2. Select `main`.
3. Check **Deploy frontend using published feed; no YouTube calls**.
4. Verify both build and deployment.

The checkbox defaults to unchecked. Category and podcast automation supply the reuse input where appropriate.

### Feed-reuse safeguards

Reuse downloads only the fixed configured snapshot:

```text
https://linyuli303.github.io/Apps/data/feed.json
```

- Redirects are refused.
- Schema, size, credential patterns, configuration consistency, and freshness are checked.
- The snapshot must be no more than **24 hours old**, with bounded future-time tolerance.
- Removal-only reconciliation can filter deleted channels and their videos.
- Newly approved channels missing from the snapshot require live collection.
- The original generation timestamp is preserved.
- Invalid, unavailable, expired, or inconsistent snapshots stop publication.
- Reuse never silently falls back to YouTube requests.

The channel-Issue processor still requests a full refresh for removals. Removal-only reuse is not automatically selected by that processor.

## YouTube quota, freshness, and view counts

The configured project allowance is **10,000 YouTube Data API units per day**, resetting at midnight Pacific Time. Fork owners must verify their own project allowance.

Collection uses channel metadata, uploads playlists, and batched video-detail requests. Statistics are included in the video-detail requests rather than fetched separately.

- View counts reflect the last successful collection, not live totals.
- Missing statistics display **Unavailable**, not zero.
- Frontend-only publication does not update view counts.
- Failed collection publishes no new feed.
- Playback is blocked after the feed exceeds the application’s 24-hour freshness limit.
- The site’s quota notice describes the configured allowance, not remaining quota.

Avoid repeated retries without diagnosis. HTTP 403 or 400 alone does not prove quota exhaustion.

Official quota documentation:
https://developers.google.com/youtube/v3/determine_quota_cost

## Set up your own MyApps fork

### 1. Review before enabling automation

Adding an API key is not sufficient. Review all workflows, public source configurations, repository URLs, owner checks, and deployment permissions.

The supplied request workflows assume a **personal-account-owned repository**. Organization ownership requires an authorization redesign.

### 2. Replace installation-specific references

Search tracked files for:

```text
linyuli303/Apps
linyuli303.github.io/Apps/
42029941
```

Review at least:

- Frontend Issue destinations and advanced-editor hints.
- `scripts/select_feed_mode.py` runner identity.
- `scripts/reuse_public_feed.py` fixed snapshot URL.
- Channel/category/podcast validators and processors.
- Podcast resolution and privileged apply boundaries.
- Repository, actor, author, and numeric-owner guards in request workflows.
- Tests, documentation, and recovery paths.

Update tests consistently. Do not weaken authorization merely to make a fork run.

### 3. Review public configurations

Review or replace:

- `channels.json`
- `categories.json`
- `podcasts.json`

Use independently reviewed immutable channel IDs. Preserve stable category IDs when renaming.

Takeout conversion is local-only. Commit reviewed JSON, **not raw exports**. Do not automatically approve channels merely because they appear in an imported CSV.

Podcast feeds must be public HTTPS sources. New feed/media hosts require review; never bypass certificate validation or add unrestricted media-source permissions.

### 4. Configure Google Cloud and GitHub

Enable YouTube Data API v3 and create an API key restricted to that API.

For the supplied GitHub-hosted runner design, application restrictions are **None**. Home-IP and website-referrer restrictions do not match runner-side collection. Fixed-egress restrictions require a separate design.

| Environment | Configuration |
| --- | --- |
| `youtube-refresh` | Allow `main`; environment secret `YOUTUBE_API_KEY` |
| `github-pages` | Allow `main` |

Keep the API key out of frontend files, repository variables, and Issues. It is injected only into the YouTube collection step.

Enable Issues and confirm policies permit declared workflow permissions and configuration commits. Review required reviewers and wait timers if unattended operation is intended.

### 5. Configure Pages and scheduling

- Select **GitHub Actions** under **Settings → Pages**.
- Configure the final HTTPS snapshot URL; redirects are not accepted.
- Set desired scheduled hours and update static notices consistently.
- Review branch rules that may prevent direct workflow commits.

A repository rename does **not** guarantee a redirect for the old GitHub Pages website.

### 6. Test locally

Python **3.12** matches CI. Runtime scripts use the standard library.

```powershell
python -m unittest discover -s tests -q
python scripts/security_check.py
git diff --check
git diff --cached --check
```

The security checker scans Git-tracked files. Stage new files before relying on its coverage.

Node-dependent tests are skipped when Node is unavailable. Review CI logs to determine which checks actually ran; do not assume local skips were covered.

Offline tests do not prove browser correctness, live authorization, network behavior, or deployment success.

### 7. First deployment and verification

A new installation has no published feed to reuse. Run the first publication with reuse unchecked.

Verify:

- Collection, packaging, and deployment succeed.
- The main URL and both section URLs open directly.
- Reload and browser Back/Forward select the correct section.
- Section navigation preserves the shared shell.
- Podcast playback and queue survive section navigation.
- YouTube playback, Kino, fullscreen, filters, and speed controls work.
- Reuse-only publication skips YouTube collection.
- Owner request processing and its separate publication succeed.
- Published changes appear on another device after reload.

## Security boundaries and limitations

- Fixed repository boundaries, main-branch guards, numeric owner authorization, and SHA/revision-aware writes are retained.
- Resolver work is separated from privileged podcast configuration writes.
- Live unchanged-Issue checks protect request processing.
- Only the explicit seven-file website artifact is published.
- Safe text rendering, restrictive CSP, credential-pattern checks, and export/path checks remain in place.
- Podcast collection uses pinned public-IP HTTPS connections, checked redirects, certificate validation, bounded inputs, and safe XML handling.
- Media CSP permissions use explicit hosts, not unrestricted HTTPS wildcards.
- Browser controls are not an authentication boundary.
- Path-scoped storage is not same-origin isolation.
- Existing browser data is not erased globally.
- Optional header/CODEOWNERS templates are not automatically enforced.
- Passing tests and pinned Actions do not establish complete security.

This is **not private hosting, parental access control, instant revocation, or a cookie-free playback guarantee**. Official providers may expose content outside the approved catalogue.

See `VERIFICATION.md` for additional testing scope and limitations.

## Acknowledgements

The palette collection is inspired by the traditional Japanese colors presented by **Nippon Colors**:

https://nipponcolors.com/

MyApps’ interface and palette adaptations are independent work; no affiliation or endorsement is implied.

## License

MIT licensed. Not affiliated with or endorsed by YouTube, Google, GitHub, Apple, Spotify, podcast publishers, or Nippon Colors.
