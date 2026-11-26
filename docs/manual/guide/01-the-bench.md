---
title: The bench and the app
order: 1
---

# The bench and the app

## What is on the bench

Two LED tapes, each on its own DALI driver, and one interface between the computer and the DALI bus.

| Part      | What it is                                                                | Address |
| --------- | ------------------------------------------------------------------------- | ------- |
| Tape A    | Tunable white: warm to cool                                               | 0       |
| Tape B    | RGB with two whites (RGB + CCT)                                           | 1       |
| Drivers   | Two Skydance DA5-L, one for each tape. A is set to light type C2, B to C5 |         |
| Interface | A hasseb USB DALI Master                                                  |         |

DALI is the bus the drivers listen on. A command is a short frame: an address and an instruction, such as "address 0, go to this level". The drivers keep their own settings (their brightest level, their fade time, their scenes), which is why much of what the app does is write a setting and read it back.

## What the app is for

Working out what the lighting should do before it is wired into a house, and checking that the drivers do it. That means trying levels and colours, shaping fades, building scenes and sequences, seeing roughly how the light would fall in a hallway, and then running the same things on the real tapes.

## Simulator, hardware, or both

The app can send to three places, chosen in the top bar.

| Target    | What answers                                                | Use it for                                     |
| --------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Simulator | A model of the two drivers, built from their documents      | Everything, first. It needs nothing plugged in |
| Hardware  | The real drivers, through a small server on this computer   | Running the bench                              |
| Both      | The real drivers, with the simulator following and compared | Finding where the model is wrong               |

Most of this guide uses the simulator. It behaves as the documents say a DA5-L behaves, and where the documents do not say, it has a setting with a stated default. [The last chapter](14-hardware.md) covers what changes with real gear.

> [!NOTE] The simulator is honest about being a model
> The bench preview and the visualiser are labelled "estimated". Tape brightness and colour are placeholders until the tapes are measured.

## Everything goes through one gate

Whatever you use (a slider, the console, a script, a switch plate), the command passes through one safety governor before it reaches a driver, simulated or real. It limits brightness, limits how fast light can change, and can stop everything at once. [The next chapter](02-ceiling-and-panic.md) puts its two main controls in your hands.

## Finding your way round

| Part      | Where          | For                                                |
| --------- | -------------- | -------------------------------------------------- |
| Top bar   | Top            | The target, the ceiling, Panic                     |
| Rail      | Left           | The pages. Alt with a digit goes to one            |
| Inspector | Right          | The stored values of the driver you are looking at |
| Console   | Bottom, Ctrl ` | Typing commands                                    |
| Manual    | F1             | This                                               |

Open the app, wait for the top bar to say "2/2 verified", and go on.
