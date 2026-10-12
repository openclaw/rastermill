# Releasing Rastermill

Rastermill publishes the `rastermill` npm package and a GitHub Release through
[`release-npm-package.yml@v1`](https://github.com/openclaw/release-workflows/blob/v1/.github/workflows/release-npm-package.yml).
There are no native release binaries, Homebrew formulas, or Sparkle artifacts.
Do not publish from a local checkout; Actions owns both destinations.

## Prepare

Compare npm and GitHub with `CHANGELOG.md` before choosing a version. Update
`package.json` and finalize exactly one `## X.Y.Z - YYYY-MM-DD` section with a
short `**Highlights:**` paragraph, keeping an empty `## Unreleased` above it.
Use the repository's pinned pnpm 11.28.4:

```sh
pnpm install --frozen-lockfile
pnpm check:release
pnpm docs:check
git diff --exit-code -- dist
pnpm pack --pack-destination /path/to/fresh-pack-directory
node scripts/package-smoke.mjs /path/to/fresh-pack-directory
```

Commit generated `dist` changes with their sources. Review and merge the
preparation PR after Node 22/24 and Windows checks pass. The release build
installs ImageMagick and FFmpeg, reruns the gates, and packs the exact commit.
Clean x64 and arm64 verifiers install the frozen tarball with lifecycle scripts
disabled and exercise exports, declarations, PNG probing/transparency, and JPEG
conversion/resizing.

## npm trusted publishing

The existing `rastermill` package must trust GitHub repository
`openclaw/rastermill`, caller filename `release.yml`, with publish permission.
Registry administration uses the approved npm helper; no npm token belongs in
GitHub Actions. Only the publisher receives `id-token: write`; it publishes the
verified tarball via OIDC with provenance and lifecycle scripts disabled.

Stable versions use `latest`; prereleases use `next`. Existing registry versions
are never republished. Recovery accepts an existing version only when its
integrity and downloaded bytes match the verified payload. If npm succeeded but
GitHub publication failed, dispatch the same immutable signed tag with
`dry_run=false`; do not change its code or retry publication from newer main.

## Publish through Actions

After the preparation PR and push CI pass on the exact merged commit, create a
signed annotated `vX.Y.Z` tag using the release SSH key authorized by
`.github/release-allowed-signers`, verify it, and push only that tag. Never move
an existing tag or reuse a published version. The tag starts `Release`; do not
publish locally or create a GitHub Release by hand.

The shared workflow freezes the commit, checks protected-main ancestry, the SSH
signature, version metadata, dated changelog notes, and green independent push
CI. It then runs the checks below and binds the payload to two independent
verifiers before publication. A live dispatch also requires an existing signed
tag; it cannot silently substitute an unsigned tag.

## No-publish rehearsal

Dispatch `Release` on the current protected `main` with the version matching its
metadata and a dated changelog section. `dry_run` defaults to `true`:

```sh
gh workflow run release.yml --repo openclaw/rastermill --ref main -f version=0.4.0 -F dry_run=true
```

This checks current main even when that version has an older tag. It neither
creates nor changes tags, GitHub Releases, registry versions, or deployments.
Only the release pipeline's checks run; ordinary push workflows remain separate.

## Verify and close out

Confirm the Actions run succeeded and the GitHub Release has the expected
signed tag, frozen commit, exact dated changelog section, inventory, and
`SHA256SUMS`. Download the attached payload and verify its checksums. Never
replace an existing release's assets to fix a failed attempt.

Keep the released changelog section intact. Open an empty `## Unreleased`
section if one is absent, review and merge the follow-up, and leave `main` clean
and current. No release is complete while its independent CI or publication
verification is failing.

Also verify npm's version, dist-tag, tarball, integrity, and publication time.
The publisher verifies registry bytes, Sigstore signatures, and provenance
against the frozen commit before creating the GitHub Release. Its assets include
the tarball, package plan, exact release notes, inventory, and checksums.
