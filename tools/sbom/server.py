"""Write a CycloneDX SBOM for the hardware server from its hash-pinned requirements file.

Usage: python3 -I tools/sbom/server.py server/requirements.txt out.cdx.json

Standard library only, so the SBOM tool adds nothing to the supply chain it describes. The app's own
SBOM comes from `pnpm sbom`. The licences are the ones recorded in docs/DEPENDENCIES.md: a package
with no licence listed here fails the run, so a new pin cannot ship without one.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

LICENCES = {
    "hidapi": "BSD-3-Clause",
    "python-dali": "LGPL-3.0-or-later",
    "websockets": "BSD-3-Clause",
}

PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.!+_-]+)$")
HASH = re.compile(r"^--hash=sha256:([0-9a-f]{64})$")
MAX_BYTES = 1_000_000


def parse(text: str) -> list[dict[str, object]]:
    """Each pinned package with its version and the SHA-256 of every file pip may install."""
    packages: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for raw in text.splitlines():
        line = raw.strip().rstrip("\\").strip()
        if line == "" or line.startswith("#"):
            continue
        for part in line.split():
            pin = PIN.match(part)
            digest = HASH.match(part)
            if pin is not None:
                current = {"name": pin.group(1).lower(), "version": pin.group(2), "hashes": []}
                packages.append(current)
            elif digest is not None and current is not None:
                hashes = current["hashes"]
                assert isinstance(hashes, list)
                hashes.append(digest.group(1))
            else:
                raise ValueError(f"A line that is neither a pin nor a hash: {raw!r}")
    for p in packages:
        if not p["hashes"]:
            raise ValueError(f"{p['name']} has no hash.")
        if p["name"] not in LICENCES:
            raise ValueError(f"{p['name']} has no licence in tools/sbom/server.py.")
    return sorted(packages, key=lambda p: str(p["name"]))


def bom(packages: list[dict[str, object]], version: str) -> dict[str, object]:
    root = f"pkg:generic/enlighten-server@{version}"
    components = []
    for p in packages:
        ref = f"pkg:pypi/{p['name']}@{p['version']}"
        hashes = p["hashes"]
        assert isinstance(hashes, list)
        components.append(
            {
                "type": "library",
                "name": p["name"],
                "version": p["version"],
                "purl": ref,
                "bom-ref": ref,
                "licenses": [{"license": {"id": LICENCES[str(p["name"])]}}],
                # One entry for each file the pin allows: the wheels for each platform, and the
                # source archive where there is one. pip installs exactly one of them.
                "externalReferences": [
                    {
                        "type": "distribution",
                        "url": f"https://pypi.org/project/{p['name']}/{p['version']}/",
                        "hashes": [{"alg": "SHA-256", "content": h} for h in sorted(hashes)],
                    }
                ],
            }
        )
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "version": 1,
        "metadata": {
            "lifecycles": [{"phase": "build"}],
            "component": {
                "type": "application",
                "name": "enlighten-server",
                "version": version,
                "purl": root,
                "bom-ref": root,
                "description": "The hardware server: a loopback relay between the app and a hasseb USB DALI Master.",
            },
        },
        "components": components,
        "dependencies": [{"ref": root, "dependsOn": [c["bom-ref"] for c in components]}],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    source = Path(argv[1])
    if source.stat().st_size > MAX_BYTES:
        raise ValueError("The requirements file is larger than expected.")
    package = json.loads(Path(__file__).resolve().parents[2].joinpath("package.json").read_text())
    out = bom(parse(source.read_text(encoding="utf-8")), str(package["version"]))
    Path(argv[2]).write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
