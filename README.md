# MyTube — Your channels, your feed

A static, whitelist-based YouTube browsing app hosted on GitHub Pages.

Browse approved channels through a searchable video grid or a text-only RSS-style catalogue. Videos open on official YouTube, allowing playback through your signed-in account.

**The repository, approved channel IDs, published feed, and channel-request issues are public. Never commit API keys, tokens, cookies, passwords, or raw Takeout exports.**

## View MyTube

Open the live MyTube viewer:

https://linyuli303.github.io/MyTube/

This public viewer uses the owner’s published channel whitelist. To create your own feed, follow the fork setup instructions below.

## Next Release — A Smoother Signed-In Experience

Explore ways to make playback more seamless for users already signed in to YouTube, while preserving their privacy and Premium benefits.

- Investigate whether supported YouTube integrations can recognize an existing signed-in session during playback.
- Keep official YouTube playback as the reliable fallback.
- Never collect passwords, copy session cookies, or expose authentication tokens.

**Status:** Research planned. MyTube currently does not authenticate users with YouTube. Signing in through Google alone does not guarantee Premium recognition in embedded players; support depends on YouTube and browser restrictions.

## Features

### Video browsing

- Search, channel filters, sorting, and 48-card pagination.
- Thumbnails enabled by default, with an option to disable them.
- Video cards open official YouTube in a new tab.
- Current configuration requests **15 recent uploads per channel**, not full history.
- Private, unavailable, upcoming, or non-embeddable videos may be excluded, so fewer than 15 may appear.

### RSS-style catalogue

- Left-edge catalogue, collapsed by default.
- Hover over the catalogue tab to open; click and keyboard controls remain available.
- Spacious channel list ranked by the latest available video publication.
- Separate adjacent panel containing compact rows: **Published date | Video title | Views**.
- Theme-tinted feed background and deeper full-row hover/focus highlighting.
- Click a channel to pin its feed.
- Moving away does not close the first-level catalogue.
- On narrow screens, the feed overlays the catalogue; **Back to channels** returns to navigation.

This is an RSS-style webpage, **not an XML feed for RSS-reader subscriptions**.

### Appearance and channel management

- **50 palettes**, with Fuji as the default.
- Light, Dark, and System appearance.
- Channel search by name or immutable ID.
- Clickable channel names linking to official YouTube pages.
- Browser-local whitelist drafts, with explicit Remember and Forget controls.
- Prefilled GitHub issue forms for owner-authorized shared additions and removals.
- Draft export and advanced JSON editing remain available.

## Playback and YouTube Premium

Videos open on official YouTube. Sign in there with the account holding your active Premium membership.

MyTube does not access your Google login, cookies, or membership. The YouTube API key retrieves public metadata; it does **not** connect Premium benefits to MyTube.

Creator-included sponsorships may remain in videos.

Grid thumbnails contact YouTube’s image servers. Disable thumbnails if desired; the RSS catalogue does not load them.

## Refresh schedule

Configure scheduled refresh hours using this **GitHub repository variable**:

```text
YOUTUBE_REFRESH_HOURS_UTC=09,12,18,22
```

Location: **Settings → Secrets and variables → Actions → Variables**.

Use two-digit UTC hours separated by commas, without spaces. For example:

```text
08,19
```

This selects 08:00 and 19:00 UTC.

The workflow contains hourly schedule entries, but only selected hours proceed with the build and deployment. A missing or empty variable defaults to `09,12,18,22`. Leaving the variable empty does **not** disable scheduled refreshes.

Scheduled times are start targets, not guaranteed start or completion times. The site’s schedule notice is currently **static text**: update it separately if you change the variable.

### What triggers YouTube requests?

| Event | Fetches new YouTube data? |
|---|---|
| Selected scheduled hour | Yes |
| Manual run with the reuse checkbox unchecked | Yes |
| Accepted owner channel request, including a no-op request | Yes |
| Push changing `channels.json`, `scripts/build_feed.py`, or `scripts/prepare_site.py` | Yes |
| Frontend-only push | No—reuses the validated public feed |
| Manual run with the reuse checkbox checked | No—reuses the validated public feed |
| Browsing, searching, or expanding RSS panels | No |
| Clicking Refresh inside MyTube | No—reloads the published snapshot |

