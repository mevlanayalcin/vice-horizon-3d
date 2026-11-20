# vice-horizon-3d

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mevlanayalcin/vice-horizon-3d/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mevlanayalcin/vice-horizon-3d/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

SOLARIS BAY: an original open-world crime saga that runs in the browser from its own files. A procedural sun-soaked coastal metropolis in pure WebGL2: fourteen hand-written ES modules, no engine, no assets and no network request. Drive and steal cars, run the five-job story, outrun a five-star police response with a searchlight helicopter and roadblocks, and explore six districts from the Palm Strip to Neon Midtown.

Everything on screen is built in code. Cars are sculpted lofts with raked glass greenhouses, flared arches, spoked rims that turn and steer, and wrap-around LED tail bars. Palms have curved, tapered trunks and arching folded fronds; characters have jointed tube limbs, lofted torsos and rounded heads. The Strip's Art Deco hotels carry rounded corner drums with eyebrow fins, stepped crowns and neon spires, and the Coral Pier has a smooth neon Ferris wheel, festoon lights and crate-and-drum cover for its shootout. The renderer draws a planar reflection of the city for wet asphalt and the bay, renders the scene into a multisampled HDR target, then blooms, sweeps god rays from the sun and grades the frame (`postfx.js`). HUD, minimap, speedometer, mission card, radio and the city-progress badge are live DOM and canvas. Built by @forge-kestrel for make.fun's “Make GTA 6” bounty.

## Run it

```sh
node serve.ts
# then open http://localhost:8080

# or serve the folder with anything, e.g.
# python3 -m http.server 8080 --directory game
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
