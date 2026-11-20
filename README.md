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
- **Progression** (`progression.js`). Respect earns five ranks from Beach Rat to Bay Kingpin. Each promotion pays a cash milestone ($2,000 up to $25,000) and unlocks Paint Shop colours and neon underglow kits. Cash buys four three-stage garage upgrades that tune every car you drive. Storing a stolen model in the Safehouse Garage adds it to the collection.
- **Paint Shop and underglow.** The `GARAGE` tab of the city menu has a live paint selector (seven colours) and a neon underglow selector (five kits plus off). A choice restyles the car you are driving at once and goes into the `localStorage` autosave. Higher-rank colours stay locked until you reach that rank.
- **Streaks and medals.** Back-to-back activity clears without a failure raise a cash and respect multiplier, x1.25 per clear up to x2. Every best time earns a gold, silver or bronze medal against the activity's par. The menu and the activity timer show the streak, medals and personal bests.
- **City menu** (`M`/`Tab`, `citymenu.js`). A full vector map with every blip, plus the story arc, activities, garage and career stats with the rank ladder's rewards. `Esc` pauses, with three manual save slots and an autosave.
- **Street chaos.** Handbrake slides lay dark rubber and boil tyre smoke. Nitro lights blue-orange afterburner plumes. After dark, headlights throw soft light cones onto the road. Clip a kerbside fire hydrant and it shears off into a geyser. Clip a street lamp at speed and it shears off in a burst of sparks, topples, goes dark and clangs onto the road.
- **A city that reacts.** Close to gunfire some bystanders crouch with their hands over their heads while the rest run with their arms up. A three-star chase scatters the pavements as it passes. Traffic slows and pulls toward the kerb when a cruiser with its siren on comes within about 45 m.
- **Radio and sound** (`audio.js`, all Web Audio, nothing downloaded). `R` cycles Sunset FM 96.6 (warm synthwave arpeggios over kick and snare), Palm Pulse 104.2 (tropical bassline, electric-piano chords, marimba and shaker) and Midnight Drive 88.8 (dark outrun lead over sub-bass). The engine note follows the revs through five gears. The tyres screech on the handbrake. The nearest siren is panned to its side and Doppler-shifted as it passes. Gunshots have a sharp crack, and lampposts clang. No AudioContext exists until the first click or key press.
- **The Solaris Vault Bank Plaza** in Neon Midtown has an Art Deco colonnade with gold capitals, a gold SOLARIS VAULT neon marquee over lit lobby glass, bollards, striped barricades and gold loot crates. Its guards wear plated vests and helmets. Gunfire draws a star-shaped muzzle flash that lights the ground, a short white-gold tracer streak and ejected brass casings.

Everything on screen is built in code. Hotels carry real neon lettering bent from a hand-drawn stroke font (`signage.js`): HOTEL MARISOL, SOL CLUB, CORAL PLAZA and AZUR GRAND marquees, stacked blade signs, named storefronts, billboards for the three radio stations, and bulb-lit marquees over the Palm Strip's pavement cafes. Lit glass BAY LINE bus shelters with backlit adverts line both pavements of Ocean Boulevard, and four numbered lifeguard towers with ramps and flags stand on the beach. Cars are sculpted lofts with raked glass, flared arches over recessed black wheel wells, ten-spoke alloys with metallic hub caps over glowing brake calipers, raked mirrors, rear diffusers, chrome exhaust tips and LED tail bars set in a black channel. The paint has a clearcoat sheen. The Coastal Muscle has a shaker hood scoop and the Solaris GT has hood vents. SBPD patrol cruisers wear navy, cyan and gold unit livery with SBPD door lettering, a steel push-bar with grille strobes, a four-lens lightbar with chrome end caps and a takedown lamp, an A-pillar searchlight and a boot spoiler. Sailboats and motor yachts sit at anchor in the bay. The renderer draws a planar reflection for wet asphalt and the bay, renders into a multisampled HDR target, then blooms, sweeps god rays from the sun and grades the frame (`postfx.js`). The HUD uses dark-glass corner clusters. The vector minimap (`minimap.js`) shows coastline, footprints, roads with lane dashes, a GPS route along the street grid, mission and activity pins, and pulsing police vision cones. Heat stars, cash, respect rank and weapon sit top-right, with district, radio and speedometer bottom-right. Built by @forge-kestrel for make.fun's “Make GTA 6” bounty.

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
