# Orbit Phase 2 — streaming recycler (all 471 photos)

Date: 2026-07-09
File: `mockups/orbit.html` (builds on the Phase 1 electron-cloud redesign).

## Goal
Cycle through **all ~471 photos** over time while only ever holding a bounded working set
resident on the GPU, so it never repeats and "serves up new images almost every time" — without
regressing the now-smooth Phase 1 feel.

## Constraint that shapes the design
Frames are rendered **opaque** (this is what fixed the drag jitter — no transparency re-sorting).
Opaque means we **cannot alpha-cross-fade** a texture swap. So swaps must be hidden another way.

## Approach — recycle at the far-drift extreme, hidden by a scale-down
Keep **all of Phase 1's motion** (slow cloud rotation + per-frame in/out depth-drift + mutual
repulsion + freeze-on-grab). Layer streaming on top:

1. **Pool.** Build the full list of all image URLs from a hardcoded per-album `COUNTS` map
   (mirrors the album image counts; 471 total), deterministically shuffled (mulberry32). A global
   cursor hands out the next URL, wrapping — so every frame keeps pulling fresh images and the
   whole library cycles through.

2. **Bounded live set.** Keep the existing ~117 meshes (desktop) as the live set — each is one
   "slot". VRAM stays ≈ the live count because each swap **disposes** the outgoing texture. (Not
   growing the count; Phase 1 already ran this many after the perf fixes.)

3. **Hidden swap at the drift extreme.** Each frame drifts in/out on `sin(driftPhase)`. Near its
   OUT extreme (`sin → 1`: farthest, smallest, most fogged) a per-frame **swapScale** ramps the
   mesh scale to ~0 (a quick shrink-away, on top of the perspective shrink + fog) so it briefly
   vanishes. While hidden:
   - **request** the next pool URL (async load, capped concurrency);
   - when the load finishes, hold it as `pendingTex`;
   - **apply** `pendingTex` only while the mesh is hidden (`swapScale < ~0.12`): dispose the old
     texture, point `uMap`/`uAspect`/`baseW` at the new one, clear pending.
   Then the mesh scales back up and drifts inward showing the new image — so a frame that was in
   the periphery returns to the foreground as a *different* photo. Re-arm the request when the
   frame comes back in (`sin < ~0.8`).

4. **Streamer.** A tiny queue with ≤3–4 concurrent `ImageLoader` loads feeds `makeTexture` (reused).
   Old textures are `.dispose()`d on apply. Initial fill uses the existing LoadingManager for the
   first N images (canvas fade-in covers it).

## Focus mode
Album grouping no longer means anything (a slot shows different pool images over time), so
`stepFocus` steps through the **live meshes array** (nearest-in-space ordering optional) instead of
`occasions[]`. Counter shows position in the live set. A focused frame does not recycle while held.

## Non-goals / notes
- Not a literal "emerge from deep fog" conveyor (that needs a big radial rewrite + transparency);
  the scale-hidden swap at the existing drift extreme is the opaque-safe equivalent and reuses the
  approved motion. Can revisit a deeper conveyor later.
- `COUNTS` is hardcoded; when albums change, update it (or generate a manifest).
- Recycling plays out over minutes — must be validated live, not from a still.

## Risks to watch (review targets)
Texture leaks (every swap must dispose), applying a texture while visible (pop), load stalls
blocking swaps, focused frame recycling out from under the viewer, aspect/baseW mismatch after swap.
