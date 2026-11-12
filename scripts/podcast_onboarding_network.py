"""Onboarding-only connection failover; no HTTP or TLS bypass."""
import errno
import ipaddress
import time

from build_podcasts import PinnedHTTPS

MAX_ADDRESS_ATTEMPTS = 8
UNREACHABLE = {errno.ENETUNREACH, errno.EHOSTUNREACH}


def connect_with_failover(host, addresses, timeout, *,
                          factory=PinnedHTTPS, clock=time.monotonic):
    """Return an already-connected HTTPS connection.

    Validate every address before any connection. Try another address only
    when connect() raises network/host unreachable. Never retry a request.
    TLS SNI and certificate checks remain those of PinnedHTTPS.
    """
    addresses = list(addresses)
    if not addresses or any(
        not ipaddress.ip_address(address).is_global for address in addresses
    ):
        raise ValueError("Non-public feed destination")
    deadline = clock() + timeout
    candidates = addresses[:MAX_ADDRESS_ATTEMPTS]
    for index, address in enumerate(candidates):
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError("Onboarding connection budget exceeded")
        connection = factory(host, address, min(5, remaining))
        try:
            connection.connect()
            return connection
        except OSError as error:
            connection.close()
            if error.errno not in UNREACHABLE or index == len(candidates) - 1:
                raise
            print("Onboarding connection: unreachable address; trying next validated public address.")
        except BaseException:
            connection.close()
            raise
