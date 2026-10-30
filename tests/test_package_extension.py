import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

from scripts.package_extension import build_package, chrome_version


ROOT = Path(__file__).resolve().parents[1]


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "extension"
        self.root.mkdir()
        for name in ["manifest.json", "background.js", "pathbuilder.js", "roll20.js",
                     "roll20-initiative-bridge.js", "popup.html", "popup.js", "LICENSE", "icons"]:
            source = ROOT / name
            if source.is_dir():
                shutil.copytree(source, self.root / name)
            else:
                shutil.copyfile(source, self.root / name)
        self.version = json.loads((self.root / "manifest.json").read_text())["version"]

    def build(self, **kwargs):
        return build_package(self.root, Path(self.temp.name) / "dist", **kwargs)

    def test_only_runtime_files_and_license_are_packaged_at_zip_root(self):
        for name in [".env", "AGENTS.md", "temp.html", "old.zip", "private-key.pem"]:
            (self.root / name).write_text("must not ship")
        (self.root / "icons" / "private-key.pem").write_text("must not ship")
        package = self.build(expected_version=self.version)
        with zipfile.ZipFile(package) as archive:
            self.assertEqual(set(archive.namelist()), {
                "manifest.json", "background.js", "pathbuilder.js", "roll20.js",
                "roll20-initiative-bridge.js", "popup.html", "popup.js", "LICENSE",
                "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
            })
            self.assertIsNone(archive.testzip())
        checksum = package.with_suffix(".zip.sha256").read_text()
        self.assertEqual(checksum, f"{hashlib.sha256(package.read_bytes()).hexdigest()}  {package.name}\n")

    def test_package_is_reproducible_despite_source_mtime_changes(self):
        first = self.build().read_bytes()
        (self.root / "popup.js").touch()
        self.assertEqual(self.build().read_bytes(), first)

    def test_mismatched_expected_version_fails_before_artifact(self):
        with self.assertRaisesRegex(ValueError, "expected version"):
            self.build(expected_version="99.0.0")
        self.assertFalse((Path(self.temp.name) / "dist").exists())

    def test_missing_runtime_asset_is_rejected(self):
        (self.root / "roll20-initiative-bridge.js").unlink()
        with self.assertRaisesRegex(ValueError, "roll20-initiative-bridge.js"):
            self.build()

    def test_new_manifest_reference_requires_explicit_packaging(self):
        path = self.root / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["content_scripts"][0]["js"].append("new-feature.js")
        (self.root / "new-feature.js").write_text("// new")
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "new-feature.js"):
            self.build()

    def test_popup_local_reference_requires_packaging(self):
        with (self.root / "popup.html").open("a") as page:
            page.write('<script src="missing.js"></script>')
        with self.assertRaisesRegex(ValueError, "missing.js"):
            self.build()

    def test_symlink_is_rejected(self):
        (self.root / "popup.js").unlink()
        (self.root / "popup.js").symlink_to(ROOT / "popup.js")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.build()

    def test_chrome_versions_have_four_numeric_components_at_most(self):
        for value in ["0", "0.0.0.0", "01.2", "1.2.3.4.5", "65536", "1.2-beta", "../1", "", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                chrome_version(value)
        self.assertEqual(chrome_version("1.2.3"), (1, 2, 3, 0))
        self.assertEqual(chrome_version("65535.0.1.2"), (65535, 0, 1, 2))
