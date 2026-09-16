# MERQO — Release Process

## Versioning

SemVer in `package.json` + `CHANGELOG.md` (Added/Changed/Fixed/Security +
migration notes). `APP_VERSION` in `src/shared/constants.ts` must match.

## Pre-release gate (every release)

1. `npm run lint` (tsc renderer + main) — clean.
2. `npm test` (vitest) — all green, including reconciliation identities.
3. `npm run build` — renderer + main bundles succeed.
4. Fresh-install walkthrough: setup wizard → product → barcode sale →
   credit sale → payment → purchase → return → reports → backup/restore.
5. Bengali copy pass: no TODO/FIXME/lorem/“Coming Soon” in user-facing strings.
6. Responsive check: 1366×768 → 3840×2160; 100–175% Windows scaling.

## Building the Windows installer

Built on **Windows** (GitHub Actions `windows-latest`, see
`.github/workflows/release.yml`) — reproducible, no dev-machine leftovers:

```
npm ci
npm run rebuild        # electron-builder install-app-deps (native modules for Electron)
npm run dist           # NSIS setup + portable .exe into release/
```

Artifacts: `MERQO Retail Suite-Setup-<ver>.exe`,
`MERQO Retail Suite-Portable-<ver>.exe`.

## Installer contents

Branding, version, install location, Start Menu + optional Desktop shortcuts,
uninstaller entry, bundled license notice. No dev tooling, no test data.

## Post-release

- Tag `v<ver>`, attach artifacts + `CHANGELOG.md` excerpt.
- Keep upgrade path: new schema versions ship as migrations; test restore of
  a vN backup into vN+1 on a copy before shipping.
