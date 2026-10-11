# Packaging and releases

Sayfern ships as a macOS `.dmg`, a Windows `.exe` and a Linux Flatpak. GitHub Actions builds all of them on every push to `main`.

## What CI does

The workflow is [`.github/workflows/release.yml`](../.github/workflows/release.yml). Pushes that change only `site/` do not start it. You can also start it by hand (Actions > Build and release > Run workflow).

| Job | Runner | Output |
|---|---|---|
| `check` | ubuntu-latest | `npm run typecheck`, `npm test`. The other jobs wait for it. |
| `package` | macos-latest | `Sayfern-<version>-mac-arm64.dmg` (Apple silicon) |
| `package` | macos-15-intel | `Sayfern-<version>-mac-x64.dmg` (Intel) |
| `package` | windows-latest | `Sayfern-<version>-win-x64.exe` (NSIS installer) |
| `package` | ubuntu-latest | `Sayfern-<version>-linux-x64.tar.gz`, plus the `flatpak-source` and `flathub-submission` folders |
| `flatpak` | ubuntu-latest, Flatpak container | `Sayfern-<version>-linux-x86_64.flatpak` |
| `release` | ubuntu-latest | A GitHub release `v<version>`, only if that release does not exist yet |

Every run keeps its files as workflow artifacts. A release needs a new version in `package.json` (AGENTS.md rule 10) and a `## [<version>] - <date>` section in `CHANGELOG.md`. The release notes are that section.

Each OS and CPU builds on its own machine, because `pdfjs-dist` needs the native `@napi-rs/canvas` package for that OS and CPU.

## Build on your own computer

```bash
npm run dist -- --mac --arm64          # dist/Sayfern-<version>-mac-arm64.dmg
npm run dist -- --win --x64            # on Windows
npm run dist -- --linux --x64          # on Linux
npx electron-builder --mac dir --arm64 # only the .app, no .dmg (faster)
```

The config is [`electron-builder.yml`](../electron-builder.yml). `npm run dist` runs `electron-vite build` first.

Things to know:

- `productName` is "Sayfern", but `app.name` stays `sayfern`. electron-builder does not write `productName` into the packaged `package.json`, so the data folder and the Keychain item do not change.
- The macOS microphone text is in `mac.extendInfo`. Keep it the same as `MIC` in `scripts/brand-electron-app.mjs`.

## Signing

The builds are not signed with a paid certificate yet.

- **macOS:** the app has an ad-hoc signature (`mac.identity: "-"`). Without a signature, Apple silicon says that the app is "damaged". With an ad-hoc signature, macOS says that it cannot check the developer. The learner must right-click the app, then click Open (or use System Settings > Privacy & Security > Open Anyway).
- **Windows:** SmartScreen shows "Windows protected your PC". The learner must click More info, then Run anyway.

To sign and notarize the macOS app with an Apple Developer ID:

1. Delete `identity: "-"` and the `disable-library-validation` entitlement in `build/entitlements.mac.plist`.
2. Add these repository secrets: `CSC_LINK` (the .p12, base64), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
3. Pass them as `env` to the `electron-builder` step of the macOS jobs. electron-builder then signs and notarizes.

For Windows, add `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` and pass them to the Windows job.

## Flatpak and Flathub

The source files are in [`flatpak/`](../flatpak/): the manifest `ca.sayfern.Sayfern.yml`, the launcher `sayfern.sh` (it starts Electron through `zypak-wrapper`), the `.desktop` file and the AppStream metainfo. The manifest repackages the Linux `tar.gz` on `org.electronjs.Electron2.BaseApp`.

Do not build the manifest in `flatpak/` directly. [`scripts/flatpak.mjs`](../scripts/flatpak.mjs) makes a copy with the version and its CHANGELOG date in the metainfo:

| Command | Output | Use |
|---|---|---|
| `node scripts/flatpak.mjs local <tar.gz>` | `dist/flatpak/` | The manifest reads the local `tar.gz`. CI makes the `.flatpak` bundle from it. |
| `node scripts/flatpak.mjs flathub <tar.gz> <owner/repo>` | `dist/flathub/` | The manifest downloads the release `tar.gz` (URL and sha256). These are the files for the Flathub repo. |

Build and run the Flatpak on Linux:

```bash
npm run dist -- --linux --x64
node scripts/flatpak.mjs local dist/Sayfern-<version>-linux-x64.tar.gz
flatpak-builder --user --install --force-clean --install-deps-from=flathub build-dir dist/flatpak/ca.sayfern.Sayfern.yml
flatpak run ca.sayfern.Sayfern
```

Install a CI bundle: `flatpak install --user Sayfern-<version>-linux-x86_64.flatpak`.

The sandbox gets the network, the display (Wayland, X11 fallback), the GPU, audio (voice) and the Secret Service (`safeStorage` keeps the credentials key there). Open and save dialogs go through the desktop portal, so the app has no file system access.

### Publish on Flathub (one time, by hand)

Flathub reviews each new app. A person must submit it:

1. Make the GitHub repository public. Flathub downloads the `tar.gz` from the release, and a private repository's releases are not public.
2. Prove that you own `sayfern.ca`: Flathub asks for a token at `https://sayfern.ca/.well-known/org.flathub.VerifiedApps.txt`. The app ID `ca.sayfern.Sayfern` depends on this domain.
3. Add screenshots to the metainfo (Flathub's quality rules ask for them).
4. Take the `flathub-submission` artifact of a run that published a release. Open a pull request with it to the `new-pr` branch of [github.com/flathub/flathub](https://github.com/flathub/flathub), as the [Flathub submission guide](https://docs.flathub.org/docs/for-app-authors/submission) tells you.

After Flathub accepts the app, it makes the repository `flathub/ca.sayfern.Sayfern`. The `x-checker-data` block in the manifest lets Flathub's bot open a pull request there for each new GitHub release. You only merge it.

`flathub.json` limits the build to `x86_64`, because CI makes only an x64 Linux build. For `aarch64`, add an `ubuntu-24.04-arm` job (free only for public repositories), add its `tar.gz` as a second source with `only-arches: [aarch64]`, and delete `flathub.json`.

## Not done yet

- No Windows ARM or Linux ARM builds (no free ARM runners for private repositories).
- No auto-update in the app. Learners download each new version.
- Windows and Linux builds are not tested by hand. Some text still says "Mac" (for example the default interface language note).
