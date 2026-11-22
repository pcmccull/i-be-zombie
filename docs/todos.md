1. [x] allow player to look around with camera, currently it is frusterating that you can't look back and see your zombie horde. 
   - Done: left- or right-drag orbits; Z/X rotate; hold V to look back at the horde; the camera stays where you leave it (no auto-snap) until C recenters; zoom out to 48 m, tilt to 78°.
2. [x] Player should be able to split horde to attack multiple targets by 
   - Done: left-click toggles a guard/gate in or out of the selection; the horde splits evenly across all selected targets (rebalances as zombies die/join or targets fall). Right-click recalls everyone.
3. [x] when attacking a sniper in a tower, the zombies should climb the tower to attack them. Currently they can kill the sniper from the ground
   - Done: zombies at the tower base climb (≈2.5 s, max 5 at once) and only those on the platform can hit the occupant; the leader can't hit it from the ground.
4. [x] Allow zombies to crawl over small obstacles like cars when they are grouped up
   - Done: once the horde has 6+ followers it paths over cars/dumpsters/barriers (not trucks/walls); a zombie with 4+ packmates nearby crawls over at 60% speed, standing on the roof; stragglers go around.
5. [x] Make it so civilians run faster than zombies unless they are in rush mode, so they can run away successfully
   - Done: civilians flee at 6.2 m/s, faster than the leader walking even at full momentum. Followers chasing a fleeing civilian are capped at 0.9× that, whatever momentum or boosts they have, so it gets away; during Rush they run at least 1.15× and catch it. The leader can still sprint one down while stamina lasts, and a civilian cornered at the edge of its home area (or inside the store) can be caught.
6. [x] ~~Capture the mouse when you start playing so moving the mouse moves the camera~~ — reverted: capture made point-and-click horde orders impossible.
   - Now: the cursor stays free; LMB attacks toward the cursor, RMB orders the horde onto whatever is under the cursor; left/right-drag (or Z/X) orbits, wheel zooms.
7. [x] Add mobile controllers
   - Done: on touch screens a stick (bottom-left) moves the Alpha; push it to the rim to sprint. Drag the view to turn the camera, pinch to zoom, tap a human/structure/ground to order the horde there. Buttons: ATTACK, RALLY, FOLLOW, your owned ability slots, plus pause / map / camera. The HUD compacts on phones; keyboard and mouse keep working.
8. [x] Don't repeat notices, currently Horde at capacity repeats at the top of the screen. Also make sure this isn't slowing the game down trying to add continuously
   - Done: "Horde capacity reached" shows once each time the horde fills up, and only again after it has been below the cap for 4 s. The HUD never shows the same notice twice at once (a repeat refreshes the one on screen). While the horde is full the game skips the recruit scans and line-of-sight checks instead of retrying every frame.
9. [x] Hide the ability slots until the user has their first unlock then only show a single ability unlock slot. The other 3 unlock slots should be purchased
   - Done: no slots are shown until the first unlock (Rush, from the Suburb Police Checkpoint), which opens slot Q. Slots E, R, F cost 40 / 70 / 110 biomass and are bought at an active nest (nest panel button or B). Unlocks with no free slot wait until you buy or free one. Older saves keep their loadout.
10. [x] Spawn zombies and civilians out of the road. They should be on sidewalks and not in th emiddle of the road.
   - Done: wandering zombies, civilians (spawns, patrol points, respawn points) start on the sidewalks beside the street instead of the middle of the road.
10. [x] Create shops you can break into that have drinks you can use to heal
   - Done: 15 corner shops (one per district, none on the military base) with a DRINKS sign and striped awning. Break the glass door (the Alpha alone takes ~4 s, or order the horde onto it); three drinks glow inside. Walk the hurt Alpha over one to heal 35 HP (full-health Alphas leave them). An emptied shop restocks after 2.5 min.
10. [x] Show click space to recall somewhere
   - Done: while the horde is away on an attack/move order (or split), a pulsing hint under the horde counter reads "SPACE regroup · G recall horde" (touch: "Tap FOLLOW to call the horde back").
11. [x] Zombies are walking through cars
   - Done: cars are now simulated and solid: a stopped or slow car shoves bodies out of its footprint. Packed followers crawling over parked cars climb onto the roof as soon as they touch it instead of sinking into the bodywork.
12. [x] Moving Cars hitting zombies shouldthrow and damage them, as you capture more areas the citizens should start to fight back more. Theyshould get bats and run over your zombies with cars. As it progresses citizens sould start to get more powerful weapons to fight back
   - Done: up to 7 cars drive the road lanes around the Alpha (not in infected districts). They brake for humans but not zombies: a hit throws the zombie (or the Alpha) and does damage by speed, and the car slows with each body. A car jammed for good stalls and its driver bails out as a civilian (or quietly leaves when far away).
   - Fight-back level rises with strongholds captured: 1 capture - 30% of civilians carry bats and charge/swing instead of fleeing; 2 - drivers start hunting the horde (dark cars with a red bull bar ram the Alpha up to 3 passes, then flee); 4 - pistols; 7 - shotguns. Armed citizens still run once badly hurt. A toast announces each new level.
13. 