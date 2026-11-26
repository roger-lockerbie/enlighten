#!/usr/bin/env bash
# Pack a release archive from a built tree: dist/, the hardware server, the licence texts and the
# notices. Run after `pnpm build` and `pnpm sbom:all`. Writes release/ with the archive, both SBOMs
# and SHA256SUMS.
#
# The archive is made the same way each time: files in name order, one fixed time (the commit's),
# no owner names, and gzip with no name or time in its header. The same commit, built with the same
# pinned tools, should give the same bytes. That has been checked on one machine against CI, not
# proved in general.
set -euo pipefail

cd "$(dirname "$0")/../.."
version="$(node -p 'require("./package.json").version')"
name="enlighten-v${version}"
epoch="$(git log -1 --format=%ct)"
out="release"
stage="${out}/${name}"

test -f dist/index.html || { echo "Run pnpm build first." >&2; exit 1; }
test -f sbom/enlighten-app.cdx.json || { echo "Run pnpm sbom:all first." >&2; exit 1; }

rm -rf "${out}"
mkdir -p "${stage}/licences"
cp -R dist "${stage}/dist"
# The server as git tracks it, without its tests.
git ls-files -z server | grep -zv '^server/tests/' | while IFS= read -r -d '' f; do
  mkdir -p "${stage}/$(dirname "$f")"
  cp "$f" "${stage}/$f"
done
cp README.md SECURITY.md CHANGELOG.md THIRD_PARTY_NOTICES.md "${stage}/"
for f in LICENSE NOTICE; do
  if test -f "$f"; then cp "$f" "${stage}/"; fi
done
cp src/assets/fonts/Inter-LICENSE.txt src/assets/fonts/JetBrainsMono-OFL.txt "${stage}/licences/"
git rev-parse HEAD > "${stage}/COMMIT"

# GNU tar on the CI runner, and gtar or bsdtar on a Mac.
if tar --version 2>/dev/null | grep -q 'GNU tar'; then gnutar=tar
elif command -v gtar >/dev/null 2>&1; then gnutar=gtar
else gnutar=""; fi
if test -n "${gnutar}"; then
  "${gnutar}" --sort=name --mtime="@${epoch}" --owner=0 --group=0 --numeric-owner \
    --format=ustar -C "${out}" -cf "${out}/${name}.tar" "${name}"
else
  echo "No GNU tar: the archive will not match CI's byte for byte." >&2
  find "${stage}" -exec touch -h -d "$(date -u -r "${epoch}" +%Y-%m-%dT%H:%M:%SZ)" {} + 2>/dev/null || true
  (cd "${out}" && find "${name}" -print | LC_ALL=C sort | tar --no-recursion --uid 0 --gid 0 --format ustar -cf "${name}.tar" -T -)
fi
gzip -n -9 "${out}/${name}.tar"
rm -rf "${stage}"
cp sbom/enlighten-app.cdx.json "${out}/${name}-app.cdx.json"
cp sbom/enlighten-server.cdx.json "${out}/${name}-server.cdx.json"
if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
(cd "${out}" && ${sum} "${name}.tar.gz" "${name}-app.cdx.json" "${name}-server.cdx.json" > SHA256SUMS)
cat "${out}/SHA256SUMS"
