"""Execute current Spotify transaction/callback helpers without network/storage."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js unavailable; auth validation execution skipped")
class SpotifyAuthValidationTests(unittest.TestCase):
    def execute(self, scenario):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "function validateSpotifyAuthTransaction("
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
""" + helper + """
const client = "a".repeat(32);
const now = 1000000;
const pkce = {
  verifier:"v".repeat(43), state:"s".repeat(43),
  challenge:"c".repeat(43), challengeMethod:"S256"
};
const fresh = () => createSpotifyAuthTransaction(pkce, client, now);
function callback(values = {code:"fake-code", state:pkce.state}) {
  const url = new URL("https://linyuli303.github.io/Apps/");
  url.search = new URLSearchParams(values).toString();
  return url.href;
}
const validate = url => validateSpotifyCallback(url, fresh(), client, now);
""" + scenario
        result = subprocess.run(
            [NODE, "-"], input=script, capture_output=True,
            text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_transaction_binding_and_detached_result(self):
        self.execute("""
const original = {...fresh()};
const checked = validateSpotifyAuthTransaction(original, client, now);
original.state = "x".repeat(43);
assert.equal(checked.state, pkce.state);
assert.notEqual(checked, original);
assert.equal(Object.isFrozen(checked), true);
assert.equal(checked.expiresAt - checked.createdAt, 600000);
assert.equal(checked.redirectUri, "https://linyuli303.github.io/Apps/");
""")

    def test_transaction_expiry_and_invalid_clocks(self):
        self.execute("""
const value = fresh();
validateSpotifyAuthTransaction(value, client, value.expiresAt - 1);
for (const clock of [
  value.expiresAt, now - 1, NaN, Infinity, -1, 1.5, "1000000"
]) {
  assert.throws(() => validateSpotifyAuthTransaction(value, client, clock));
}
""")

    def test_transaction_schema_client_and_pkce_rejected(self):
        self.execute("""
const missing = {...fresh()};
delete missing.state;
for (const value of [
  missing, {...fresh(), extra:true}, {...fresh(), version:true},
  {...fresh(), verifier:"short"}, {...fresh(), state:"!"},
  {...fresh(), expiresAt:now + 600001},
  {...fresh(), redirectUri:"https://other.example/"}, null, []
]) {
  assert.throws(() => validateSpotifyAuthTransaction(value, client, now));
}
for (const id of ["", "a".repeat(31), "A".repeat(32), null]) {
  assert.throws(() => createSpotifyAuthTransaction(pkce, id, now));
}
for (const value of [
  null, {...pkce, challengeMethod:"plain"}, {...pkce, challenge:"short"},
  {...pkce, verifier:undefined}, {...pkce, state:undefined}
]) {
  assert.throws(() => createSpotifyAuthTransaction(value, client, now));
}
assert.throws(() =>
  validateSpotifyAuthTransaction(fresh(), "b".repeat(32), now));
""")

    def test_authorized_callback_returns_exchange_inputs(self):
        self.execute("""
const value = validate(callback());
assert.deepEqual(value, {
  status:"authorized", code:"fake-code", verifier:pkce.verifier,
  clientId:client, redirectUri:"https://linyuli303.github.io/Apps/"
});
assert.equal(Object.isFrozen(value), true);
""")

    def test_state_duplicates_and_unknown_parameters_rejected(self):
        self.execute("""
for (const values of [
  {code:"fake"},
  {code:"fake", state:"wrong"},
  {state:pkce.state},
  {state:pkce.state, code:"fake", error:"access_denied"},
  {state:pkce.state, code:"fake", next:"https://other.example/"},
  {state:pkce.state, code:"fake", error_description:"unexpected"}
]) {
  assert.throws(() => validate(callback(values)));
}
for (const extra of [
  "&state=" + pkce.state, "&code=another",
  "&%73tate=" + pkce.state,
  "&error=access_denied&error=access_denied"
]) {
  assert.throws(() => validate(callback() + extra));
}
""")

    def test_callback_destination_and_code_rejected(self):
        self.execute("""
for (const url of [
  callback().replace("https:", "http:"),
  callback().replace("linyuli303.github.io", "other.example"),
  callback().replace("/Apps/", "/Apps/MySpotify/"),
  callback().replace("https://", "https://user@"),
  callback() + "#unexpected", null, "not a URL"
]) {
  assert.throws(() => validate(url));
}
for (const code of ["", "x".repeat(4097), "with space", "x\\n", "x\\u007f"]) {
  assert.throws(() => validate(callback({state:pkce.state, code})));
}
""")

    def test_denial_returns_only_fixed_status(self):
        self.execute("""
const value = validate(callback({
  state:pkce.state, error:"access_denied",
  error_description:"Untrusted text", error_uri:"https://other.example/"
}));
assert.deepEqual(value, {status:"denied"});
assert.equal(Object.isFrozen(value), true);
assert.throws(() => validate(callback({state:pkce.state, error:""})));
""")

    def test_callback_expiry_and_client_binding(self):
        self.execute("""
const transaction = fresh();
assert.throws(() => validateSpotifyCallback(
  callback(), transaction, client, transaction.expiresAt
));
assert.throws(() => validateSpotifyCallback(
  callback(), transaction, "b".repeat(32), now
));
""")
