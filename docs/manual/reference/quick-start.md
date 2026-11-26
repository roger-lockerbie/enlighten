---
title: Quick start
order: 1
---

# Quick start

## Run it

| To                                     | Do                               | Then open                                                     |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| Use the simulator                      | `pnpm start`                     | `http://127.0.0.1:47821`                                      |
| Use the hasseb                         | `pnpm build`, then `pnpm server` | The address the server prints, which carries a one-time token |
| Try the hardware path with no hardware | `pnpm server:demo`               | The address it prints                                         |

Node 26.13.1 and pnpm 12.18.0 for all three. Python 3.11 or later for the server, set up once as `server/README.md` says. Chrome or Brave. Use a browser profile kept for this app.

## The window

| Part      | Where          | Holds                                                                                                |
| --------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| Top bar   | Top            | Target, connection, ceiling, verified drivers, bus use, unlocks, Panic                               |
| Rail      | Left           | The ten pages, Alt 1 to Alt 0, and the manual, F1                                                    |
| Main      | Centre         | The page                                                                                             |
| Inspector | Right          | A driver's stored values, or a mount's settings on the Visualiser. Hide it to give the page the room |
| Console   | Bottom, Ctrl ` | A command line for everything, with history                                                          |

## Five things to know first

|         |                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Panic   | The red button, or Escape twice. Stops everything, every light off. Resume to go on                                |
| Ceiling | 40% at the start. Lower it freely. Raising asks you to confirm                                                     |
| Target  | Simulator, Hardware or Both. Hardware and Both need the page to come from the server                               |
| Console | `help` lists commands. `help <name>` explains one. `explain <line>` shows what a line would send                   |
| Saving  | Looks, sequences, effects, scripts, plates and set-ups are kept in this browser. Settings exports them as one file |

## First minute in the simulator

```console
devices
level 0 30%
tc 0 2700K
rgb 1 200 60 0
off all
```

The two simulated drivers match the bench: address 0 is a tunable white tape (warm to cool), address 1 is an RGB tape with two whites. The Playground shows both, and the bench preview at its foot draws what the tapes are doing.

## Where next

- New to the app: [the guide](../guide/01-the-bench.md), in order.
- Looking something up: [Pages](pages.md), [Console](console.md), [Keys](../generated/keys.md).
- About to use real gear: [Hardware](hardware.md).
