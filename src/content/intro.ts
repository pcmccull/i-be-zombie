// [pure] Opening cinematic script (docs/4_intro_scene.md): narration cues, camera keyframes, music cues.
// All times are SCRIPT seconds. Narration audio second `a` plays at script time `narrationStart + a / scale`,
// where scale adapts the whole script to the real voice-over length (see narrationTimeScale).
import type { CameraKey, SubtitleCue } from '../core/cinematicMath';
import type { DistrictLayout, Vec3 } from '../core/types';

export interface IntroScript {
  /** Black-screen fade-in length (s). */
  fadeIn: number;
  /** Script time at which the narration audio starts. */
  narrationStart: number;
  /** Authored narration length (s) the cue times were measured against (assets/voiceover/intro2.mp3). */
  narrationDuration: number;
  /** The Skip Intro control appears after this script time (after the fade-in). */
  skipAvailableAt: number;
  /** Skip / exit blend length (s) into the gameplay camera. */
  skipBlend: number;
  cues: SubtitleCue[];
  /** Authored keys. The final key (gameplay camera) is appended at runtime at `endTime`. */
  keys: CameraKey[];
  /** Script time the gameplay camera pose is reached and control is handed over. */
  endTime: number;
  music: {
    /** Uplifting score starts. */
    start: number;
    /** Build toward the hero-reveal crescendo. */
    buildFrom: number;
    /** Abrupt stop on the zombie reveal + awkward comedic sting. */
    cut: number;
  };
  /**
   * Non-follower zombies are not drawn until `revealAmbientAt` (the city reads as paradise and the bus horde does
   * not spoil the joke); from then on those within `ambientRadius` of the leader reappear (during the pull-back).
   */
  revealAmbientAt: number;
  ambientRadius: number;
  /** Chunk-streaming focus for the whole cinematic (covers every shot), meters. */
  streamFocus: { x: number; z: number };
}

const NARRATION_START = 0.4;
/** Narration second -> script second. */
const n = (audioSeconds: number): number => NARRATION_START + audioSeconds;

/** Measured speech segments of intro2.mp3 (39.9 s), grouped per line. */
const CUES: SubtitleCue[] = [
  { start: n(0.1), end: n(5.5), text: 'Paradise. Sunshine. Beautiful beaches. A city full of life.' },
  { start: n(5.85), end: n(10.6), text: 'But beneath this picture-perfect paradise… something is terribly wrong.' },
  { start: n(10.9), end: n(16.0), text: 'Crime. Corruption. Traffic. Tourists wearing socks with sandals.' },
  { start: n(16.2), end: n(21.0), text: 'This city needs a hero. Someone brave enough to stand against the chaos.' },
  { start: n(21.2), end: n(27.6), text: 'Someone who can bring people together. Someone who can change the world… one person at a time.' },
  { start: n(27.95), end: n(30.9), text: 'And that someone… is YOU.' },
  { start: n(31.05), end: n(33.1), text: 'Wait… you’re a zombie?' },
  { start: n(33.2), end: n(35.25), text: 'Well. Nobody’s perfect.' },
  { start: n(35.4), end: n(36.8), text: 'Go save the world!' },
  { start: n(36.9), end: n(39.9), text: '…From the living.' },
];

function v(x: number, y: number, z: number): Vec3 { return { x, y, z }; }

/**
 * Builds the cinematic for a layout. Early shots are authored in world space for the open-world suburbs (palm
 * boulevard, intersection at (-100, 80), beach to the south); the approach / reveal shots are relative to the
 * leader's start pose so the zombie stays hidden behind the start-area house until the orbit.
 */
export function buildIntroScript(layout: DistrictLayout): IntroScript {
  const p = layout.playerStart;
  const f = layout.playerStartFacing;
  const fx = Math.sin(f), fz = Math.cos(f); // leader forward
  const rx = -Math.cos(f), rz = Math.sin(f); // leader right (camera-right convention)
  const rel = (fwd: number, right: number, y: number): Vec3 => v(p.x + fx * fwd + rx * right, y, p.z + fz * fwd + rz * right);
  const head = rel(0, 0, 1.86);

  const keys: CameraKey[] = [
    // 0–6: elevated panorama across the palm-lined city toward the ocean (fade-in from black).
    { t: 0, pos: v(-78, 46, 34), look: v(5, 0, 182), fov: 50 },
    { t: n(5.6), pos: v(-70, 43, 48), look: v(12, 0, 184), fov: 50 },
    // 6–11: glide forward over palms and the beachfront.
    { t: n(10.6), pos: v(-36, 20, 122), look: v(30, 2, 182), fov: 52 },
    // 11–16: descend toward the busy intersection.
    { t: n(13.3), pos: v(-52, 15, 110), look: v(-96, 1, 82), fov: 52 },
    { t: n(16.0), pos: v(-78, 8.5, 99), look: v(-100, 1.2, 80), fov: 52 },
    // 16–21: track along the boulevard sidewalk past the locals.
    { t: n(18.6), pos: v(-95, 2.6, 90), look: v(-118, 1.5, 79), fov: 50 },
    { t: n(21.0), pos: v(-118, 2.8, 90), look: v(-140, 1.5, 80), fov: 50 },
    // 21–27.6: creep south through the park out onto the beach, gazing out to sea; the lone Alpha stays off-frame (west).
    { t: n(24.0), pos: v(-128, 3.4, 128), look: v(-110, 1.8, 160), fov: 48 },
    { t: n(26.2), pos: v(-136, 3.0, 146), look: v(-120, 1.6, 170), fov: 47 },
    { t: n(27.6), pos: v(-140, 2.8, 150), look: v(-128, 1.6, 172), fov: 46, ease: 'inOut' },
    // 27.6–30.9: dramatic orbit along the sand toward the player, then zoom in on "YOU".
    { t: n(28.9), pos: v(-138, 3.6, 147.5), look: rel(0, 0, 1.4), fov: 44 },
    { t: n(29.9), pos: rel(5.5, -3.6, 2.6), look: rel(0, 0, 1.5), fov: 42 },
    { t: n(30.6), pos: rel(2.4, 0.15, 1.95), look: head, fov: 34, ease: 'out' },
    // 30.9–35.2: hold on the zombie's face (music cut + awkward silence).
    { t: n(35.2), pos: rel(2.2, 0.2, 1.93), look: head, fov: 34, ease: 'inOut' },
    // 35.2–end: pull back around the zombie toward the gameplay camera (final key appended at runtime).
    { t: n(37.8), pos: rel(-1, 6, 3.6), look: rel(0, 0, 1.4), fov: 48, ease: 'in' },
  ];

  return {
    fadeIn: 2,
    narrationStart: NARRATION_START,
    narrationDuration: 39.9,
    skipAvailableAt: 2.2,
    skipBlend: 1.8,
    cues: CUES,
    keys,
    endTime: n(39.9) + 0.9,
    music: { start: 0.2, buildFrom: n(21.0), cut: n(30.65) },
    revealAmbientAt: n(35.2),
    ambientRadius: 30,
    streamFocus: { x: -90, z: 105 },
  };
}

/** First tutorial objective shown as control is handed over (§6). */
export const FIRST_OBJECTIVE = {
  title: 'Find Your Nest',
  touchText: 'You are alone. Walk up from the beach to the glowing nest by the bus to raise your first horde of 10 zombies.',
  text: 'You are alone. Walk up from the beach (WASD) to the glowing nest by the bus to raise your first horde of 10 zombies.',
} as const;
