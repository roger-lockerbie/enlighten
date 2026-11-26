---
title: Hardware ledger
order: 1
---

# Hardware ledger

Every statement in this manual that rests on how real gear behaves, which has not been tried. Each is marked in its page with "Untried on hardware" and its number. After the first day with hardware, walk this table: correct the pages where the driver differed, remove the marks that were confirmed, and take each row out or rewrite it.

`docs/TEST_PLAN.md` section 10 is the checklist for that day. A test keeps the numbers here and in the pages the same.

| Id    | Pages                                                                                 | The statement                                                                                         | Settled by (test plan, section 10)           | If the driver differs                                                      |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| HW-01 | [Safety](reference/safety.md), [The ceiling and panic](guide/02-ceiling-and-panic.md) | Panic's OFF is on the bus within 100 ms when the bus is idle                                          | Part 3: panic timing on the hasseb           | State the measured time, and say what to keep within reach if it is longer |
| HW-02 | [Safety](reference/safety.md)                                                         | POWER ON LEVEL 0 keeps the tape off at power-up, and the stored warm colour is the one it starts with | Part 4: power-cycle with the profile written | Rewrite the profile table, and say what the tape does at power-up          |
| HW-03 | [Safety](reference/safety.md)                                                         | The holding rules of ADR 0019 and ADR 0022 are in force                                               | Part 8: what the rate guard rests on         | Remove each rule that is relaxed from the table, with its ADR              |
