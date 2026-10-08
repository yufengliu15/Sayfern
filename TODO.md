- Add a "New topic" button in the chat interface. add a "Go easier / go harder" slider. go harder means relatively more difficult grammar, vocab, harder topics. must still be within reason
- Bulletproof the "Corrections" tooling. sol and astra cannot trigger it for some reason. sonnet does a really good job at it, but openai struggles
- make ui fill the space better.

## Release (see docs/packaging.md)

- make the github repo public. CI becomes free with no limit (private repos use the monthly Actions quota, macOS at ~10x the Linux rate), and Flathub and SignPath both need a public repo
- macOS signing: join the Apple Developer Program (US$99/yr), make a "Developer ID Application" cert, export it as .p12, make an app-specific password. add repo secrets CSC_LINK (base64 .p12), CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID. then ask the agent to drop `identity: "-"` + `disable-library-validation` and pass the secrets to the macOS jobs
- windows signing: after the repo is public, apply to SignPath Foundation (free for OSI-licensed open source). fallback: Azure Artifact Signing (US$9.99/mo, `win.azureSignOptions`). SmartScreen still warns until downloads build reputation
- flathub: after the repo is public, put the verification token at https://sayfern.ca/.well-known/org.flathub.VerifiedApps.txt, add screenshots to flatpak/ca.sayfern.Sayfern.metainfo.xml, then open a PR with the `flathub-submission` artifact to flathub/flathub (branch new-pr)
- decide the license: LICENSE + package.json say GPL-3.0, About panel + AGENTS.md say MIT
