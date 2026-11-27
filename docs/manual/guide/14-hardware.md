---
title: The first session on hardware
order: 14
---

# The first session on hardware

Everything in this guide so far ran on the simulator. This chapter is about the day the real tapes are on the bench. It is written before that day has happened, so read it as a plan, and expect to correct it.

> [!WARNING] Untried on hardware (HW-04)
> No hasseb has been connected to this app, and it has never driven a real driver. The steps below are what the code does against a stand-in.

## Before any light

| Check                                                                 | Why                                                                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Driver A is at light type C2, address 0. Driver B is at C5, address 1 | The app drives each as it reports, but this manual and the simulator assume them this way                                           |
| The server's terminal is within reach of the bench                    | Ctrl-C there turns the lights off, whatever the browser is doing                                                                    |
| The room can take a tape at full for a moment                         | The drivers hold their own settings from before, and the app has not yet written its ceiling to them                                |
| You can reach the drivers' mains supply                               | It is the one stop that needs no software. If the bus loses power, a lit tape stays lit and nothing on the computer can change that |

## Start

1. `pnpm build`, then `pnpm server`. It prints an address.
2. Open the address. Choose Hardware.
3. The app asks whether you can see the lights. Answer truthfully: if you cannot, the app stays stricter for the session.
4. Wait. The app scans the bus, then writes its safety profile to each driver and reads it back. The top bar counts the drivers as they verify.

`pnpm server:demo` does all of this with a fake hasseb and a fake bench. Run it once beforehand to see the steps with nothing at stake.

## It will feel different

On the simulator the app knows how the driver behaves, because it wrote the driver. On hardware it knows only what the documents say, and a wrong guess about a fade or a colour could let through a change the rate guard exists to stop. So on Hardware and Both the governor assumes nothing, and holds to stricter rules until each has been checked.

| On the simulator                            | On hardware, for now                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changes as fast as the guard's usual limits | About one change of light every 2 seconds to a tape                                                                                                                       |
| Levels and colours fade                     | No fades on colour, or on a level to a colour driver                                                                                                                      |
| Groups and "all" work                       | A change of light goes to one tape at a time. `off all` still works                                                                                                       |
| A level can come first                      | A colour driver takes its colour before its level                                                                                                                         |
| Dim up and dim down                         | Refused on a colour driver                                                                                                                                                |
| The ceiling counts the colour in use        | The ceiling counts a colour driver as if every channel were full. On tape B, with five channels, a level is held to about a fifth of the ceiling: about 8% at the default |

Both DA5-L drivers are colour drivers, so all of these apply to both tapes.

> [!WARNING] Untried on hardware (HW-03)
> Each of these rules stands until the behaviour behind it is seen on the bench. Some will be relaxed that day. Some may stay.

## A first few lines

```console
tc 0 2700K 20%
level 0 30%
tc 0 4000K
off 0
```

Colour and level together first, then changes one at a time, with the fade at "No fade". If a line is held, the console says it is waiting and for how long. If one is refused, the refusal names the rule, and `help hardware` lists them all.

A level on tape B will land lower than you asked, with the reply "Level lowered so the colour mix stays under the ceiling". That is the last row of the table above, not a fault.

`first-light` does not run on hardware yet. Its first step is a level to both tapes at once, and its later levels come before a colour, and the holding rules refuse both. Walk the same checks by hand, one tape at a time:

```console
tc 0 2700K 20%
tc 0 6500K
off 0
rgb 1 254 0 0
level 1 20%
off 1
```

## Both, and the divergence log

Choose Both and the simulator follows every frame and predicts each answer. Where the real driver answers differently, the difference goes to the divergence log on the Bus monitor page.

A divergence is not a fault. It is the simulator being wrong about something, which is the most useful thing the first day can find. Each one points at a setting under "Simulator settings" on the Devices page: change the setting to what the driver did, and the simulator is right from then on.

> [!WARNING] Untried on hardware (HW-05)
> The simulator's DA5-L comes from documents, not from a driver. Expect divergences, in fades and in how the C5 driver presents its two whites above all.

## The hardware check

The Devices page has a "Hardware check" section. It holds three parts of the first day's plan: reading both drivers, the transport, and the safety profile. Each step is run or recorded there, and "Show results", then "Save as a file", keeps the record. The other parts of the plan (the hasseb before the bench is wired, behaviour, light, Both, and what the rate guard rests on) are worked from `docs/TEST_PLAN.md` section 10. On the simulator the same steps run against the simulated bench, which is a way to rehearse them.

## If something goes wrong

| It happens                | Do                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light you did not expect  | Escape twice. Or Ctrl-C in the server's terminal                                                                                                                                 |
| "Hardware: disconnected"  | Reconnect in the banner. The app has forgotten what it knew and will scan again                                                                                                  |
| A driver will not verify  | The Devices page shows the value expected and the value read. `profile apply` writes it again                                                                                    |
| The page is slow or stuck | Close the tab, or Ctrl-C in the server's terminal. The server turns the lights off when the connection goes. A page that is stuck but still connected does not do that by itself |

> [!WARNING] Untried on hardware (HW-01)
> Panic's OFF is meant to reach the bus within 100 ms. That has been measured against a stand-in for the hasseb only, so on the first day keep the server's terminal in reach as well.

## Afterwards

The first day ends with facts where there were assumptions. The simulator's settings are corrected, the holding rules are relaxed where the bench earned it, and this manual is corrected from [the hardware ledger](../hardware-ledger.md), which lists every statement in it that was written without a driver to check it against.

## What to keep from this chapter

- Keep the server's terminal within reach.
- On hardware, for now: one tape at a time, colour before level, no fades on these drivers, about 2 seconds between changes, and a low ceiling on tape B.
- A divergence in Both is the simulator learning something.
