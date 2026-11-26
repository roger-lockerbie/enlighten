---
title: Refusals and messages
order: 11
---

# Refusals and messages

What the app says when it turns something away, and what to do. The exact words vary with the address and the value: look for the phrase.

## From the governor

| It says                                                 | Means                                                                        | Do                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `clamped to the ceiling`                                | The level was sent, as the ceiling                                           | Nothing, or raise the ceiling                           |
| `Rate guard:` and a rule                                | The change would be too fast or too soon                                     | Wait. The console waits for you, up to 10 seconds       |
| `is not verified`                                       | The driver's safety profile has not read back                                | `profile` to see why, `profile apply` to write it again |
| `Panic is latched`                                      | Panic is on                                                                  | Resume, or `resume`                                     |
| `needs the reset unlock`, `needs the expert unlock`     | The command is behind an unlock                                              | `unlock reset` or `unlock expert`, if you mean it       |
| `accepted only from a person`                           | A script, sequence, effect or switch tried a command a person must send      | Type it                                                 |
| `reads DTR0, which is unknown`                          | The command uses a register the app cannot vouch for                         | Set it first: `dtr0 <value>`                            |
| `the value is above the ceiling`                        | A stored level (MAX, MIN, a scene, power-on) would be above the ceiling      | Lower the value, or raise the ceiling first             |
| `refused always`                                        | The command is never sent: identify, memory writes, calibration and the like | Nothing. It is blocked on purpose                       |
| `the gear does not report Tc`, `does not report RGBWAF` | A colour command the driver cannot take                                      | Use the other colour command. `devices` shows which     |
| `The inventory is stale`                                | A group or broadcast was used after addresses or groups changed              | `scan`                                                  |

## On Hardware and Both

| It says                                                                       | Means                                                       | Do                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `may hold a colour that is not activated, so set its colour before its level` | Colour gear takes its colour first                          | `tc` or `rgb`, then the level                        |
| `only in one step`, `set its fade time to 0 first`                            | A level or colour to colour gear may not fade               | `fade <addr> 0s`, and let it read back               |
| `its fade settings have not all been read back`                               | A read-back was lost                                        | `scan`, or `fade <addr>` to read them                |
| `more than one hard step in 2 s`                                              | One change of light every 2 seconds to an address           | Wait                                                 |
| `fast fade time is not 0`                                                     | The driver has a fast fade set, which this app never writes | A RESET, or another tool                             |
| `Hardware: disconnected`, `Hardware: no hasseb`                               | The server or the hasseb is not there                       | Reconnect in the banner. Check the server's terminal |

> [!WARNING] Untried on hardware (HW-03)
> These refusals come from the holding rules, which stand until real gear has been tried.

## From the console

| It says                                                    | Means                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Unknown command`                                          | Not a command of either kind. `help -k <word>` to find one                                                                   |
| `names commands for more than one device type`             | Put `dt6-` or `dt8-` in front                                                                                                |
| `needs an address`                                         | Give one, or set a default with `use`                                                                                        |
| `A script is running`, `A line is still running`           | Ctrl-C stops it                                                                                                              |
| `cannot be used in a script`                               | The command is for a person at the console                                                                                   |
| `explain covers commands that send DALI frames themselves` | `explain` does not list what `scan`, `cap`, `panic` and the like send                                                        |
| `no reply`                                                 | No driver answered. The address may be empty                                                                                 |
| `framing error`                                            | More than one driver answered at once: a query to a group or to all                                                          |
| `fault:`                                                   | The transport failed. The frame may or may not have reached the bus, so the app treats what it could have changed as unknown |

## From the planner

| It says                                 | Means                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `The governor would refuse` and a rule  | Check or Run found a change the governor would not send. Nothing ran                        |
| `is off. Set a level first`             | An effect moves around the level a light is at                                              |
| `Panic is on. Resume first.`            |                                                                                             |
| `Stopped: Stopped by a person.`         | Stop was chosen                                                                             |
| A time by the wall clock, in the report | The run's own clock and the wall clock differ by more than a second: the page was suspended |

## From the Devices page

| It says                          | Means                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| mismatch, with expected and read | A value of the safety profile read back differently. The driver stays unverified |
| not yet confirmed on hardware    | A line of the profile rests on behaviour the DA5-L has not been seen to have     |
