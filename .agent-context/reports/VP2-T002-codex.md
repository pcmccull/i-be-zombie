# VP2-T002 — Humanoid rig and cohesive body mesh

- **Task ID & Agent:** VP2-T002 / codex
- **Status:** COMPLETED (scoped implementation, type-check and 29 focused tests pass; unrelated full-suite timeout documented below)

**Completed Work:**

- Created `src/graphics/characters/humanoidRig.ts`: six body presets, 21 parent-relative rest offsets, allocation-free pose FK with optional output offset, and bind inverses. No Three.js import or new dependencies.
- Created `src/graphics/characters/bodyMeshMath.ts`: deterministic indexed elliptical lofts for torso/neck, both arm/mitten/thumb chains, both leg/shoe chains, sculpted skull/brow/nose/jaw, closed eye whites, open pupil discs and closed mouth. Shells have independent indices, caps, area-weighted smooth normals, metric cylindrical UVs, material regions and normalized skin influences.
- Created `tests/humanoidRig.test.ts`: independent composeBones port, 200 seeded random poses across all six shapes, full selected-matrix comparisons (stronger than origin-only comparisons), bind identity, rest-offset agreement, output-offset guards and 10,000-call FK proxy.
- Created `tests/bodyMesh.test.ts`: all six shapes and both LODs, finite/unit attributes, weight constraints, index validity, closed-shell edge counts, byte determinism, exact ground contact, triangle budgets, Alpha hand asymmetry and linear-blend skinning at 0/65/130-degree elbows and knees. Edge stretch includes each preset's runtime scale and width and stays below 2.5x.
- Appended only the requested `[VP2-T002]` bullet to `.agent-context/MEMORY.md`.
- Edited only the six assigned paths. Ran no git command that changes the index or working tree.

| Mesh | LOD0 triangles / vertices | LOD1 triangles / vertices |
| --- | --- | --- |
| Each of average, tallSkinny, shortRound, heavy, lanky | 1,304 / 680 | 446 / 248 |
| Alpha | 4,416 / 2,244 | 1,028 / 542 |

**Remaining Work:** No implementation remains in the assigned scope. Renderer integration and visual review belong to downstream VP2 tasks. An unrelated full-suite timeout in `tests/meshUtils.test.ts` must be reviewed by that file's owner; it was not modified.

**Public Interfaces/Exports Added:**

- `BodyShape`, `BODY_SHAPES`, `restBoneOffsets(shape, out?)`, `poseToBoneMatrices(pose, shape, root, out, offset?)`, `bindInverses(shape)`.
- `BodyMeshData`, `buildBodyMesh(shape, lod)`.

**Verification Run:**

- `npx tsc --noEmit` — PASS, exit 0, no diagnostics (run twice, including after final source/test changes).
- `npx vitest run tests/humanoidRig.test.ts tests/bodyMesh.test.ts` — PASS, 2 files / 29 tests. Final focused run: rig 296 ms, body mesh 328 ms; total command duration 2.16 s. Both files also passed in the full run (730 ms / 814 ms).
- Scratchpad inline Node check against installed Three.js `Euler`/`Matrix4` — PASS: maximum rotation-matrix error XYZ 2.78e-17, YXZ 0. No scratch file was created in the repository.
- In-memory TypeScript/Node mesh count inspection — PASS; counts shown above.
- `npx vitest run` (the same full-suite runner as `npm test`) — FAIL, exit 1: **78 files passed / 1 failed; 885 tests passed / 1 failed (886 total), no skips**. Duration 373.34 s. The sole failure is an external 5,000 ms timeout at `tests/meshUtils.test.ts:472`, `BuildingFactory showcases and budgets > meets LOD0/LOD1 triangle budgets, enforces LOD1 filtering, and is deterministic`. All 29 scoped tests and all 14 open-world integration tests passed. Ran the full suite once as requested; did not modify or rerun that other session's file.

**Memory Notes:**

- Chest translation MUST stay zero. Its rotation is `A^T * Rtot`, with the spine using the half-angle Euler rotation `A`; this preserves the original chest pivot while producing the exact full spine rotation. Head likewise has zero translation; its residual rotation is `N_a^T * N_full`.
- Only `neckLength`, `armLength` (hand origin only), `shoulderSlope`/`shoulderAsym` (shoulder translation/roll), and `hunch` alter shape-dependent bone frames. Hips and both leg chains use unchanged RIG dimensions for EVERY shape. Root scale/width remain the existing composeBones scaling convention.
- Upper-body composeBones equivalence holds for `average` only; the other presets deliberately change neck/shoulder/hunch frames. All shapes preserve leg/foot FK, with root scale/width included in the comparison.
- Wrist droop is derived per side: `0.15 + 0.35 * elbow - 0.25 * clamp(armPitch, -1, 1)` radians. It is not a new pose field.
- Bind inverses include shape posture and offsets but EXCLUDE `shape.scale` and `shape.width`. Mesh positions are already in that unscaled shape bind pose, in rig units. Runtime skinning is `poseWorld * bindInverse`; root scale/width are applied exactly once.
- Alpha right-hand mesh size is `handScale * (1 + 0.8 * shoulderAsym)` (1.8x relative to its left hand). This never changes arm/leg bone lengths.
- Closure is per indexed shell, with no shared indices between shells. Pupil discs (region 5) are the sole deliberate open surfaces. LOD1 zombie meshes are 446 triangles, so additions must respect the 450-triangle cap.
