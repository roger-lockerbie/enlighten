# Open questions

What Stage 2 could not decide alone. Each has a recommendation, and the design works with the recommendation until someone says otherwise. Answers go in `docs/research/SUMMARY.md` or a new ADR, and the question is then removed from this list.

## For the owner

1. **Remote sessions and a room the operator cannot see.** The server cannot tell an SSH-forwarded client from a local one. The design asks once on connect, "Can you see the lights?", and shows the answer in the top bar. Should a "no" do more: for example, hold the rate guard at one swing a second with no unlock, or need someone at the bench to press a key in the server's terminal? Recommendation: on "no", refuse the `rate` unlock for that session, and nothing more.

2. **The visualiser's default white balance.** "Adapted to the scene" shows a 2700 K hallway as white, the way eyes adapt. "Daylight" shows it orange, the way a camera does. Recommendation: adapted, with the scene's colour temperature always shown in the probe. The A/B view uses one balance for both sides in either case.

3. **Fonts.** Inter for the interface and JetBrains Mono for the console, both under the SIL Open Font License and stored in the repo. Say if you prefer system fonts only, which would mean no font files at all.

4. **Panic's shortcut.** Escape pressed twice within 500 ms. It is the only candidate that no browser or system reserves. The cost is that a fast double Escape to close two things turns the lights off. Recommendation: keep it, and tune the window on the bench.

5. **The edits to Stages 3, 4, 5 and 12 in `docs/STAGES.md`.** They are one commit in this stage's PR. Read that diff, and revert the commit if the plan should stay as it was.

6. **The licence,** when the repository goes public in Stage 11. Apache-2.0 is still the suggestion. The server uses python-dali (LGPL-3.0) as an installed dependency and contains none of its code, which Apache-2.0 allows.

## For the client

7. **Which browser will you use?** The simulator runs in Chrome, Firefox and Safari, and hardware works in any of them through the server. The console loses three keys (Ctrl-W, Ctrl-N, Ctrl-T) in a normal Chrome tab on Windows and Linux. It matters for what gets tested by hand at each stage.

8. **Which switch brands will the house use?** The app emulates zencontrol as the DALI-2 plates, with Basalte and Gira as examples of KNX plates through a gateway. If a different brand is planned, Stage 10 researches that one.

9. **Will you run the bench from another room or site?** If remote use is rare, question 1 matters less.

## Waiting on hardware

These are not questions for a person. Each is a step in the hardware-day checklist (`docs/TEST_PLAN.md` section 10), listed here so nobody mistakes a default for a fact.

- How the DA5-L presents colour in C2 and C5, and which RGBWAF channel is which white.
- Its physical minimum. If it is arc level 85, the dimmest light is about 1%, and whether that is dim enough for night lighting is yours to judge on the bench.
- Whether POWER ON LEVEL 0 holds through a power cycle, and how a power-on colour is stored. The safety profile depends on both.
- Whether lowering MAX LEVEL pulls the output down by itself.
- How it fades up from off, whether colour changes follow the fade time, and what a new command does to a running fade.
- The colour temperature mixing law, and how RGBWAF channel levels scale under the arc level. The ceiling's treatment of colour depends on both.
- The hasseb's firmware version, real throughput, send-twice gap, and its HID report descriptor.
- Whether worker timers keep time in a hidden tab well enough for S5. Stage 9's test settles this one, not the bench.
