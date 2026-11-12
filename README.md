# MyTube — Your channels, your feed

A static, whitelist-based YouTube browsing app hosted on GitHub Pages, with repository-backed channel approvals and shared categories.

Browse approved channels through a searchable video grid, an image-free text feed, or an RSS-style catalogue. Videos play inside MyTube by default, with an option to open official YouTube or its app.

**The repository, channel IDs, category names and assignments, published feed, and change-request Issues are public. Never commit API keys, tokens, cookies, passwords, or raw Takeout exports.**

## View MyTube

https://linyuli303.github.io/Apps/

The public viewer uses the owner’s approved channels and published categories. To create your own feed, follow the fork setup below.

## Features

### Browsing and playback

- Search, channel/category filters, sorting, and 48-card pagination.
- Optional thumbnails; turn them off for a compact text feed without placeholder images.
- Embedded playback with **Kino mode**, video-only fullscreen, and **Open in YouTube / App**.
- **Previous / Next** icon buttons navigate the current filtered, sorted list, wrapping at its ends.
- **Auto-play next** advances when a video ends and stops at the end of the list. It is off by default, with the preference remembered on that browser.
- **Loop** repeats the current video and takes priority over Auto-play next. It is off initially and lasts for the page session.
- **Skip videos <60s** is enabled by default, with the preference remembered on that browser. It filters the grid, text feed, RSS catalogue, playback Feed menu, and navigation. Videos exactly 60 seconds long and videos with unknown durations remain included. Changing the setting does not interrupt the current video.
- The skip rule uses duration, not YouTube’s official Shorts classification. It does not fetch older videos to replace skipped uploads.
- A collapsible **Feed** menu beside **Channel categories** previews the current filtered list, highlights the playing video, and shows channel, publication date, views, and duration. Select a row to play it. Click the menu again, click outside, or press Escape to collapse it. The panel uses 48-row pagination and overlays the player without resizing the video window.
- Video durations appear in the grid, text feed, RSS catalogue, and playback Feed menu. Missing or unsupported durations display **Unavailable**.
- Remembered preferred speed from **0.25× to 2×**, in **0.25 increments** for both the dropdown and slider. No custom-rate option. YouTube determines supported rates; MyTube uses a supported fallback and reports failures or mismatches rather than claiming an unsupported rate worked.
- The current configuration requests **15 recent uploads per channel**, not full history. Skipping short videos can leave fewer than 15 visible videos per channel. Private, unavailable, upcoming, or non-embeddable videos may also be excluded.
- Playback controls, duration display, and short-video filtering use the existing snapshot and official iframe API; they do not make additional YouTube Data API requests. Browser autoplay restrictions can still require pressing Play manually.

### RSS-style catalogue

- Left-edge catalogue, collapsed by default, with hover, click, and keyboard support.
- Channels ranked by newest available upload; click a channel to pin its adjacent feed.
- Compact rows showing **Published date | Video title | Views**.
- Theme-tinted backgrounds and hover/focus highlights.
- **Back to channels** navigation on narrow screens.

This is an RSS-style webpage, **not an XML subscription feed**.

### Shared categories

Categories are stored in **`categories.json`** and published with the website, so devices load the same saved labels without importing a backup.

- Eight defaults: **Data & AI, IT & Cyber, Travel, Music, Skills, News, Talk Shows & Podcasts, Entertainment**.
- Open **☰** beside the category filter to add, rename, delete, or assign categories. Search channels by name or immutable ID.
- Label the current channel through **Channel categories** beneath the video, without restarting playback.
- Assign multiple categories per channel. Labels apply to **every video from that channel**, across the grid, text feed, and RSS catalogue.
- Rename categories without losing assignments. Deleting a category removes its assignments, not channels or videos.
- Export/import JSON backups; explicitly import previous browser-only labels when migrating.

#### Edit locally, then save for all devices

