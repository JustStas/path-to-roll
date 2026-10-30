"""Build the store ZIP from reviewed runtime files, never the whole checkout."""

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit
import zipfile


RUNTIME_FILES = (
    "LICENSE", "background.js", "manifest.json", "pathbuilder.js", "popup.html",
    "popup.js", "roll20.js", "roll20-initiative-bridge.js",
    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
)


def chrome_version(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}", value):
        raise ValueError("Invalid Chrome version: use 1–4 numeric components without leading zeros")
    parts = tuple(int(part) for part in value.split("."))
    if max(parts) > 65535 or not any(parts):
        raise ValueError("Invalid Chrome version: components must be 0–65535, with at least one nonzero")
    return parts + (0,) * (4 - len(parts))


class LocalAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in {"src", "href"} and value:
                parsed = urlsplit(value)
                if not parsed.scheme and not parsed.netloc and parsed.path:
                    self.paths.append(parsed.path)


def validate_sources(root, expected_version=None):
    root = root.resolve()
    for name in RUNTIME_FILES:
        path = root / name
        if any((root / Path(*Path(name).parts[:index])).is_symlink()
               for index in range(1, len(Path(name).parts) + 1)):
            raise ValueError(f"Runtime file must not use a symlink: {name}")
        if not path.is_file():
            raise ValueError(f"Missing runtime file: {name}")
    manifest = json.loads((root / "manifest.json").read_text())
    version = manifest.get("version")
    chrome_version(version)
    if expected_version is not None and version != expected_version:
        raise ValueError(f"Manifest version {version} does not match expected version {expected_version}")
    if manifest.get("manifest_version") != 3:
        raise ValueError("Expected a Manifest V3 extension")

    action = manifest.get("action", {})
    references = list(manifest.get("icons", {}).values())
    references += list(action.get("default_icon", {}).values())
    references += [action.get("default_popup"), manifest.get("background", {}).get("service_worker")]
    for script in manifest.get("content_scripts", []):
        references += script.get("js", []) + script.get("css", [])
    for resource in manifest.get("web_accessible_resources", []):
        references += resource.get("resources", [])
    parser = LocalAssets()
    parser.feed((root / "popup.html").read_text())
    references += parser.paths
    for name in filter(None, references):
        if name not in RUNTIME_FILES:
            raise ValueError(f"Asset is not in RUNTIME_FILES; review and add it before packaging: {name}")
    return version


def build_package(root, output_dir, expected_version=None):
    root, output_dir = Path(root), Path(output_dir)
    version = validate_sources(root, expected_version)
    # No transpilation: these are exactly the JavaScript files Chrome will load.
    for name in RUNTIME_FILES:
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(root / name)], check=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    package = output_dir / f"path-to-roll-{version}.zip"
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(RUNTIME_FILES):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, (root / name).read_bytes())
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    package.with_suffix(".zip.sha256").write_text(f"{digest}  {package.name}\n")
    return package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    parser.add_argument("--expected-version")
    args = parser.parse_args()
    try:
        print(build_package(args.root, args.output_dir, args.expected_version))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Packaging failed: {error}\n")


if __name__ == "__main__":
    main()
