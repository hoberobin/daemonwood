# Releasing

Daemonwood reaches people as one command, `npx daemonwood wake`, so a release
is an npm publish of this repository. There are no dependencies and no build
step: the published tarball is the `files` list in `package.json`, which
`tests/runtime.test.js` holds equal to the installer's payload.

## Checklist

1. `npm test` passes.
2. Bump `version` in `package.json`. Every build is content-hashed into
   `~/.daemonwood/versions/`, so a new version is only needed for npm, not
   for existing installs to notice a change.
3. Rehearse as a stranger: `npm pack`, then in an empty directory
   `npx --yes --package=/path/to/daemonwood-<version>.tgz daemonwood wake`.
   Point `HOME` at a scratch folder to keep your own install out of it.
4. `DAEMONWOOD_RELEASE=1 npm publish` (log in once with `npm login`). A bare
   `npm publish` is refused on purpose, so nothing goes live by accident; the
   guard also runs the test suite first. `publishConfig` in
   `package.json` sets the `latest` tag and public access, so a beta version
   still becomes what a bare `npx daemonwood` runs.
5. Check it from the registry: `npx daemonwood@latest wake`.

## Two npm traps this package avoids

- npm 11 drops a `bin` path written as `./bin/daemonwood.mjs` at publish time
  ("script name … was invalid and removed"), which publishes a package with no
  command. Keep it as `bin/daemonwood.mjs`.
- npm refuses to publish a prerelease version without a tag, and one published
  only under `beta` is invisible to `npx daemonwood`. `publishConfig.tag` is
  `latest` for that reason; change it deliberately if a stable line exists.
