"""Read-only candidate media inspection. HEAD only; never grants approval."""
import time
from urllib.parse import urljoin, urlsplit

from build_podcasts import checked_url, public_addresses, PinnedHTTPS

REDIRECTS = (301, 302, 303, 307, 308)


def inspect_chain(url, *, addresses=public_addresses,
                  connection_factory=PinnedHTTPS, clock=time.monotonic):
    """Inspect at most six HTTPS responses within a bounded time budget.

    URLs are untrusted candidates, not approved playback destinations.
    No response bodies, cookies, Location values, or raw errors are returned.
    """
    hops = []
    seen = set()
    deadline = clock() + 30

    def outcome(status, reason):
        return {"status": status, "reason": reason, "hops": hops}

    for index in range(6):
        try:
            if url in seen:
                return outcome("review_required", "redirect_loop")
            seen.add(url)
            host = urlsplit(url).hostname
            parsed = checked_url(url, [host])
        except (ValueError, TypeError):
            return outcome("review_required", "unsafe_url")

        try:
            candidates = addresses(host)
            remaining = deadline - clock()
            if remaining <= 0:
                return outcome("review_required", "time_limit")
            connection = connection_factory(
                host, candidates[0], min(5, remaining)
            )
            try:
                target = parsed.path or "/"
                if parsed.query:
                    target += "?" + parsed.query
                connection.request("HEAD", target, headers={
                    "User-Agent": "MyApps-Media-Inspection/1.0",
                    "Accept-Encoding": "identity",
                    "Cache-Control": "no-store",
                })
                response = connection.getresponse()
                code = response.status
                hops.append({
                    "host": host,
                    "httpStatus": code,
                    "setCookie": bool(response.getheader("Set-Cookie")),
                })
                if clock() >= deadline:
                    return outcome("review_required", "time_limit")
                if code == 200:
                    return outcome("observed", "head_ok")
                if code not in REDIRECTS:
                    return outcome("review_required", "head_http_error")
                location = response.getheader("Location")
                if not location:
                    return outcome("review_required", "missing_redirect")
                if index == 5:
                    return outcome("review_required", "redirect_limit")
                url = urljoin(url, location)
            finally:
                connection.close()
        except Exception:
            # Fail closed without exposing URLs or network exception text.
            return outcome("review_required", "network_or_destination_failed")

    return outcome("review_required", "redirect_limit")
