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
