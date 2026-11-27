---
title: Hardware
order: 9
---

# Hardware

The hardware path has never driven a real driver. It is built and tested against a stand-in for the hasseb. Everything on this page about real gear is marked.

## What is needed

|           |                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Interface | A hasseb USB DALI Master, plugged into the computer that runs the server                                                       |
| Drivers   | Two Skydance DA5-L: A at light type C2, address 0. B at light type C5, address 1. Addresses are set on the drivers' own panels |
| Server    | Python 3.11 or later, set up once as `server/README.md` says                                                                   |
| Browser   | Chrome or Brave, in a profile kept for this app                                                                                |

## Start

| Step | Do                                                                               |
| ---- | -------------------------------------------------------------------------------- |
| 1    | `pnpm build`, then `pnpm server`                                                 |
| 2    | Open the address it prints. It carries a token that works once                   |
| 3    | Choose Hardware, or Both                                                         |
| 4    | Answer whether you can see the lights from where you are                         |
| 5    | Wait for the scan and the safety profile: the top bar shows the drivers verified |

To reload the page, press Enter in the server's terminal for a fresh address. `pnpm server:demo` runs all of this with a fake hasseb and a fake bench.

> [!WARNING] Untried on hardware (HW-04)
> Whether the hasseb answers as python-dali expects, with the firmware this code was written against, is the first check of the first day. If it does not connect, the banner says "Hardware: no hasseb" or "Hardware: disconnected" with the reason.

## Three targets

| Target    | Frames go to                           | Replies come from                             | Use it for                           |
| --------- | -------------------------------------- | --------------------------------------------- | ------------------------------------ |
| Simulator | The simulated bench                    | The simulator                                 | Design, and anything risky, first    |
| Hardware  | The server and the hasseb              | The real drivers                              | Running the bench                    |
| Both      | The server, with a simulator following | The real drivers, compared with the simulator | Finding where the simulator is wrong |

On every change to Hardware or Both, and on every reconnect, the app forgets what it knew: every driver unverified, levels, colours and fades unknown, until the scan and the profile complete. Nothing learned from the simulator is applied to hardware.

In Both, each difference between what the simulator predicted and what the driver answered goes to the divergence log on the Bus monitor page.

> [!WARNING] Untried on hardware (HW-05)
> The simulator's DA5-L is built from documents. A driver in C5 is assumed to present five RGBWAF channels. If it presents colour temperature beside RGB, the app drives it as it reports, and the simulator's setting is changed to match.

## What keeps the lights safe if something stops

| If                                              | Then                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The page is closed or reloaded                  | The server sends TERMINATE and OFF                                                                                                                                                        |
| The connection falls silent for 3 seconds       | The same, and the connection closes. A page that is stuck but still connected is not silent: close its tab                                                                                |
| The server is stopped, with Ctrl-C              | The same                                                                                                                                                                                  |
| The connection drops                            | The app shows "Hardware: disconnected", stops running work, and sends nothing to the simulator in its place                                                                               |
| The bus loses power, or the hasseb is unplugged | Nothing can be sent. Each driver goes to its stored SYSTEM FAILURE LEVEL, which the profile sets to "no change", so a lit tape stays lit. The drivers' mains supply is then the only stop |

Keep two things within reach of the bench: the server's terminal, where Ctrl-C turns the lights off, and the drivers' mains supply, which needs no software.

> [!WARNING] Untried on hardware (HW-06)
> The server's OFF on silence and on exit has been tested against the fake hasseb. What the DA5-L does when the bus loses power, and when it returns, is not known.

## The holding rules

Until real gear has been tried, Hardware and Both hold to stricter rules than the simulator. [Safety](safety.md#on-hardware) lists them, and `help hardware` prints them.

Two things follow that the rules do not say outright.

|                            |                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ceiling on colour gear | On Hardware and Both the app does not know which colour a driver holds, so the ceiling counts every channel as full. Tape B has five, so its level is held to about a fifth of the ceiling: arc 161, about 8%, at the default. The reply says "Level lowered so the colour mix stays under the ceiling" |
| `first-light`              | Does not run on hardware yet. Its level to both tapes at once, and its levels before a colour, are refused. [The guide](../guide/14-hardware.md#a-first-few-lines) has the same checks by hand                                                                                                          |

## The hardware check

The Devices page has a "Hardware check" section: parts 2 to 4 of the first day's plan (read both drivers, the transport, the safety profile), each step run or recorded, with "Show results" and "Save as a file". Parts 1 and 5 to 8 are worked from `docs/TEST_PLAN.md` section 10, which is the whole plan. On the simulator the steps run against the simulated bench.

## Remote use

Run the server on the bench computer and forward the port from the other one:

```bash
ssh -L 127.0.0.1:47821:127.0.0.1:47821 bench
```

The server listens on 127.0.0.1 only, and has no option to listen anywhere else. If you cannot see the lights from where you are, say so when the app asks: the `rate` unlock then stays off for the session.
