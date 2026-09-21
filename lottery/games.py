"""Game definitions. Only draws in the current format are analysed together,
because a format change (different pool or numbers per draw) changes every
probability."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Game:
    key: str
    name: str
    pool: int            # main numbers are 1..pool
    main: int            # main numbers per draw
    supp: int            # supplementaries / bonus numbers, drawn from the same machine
    supp_label: str
    pb_pool: int = 0     # separate Powerball barrel (0 = none)
    format_start: str = ""  # first draw date of the current format


GAMES = {
    "tattslotto": Game("tattslotto", "Saturday TattsLotto", 45, 6, 2, "supplementaries",
                       format_start="1985-01-01"),
    "powerball": Game("powerball", "Powerball", 35, 7, 0, "", pb_pool=20,
                      format_start="2018-04-19"),
    "setforlife": Game("setforlife", "Set for Life", 44, 7, 2, "bonus numbers",
                       format_start="2020-03-23"),
}