1. Make changes in **Manage categories** or the player’s category panel. For a rename, click **Save name** to apply it to the draft.
2. Make further edits if needed; several changes can be submitted together.
3. Click **Save to GitHub…** and review the human-readable changes. Technical JSON is collapsed under **Technical details / Copy fallback**.
4. Open the prefilled GitHub Issue, review the public request, check its confirmation, and submit using the authorized owner account. Large requests may require copying the payload into the form.
5. Check **Apply owner category request**, then its separate **Refresh and publish** run.
6. Reload MyTube on each device. **Published categories loaded. No unsaved changes.** indicates that device has no pending draft against its loaded published snapshot; it is not a continuous live-sync indicator.

**Checking a category or clicking Save name updates a browser-local draft, not the repository. Opening the GitHub form does not submit it.** Shared saving requires successful request processing and publication.

Compact requests send changed assignments rather than the entire assignment map. Category definitions are included when edited. Owner authorization, unchanged-Issue checks, and revision checks protect updates; stale requests are rejected rather than overwriting newer data. Export a draft backup before discarding or rebuilding stale edits.

Category requests explicitly dispatch **reuse-only publication**, with no YouTube Data API calls. Reuse must still pass the feed’s freshness and validation checks. A repository commit can succeed even if the later publication fails; inspect both workflows.

### Channel management

- Search approved channels by name or immutable ID; channel names link to official YouTube pages.
- Browser-local whitelist drafts support Remember, Forget, and export controls. Local changes do not update the shared whitelist.
- Request shared additions/removals through prefilled, owner-authorized GitHub Issues.
- **Each channel request currently covers one channel.** Multi-channel or combined channel/category requests are not implemented.
- Accepted channel requests—including removals and no-ops—currently dispatch a **full refresh**.

Channel approvals live in **`channels.json`**. Category labels do not approve channels or alter this whitelist.

### Appearance

- **51 palettes**, with **Yugure / 夕暮れ (Twilight)** as the default for users without a saved preference.
- Shared **Light, Dark, and System** appearance across browsing and playback.
- Existing saved palette and appearance choices are preserved. Theme, appearance, and preferred playback speed remain browser-local; repository-backed category sync does not sync those preferences.

## How storage and hosting work

| Component                 | Responsibility                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `channels.json`           | Shared approved-channel configuration                                                 |
| `categories.json`         | Shared category definitions and channel assignments                                   |
| GitHub Issues and Actions | Owner-authorized validation, repository updates, and publication                      |
| GitHub Pages              | Static website hosting                                                                |
| Browser storage           | Local category drafts, optional whitelist drafts, and playback/appearance preferences |

The Issue processors use GitHub’s REST API and workflow-provided token. The public frontend contains no repository-write token. There is **no application database, continuously running backend, or direct authenticated frontend save API**.

Publication retains the five-file allowlist: `index.html`, `style.css`, `app.js`, `icon.svg`, and `data/feed.json`. Validated shared categories are embedded in the published `app.js`; `categories.json` is not a sixth website asset, but remains public in the repository.

## Playback and YouTube Premium

Videos play inside MyTube by default. Embedded playback may not recognize Premium; use **Open in YouTube / App** while signed in to your Premium account for official playback. App opening depends on device settings, and creator-included sponsorships may remain.

MyTube does not access your Google login, cookies, or membership. Its API key retrieves public metadata, not Premium authentication. Preferred speed applies only inside MyTube, not external playback.

Thumbnails contact YouTube’s image servers; the image-free text feed and RSS catalogue do not load thumbnails. Playback speed control loads YouTube’s official iframe API when a video opens. This does not consume YouTube **Data API** quota.

## Refresh schedule

The current repository variable is:

```text
YOUTUBE_REFRESH_HOURS_UTC=08,11,15,19
```

Set it under **Settings → Secrets and variables → Actions → Variables**. Enter two-digit UTC hours separated by commas, **without spaces**.

