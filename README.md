<img src="./.github/logo.svg" width="100%" align="right">

# factorio-blueprint-editor-universal

> **This is a fork of a fork.** Immediate parent is
> [`trisiak/factorio-blueprint-editor`](https://github.com/trisiak/factorio-blueprint-editor)
> (hosted at https://trisiak.github.io/factorio-blueprint-editor/), itself a fork
> of [`Teoxoy/factorio-blueprint-editor`](https://github.com/Teoxoy/factorio-blueprint-editor)
> (hosted at https://fbe.teoxoy.com). This line of development is **not** expected
> to merge back to either upstream. It deploys on its own via GitHub Pages at
> https://timothyyao.github.io/factorio-blueprint-editor-universal/.
> Pages setup (including the one-time GitHub settings this repo cannot flip from
> code) is in [`docs/github-pages.md`](./docs/github-pages.md).

[![Website](https://img.shields.io/website?url=https%3A%2F%2Ftimothyyao.github.io%2Ffactorio-blueprint-editor-universal%2F&style=flat-square)](https://timothyyao.github.io/factorio-blueprint-editor-universal/)
[![Discord](https://img.shields.io/discord/540738973413408809.svg?style=flat-square&color=7289da&logo=discord&logoColor=white)](https://discord.gg/c5eXyBU)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg?style=flat-square)](./CONTRIBUTING.md)
&nbsp;&nbsp;_Badges are clickable!_ Discord is the original project's community.

A feature-rich [Factorio](https://www.factorio.com) Blueprint Editor. You can now edit your blueprints in the browser!

![Preview](./.github/preview.png)

**Try a sample**

- Sample blueprint — [via pastebin][sample-bp-pastebin] · [via embedded string][sample-bp-string]
- Sample blueprint book — [via pastebin][sample-book-pastebin] · [via embedded string][sample-book-string]

# Features

- rendering and editing blueprints
- history (undo/redo)
- copy and delete selections
- import blueprints and books from a pasted bp string or a URL (see [Importing a blueprint](#importing-a-blueprint) for which hosts work on this static deploy)
- generating blueprint images
- oil outpost generator
- customizable keybinds
- "creative" entities

# Importing a blueprint

Pass a blueprint (or book) into the editor with `?source=`:

- a Factorio blueprint string (`0eN…`), decoded in the browser with no network fetch
- a post URL from a hosting site in the table below
- any other URL whose body is a raw blueprint string (CORS permitting)

Books also accept `&index=N` to open a specific page (0-based). Direct-string URLs must stay under ~8 KB — GitHub Pages returns 414 past that, which is why the embedded samples below are compact vanilla prints.

Live samples below were verified 2026-09. "Open in editor" links work on this GitHub Pages deploy.

| Host                                           | Link shape                               | GitHub Pages                            | Sample                                                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct string                                  | `?source=<bpstring>`                     | ✅ always (no fetch; ~8 KB URL cap)     | [sample blueprint][sample-bp-string]<br>[sample book][sample-book-string]                                                                                                             |
| Pastebin                                       | `pastebin.com/<id>`                      | ✅ direct                               | [sample blueprint][sample-bp-pastebin]<br>[sample book][sample-book-pastebin]                                                                                                         |
| [Factorio Prints](https://factorioprints.com)  | `factorioprints.com/view/<key>`          | ✅ direct (CORS-open Firebase DB)       | [Tileable Science Production — open in editor](https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://factorioprints.com/view/-KnQ865j-qQ21WoUPbd3)         |
| [Factorio School](https://www.factorio.school) | `factorio.school/view/<key>`             | ✅ direct (same DB as Prints)           | [the same print via factorio.school — open in editor](https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://www.factorio.school/view/-KnQ865j-qQ21WoUPbd3) |
| [FactorioBin](https://factoriobin.com)         | `factoriobin.com/post/<id>`              | ❌ proxy-only                           | [Raynquist's Belt Balancer Compendium](https://factoriobin.com/post/Y5h0w60K)                                                                                                         |
| [FactorioCodex](https://factoriocodex.com)     | `factoriocodex.com/blueprints/<id>`      | ❌ proxy-only                           | [Space Age Mega Blueprint Library](https://www.factoriocodex.com/blueprints/244)                                                                                                      |
| GitHub gist                                    | `gist.github.com/<user>/<id>`            | ✅ direct (gist API)                    | [16×16 balancer gist — open in editor](https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://gist.github.com/henrydatei/b4836a311b36a615ba6f0513a3e2d1ce)  |
| Dropbox                                        | `dropbox.com/scl/fi/<id>/<file>?rlkey=…` | ✅ direct (`dl.dropboxusercontent.com`) | bring your own share link                                                                                                                                                             |
| GitLab snippets                                | `gitlab.com/-/snippets/<id>`             | ❌ proxy-only                           | —                                                                                                                                                                                     |
| Google Docs                                    | `docs.google.com/document/d/<id>/…`      | ✅ direct (txt export)                  | —                                                                                                                                                                                     |
| any other URL                                  | fetched as a raw blueprint string        | depends on the host's CORS              | —                                                                                                                                                                                     |

URL imports (`?source=https://…`) fetch the host directly from the browser, so they work on GitHub Pages for hosts that send CORS headers (✅ above). Hosts that don't (❌) fall back to a `/corsproxy` that GitHub Pages does not provide — those links import fine on a Cloudflare Pages deploy; on this one, paste the blueprint string or use `?source=<bpstring>`. Hastebin support was removed: Toptal's takeover put its raw endpoint behind an API key. See [`docs/github-pages.md`](./docs/github-pages.md).

[sample-bp-pastebin]: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://pastebin.com/uc4n81GP
[sample-book-pastebin]: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://pastebin.com/Xp9u7NaA&index=1
[sample-bp-string]: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx%2FAhmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW%2BSpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM%2FeMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I%2BV8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j%2BGltfMAmGY%2BeDpPoE5RG5eU1%2Bvk0W75Kbt8nyPrmbpl8tsiv1
[sample-book-string]: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=0eNqdk9tugkAQhl%2FF7DUY5eCBuz5DL3rRGLMsU510mSW7i60xvHsXULARlTYhJMsw3zeT7H9iqSyh0Eh2myr1yZITQws5S%2FqC3xQ8JnkK0hVeeV5ImJy%2FcmHxAFukDL5ZMvPYAbRBRSyJF8E6Wq%2FjMArm4TzweqJhybvzdC1dYUh%2FZX4xBvJUOgF75EGhqFUY3BGXNdUeC3CEBu4x4nl94i0PaefnXOyRwA9Z5V0mm1cbjwFZtAgtrzkct1TmKWj3w2OSxwplXHM95Im1qx7d2xk0CGwGKrQSYEzdWBJaZ7%2BxBH%2B0xLcWkCCsVoTCF6hFOSwK%2F7VOfC3i2YGTgOyRJuo0H9xYH8mAtq5wZ5Gan6EztJVogBh3xPuwsIGFz2GLDmY1J1Mo7RIA0t5Drp4jl6OR0VjkajQyHkZuqpp6uenPM3gTtyiYLZfRok%2Fnm1IZ0ETswdQNfQp7SZ%2FH8%2FBfTY%2Ff9lTj8%2Far7%2FZiTs8ZmMZVvah7fgBMuKM8&index=1

# Contributing

Check out [this readme](./CONTRIBUTING.md) if you are interested in contributing.

# Credits

Thanks to all contributors!

Thanks to everyone who submitted bugs and feature requests on github and doorbell.io!

Thanks to the factorio player GamesDan for reporting a lot of issues via doorbell!
