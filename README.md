# Hardened personal YouTube — v2

Current security-hardened edition. See the separately delivered YOUTUBE_SETUP_HARDENED_V2.md for setup and migration. No personal whitelist, raw CSV, or key is bundled. Preserve/review your ID-only channels.json when upgrading.

- Main-only workflow guards; refresh environment reference; all Actions commit-pinned. Configure the environment's main-only rules and relocate the API secret there—code alone does not enforce secret isolation.
- Immutable channel-ID approvals only. Resolve handles locally with scripts/resolve_handle.py and verify channel identity before adding.
- Session drafts by default; explicit Remember and Forget. Path-scoped keys prevent accidental collisions but are not same-origin isolation.
- 48-card pages, indexed channel membership and 24-hour feed-age blocking (client-side best effort, not access control).
- Public artifact allowlist, safe text rendering, opt-in thumbnails, restrictive meta CSP, local-only Takeout conversion and credential/path checks retained.
- Optional header and CODEOWNERS templates require owner configuration; neither is automatically enforced.

Known limits: feed/approved IDs are public; embedded YouTube remains outside whitelist control; no authenticated editor, child-safety enforcement, instant revocation or private hosting. Sharing changes still requires exporting/reviewing/committing JSON and successful deployment. Old clients are not remotely upgraded. Full-SHA pins do not imply vulnerability-free dependencies; the deploy pin requires upstream identity verification before use.

Python 3.10+, standard library only at runtime. Run python -m unittest discover -s tests -v. See VERIFICATION.md for exactly what was tested and what was not. MIT licensed; not affiliated with YouTube or GitHub.
