# Security boundaries

This is a public discovery UI, not authentication, parental controls, or a modified YouTube player. Anyone using the browser can edit/reset a local draft. A repository maintainer who can merge main code is trusted with its refresh secret. Never submit secrets or original exports in public issues.

See the separate setup guide for REQUIRED youtube-refresh environment branch restrictions, moving the API key out of repository scope, protected-main/code-owner rules and secret scanning. Git ignore/CI scanners cannot undo exposure and are not complete secret detectors. Rotate exposed keys before cleaning Git history.

Use a dedicated origin without untrusted apps. localStorage path prefixes do not isolate origins. Client freshness checks are best-effort availability safeguards, not unbypassable revocation. Configure real HTTP security headers on a capable host/proxy if required; the included template has no effect on GitHub Pages by itself. Content downloads and old clients cannot be revoked.

Report vulnerabilities privately to the owner; configure GitHub private reporting as appropriate. No formal penetration test or production deployment security audit was conducted. Verify official action commit identities and review updates.