If Git cannot reliably determine changed files, the selector conservatively chooses a full refresh.

## Deploy frontend changes without refreshing YouTube

Frontend-only pushes reuse the existing published feed.

For an explicit manual frontend deployment:

1. Open **Actions → Refresh and publish → Run workflow**.
2. Select `main`.
3. Check **Deploy frontend using published feed; no YouTube calls**.
4. Run the workflow.

The checkbox defaults to **unchecked**, so an ordinary manual run still refreshes YouTube data.

### Feed-reuse safeguards

Reuse downloads the snapshot from the fixed, configured public Pages URL and validates it before publication.

Reuse stops if the feed is:

- Unavailable or invalid.
- More than 24 hours old or excessively future-dated.
- Inconsistent with the current whitelist or relevant configuration.
- Outside size, schema, or credential-pattern safety checks.

The original timestamp is preserved. Reuse does **not** make old data fresh and does **not** automatically fall back to YouTube requests.

A failed API refresh also does not currently trigger automatic feed reuse. Use the explicit frontend-only deployment option when appropriate.

## API quota and view counts

MyTube does not use AI tokens. YouTube Data API usage is measured in **quota units**, not AI tokens or Premium viewing allowances.

The current Google Cloud project has a **10,000-unit daily allowance**, resetting at **midnight Pacific Time**. Fork owners must check their own project’s actual quota.

The current builder performs:

- One channel-metadata request per approved channel.
- One uploads-playlist request per channel.
- Video-detail requests in batches of up to 50 IDs.

The relevant list methods each cost one quota unit per request. View statistics are requested alongside existing video details, without a separate statistics request.

Repeated refreshes, retries, channel requests, and other applications sharing the same Cloud project contribute to usage. Increasing the video limit can require more video-detail batches.

For current method costs and quota rules, consult Google’s official documentation: https://developers.google.com/youtube/data/determine_quota_cost

### When quota is exhausted

- New metadata cannot be fetched until quota becomes available.
- Failed refreshes publish no new feed.
- Avoid repeatedly rerunning failed API refreshes.
- Frontend-only deployment can still work if the published snapshot passes reuse validation.
- Existing playback is blocked once the feed exceeds the app’s 24-hour freshness limit.

### View-count availability

View counts reflect the **last successful refresh**, not live totals.

If a refresh fails:

- Previously collected counts may become outdated.
- Older feeds without statistics display **Unavailable**.
- Missing counts are not displayed as a misleading zero.

New counts appear only after a successful refresh and deployment.

The quota notice on the website shows the configured allowance, **not a live remaining-quota counter**.

## Set up your own MyTube fork

### 1. Fork and review

Fork the repository and review the workflows before enabling them.

The supplied code contains repository-specific URLs and owner authorization. **Adding an API key alone is not sufficient to configure a fork.**

### 2. Replace repository and owner references

Update references to the original repository, Pages URL, and immutable numeric GitHub owner ID.

| File | Configuration to review |
|---|---|
| `site/app.js` | GitHub request-form destination |
| `scripts/reuse_public_feed.py` | Fixed public feed URL |
| `scripts/channel_request.py` | Repository and owner authorization |
| `scripts/process_channel_request.py` | Repository name and numeric owner ID |
| `.github/workflows/channel-change.yml` | Repository, actor, issue-author, and owner guards |
| Tests, documentation, optional templates | Repository-specific expectations and ownership |

Also update the repository identity check in **`scripts/select_feed_mode.py`**, which rejects unexpected runner repositories.

Use your numeric GitHub account ID wherever immutable owner checks are required. Search tracked files for the original repository name, username, and numeric owner ID to identify any remaining installation-specific references. Do not weaken authorization checks merely to make a fork run; update them consistently with their tests.

The current channel-request automation assumes a **personal-account-owned repository**. Organization-owned repositories require a deliberate authorization redesign and updated tests.

### 3. Configure approved channels

Review or replace `channels.json` before publication. Do not assume a fork contains an empty or private whitelist.

Example:

```json
{
  "title": "MyTube",
  "max_videos_per_channel": 15,
  "channels": [
    {
      "id": "UCVuR4hBxX3zWY_xUCZeIc3A"
    }
  ]
}
```

Replace the example channel with independently reviewed immutable channel IDs.

