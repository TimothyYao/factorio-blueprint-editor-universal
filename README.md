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

Sample blueprint: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://pastebin.com/uc4n81GP

Example blueprint book: https://timothyyao.github.io/factorio-blueprint-editor-universal/?source=https://pastebin.com/Xp9u7NaA&index=1

URL imports (`?source=https://…`) fetch the host directly from the browser, so they work on GitHub Pages for hosts that send CORS headers (pastebin, gist, Google Docs, factorioprints). Hosts that don't (e.g. gitlab raw) fall back to a `/corsproxy` that GitHub Pages does not provide — for those, paste the blueprint string or use `?source=<bpstring>`. See [`docs/github-pages.md`](./docs/github-pages.md).

# Features

- rendering and editing blueprints
- history (undo/redo)
- copy and delete selections
- import blueprints and books from a pasted bp string (URL imports need a CORS proxy and do not run on this GitHub Pages deploy)
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
