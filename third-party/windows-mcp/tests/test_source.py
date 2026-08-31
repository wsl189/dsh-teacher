"""Source provenance, patch integrity, and complete-package installation checks."""

import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile


INPUTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("windows_mcp_source", INPUTS / "source.py")
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)


class ReviewedSourceTests(unittest.TestCase):
    def setUp(self):
        self.metadata = json.loads((INPUTS / "runtime.json").read_text(encoding="utf-8"))

    def test_complete_reviewed_catalog_and_native_fixes(self):
        files = source.prepared_source(source.ROOT, self.metadata)
        signatures = source.tool_signatures(files)
        self.assertEqual(len(signatures), 20)
        for tool in ("Screenshot", "Snapshot"):
            self.assertIn("region", [parameter["name"] for parameter in signatures[tool]])
        self.assertIn(b'"SliderControl"', files["windows_mcp/tree/config.py"])
        self.assertIn(b"CREATE_NO_WINDOW", files["windows_mcp/powershell/utils.py"])
        self.assertIn("windows_mcp/infrastructure/eventloop.py", files)
        self.assertIn(b"from thefuzz import process", files["windows_mcp/desktop/service.py"])
        self.assertNotIn(b"from fuzzywuzzy import process", files["windows_mcp/desktop/service.py"])

    def test_rejects_modified_inputs_before_installation(self):
        for field in ("sha256", "toolSignaturesSha256"):
            with self.subTest(field=field):
                metadata = copy.deepcopy(self.metadata)
                metadata["source"][field] = "0" * 64
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    source.prepared_source(source.ROOT, metadata)
        metadata = copy.deepcopy(self.metadata)
        metadata["patches"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            source.prepared_source(source.ROOT, metadata)

    def test_rejects_patch_drift_and_changed_inventory(self):
        metadata = copy.deepcopy(self.metadata)
        metadata["patches"][0]["before"] = "this source text does not exist"
        with self.assertRaisesRegex(ValueError, "exactly one match"):
            source.prepared_source(source.ROOT, metadata)
        metadata = copy.deepcopy(self.metadata)
        metadata["source"]["fileCount"] += 1
        with self.assertRaisesRegex(ValueError, "inventory"):
            source.prepared_source(source.ROOT, metadata)

    def test_rejects_input_path_outside_repository(self):
        with self.assertRaisesRegex(ValueError, "escapes the repository"):
            source.checked_input(source.ROOT, "../outside.zip", "0" * 64)

    def test_rejects_unsafe_or_duplicate_archive_entries(self):
        for member in ("../escape.py", "/absolute.py", "windows_mcp/../escape.py", "other/file.py", "windows_mcp\\escape.py"):
            with self.subTest(member=member):
                self.check_archive_rejected([member], "Invalid")
        self.check_archive_rejected(["windows_mcp/file.py", "windows_mcp/file.py"], "Duplicate")

    def check_archive_rejected(self, members, message):
        with tempfile.TemporaryDirectory(prefix="dsh-windows-mcp-input-") as directory:
            root = Path(directory)
            archive = io.BytesIO()
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(archive, "w") as output:
                    for member in members:
                        output.writestr(member, "")
            (root / "source.zip").write_bytes(archive.getvalue())
            (root / "tools.json").write_text("{}", encoding="utf-8")
            metadata = {"source": {
                "archive": "source.zip", "sha256": source.digest(archive.getvalue()),
                "toolSignatures": "tools.json", "toolSignaturesSha256": source.digest(b"{}"),
                "fileCount": len(members),
            }}
            with self.assertRaisesRegex(ValueError, message):
                source.prepared_source(root, metadata)

    def test_installs_complete_package_without_stale_wheel_modules(self):
        files = source.prepared_source(source.ROOT, self.metadata)
        with tempfile.TemporaryDirectory(prefix="dsh-windows-mcp-install-") as directory:
            target = Path(directory)
            (target / "windows_mcp").mkdir()
            (target / "windows_mcp/stale.py").write_text("stale", encoding="utf-8")
            metadata = target / "windows_mcp-0.8.5.dist-info"
            metadata.mkdir()
            (metadata / "METADATA").write_text("retained", encoding="utf-8")
            source.install_source(target, files)
            self.assertFalse((target / "windows_mcp/stale.py").exists())
            self.assertEqual((metadata / "METADATA").read_text(encoding="utf-8"), "retained")
            for path, data in files.items():
                self.assertEqual((target / path).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
