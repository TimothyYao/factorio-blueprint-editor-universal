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

**Sample blueprint**

- URL import: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://pastebin.com/uc4n81GP
- Direct string (no pastebin fetch involved): [open in editor](https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx%2FAhmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW%2BSpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM%2FeMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I%2BV8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j%2BGltfMAmGY%2BeDpPoE5RG5eU1%2Bvk0W75Kbt8nyPrmbpl8tsiv1)

**Example blueprint book**

- URL import: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://pastebin.com/Xp9u7NaA&index=1
- Direct string (no pastebin fetch involved): [open in editor](https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=0eNqdk9tugkAQhl%2FF7DUY5eCBuz5DL3rRGLMsU510mSW7i60xvHsXULARlTYhJMsw3zeT7H9iqSyh0Eh2myr1yZITQws5S%2FqC3xQ8JnkK0hVeeV5ImJy%2FcmHxAFukDL5ZMvPYAbRBRSyJF8E6Wq%2FjMArm4TzweqJhybvzdC1dYUh%2FZX4xBvJUOgF75EGhqFUY3BGXNdUeC3CEBu4x4nl94i0PaefnXOyRwA9Z5V0mm1cbjwFZtAgtrzkct1TmKWj3w2OSxwplXHM95Im1qx7d2xk0CGwGKrQSYEzdWBJaZ7%2BxBH%2B0xLcWkCCsVoTCF6hFOSwK%2F7VOfC3i2YGTgOyRJuo0H9xYH8mAtq5wZ5Gan6EztJVogBh3xPuwsIGFz2GLDmY1J1Mo7RIA0t5Drp4jl6OR0VjkajQyHkZuqpp6uenPM3gTtyiYLZfRok%2Fnm1IZ0ETswdQNfQp7SZ%2FH8%2FBfTY%2Ff9lTj8%2Far7%2FZiTs8ZmMZVvah7fgBMuKM8&index=1)

URL imports (`?source=https://…`) fetch the host directly from the browser, so they work on GitHub Pages for hosts that send CORS headers (pastebin, gist, Google Docs, factorioprints) — the sample links above included. Hosts that don't (e.g. gitlab raw) fall back to a `/corsproxy` that GitHub Pages does not provide — for those, paste the blueprint string or use `?source=<bpstring>`. The direct-string links above embed compact vanilla prints (Pages returns 414 for URLs past ~8 KB) and render with no pastebin round-trip at all. See [`docs/github-pages.md`](./docs/github-pages.md).

# Features

- rendering and editing blueprints
- history (undo/redo)
- copy and delete selections
- import blueprints and books from a pasted bp string or a URL (pastebin, gist, Google Docs, factorioprints; CORS-less hosts like gitlab raw need a proxy this GitHub Pages deploy doesn't run)
- generating blueprint images
- oil outpost generator
- customizable keybinds
- "creative" entities

# Contributing

Check out [this readme](./CONTRIBUTING.md) if you are interested in contributing.

# Credits

Thanks to all contributors!

Thanks to everyone who submitted bugs and feature requests on github and doorbell.io!

Thanks to the factorio player GamesDan for reporting a lot of issues via doorbell!
