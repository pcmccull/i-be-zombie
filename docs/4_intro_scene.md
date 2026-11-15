# AI Coding Instructions: Cinematic Tutorial Introduction

Use the assets/voiceover/intro2.mp3 during this intro scene. 

Implement a cinematic opening sequence for the Three.js zombie horde game. The intro should feel like the beginning of a dramatic, heroic open-world game, with a comedic reveal that the player is actually a zombie.

## 1. Initial Scene and Fade-In

- Start with a completely black screen.
- Disable all player input, movement, attacks, zombie commands, and camera controls.
- Load the game world and required assets before beginning the cinematic.
- Fade smoothly from black over 2 seconds to reveal a beautiful, Miami-inspired tropical city.
- The opening camera should be elevated, looking across palm-lined boulevards toward the ocean.
- The scene should feel bright, colorful, sunny, and full of life, with low-poly tropical buildings, palm trees, pedestrians, and moving traffic.

## 2. Cinematic Camera Sequence

Use smooth, scripted Three.js camera movement. Avoid abrupt jumps between shots.

| Time | Camera movement | Narration |
|---|---|---|
| 0–4s | Fade in from black to an elevated panoramic view of the tropical coastline and city skyline | "Paradise. Sunshine. Beautiful beaches. A city full of life." |
| 4–9s | Glide forward over palm trees and colorful beachfront buildings | "But beneath this picture-perfect paradise... something is terribly wrong." |
| 9–15s | Descend toward a busy intersection with pedestrians and cars | "Crime. Corruption. Traffic. Tourists wearing socks with sandals." |
| 15–21s | Track along a sidewalk past ordinary citizens enjoying the city | "This city needs a hero. Someone brave enough to stand against the chaos." |
| 21–28s | Slowly move toward the player's location, keeping the character hidden behind scenery or outside the frame | "Someone who can bring people together. Someone who can change the world... one person at a time." |
| 28–33s | Dramatically orbit toward the player, then zoom in to reveal the zombie | "And that someone... is YOU." |
| 33–38s | Hold on the zombie's face. Stop the dramatic music for comedic effect | "Wait... you're a zombie? Well. Nobody's perfect." |
| 38–43s | Pull back and transition smoothly to the normal gameplay camera | "Go save the world! ...From the living." |

The timing should adapt to the actual narration duration rather than cutting off voice lines.

## 3. Camera Implementation

- Use the existing Three.js camera and game rendering system.
- Create a reusable `CinematicController` responsible for scripted camera movement.
- Define camera keyframes using world coordinates, look-at targets, field of view, and transition durations.
- Interpolate position using smooth spline paths such as Catmull-Rom curves.
- Smoothly interpolate camera orientation with quaternions or suitable target interpolation.
- Use cinematic easing for acceleration and deceleration.
- Maintain collision-safe camera paths that do not pass through buildings or terrain.
- Animate the existing game camera rather than creating a separate scene or duplicating the world.
- Keep the final camera transition seamless with the normal player-follow camera.

## 4. Narration, Audio, and Subtitles

- Synchronize the camera movements with the narration.
- Display subtitles near the bottom center of the screen.
- Use existing game UI styling for subtitles.
- Start with uplifting, cinematic background music.
- Build the music toward a dramatic crescendo during the hero reveal.
- Abruptly stop the music when the zombie is revealed.
- Play an awkward comedic sound effect or short silence.
- Resume with energetic gameplay music as the player gains control.
- Provide a fallback using timed subtitles if narration audio is unavailable.
- Do not block the cinematic if optional audio fails to load.

## 5. Player Input Lock

**The player must not be able to interact with the game until the cinematic has fully finished.**

Implement an explicit game state:

```typescript
type GameState =
  | "LOADING"
  | "INTRO_CINEMATIC"
  | "PLAYING"
  | "PAUSED";
```

During `INTRO_CINEMATIC`:

- Disable keyboard and mouse gameplay input.
- Disable touch controls and virtual joysticks.
- Disable player movement, attacks, and abilities.
- Disable horde commands and interactions.
- Disable manual camera movement, zoom, and rotation.
- Hide the normal gameplay HUD.
- Keep NPCs, traffic, palm trees, and environmental animations running.
- Prevent any buffered gameplay inputs from executing after the cinematic.

Use a central state check rather than independently disabling individual controls where possible.

## 6. Transition to Gameplay

At the end of the narration:

1. Smoothly move the cinematic camera into its normal third-person gameplay position behind the zombie.
2. Reveal the regular gameplay HUD.
3. Display the first tutorial objective: **"Make Some Friends"**.
4. Display a short instruction explaining how to approach or infect the first human.
5. Clear any accumulated keyboard, mouse, or touch input.
6. Set the game state to `PLAYING`.
7. Enable gameplay controls only after the final camera transition and cinematic sequence are complete.

Do not reload the world, reposition the player unnecessarily, or use a hard camera cut.

## 7. Technical Requirements

- Integrate with the existing game architecture and input system.
- Do not introduce a new rendering framework.
- Keep cinematic camera paths and narration timing configurable.
- Ensure all animations are frame-rate independent using delta time.
- Use the existing animation loop; do not create competing render loops.
- Handle window resizing and browser visibility changes.
- Provide an optional **Skip Intro** control after the initial fade-in. Skipping must execute the same safe transition to gameplay, without leaving controls locked or allowing input early.
- Ensure the opening sequence plays only when starting a new game or explicitly replaying the tutorial, not whenever the player enters another city district.

## 8. Acceptance Criteria

- The game starts on a black screen and fades into a recognizable tropical, Miami-inspired city.
- Camera movement is smooth and cinematic.
- The zombie remains hidden until the comedic reveal.
- Narration and camera movement are synchronized.
- City pedestrians and environmental animations continue throughout.
- The player cannot move, attack, control the horde, or manipulate the camera during the intro.
- The final camera smoothly transitions into the regular gameplay camera.
- Gameplay input activates only after the intro completes or is safely skipped.
- The first tutorial objective appears immediately after the transition.

**Desired result:** The player initially believes they are watching the introduction to a heroic open-world adventure. The sweeping tropical-city cinematography builds that expectation until the camera reveals a shambling zombie. The joke lands, the camera settles behind the zombie, and the player immediately begins spreading the apocalypse.