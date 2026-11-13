# Open questions

What Stage 2 could not decide alone. Each has a recommendation, and the design works with the recommendation until someone says otherwise. Answers go in `docs/research/SUMMARY.md` or a new ADR, and the question is then removed from this list.

## For the owner and the client

None open. The owner answered every question from Stage 2 on 14 November 2026, and the answers are decisions 10 to 19 in `docs/research/SUMMARY.md`.

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
