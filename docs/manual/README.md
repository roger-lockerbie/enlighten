---
title: Contents
order: 0
---

# Enlighten manual

Enlighten designs and tests DALI lighting on a two-tape bench. It drives a simulator of the bench's driver (a Skydance DA5-L), the real tapes through a hasseb USB DALI Master, or both at once. Every command to either goes through one safety governor.

This manual is for version 0.2.0 and later. It has two halves, written from the same facts.

| Half      | What it is                                                                   | Read it when                               |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| Guide     | Chapters in order, each one a capability and the reason for it               | You are new to the app, or to a part of it |
| Reference | One dense page per area, tables first                                        | You know what you want and need the detail |
| Tables    | Keys, console commands and every DALI command, built from the app's own data | You need to look one thing up              |

## Guide

1. [The ceiling and panic](guide/02-ceiling-and-panic.md)

## Reference

- [Safety](reference/safety.md)

## Tables

- [Keys](generated/keys.md)
- [Console commands](generated/console-commands.md)
- [DALI commands](generated/dali-commands.md)

## In the app and outside it

The manual opens inside the app with F1, the Manual entry at the foot of the page list, or `manual` in the console. `manual <page>` goes straight to a page, by its file name or part of its title. A console line shown in a box has a "Put in console" button, which copies it to the console's input and does not send it.

The same files are in the repository under `docs/manual/`, as plain Markdown. They read as they are on GitHub, and the folder opens as an Obsidian vault.

## What has not been tried

The hardware path has never driven a real driver. A statement that rests on how real gear behaves is marked "Untried on hardware" with a number, and [the hardware ledger](hardware-ledger.md) lists every one.
