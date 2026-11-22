# VP-T003 — Character art: human archetypes + Alpha hero silhouette (docs/8_visual_polish.md §1, §2)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§VP-0…VP-4 at the top; art bible VP-2), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/8_visual_polish.md` §1–2, then `src/visuals/{LowPolyCharacters,zombieModel,zombieTextures,
zombieProfiles,EntityRenderer}.ts`. All art stays procedural (no files/downloads), three + TS only.

## Locked files (create/edit only these)
- `src/visuals/humanProfiles.ts` (new, **[pure]**, no three import)
- `src/visuals/LowPolyCharacters.ts`, `src/visuals/zombieModel.ts`, `src/visuals/zombieTextures.ts`, `src/visuals/EntityRenderer.ts`
- `tests/humanProfiles.test.ts` (new)
Do NOT touch `Game.ts`, `HordeRenderer.ts`, `zombieAnimation.ts`, contract files, balance, or sim code. Root position/facing,
hit timing and collision always come from `GameState` (render-only task).

## 1. Humans (`humanProfiles.ts` + `LowPolyCharacters.ts`)
- `humanProfile(id, role, post, weapon): HumanProfile` deterministic per id: `archetype` ∈ `'tourist' | 'resident' | 'worker' |
  'security' | 'defender'` (+ keep armed-civilian weapon props). Mapping: role `soldier` ⇒ `defender` always (orange vest #e0782a +
  navy #2c3e66, helmet, rifle — unchanged identity); role `police` / post `barricade` ⇒ `security` (navy + light blue, cap, pistol);
  `civilian` ⇒ tourist / resident / worker by id hash (~45/35/20 %). Fields: skin tone (≥ 6 tones), hair style (≥ 5 incl. bald,
  bun, afro, cap-less short, long) + hair colour, body build (slim/average/stocky/tall → scale/width), outfit palette, props.
- Looks (readable from the elevated camera): **tourist** = Hawaiian/floral shirt (use a small procedural canvas pattern texture or
  vertex-colour flower blotches), shorts, sandals, sun hat or camera/backpack/sunglasses props, sunburn-pink option;
  **resident** = tee/tank + jeans/skirt, sneakers, tote/phone; **worker** = hi-vis yellow-green tabard (NOT orange), hard hat or cap,
  work boots, tool belt; **security** = existing police look polished (badge, belt, radio); **defender** = existing soldier look polished
  (vest pockets, knee pads, helmet visor). Civilians never wear orange + navy together.
- Material: keep one material per rig (vertex colours), but switch to `MeshStandardMaterial({ vertexColors, flatShading, roughness
  0.75, metalness 0 })` (weapons via vertex colour darker; fine). Bevel-ish silhouettes: rounder heads (low-seg spheres/
  octahedra are fine), tapered limbs, hands, noses, shoes — each human ≤ ~1.5 k triangles.
- Animation reactions (pose only; extend `computePose`/`PoseParams` with optional fields): **panic** (civilians fleeing: arms flailing
  overhead, faster cadence), **alert** (head snap + weapon raise), **hit recoil** (torso snap back for ~0.2 s on `hitFlash` rising
  edge), keep stagger/death. Seeded per-id phase offsets so crowds never walk in sync.

## 2. Alpha hero (`zombieModel.ts` hero rig + `zombieTextures.ts`)
Make the player unmistakable **without hats/glasses** and friendlier (humorous, not horror): replace the shoulder pads / back spikes
/ exposed ribs with: asymmetric shoulders (right raised + hunched), exaggerated forward lean is in the animation already, **one
oversized right hand** (≈ 1.8× hand + chunky fingers), large **mismatched eyes** (one bigger, glowing yellow-green, keep `glow`),
slack grin with a couple of teeth, cheek patch; a **distressed colourful tourist shirt** (Hawaiian print tile in the atlas: teal/coral
flowers, seams, a torn hem) + cargo shorts + one rubber sandal / one sneaker. Keep the skeleton, bone ids, `composeBones`, scale
and the controller untouched. Add **cosmetic attachment slots**: `ZombieHeroRig.slots: Record<'hat' | 'glasses' | 'back' | 'hand',
THREE.Object3D>` (empty anchors parented to head/spine/hand bones, updated with the bones) — nothing attached by default.
Horde zombies: keep everything (docs/6 already has 8 looks × 6 builds); optionally add the Hawaiian tile as one more shirt tile.
Hero triangle count may grow to ≤ ~8 k.

## 3. EntityRenderer
Pass the profile into `createGuardRig`; feed panic/alert/hit-recoil params from GameState (`g.state`, `g.hitFlash`, `g.role`,
fleeing civilians) in the existing pose loop without per-frame allocation. Keep the vision gating (`humanVisual`) exactly as is.

## Tests (`tests/humanProfiles.test.ts`)
ARCHITECTURE §VP-4 #5: deterministic per id; soldier ⇒ defender always; police/barricade ⇒ security; over ids 1..500 civilians reach
tourist, resident and worker; no civilian palette contains both #e0782a and #2c3e66; ≥ 6 skin tones and ≥ 5 hair styles reachable.

## Done
`npx tsc --noEmit` 0 errors, `npm test` all green, `npm run build` OK. Report at `.agent-context/reports/VP-T003-<agent>.md`
(include triangle counts per archetype and the hero), MEMORY notes appended to `.agent-context/MEMORY.md`.