Handles can be resolved locally using `scripts/resolve_handle.py`. Review the resolved identity before approval. Check the script’s help for usage; handle resolution may itself use YouTube API quota.

Takeout conversion is local-only. Commit the reviewed JSON, **not the original CSV**.

### 4. Configure Google Cloud

1. Create or select a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Create an API key.
4. Set API restrictions to **YouTube Data API v3**.
5. For the supplied GitHub-hosted runner configuration, use **Application restrictions: None**.
6. Monitor project quota and rotate the key if exposed.

Do not apply a home-IP restriction or website-referrer restriction: metadata requests originate from GitHub’s runner, not your home browser or website visitors.

The key must remain secret even when application restrictions are None. Fixed-egress runner restrictions require a separately designed setup.

OAuth and a browser-side GitHub personal access token are not required for the supplied public-metadata workflow.

### 5. Configure GitHub environments

Create these environments:

| Environment | Configuration |
|---|---|
| `youtube-refresh` | Allow `main` only; add environment secret `YOUTUBE_API_KEY` |
| `github-pages` | Allow `main` only |

For unattended operation, do not enable required reviewers or wait timers unless you intentionally want approval before runs.

Keep the API key in the **`youtube-refresh` environment secret**, not frontend files, repository variables, or a duplicate repository-level secret. It is injected only into the feed-building step.

The channel-request processor uses GitHub’s workflow-provided `GITHUB_TOKEN`; users should never paste credentials into issue forms. Confirm repository policies permit the workflow’s declared permissions. Enable repository Issues if using channel-request forms.

### 6. Configure Pages and schedule

- Select **GitHub Actions** under **Settings → Pages**.
- Create repository variable `YOUTUBE_REFRESH_HOURS_UTC`.
- Set your desired UTC hours.
- Verify the feed-reuse URL matches your Pages address, including any custom domain. The reuse downloader refuses redirects, so configure the final HTTPS URL.
- Update the site’s static schedule and quota notices to describe your configuration accurately.
- Review branch protection: rules that require pull requests or disallow the workflow’s direct configuration commits may require redesigning channel-request automation.

### 7. Test locally

Python **3.12** matches the supplied workflow. Runtime scripts use the standard library.

```powershell
python -m unittest discover -s tests -v
python scripts/security_check.py
git diff --check
```

The security checker scans tracked/staged files. Stage new files before relying on its coverage, then review the staged diff before committing.

Tests are offline checks; they do not prove live API authorization, deployment success, browser appearance, or end-to-end channel automation.

### 8. Perform the first deployment

Run **Refresh and publish** manually with the reuse checkbox **unchecked**.

A new fork has no published feed to reuse, so its first successful deployment requires a YouTube refresh.

Verify:

- Feed build and Pages deployment succeed.
- Grid and RSS browsing work.
- Video and channel links open correctly.
- Theme and appearance switching work.
- Frontend-only deployment skips YouTube requests.
- Owner channel requests work end to end.

## Security boundaries

- Main-only workflow guards and commit-pinned Actions are included. Environment restrictions must be configured separately.
- Publication stages exactly five approved public assets, not the repository root.
- Local drafts are session-only by default; Remember persists them on that browser.
- Path-scoped storage reduces accidental collisions but is **not same-origin isolation**. A dedicated origin provides a stronger separation from other hosted projects.
- Local removal affects that browser only. Shared changes require successful processing and deployment.
- Restrictive meta CSP, safe text rendering, local-only conversion, and credential/path checks are retained.
- Optional HTTP-header and CODEOWNERS templates are not automatically enforced.
- This is **not parental access control**, private hosting, instant revocation, or an authenticated frontend editor.
- Official YouTube pages can expose recommendations and content outside the whitelist.
- Old clients are not remotely upgraded.
- Passing tests and immutable action pins do not establish complete security. Review action updates and verify upstream identities before changing pins.

See `VERIFICATION.md` for testing scope and limitations.

## Acknowledgements

The color palette collection is inspired by the traditional Japanese colors presented by **Nippon Colors**:

https://nipponcolors.com/

MyTube’s interface and palette adaptations are independent work; no affiliation or endorsement is implied.

## License

MIT licensed. Not affiliated with or endorsed by YouTube, Google, GitHub, or Nippon Colors.
