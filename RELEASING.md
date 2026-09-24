# Releasing Rastermill

Rastermill is published manually to npm and GitHub. There is no tag-triggered
release workflow; merging a version bump alone does not publish a release.

## Prepare

1. Compare the latest npm version and GitHub release with `CHANGELOG.md`. Include
   any previously prepared but unpublished changes. Use a minor bump for new
   features or compatibility changes, and a patch bump for fixes alone.
2. Update `package.json` and move the pending changelog entries into a dated
   version section with a short **Highlights** paragraph. Keep an empty
   `## Unreleased` section above it.
3. Run the package gates with the pinned pnpm version:

   ```sh
   pnpm install --frozen-lockfile
   pnpm prepublishOnly
   pnpm docs:check
   git diff --exit-code -- dist
   pnpm pack --pack-destination /tmp/rastermill-pack
   pnpm package:smoke
   ```

   Use a fresh pack directory so the smoke test selects the intended version.
   Commit generated build output whenever source changes. Review and merge the
   release PR after Node 22/24 and both Windows workflows pass at its exact head.

## Publish and verify

1. Update a clean `main` checkout to the merged release commit. Build and pack
   that commit, then run `scripts/package-smoke.mjs` against the exact tarball.
2. Create and push a signed `vX.Y.Z` tag at that commit.
3. Authenticate to npm as a package maintainer and publish the tested tarball:
   `npm publish /path/to/rastermill-X.Y.Z.tgz --access public --tag latest`.
4. Verify `npm view rastermill@X.Y.Z version dist.tarball dist.integrity --json`,
   the `latest` dist-tag, and its publication time. Download the registry tarball,
   verify its integrity and packaged files against the tested artifact, and run
   the installed-package smoke test again.
5. Create a non-draft GitHub Release for the tag. Copy the version's changelog
   section verbatim, then append links to the npm version, registry tarball, and
   CI proof, plus the registry integrity and publication time. Use a notes file
   so Markdown and shell metacharacters remain literal.
6. Verify the published GitHub Release and npm version, leave `main` clean, and
   remove temporary tarballs. A release is complete only when both destinations
   are published and the release notes match the changelog.
