# Playtesting Washed Away

A guide for a real playtest of bed wars with 4 to 8 people, so the match's
balance is checked by people and not just by scripts. Allow about an hour:
ten minutes to set up, three or four matches, and ten minutes to talk.

## Before

- **Hosting.** On Render's free plan the server sleeps when nobody has used
  it for 15 minutes, and the first visit then takes about a minute. Open
  <https://washed-away.onrender.com/?mp> yourself five minutes before, and
  keep that tab open. On one network you can also host it yourself with
  `npm run lan` (see the README).
- **Players.** 4 to 8 people, each on their own computer with a mouse.
  Two per team is ideal; with 4 people, play 2 against 2 first, then four
  teams of one.
- **Record.** One person (or a spectator: **Watch instead** in the lobby)
  records the screen, for the gameplay video and to look back at fights.
  Windows: `Win + Alt + R` (Xbox Game Bar).
- **Explain only this much:** the build phase lasts 4 minutes behind the
  barriers; your bed is your life (while it stands you come back); the
  typhoon raises the sea, and 12 minutes in the flood comes and climbs
  faster and faster. Let them find out the rest: whether they can is part
  of the test.

## During

Watch, and write down the time when any of these happens:

| Watch for | Why it matters |
| --- | --- |
| Anyone stuck, lost or asking "what do I do now?" | Onboarding: the tutorial and messages should answer it |
| Where people put their beds (the kubo, low ground, somewhere odd) | Whether the flood threat is understood |
| The first fight: who wins, and with what (spear, axe, pickaxe) | Weapon balance |
| How long a bed takes to break, and with what | Bed health (200) and damage |
| Doors: do attackers break them, or go round? | The 5% a hit build damage |
| Berries eaten in a fight | Whether healing (20) matters |
| When the first team is out, and when the match ends | Pacing: aim for 12 to 18 minutes |
| Lag: players jumping about, hits that didn't count | The server and the network |
| Anything that looks broken | Bugs |

Don't help unless someone is truly stuck for a minute or more; note it
if you do.

## After each match

Ask everyone, quickly, and write down the answers:

1. Who won, and why do you think they won?
2. What was the most fun moment? The most frustrating one?
3. Was anything unfair or too strong? (A weapon, a place, the flood.)
4. Did you understand what the climate and the flood were doing?
5. Out of 10, would you play again?

## After the session

- Count: matches played, how long each took, how each was won (beds broken
  or the flood), and the average "play again" score.
- Note the three things most people mentioned. Those are what to fix first.
- Keep the recordings: the best minutes make the gameplay video.

## What the scripted test already covers

Before real people play, the game was run with two full game windows and six
scripted players (8 in all, two a team) on the quick test server: the lobby,
starting, the build phase and barriers, the storm and surge, the flood,
beds washed away, players going out, and the end of the match; trees felled in
one game falling in the others; and the time of day (and so the tide) matching
across games. What scripts can't tell you is whether it's fair and fun. That's
what this playtest is for.
