# ADR 0024: the manual is Markdown in the repo, drawn by the app itself

Status: accepted

Date: 2026-11-27

## Context

After v0.2.0 the app had no user documentation beyond the README and the console's `help`. The owner asked for two things from one source: a concise, table-first manual for a reader who wants dense reference, and a longer guide that walks through the app's capabilities and the reasons for them. Both were to be readable inside the app, and to live in the repo in a form that could be dropped into another system, such as Obsidian, unchanged.

It was done as Stage 11b, before hardware day. The hardware path has never driven a real driver, so what the manual says about real gear had to be marked and tracked.

Three constraints shaped it. The app bans `innerHTML` and `{@html}` and enforces Trusted Types, and every Markdown library makes HTML strings. A runtime dependency needs the owner's approval. And the entry chunk has a 250 kB budget.

The owner chose on 2026-11-27: our own small renderer with no dependency, scripted screenshots with callouts, hardware chapters written now and marked, and a generated reference for all 137 DALI commands.

## Decision

### The source

`docs/manual/` holds plain Markdown in a fixed subset: headings to level 4, paragraphs, bold, italic, inline code, fenced code, lists two levels deep, tables, block quotes, callouts in the `> [!NOTE]` form that GitHub and Obsidian both draw, pictures on a line of their own, rules, and relative links. No raw HTML and no wikilinks. A frontmatter block gives each page a title and an order.

`guide/` is the journey, numbered. `reference/` is the concise manual. `generated/` is three pages written from the app's own tables. `img/` is the pictures. `hardware-ledger.md` lists what rests on untried hardware.

### The viewer

`src/manual/markdown.ts` parses the subset to a typed tree. It makes no HTML. Text outside the subset stays text, so a `<script>` in a page is seven characters on the screen. `src/manual/book.ts` orders the pages, resolves links and searches. `src/ui/manual/ManualView.svelte` draws the tree as ordinary elements with text nodes.

Even though the pages are the project's own and are bundled at build time, the viewer treats them as untrusted:

- A link is followed only to another page of the manual or a heading on the same page. Any other address, one on another origin included, is shown as text and is not a link.
- A picture is shown only if the build has a file for it. The `src` comes from the build's own map of hashed files, never from the page's text.
- A console line's "Put in console" button copies the line to the console's input. It does not send it.

The page itself loads with the other later pages (ADR 0020). The text, the parser and the book are one more chunk, loaded when the manual is first opened, as the help text is (ADR 0023). The viewer takes every function through that chunk's module, so none of the code is shared with the page that shows it and the bundler makes no extra shared chunk.

It opens from a Manual entry at the foot of the rail, from F1, and from `manual [<page>]` in the console. The ten Alt-digit pages keep their keys. The page hides the inspector, which has nothing to show there, and keeps the page last read for the session.

### Generated pages

`pnpm manual:gen` writes keys, console commands and DALI commands from `legend()`, `APP_KEYS`, `RAIL`, `help()` and `daliEntry()`: the tables the app runs on. A test builds the same text and fails when a file is stale. The pages are kept out of the formatter, so the comparison is exact.

Settings showed its own list of keys, which had gone stale ("Alt 1 to Alt 5"). It now shows `APP_KEYS`, the list the manual is built from.

### Pictures

`pnpm manual:shots` runs a Playwright script that follows each guide chapter's steps in the simulator and takes its pictures, so a step that stops working fails there. Numbered callouts are badges the script adds with DOM calls and style properties, which the CSP allows, so the pictures come from the build a person runs. It is run by hand on the reference laptop, not in CI: fonts differ on Linux, as for `e2e:visual`.

### Keeping it true

Unit tests hold the manual to the app: every link and picture resolves and every picture is used; every `console` block parses with the console's parser and every `script` block with the script parser; hand-written pages stay in the subset and follow the project's writing rules; and each "Untried on hardware (HW-nn)" callout has a row in the ledger, which names the page.

### Hardware

A statement that rests on how real gear behaves carries a warning callout with an id. The ledger gives, for each id, the pages, the statement, the part of the test plan's section 10 that settles it, and what to change if the driver differs. Stage 12 walks the ledger.

## Consequences

- No new dependency, at run time or for development.
- The manual must stay inside the subset. A page that needs more needs the parser extended, with tests.
- About 26 pictures, 2 MB, are in the repo and in the release archive.
- A change to the UI, the console or the governor's rules now has a third place to update, after the code and the spec. `CLAUDE.md` says so, and the tests catch a console line or a generated table that no longer matches. They do not catch prose that has gone out of date.
- The pictures can only be regenerated on the reference laptop.
- Writing the manual found three things in the app: the `rate` unlock has no control that then sets the swing limit; the top bar's bus figure does not fall when the bus goes idle; and the Settings keys list was stale. The third is fixed here. The first two are recorded in `docs/STATUS.md` and stated in the manual where they matter.

## Tests

- U-manual: the parser's subset; the book's order, links, search and page names; the manual's own files as above.
- P-manual: the parser takes any text without throwing and gives plain data; plain prose keeps every word; a page of nothing but marks parses in good time.
- E-manual: the page opens from the rail, F1 and `manual`; a link, a picture, a table and a hardware mark show; "Put in console" fills the input and sends nothing; search and contents move between pages; panic works from the page.
- The bundle test holds the manual's text out of the entry and the later-pages chunk.
