"""The fake bench's quirks, which the e2e tests use to make the fake differ from the simulator."""

from server import fake


def test_max_level_quirk_ignores_set_max_level_on_the_rgbwaf_driver_only() -> None:
    a, b = fake.bench("max-level")
    for g in (a, b):
        g.dtr[0] = 150
        g.handle("general.SetMaxLevel", (g.short or 0) << 1 | 1, 0x2A)
    assert a.max_level == 150
    assert b.max_level == 254
    assert b.handle("general.QueryMaxLevel", 3, 0xA1) == 254


def test_the_quirk_survives_a_reset() -> None:
    _, b = fake.bench("max-level")
    b.handle("general.Reset", 3, 0x20)
    b.dtr[0] = 150
    b.handle("general.SetMaxLevel", 3, 0x2A)
    assert b.max_level == 254


def test_the_quirk_is_offered_on_the_command_line() -> None:
    assert "max-level" in fake.QUIRKS
