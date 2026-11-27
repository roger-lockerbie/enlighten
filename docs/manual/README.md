---
title: Contents
order: 0
---

# Enlighten manual

Enlighten designs and tests DALI lighting on a two-tape bench. It drives a simulator of the bench's driver (a Skydance DA5-L), the real tapes through a hasseb USB DALI Master, or both at once. Every command to either goes through one safety governor.

This manual is for version 0.3.0. It has a guide and a reference, written from the same facts, and tables built from the app's own data.

| Half      | What it is                                                                   | Read it when                               |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| Guide     | Chapters in order, each one a capability and the reason for it               | You are new to the app, or to a part of it |
| Reference | One dense page per area, tables first                                        | You know what you want and need the detail |
| Tables    | Keys, console commands and every DALI command, built from the app's own data | You need to look one thing up              |

## Guide

Read in order. Each chapter ends with what to keep from it.

1. [The bench and the app](guide/01-the-bench.md)
2. [The ceiling and panic](guide/02-ceiling-and-panic.md)
3. [Drivers, real and simulated](guide/03-simulated-drivers.md)
4. [Levels and colour](guide/04-levels-and-colour.md)
5. [Fades](guide/05-fades.md)
6. [Looks](guide/06-looks.md)
7. [Sequences](guide/07-sequences.md)
8. [Effects](guide/08-effects.md)
9. [Switches](guide/09-switches.md)
10. [The visualiser](guide/10-visualiser.md)
11. [The console](guide/11-console.md)
12. [Scripts](guide/12-scripts.md)
13. [Saving and moving work](guide/13-saving-work.md)
14. [The first session on hardware](guide/14-hardware.md)

## Reference

| Page                                                | For                                                        |
| --------------------------------------------------- | ---------------------------------------------------------- |
| [Quick start](reference/quick-start.md)             | Running it, and the first minute                           |
| [Safety](reference/safety.md)                       | Panic, the rate guard, verified gear, the ceiling, unlocks |
| [Pages](reference/pages.md)                         | Every page and its controls                                |
| [Console](reference/console.md)                     | Syntax, addresses, values, replies, editing                |
| [Scripts](reference/scripts.md)                     | The format, its limits, running                            |
| [Looks, sequences and effects](reference/design.md) | Fields, states, every effect's settings                    |
| [Switches](reference/switches.md)                   | Events, timers, mapping                                    |
| [Visualiser](reference/visualiser.md)               | Camera, view, mounts, hallway                              |
| [Hardware](reference/hardware.md)                   | The server, the three targets, the holding rules           |
| [Files and storage](reference/files.md)             | The workspace file, imports, exports                       |
| [Refusals and messages](reference/messages.md)      | What the app says, and what to do                          |

## Tables

- [Keys](generated/keys.md)
- [Console commands](generated/console-commands.md)
- [DALI commands](generated/dali-commands.md)

## In the app and outside it

The manual opens inside the app with F1, the Manual entry at the foot of the page list, or `manual` in the console. `manual <page>` goes straight to a page, by its file name or part of its title. A console line shown in a box has a "Put in console" button, which copies it to the console's input and does not send it.

The same files are in the repository under `docs/manual/`, as plain Markdown. They read as they are on GitHub, and the folder opens as an Obsidian vault.

## What has not been tried

The hardware path has never driven a real driver. A statement that rests on how real gear behaves is marked "Untried on hardware" with a number, and [the hardware ledger](hardware-ledger.md) lists every one.