| UTC   | Germany: winter (CET) | Germany: summer (CEST) |
| ----- | --------------------- | ---------------------- |
| 08:00 | 09:00                 | 10:00                  |
| 11:00 | 12:00                 | 13:00                  |
| 15:00 | 16:00                 | 17:00                  |
| 19:00 | 20:00                 | 21:00                  |

The intended German refresh times are **09:00, 12:00, 16:00 and 20:00**.
The winter setting above uses fixed UTC hours and does not adjust automatically.
To keep those local times during summer (CEST), change the variable to
`07,10,14,18` and update the frontend notice accordingly.

The workflow has 24 hourly schedule entries. Only selected schedule hours proceed; other entries can appear as **Skipped**, without executing the feed builder. Selection uses the intended cron hour, not a delayed actual start time.

**The hour gate applies only to scheduled events. Pushes and manual dispatches bypass it.** A missing or empty variable defaults to `09,12,18,22`; an empty value does not disable scheduling. Start times are targets, not guarantees. Update the site’s static schedule notice separately when changing the variable.

### What triggers YouTube requests?

| Event                                                                                | Fetches new YouTube data?       |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| Selected scheduled hour                                                              | Yes                             |
| Unselected scheduled hour                                                            | No—build skipped                |
| Ordinary manual run, reuse unchecked                                                 | Yes                             |
| Accepted owner channel request, including removal or no-op                           | Yes                             |
| Push changing `channels.json`, `scripts/build_feed.py`, or `scripts/prepare_site.py` | Yes                             |
| Other pushes, including category-data-only changes                                   | No—reuse validated public feed  |
| Accepted owner category request                                                      | No—explicit reuse-only dispatch |
| Manual run with reuse checked                                                        | No—reuse validated public feed  |
| Browsing, searching, editing labels, or expanding RSS panels                         | No                              |
| Refresh button inside MyTube                                                         | No—reload published snapshot    |
| Local Git commit without pushing                                                     | No—no GitHub workflow triggered |

If Git cannot reliably determine changed files, the selector conservatively chooses a full refresh. A push containing multiple commits is evaluated for its overall changes, not just the final commit message.

## Publish without refreshing YouTube

For an explicit reuse-only deployment:

1. Open **Actions → Refresh and publish → Run workflow**.
2. Select `main`.
3. Check **Deploy frontend using published feed; no YouTube calls**.
4. Run the workflow and verify both build and deployment.

The checkbox defaults to **unchecked**. Category automation supplies the reuse input automatically; its resulting run can be labelled **Manually run by github-actions[bot]**.

### Feed-reuse safeguards

Reuse downloads the snapshot from the fixed configured public Pages URL. It validates schema, size, credentials, configuration consistency, and freshness before publication.

- The feed must be no more than **24 hours old**, with bounded future-time tolerance.
- Removal-only changes can filter deleted channels and their videos from a validated snapshot.
- Newly approved channels missing from the snapshot require a live refresh.
- The original generation timestamp is preserved: reuse does not make old data fresh.
- Invalid, unavailable, or inconsistent snapshots stop publication.
- Reuse never silently falls back to YouTube requests; failed API refreshes do not automatically fall back to reuse.

**The current channel-Issue workflow still requests a full refresh for removals.** Removal-only reuse is available through an appropriate reuse-mode deployment, not automatically selected by that processor.

The website’s **Feed built** timestamp is shown in browser-local time. A successful reuse-only deployment leaves that feed timestamp unchanged.

## API quota and view counts

MyTube does not use AI tokens. YouTube Data API consumption is measured in **quota units**, separate from Premium viewing allowances.

The current project has a **10,000-unit daily allowance**, resetting at **midnight Pacific Time**. This corresponds to 09:00 in Germany when both regions use their usual winter or summer offsets, and 08:00 during the short periods when their daylight-saving transitions differ. Fork owners must check their own project’s quota.

The builder performs:

- One channel-metadata request per approved channel.
- One uploads-playlist request per channel.
- Video-detail requests in batches of up to **50 video IDs**, including view statistics in the same request.

