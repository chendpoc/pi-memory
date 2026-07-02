# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for version bumps and `CHANGELOG.md`.

## Add a changeset (in your feature PR)

```bash
pnpm changeset
```

Pick `patch` / `minor` / `major` and write a short summary. Commit the generated file under `.changeset/`.

## Release (automated on GitHub)

1. Merge PRs with changeset files into `main`.
2. GitHub Actions opens a **Version Packages** PR (bumps version + updates `CHANGELOG.md`).
3. Merge that PR → CI publishes to npm and creates a GitHub Release.
