# Verification scope and limitations

This document records implemented safeguards and available verification evidence. It is **not a formal security audit** or a guarantee of complete security.

## Implemented safeguards

### Workflows and credentials

- Main-only workflow guards and trusted checkout configuration.
- GitHub Actions referenced by full commit SHA.
- Environment-scoped `YOUTUBE_API_KEY`, injected only into the feed-building step.
- Owner-authorized channel and category requests, with live Issue revalidation.
- Revision checks and SHA-aware category writes to reject stale updates.
- Category requests explicitly dispatch reuse-only publication.

### Data validation and publication

- Immutable channel-ID validation; category labels cannot approve channels.
- Compact category requests preserve unrelated assignments.
- Restricted API origins, bounded responses, timeouts, bounded retries, and safe error output.
- Feed validation and a 24-hour freshness gate, including periodic and visibility checks in the browser.
- Publication restricted to exactly five public assets:
  - `index.html`
  - `style.css`
  - `app.js`
  - `icon.svg`
  - `data/feed.json`
- Validated shared categories embedded in the published JavaScript.
- Reuse preserves the original feed timestamp and rejects unavailable, invalid, expired, or inconsistent snapshots.
- No automatic fallback from failed reuse to live YouTube requests, or from failed API refresh to reuse.

### Frontend and local storage

- Safe text rendering and a restrictive meta Content Security Policy, with narrowly scoped permissions for YouTube’s official iframe API.
- Path-scoped browser storage.
- Optional persistent whitelist drafts with Remember and Forget controls.
- Separate browser-local category drafts and appearance/playback preferences.
- Channel membership checks and 48-card pagination.
- Optional response-header and CODEOWNERS templates. Their presence does **not** mean they are deployed or enforced.

## Latest reported local verification

The latest reported local test run completed:

```text
Ran 119 tests
OK (skipped=3)
```

The three Node-dependent checks were not executed locally because Node.js was unavailable. Check the relevant GitHub Actions test log to establish their CI results.

Tracked-file security checks and staged whitespace checks passed for the reviewed changes.

An offline publication exercise also confirmed:

- Exactly the five allowed public assets were produced.
- Shared categories were embedded in the published application script.
- Feed bytes and source JavaScript were unchanged by that exercise.

These results apply to the versions tested. Rerun checks after relevant changes.

**Whitespace checks do not establish behavioural correctness. Credential-pattern checks are not comprehensive secret scanning.** The security checker scans Git-tracked paths; stage new files before relying on its coverage.

## Live checks confirmed by the owner

- Successful YouTube metadata refresh and GitHub Pages deployment.
- Published feed timestamp updated after a full refresh.
- Repository-backed categories loaded in the frontend.
- A compact category request for **AURORA → Music** was processed through owner-submitted Issue #8.
- The resulting category commit and separate publication workflow succeeded.
- After reloading, the frontend displayed:

  > Published categories loaded. No unsaved changes.

- Reloading the published feed restored the channel-assignment list when the editor had displayed a fresh-feed requirement.

These checks establish the observed paths only. They do not verify every browser, device, failure mode, or authorization edge case. Successful publication alone does not establish that a workflow made zero YouTube requests; inspect its refresh/reuse steps.

## Verification still required

- Confirm Node-dependent checks execute successfully in CI for each relevant release.
- Review Action pins against trusted upstream Git objects and assess updates.
- Independently review environment restrictions, secret scope, branch rules, and effective workflow permissions.
- Test storage failures, import/export, stale-draft conflicts, concurrent edits, and interrupted publication.
- Verify category changes on a separate device or clean browser session.
- Test keyboard navigation, focus restoration, mobile/TV behaviour, fullscreen, and embedded-player interactions.
- Verify actual HTTP response headers and any dedicated-domain configuration.
- Assess dependency and supply-chain risks; immutable pins alone are insufficient.
- Test operational monitoring, including detection of scheduled refreshes that never start.

Historical QuickJS, in-memory packaging, and ZIP-integrity checks are not evidence that the current frontend or deployment artifact has passed those same checks.

## Known limitations

- Repository configuration, category assignments, Issues, and published data are public.
- GitHub Pages is a static host, not an authenticated application backend.
- Frontend editing controls are not an authorization boundary; write authorization is enforced by workflows and request processors.
- Local editing is not shared saving. Request processing and publication must both succeed.
- A configuration commit may succeed even if its subsequent publication fails.
- The “Published categories loaded” message describes the loaded snapshot and local draft state; it is not continuous live-sync monitoring.
- Category-only publication consumes no YouTube Data API quota when the explicit reuse path runs successfully, but still requires a valid, fresh feed.
- Channel-request automation currently requests a full refresh, including removals and no-op requests.
- The 24-hour playback cutoff is an application policy, not a YouTube requirement or proof that channel approvals are current.
- Scheduled workflow entries do not guarantee an exact start time.
- Path-scoped storage is not same-origin isolation.
- Old clients are not remotely upgraded; shared removals are not instant revocation.
- Official YouTube can expose content outside the whitelist.
- Premium recognition in embedded playback is not guaranteed.
- Optional hosting headers, environment rules, branch protection, and domain configuration require owner setup and verification.
- Passing tests do not establish complete security or production reliability.

## Before releasing changes

1. Run the offline test suite and inspect failures and skipped tests.
2. Stage only intended files before relying on security-check coverage.
3. Run the security checker and staged whitespace checks.
4. Review the staged diff, including public data and configuration changes.
5. Confirm the expected refresh/reuse mode in GitHub Actions.
6. Verify both build and deployment succeed.
7. Check the changed behaviour in the browser.
8. Update this document when verification scope or evidence changes.
