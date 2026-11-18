# Golf Swing Beat

A golf swing tempo trainer that runs in your browser. A moving light and count sounds mark three timings: takeaway, top, and impact.

**Live:** <https://wasabeef.github.io/golf-swing-beat/>

## Features

- BPM from 20 to 120
- Backswing-to-downswing ratio: 1:1, 2:1, or 3:1
- Two sounds, volume control, and a left-handed layout (in the gear menu)
- Built for phones in landscape. Installable from the browser menu (iPhone: Share → Add to Home Screen) and works offline
- Sound and light stay in sync, including audio output latency
- No runtime dependencies (TypeScript, Web Audio API, Canvas)

## How to use

1. Put your phone in landscape, outside your swing path. Line up the club head with the vertical light (the start line).
2. Press START. Lights move in from both edges. Start your takeaway on the first sound, when they meet.
3. The second sound is the top, and the third (higher) sound is impact.

| Action | Button | Key |
|---|---|---|
| Start / stop | START / STOP | Space |
| Change BPM (hold to repeat) | BPM − / + | ↑ ↓ |
| Change ratio (applies from the next swing) | RATIO 1:1 / 2:1 / 3:1 | R |
| Change sound | Gear → SOUND | S |
| Volume | Gear → VOL | — |
| Left-handed | Gear → HAND | — |
| Full screen (supported browsers only) | Gear → SCREEN | — |

Settings are saved in your browser.

## BPM and ratio

BPM is the speed of the backswing (takeaway to top). The ratio sets how long the downswing (top to impact) is: 1/ratio of the backswing.

| Shot | Ratio | Notes |
|---|---|---|
| Driver to irons | 3:1 | Tour players swing at about 3:1, with a backswing of 0.7–0.8 s. BPM 80 gives a 0.75 s backswing and a 0.25 s downswing. |
| Chips and putts | 2:1 | Keep the stroke time the same for every length. About 0.6 s back and 0.3 s through (around BPM 100). |
| Counting rhythm | 1:1 | Three evenly spaced sounds. |

There is no single "correct" BPM for each club. Use these as a starting point and find what feels natural.

Sources:

- [Towards a Biomechanical Understanding of Tempo in the Golf Swing (arXiv)](https://arxiv.org/abs/physics/0611291)
- [Find a rhythm and tempo that fits your game (PGA.com)](https://pga.com/story/find-a-rhythm-and-tempo-that-fits-your-game)
- [Practice line, path and tempo to avoid pesky 3 putts (PGA.com)](https://pga.com/story/practice-line-path-and-tempo-to-avoid-pesky-3-putts)
- [What Is Golf Swing Tempo Ratio (Blast Motion)](https://blastmotion.com/blog/what-is-golf-swing-tempo-ratio/)

## License

[MIT](LICENSE)
