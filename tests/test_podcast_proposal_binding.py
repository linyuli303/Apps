"""Offline tests for exact proposal input/output bindings."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from podcast_proposal_binding import prepare_bound_proposal, verify_bound_proposal

spec = importlib.util.spec_from_file_location(
    "binding_proposal_fixtures", ROOT / "tests/test_podcast_proposal.py"
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class ProposalBindingTests(unittest.TestCase):
    def inputs(self):
        event, config, envelope, js, html = fixtures.ProposalTests().setup_proposal()
        base = {
            "podcasts.json": (json.dumps(config) + "\n").encode("utf-8"),
            "site/app.js": js.encode("utf-8"),
            "site/index.html": html.encode("utf-8"),
        }
        return event, envelope, "a" * 40, base

    def test_roundtrip_and_inputs_unchanged(self):
        args = self.inputs()
        before = copy.deepcopy(args)
        manifest, proposed = prepare_bound_proposal(*args)
        self.assertEqual(verify_bound_proposal(manifest, *args), proposed)
        self.assertEqual(args, before)
        self.assertEqual(set(proposed), set(args[3]))

    def test_binding_is_deterministic(self):
        args = self.inputs()
        self.assertEqual(prepare_bound_proposal(*args), prepare_bound_proposal(*args))

    def test_every_manifest_field_is_checked(self):
        args = self.inputs()
        manifest, _ = prepare_bound_proposal(*args)
        for field in manifest:
            with self.subTest(field=field):
                changed = copy.deepcopy(manifest)
                changed[field] = None
                with self.assertRaises(ValueError):
                    verify_bound_proposal(changed, *args)

    def test_extra_or_missing_fields_rejected(self):
        args = self.inputs()
        manifest, _ = prepare_bound_proposal(*args)
        for changed in (dict(manifest, extra=True), {}):
            with self.assertRaises(ValueError):
                verify_bound_proposal(changed, *args)

    def test_boolean_version_is_not_integer_version(self):
        args = self.inputs()
        manifest, _ = prepare_bound_proposal(*args)
        manifest["version"] = True
        with self.assertRaises(ValueError):
            verify_bound_proposal(manifest, *args)

    def test_changed_main_rejected(self):
        args = list(self.inputs())
        manifest, _ = prepare_bound_proposal(*args)
        args[2] = "b" * 40
        with self.assertRaises(ValueError):
            verify_bound_proposal(manifest, *args)

    def test_changed_base_bytes_rejected_including_config_formatting(self):
        for path in self.inputs()[3]:
            with self.subTest(path=path):
                args = self.inputs()
                manifest, _ = prepare_bound_proposal(*args)
                args[3][path] += b"\n"
                with self.assertRaises(ValueError):
                    verify_bound_proposal(manifest, *args)

    def test_edited_issue_rejected(self):
        args = self.inputs()
        manifest, _ = prepare_bound_proposal(*args)
        args[0]["issue"]["updated_at"] = "edited"
        with self.assertRaises(ValueError):
            verify_bound_proposal(manifest, *args)

    def test_changed_valid_observation_rejected(self):
        args = self.inputs()
        manifest, _ = prepare_bound_proposal(*args)
        args[1]["result"]["mediaInspection"][0]["hops"][0]["setCookie"] = True
        # The new observation is valid but must not match the old binding.
        prepare_bound_proposal(*args)
        with self.assertRaises(ValueError):
            verify_bound_proposal(manifest, *args)

    def test_proposed_hash_tampering_rejected(self):
        args = self.inputs()
        manifest, _ = prepare_bound_proposal(*args)
        manifest["proposedFiles"]["site/app.js"] = "0" * 64
        with self.assertRaises(ValueError):
            verify_bound_proposal(manifest, *args)

    def test_invalid_base_commits_rejected(self):
        for sha in (None, "main", "a" * 39, "A" * 40, "a" * 41):
            args = list(self.inputs())
            args[2] = sha
            with self.subTest(sha=sha), self.assertRaises(ValueError):
                prepare_bound_proposal(*args)

    def test_unexpected_base_paths_rejected(self):
        for path in ("../podcasts.json", ".github/workflows/publish.yml"):
            args = self.inputs()
            args[3][path] = b"untrusted"
            with self.assertRaises(ValueError):
                prepare_bound_proposal(*args)

    def test_missing_base_path_rejected(self):
        args = self.inputs()
        del args[3]["site/app.js"]
        with self.assertRaises(ValueError):
            prepare_bound_proposal(*args)

    def test_nonbytes_or_oversized_base_rejected(self):
        for value in ("not raw bytes", b"x" * 2_000_001):
            args = self.inputs()
            args[3]["site/app.js"] = value
            with self.assertRaises(ValueError):
                prepare_bound_proposal(*args)

    def test_invalid_utf8_rejected(self):
        args = self.inputs()
        args[3]["site/app.js"] = b"\xff"
        with self.assertRaises(ValueError):
            prepare_bound_proposal(*args)
