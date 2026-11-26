"""tools/sbom/server.py: the server's SBOM matches its hash-pinned requirements."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("sbom_server", ROOT / "tools" / "sbom" / "server.py")
assert spec is not None and spec.loader is not None
sbom = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sbom)


def test_every_pin_is_a_component_with_its_hashes_and_licence(tmp_path: Path) -> None:
    out = tmp_path / "server.cdx.json"
    assert sbom.main(["server.py", str(ROOT / "server" / "requirements.txt"), str(out)]) == 0
    bom = json.loads(out.read_text())
    assert bom["bomFormat"] == "CycloneDX"
    names = [c["name"] for c in bom["components"]]
    assert names == ["hidapi", "python-dali", "websockets"]
    text = (ROOT / "server" / "requirements.txt").read_text()
    for c in bom["components"]:
        assert f"{c['name']}=={c['version']}" in text
        assert c["purl"] == f"pkg:pypi/{c['name']}@{c['version']}"
        assert c["licenses"][0]["license"]["id"]
        hashes = c["externalReferences"][0]["hashes"]
        assert hashes and all(f"--hash=sha256:{h['content']}" in text for h in hashes)
    assert sum(len(c["externalReferences"][0]["hashes"]) for c in bom["components"]) == text.count(
        "--hash=sha256:"
    )
    version = json.loads((ROOT / "package.json").read_text())["version"]
    assert bom["metadata"]["component"]["version"] == version
    # The same input gives the same file: no time stamp and no serial number.
    again = tmp_path / "again.cdx.json"
    sbom.main(["server.py", str(ROOT / "server" / "requirements.txt"), str(again)])
    assert again.read_text() == out.read_text()


def test_refuses_a_pin_with_no_hash_or_no_licence() -> None:
    with pytest.raises(ValueError, match="no hash"):
        sbom.parse("websockets==17.4\n")
    with pytest.raises(ValueError, match="no licence"):
        sbom.parse("leftpad==1.0 \\\n    --hash=sha256:" + "0" * 64 + "\n")
    with pytest.raises(ValueError, match="neither a pin nor a hash"):
        sbom.parse("websockets>=17\n")
