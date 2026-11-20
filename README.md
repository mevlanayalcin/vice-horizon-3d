# vice-horizon-3d

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mevlanayalcin/vice-horizon-3d/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mevlanayalcin/vice-horizon-3d/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

SOLARIS BAY: an original open-world crime saga that runs in the browser from its own files. A procedural sun-soaked coastal city in pure WebGL2: twenty-three hand-written ES modules, no engine, no assets and no network request. Steal and drive any civilian car, run Elena and Mateo's five-job story, race and courier between jobs, outrun a five-star police response with a searchlight helicopter and roadblocks, tune your cars at the Safehouse Garage and climb five street ranks across six districts from the Palm Strip to Neon Midtown.

What you can do:

- **On foot and by car.** WASD to walk or drive, `E`/`F` to steal the nearest car, mouse to aim and fire four weapons, `Space` handbrake drift, `Shift` nitro, gold stunt ramps.
- **Heat.** Car theft, gunfire and hit-and-runs raise up to five stars. Patrol cruisers chase and ram, officers deploy on foot, a helicopter pins you in its searchlight from three stars, roadblocks close the boulevard at four. Break line of sight to cool off.
- **Story.** Five connected missions (`missions.js`), each with steps, dialogue, gang fights, cargo and a getaway.
- **Side activities** (`activities.js`). Ocean Boulevard Sprint and the Midtown Neon Circuit street races, the Coral Courier run, Sun Cab fares and the stunt-ramp hunt. Each starts from a cyan ring, runs against the clock and saves best times.
- **Progression** (`progression.js`). Respect earns five ranks from Beach Rat to Bay Kingpin. Cash buys four three-stage garage upgrades that tune every car you drive. Storing a stolen model in the Safehouse Garage adds it to the collection.
- **City menu** (`M`/`Tab`, `citymenu.js`). A full vector map with every blip, plus the story arc, activities, garage and career stats. `Esc` pauses, with three manual save slots and an autosave.
- **Street chaos.** Handbrake slides lay dark rubber and boil tyre smoke. Nitro lights blue-orange afterburner plumes. After dark, headlights throw soft light cones onto the road. Clip a kerbside fire hydrant and it shears off into a geyser.
- **The Solaris Vault Bank Plaza** in Neon Midtown has an Art Deco colonnade with gold capitals, a gold SOLARIS VAULT neon marquee over lit lobby glass, bollards, striped barricades and gold loot crates. Its guards wear plated vests and helmets. Gunfire draws a star-shaped muzzle flash that lights the ground, a short white-gold tracer streak and ejected brass casings.

Everything on screen is built in code. Hotels carry real neon lettering bent from a hand-drawn stroke font (`signage.js`): HOTEL MARISOL, SOL CLUB, CORAL PLAZA and AZUR GRAND marquees, stacked blade signs, named storefronts and billboards. Cars are sculpted lofts with raked glass, flared arches, turning rims and light bars. Sailboats and motor yachts sit at anchor in the bay. The renderer draws a planar reflection for wet asphalt and the bay, renders into a multisampled HDR target, then blooms, sweeps god rays from the sun and grades the frame (`postfx.js`). The HUD uses dark-glass corner clusters. The vector minimap (`minimap.js`) shows coastline, footprints, roads with lane dashes, a GPS route along the street grid, mission and activity pins, and pulsing police vision cones. Heat stars, cash, respect rank and weapon sit top-right, with district, radio and speedometer bottom-right. Built by @forge-kestrel for make.fun's “Make GTA 6” bounty.

The sky (`renderer3d.js`) layers a tropical sunset by the sun's height: a molten gold horizon climbing through coral, rose and violet to indigo. Long stratus bands are backlit plum near the sun with hot rims and lit pink away from it. Soft crepuscular rays fan out from the sun, and a far-shore skyline silhouette with lit windows stands across the bay. Haze glows gold toward the sun and cools to rose-violet away from it. The city map paints an organic coastline with shallow-to-deep contours, a scalloped Sunset Beach, Starlight Key with its marina slips, and dashed district zones. The map is cached offscreen, so the minimap costs one blit per frame.

The four screenshots are live 1280×720 frames of the game's own code in Chromium, staged with photo mode (`shotstage.js`, `?shot=start|chase|foot|menu`).

## Run it

```sh
node serve.ts
# then open http://localhost:8080

# or serve the folder with anything, e.g.
# python3 -m http.server 8080 --directory game
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
