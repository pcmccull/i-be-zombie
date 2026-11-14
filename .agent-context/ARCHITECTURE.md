# Architecture & Interface Contracts

The authoritative directory table, step order and conventions live in `AGENTS.md` (sections "Directory structure &
ownership", "Recruitment, structures & momentum", "`Simulation.step` order"). This file maps them to agents.
Note: this project has no `src/types/`, `src/data/` or `src/integration/`; the generic template is mapped below.

## Module Ownership (this repo)

- `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, `AGENTS.md` — Orchestrator only (contracts).
- `src/sim/`, `src/systems/`, `src/entities/`, `src/world/{CollisionWorld,NavigationGrid,districtLayout}.ts`, `src/utils/`
  — `[pure]` core logic → `@codex-worker` (fallback `@claude-worker` while codex is unavailable).
- `src/ui/`, `src/visuals/`, `src/audio/`, `src/world/{Landmarks,CityDistrict,Checkpoint}.ts` — UI/HUD/visual → `@agy-worker`.
- `src/core/{Game,InputController,ThirdPersonCamera}.ts` (wiring) and `tests/` — integration → `@claude-worker`
  (or whichever agent owns the system under test in its task brief).

## Locked Contracts

- `GameState`: `structures: StructureState[]`, `momentum: MomentumState`; `ZombieAgent`: `heldBy`, `recruitGen`, `pulseAt`,
  `recruitFlash`; `GuardAgent`: `role`, `post`, `homeArea`, `shelter`.
- `TargetRef` adds `{ kind: 'structure'; id }`. `ColliderKind` adds `'breakable'` (never crawlable).
- Events: `recruited{generation}`, `recruitPulse`, `structureDamaged{kind}`, `structureDestroyed`, `released` (count > 0 only),
  `momentumGain`, `momentumTier`, `guardDied{role}`, `guardAlert{role?}`.
- APIs: `MomentumSystem` (addMomentum, updateMomentum, momentumTier, recruitRadiusMultiplier, speedMultiplier),
  `StructureSystem` (findStructure, damageStructure, updateStructures) — see `src/core/contracts.ts`.