These list methods each cost one quota unit per request. For example, **188 channels × up to 15 uploads** implies up to **188 + 188 + 57 = 433 units** for a normal complete refresh, excluding retries. Fewer returned or deduplicated videos can reduce the detail-batch count. This is an estimate, not a measured per-run report.

All live refreshes, retries, and other applications using the project contribute to usage. Quota dashboards are not live per-request counters and can show delayed updates. A per-minute rate limit is separate from the daily allowance; it does not increase that allowance.

Official method costs and quota rules:
https://developers.google.com/youtube/v3/determine_quota_cost

### Failed refreshes

- No new feed is deployed when the builder fails.
- Avoid repeated retries before diagnosing the failure. HTTP 403 alone does not establish quota exhaustion; HTTP 400 is not proof of quota exhaustion either.
- Once quota is exhausted, new metadata cannot be fetched until quota becomes available.
- Reuse-only publication can still work while the existing feed passes validation.
- Playback is blocked after the feed exceeds the app’s 24-hour freshness limit.

The website’s quota notice describes the configured allowance, **not remaining quota**. Private per-run quota reporting and email notifications are not implemented.

### View counts

View counts reflect the **last successful feed refresh**, not live totals. Missing statistics show **Unavailable**, not zero. A failed refresh leaves previous counts unchanged; frontend-only publication does not update them.

## Set up your own MyTube fork

### 1. Fork and review

Review the source and workflows before enabling automation. **Adding an API key alone is not enough:** repository URLs, owner guards, and supplied public configurations must be replaced or reviewed.

### 2. Replace repository and owner references

| File                                         | Configuration to review                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `site/app.js`                                | Channel/category request-form destinations                                   |
| `scripts/reuse_public_feed.py`               | Fixed public feed URL                                                        |
| `scripts/select_feed_mode.py`                | Runner repository identity                                                   |
| `scripts/channel_request.py`                 | Repository and personal-owner authorization                                  |
| `scripts/process_channel_request.py`         | Repository and immutable numeric owner ID                                    |
| `scripts/category_request.py`                | Category authorization and numeric owner guard; reuses channel authorization |
| `scripts/process_category_request.py`        | Imported repository/owner constants and category processing                  |
| `.github/workflows/channel-change.yml`       | Channel-request repository, actor, author, and owner guards                  |
| `.github/workflows/category-change.yml`      | Category-request repository, actor, author, and owner guards                 |
| Tests, documentation, and optional templates | Installation-specific expectations                                           |

Search tracked files for the original repository name, username, and numeric account ID. Update references and their tests consistently; do not weaken authorization checks merely to make a fork run.

Both request workflows assume a **personal-account-owned repository**. Organization-owned repositories require an authorization redesign.

### 3. Configure channels and categories

Review or replace **both** `channels.json` and `categories.json`. A fork inherits the original public whitelist and labels unless you change them.

```json
{
  "title": "MyTube",
  "max_videos_per_channel": 15,
  "channels": [{ "id": "UCVuR4hBxX3zWY_xUCZeIc3A" }]
}
```

Replace the example with independently reviewed immutable channel IDs. Handles can be resolved locally using `scripts/resolve_handle.py`; review the identity before approval. Resolution may consume YouTube quota.

Takeout conversion is local-only. Commit reviewed JSON, **not the CSV**. For removal-only reconciliation, retain the intersection of approved IDs and export IDs; do not automatically approve CSV-only channels.

Shared category data uses this structure:

```json
{
  "version": 1,
  "categories": [{ "id": "cat-0", "name": "Music" }],
  "assignments": {}
}
```

Preserve stable category IDs when renaming. Review imported assignments against your whitelist. Keep export backups outside tracked files if you do not intend to publish them.

### 4. Configure Google Cloud

1. Create/select a project and enable **YouTube Data API v3**.
2. Create an API key restricted to **YouTube Data API v3**.
3. Use **Application restrictions: None** for the supplied GitHub-hosted runner setup.
4. Monitor quota and rotate exposed credentials.

