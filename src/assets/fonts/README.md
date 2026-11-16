# Fonts

Self-hosted, so the app makes no third-party request (`docs/UI.md` section 5). Both fonts are under
the SIL Open Font License 1.1, whose text is beside them. They are assets, not packages.

| File                          | From                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `Inter-Regular.woff2`         | `rsms/inter` at tag `v4.1`, `docs/font-files/Inter-Regular.woff2` |
| `Inter-Medium.woff2`          | `rsms/inter` at tag `v4.1`, `docs/font-files/Inter-Medium.woff2`  |
| `Inter-LICENSE.txt`           | `rsms/inter` at tag `v4.1`, `LICENSE.txt`                         |
| `JetBrainsMono-Regular.woff2` | `JetBrains/JetBrainsMono` at tag `v2.304`, `fonts/webfonts/`      |
| `JetBrainsMono-OFL.txt`       | `JetBrains/JetBrainsMono` at tag `v2.304`, `OFL.txt`              |

Each file's git blob hash matched the tagged repository when it was added. `SHA256SUMS` holds their
SHA-256 sums, and `tests/fonts.test.ts` checks them, so a changed file fails the tests.
