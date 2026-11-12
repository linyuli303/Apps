"""Execute current PKCE generation code; no network, tokens, or storage."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js unavailable; PKCE execution skipped")
class SpotifyPKCETests(unittest.TestCase):
    def execute(self, scenario):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "async function createSpotifyPKCE("
        end = (
            "// Public GitHub request forms only: "
            "no token, persistent draft or source lookup."
        )
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        last = source.index(end, first)
        helper = source[first:last]
        script = """
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto").webcrypto;
""" + helper + """
(async () => {
""" + scenario + """
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
"""
        result = subprocess.run(
            [NODE, "-e", script], capture_output=True,
            text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_reference_vector(self):
        self.execute("""
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const bytes = Buffer.from(verifier, "base64url");
let calls = 0;
const value = await createSpotifyPKCE({
  getRandomValues(target) {
    calls++;
    if (calls === 1) target.set(bytes);
    else target.fill(1);
    return target;
  },
  subtle: crypto.subtle,
});
assert.equal(value.verifier, verifier);
assert.equal(value.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
assert.equal(value.challengeMethod, "S256");
assert.equal(calls, 2);
""")

    def test_encoding_and_immutability(self):
        self.execute("""
const value = await createSpotifyPKCE(crypto);
for (const key of ["verifier", "state", "challenge"]) {
  assert.match(value[key], /^[A-Za-z0-9_-]{43}$/);
}
assert.equal(Object.isFrozen(value), true);
""")

    def test_fresh_random_material(self):
        self.execute("""
const a = await createSpotifyPKCE(crypto);
const b = await createSpotifyPKCE(crypto);
for (const key of ["verifier", "state", "challenge"]) {
  assert.notEqual(a[key], b[key]);
}
assert.notEqual(a.verifier, a.state);
""")

    def test_missing_crypto_rejected(self):
        self.execute("""
for (const provider of [null, {}, {getRandomValues() {}}]) {
  await assert.rejects(() => createSpotifyPKCE(provider));
}
""")

    def test_digest_failure_rejected(self):
        self.execute("""
await assert.rejects(() => createSpotifyPKCE({
  getRandomValues(target) { target.fill(1); return target; },
  subtle: { digest() { return Promise.reject(new Error("fixture")); } },
}));
""")

    def test_malformed_digest_rejected(self):
        self.execute("""
await assert.rejects(() => createSpotifyPKCE({
  getRandomValues(target) { target.fill(1); return target; },
  subtle: { digest() { return Promise.resolve(new ArrayBuffer(0)); } },
}));
""")