Do not apply home-IP or website-referrer restrictions: metadata requests originate from the runner. Fixed-egress restrictions require a separate design. Keep the key secret even with application restrictions set to None.

Google OAuth and a browser-side GitHub personal access token are not required by the supplied workflow.

### 5. Configure environments and request permissions

| Environment       | Configuration                                           |
| ----------------- | ------------------------------------------------------- |
| `youtube-refresh` | Allow `main` only; environment secret `YOUTUBE_API_KEY` |
| `github-pages`    | Allow `main` only                                       |

For unattended operation, leave required reviewers and wait timers disabled unless intentional. Keep the API key in the **environment secret**, not frontend files, variables, or duplicate repository secrets. It is injected only into the feed-building step.

Enable Issues if using request forms. The request processors use the workflow-provided GitHub token; users never enter credentials into Issues. Confirm repository and branch policies permit the declared permissions and direct configuration commits.

### 6. Configure Pages and schedule

- Select **GitHub Actions** under **Settings → Pages**.
- Set `YOUTUBE_REFRESH_HOURS_UTC` to your desired hours, without spaces.
- Configure the final HTTPS reuse URL to match your Pages address/custom domain. The downloader refuses redirects.
- Update static schedule/quota notices.
- Review branch rules: required pull requests or restrictions on workflow commits can require redesigning both request processors.

### 7. Test locally

Python **3.12** matches CI. Runtime scripts use the standard library.

```powershell
python -m unittest discover -s tests -v
python scripts/security_check.py
git diff --check
```

The security checker scans Git-tracked files. Stage new files before relying on its coverage and review the staged diff. Node-dependent tests are skipped if Node.js is unavailable locally; CI must execute those checks.

Offline tests do not establish live API authorization, publication success, browser behaviour, or end-to-end request processing.

### 8. First deployment and verification

Run **Refresh and publish** manually with reuse **unchecked**. A new fork has no published feed to reuse.

Verify:

- Feed build and Pages deployment both succeed.
- Grid, text feed, RSS navigation, embedded playback, Kino, and fullscreen work.
- Themes, appearance, and quarter-step playback speeds work.
- Reuse-only deployment skips the YouTube fetch step.
- Owner channel requests work end to end.
- A small category edit produces a compact request, commits successfully, publishes through reuse, and appears on another device after reload.

## Security boundaries

- Main-only guards and commit-pinned Actions are included; configure environment restrictions separately.
- Only five approved public assets are published, never the repository root. Shared category data is intentionally public inside the script.
- Whitelist drafts are session-only by default; Remember persists them. Category edits are stored separately as browser-local drafts until shared saving succeeds.
- Path-scoped storage reduces collisions but is **not same-origin isolation**. A dedicated origin offers stronger separation from other projects.
- Local whitelist removals affect that browser only. Shared changes require successful processing and publication; old clients are not remotely upgraded.
- Safe text rendering, restrictive meta CSP, local-only conversion, and credential/path checks are retained. Script permissions narrowly allow YouTube’s official iframe API.
- Owner checks run in the request processors and workflows; frontend editing controls are not an authentication boundary.
- Optional HTTP-header and CODEOWNERS templates are not automatically enforced.
- This is **not parental access control, private hosting, instant revocation, or a direct authenticated frontend editor**. Official YouTube can expose content outside the whitelist.
- Passing tests and pinned Actions do not prove complete security. Review updates and upstream identities before changing pins.

See `VERIFICATION.md` for testing scope and limitations.

## Acknowledgements

The palette collection is inspired by the traditional Japanese colors presented by **Nippon Colors**:

https://nipponcolors.com/

MyTube’s interface and palette adaptations are independent work; no affiliation or endorsement is implied.

## License

MIT licensed. Not affiliated with or endorsed by YouTube, Google, GitHub, or Nippon Colors.
