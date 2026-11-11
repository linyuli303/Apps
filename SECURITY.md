# Security boundaries

MyTube is a **public discovery interface**, not parental access control, private hosting, or a modified YouTube player. The frontend does not authenticate viewers. Shared writes are authorized separately through owner-submitted GitHub Issues and server-side workflow validation.

## Public data and local drafts

- The repository, approved channel IDs, category names and assignments, change-request Issues, and published feed are public.
- Published category data is embedded in the application script. Keeping `categories.json` outside the website artifact does not make its contents private.
- Anyone using a browser can edit or reset that browser’s drafts. Local changes do not authorize repository writes.
- Category edits remain local until an owner request is validated, committed, and successfully published. A successful commit does not guarantee successful deployment.
- Never include API keys, tokens, cookies, passwords, raw Takeout exports, or other private information in public Issues, tracked files, or workflow logs.

## Authorization and credentials

- Channel and category request processors validate the expected repository and personal owner, request structure, and unchanged live Issue before making configuration changes.
- Category updates use base-revision checks and SHA-aware writes to reject stale changes. These protections do not replace an independent review of authorization and concurrency behaviour.
- The public frontend contains no repository-write token. Request processors use GitHub’s workflow-provided token with declared permissions.
- Store `YOUTUBE_API_KEY` only in the **`youtube-refresh` environment secret**, injected only into the feed-building step. Do not duplicate it in repository secrets, variables, or frontend code.
- A maintainer able to change trusted workflow or application code may be able to access or misuse the refresh secret within the permissions and environment controls in effect. Treat such maintainers as privileged.
- The supplied owner checks assume a personal-account-owned repository. Organization use requires a deliberate authorization redesign.

## Repository and deployment configuration

Follow the setup instructions for the required main-only `youtube-refresh` and `github-pages` environment restrictions, workflow permissions, Pages configuration, and branch rules.

Branch protection, CODEOWNERS, and secret scanning require configuration and verification; included templates do not enforce themselves. Rules must also be compatible with the intended owner-request automation, which currently commits directly to `main`. Requiring pull requests for every configuration change requires redesigning that automation rather than silently bypassing the rule.

Publication stages exactly five approved assets: `index.html`, `style.css`, `app.js`, `icon.svg`, and `data/feed.json`. The allowlist reduces accidental publication of repository files; it does not make intentionally published data private or establish that all content is safe.

Git ignore rules prevent ordinary accidental tracking of matching untracked files. They do not protect already tracked files, public logs, caches, artifacts, or cloud storage. The CI checker inspects Git-tracked paths and recognized credential patterns; it is not a complete secret detector. Stage new files before relying on its coverage.

**If a credential is exposed, revoke or rotate it before cleaning Git history.** Ignore rules and scanners cannot undo disclosure or remove copies already obtained by others.

## Browser and hosting boundaries

- Prefer a dedicated origin without untrusted applications. Path-prefixed `localStorage` keys reduce collisions but do **not** isolate applications sharing an origin.
- Safe text rendering and the restrictive meta Content Security Policy reduce risk but are not complete protection against frontend compromise.
- Script permissions narrowly allow the official YouTube iframe API. Embedded playback and thumbnails communicate with YouTube; MyTube does not obtain or transfer Google login cookies or Premium membership.
- Configure real HTTP security headers on a capable host or proxy if required. The included response-header template has no effect on GitHub Pages by itself.
- Official YouTube pages and apps may expose recommendations and content outside the whitelist. Embedded Premium recognition is not guaranteed.

## Freshness, publication, and revocation

- The 24-hour feed cutoff is an application policy, not a YouTube requirement or proof that approvals are current.
- Browser freshness and membership checks are best-effort application safeguards, not unbypassable access controls or instant revocation.
- Reuse-only publication preserves the original feed timestamp and stops if validation fails. It does not silently fetch new YouTube data or make an old snapshot fresh.
- Scheduled workflows are not guaranteed to start exactly on time. Failure alerts alone do not detect a workflow that never starts.
- Repository changes reach clients only through successful publication and loading of updated assets. Previously downloaded content, old clients, cached copies, and exported files cannot be remotely revoked.

## Reporting and assurance

Report vulnerabilities privately to the repository owner. Configure GitHub private vulnerability reporting if desired, and verify it is enabled before directing reporters to use it. Do not disclose credentials or exploit details in a public Issue.

Actions are pinned to full commit SHAs, but upstream commit identities and updates still require review. Pins do not establish that an Action is vulnerability-free.

Offline tests, successful deployments, and observed browser checks are limited evidence—not a formal penetration test, independent production security audit, or guarantee of complete security. See `VERIFICATION.md` for the recorded verification scope and remaining checks.
