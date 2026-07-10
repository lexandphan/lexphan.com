# Orbit redesign — "the drift"

Date: 2026-07-09
File(s): `mockups/orbit.html` (prototype), then port to `mockups/main.html` `#orbit-overlay`.

## Problem
Current orbit lays albums along a single straight axis into depth (`z = 6 − i·15.5`) — a
tunnel. To reach a far album you fly past all the others; there's no overview and no way
to jump. The 6-DOF momentum fly-through (drag=look, scroll=throttle, constant creep) lets
you rotate off-corridor and end up staring into empty dust with no way to recenter. Net:
hard to navigate, easy to get lost.

## North star
**Dreamlike wander** — drift and discover; calm, unhurried; a little lost is fine but
never frustrating; always recoverable. Reaching a *specific* album on demand is a non-goal.
Stays fully anonymous — no titles, no labels, ever.

## Design

### 1. Space — enveloping field (evenly distributed, non-overlapping)
A bounded, slightly oblate spherical cloud (radius R≈34, vertical squish ≈0.62) centered at
origin. You float *inside* it; content in every direction; no ends. Each shoot seeds a loose,
unlabeled pocket (Fibonacci-sphere direction × varied radius). Then a **relaxation pass**
pushes apart any two frames closer than MIN_SEP (≈7u) — several iterations, re-clamped inside
the ellipsoid — so **no two photos overlap in space and each is individually discoverable**
(the pocket grouping survives only as metadata for focus-stepping). Frames face roughly toward
the cloud center (with jitter) so they read face-on from any radial vantage. Keep the existing
atmosphere: dust motes, exponential fog (hides the far rim → cloud reads endless), per-photo
bob + a whisper of roll.

### 2. Movement — look around; the cloud orbits you like an electron shell
Revised twice from live feedback: continuous forward glide "drifted straight through", and
random gaze-panning felt aimless. Final model:
- **Drag = look around** (yaw + pitch aim). **Roll always 0** (self-leveling). No forward
  glide — dragging never translates you, so you can study a spot without being carried off.
- **The whole cloud slowly revolves around the center (always on):** one **rigid** rotation
  shared by every frame — a slow spin (≈0.04 rad/s) about a gently **precessing/tumbling axis**
  — so the photos orbit past the viewer "like electrons, gently and slowly". Rigid ⇒ every
  pairwise distance is preserved, so the relaxed no-overlap spacing never degrades. Each frame
  also keeps facing the center as it orbits, plus its own bob/roll for life.
- **Idle (no input for ~1.4 s):** the camera eases to the exact **center** and holds still, so
  you're suspended in the middle watching the field revolve around you. (This is the state the
  effect is designed for; the cloud keeps orbiting while you drag or focus too.)
- **Diving in / translating** happens via focus (tap a photo → fly to it, tracked as it orbits)
  — the only ways the camera itself moves are focus, the idle center-settle, and reset.
- Light aim momentum on release (integrated only when not actively holding, so the drag delta
  isn't applied twice) + a whisper of ambient sway/parallax. Aim sensitivity per `pointerType`.

### 3. Staying in the cloud
No free-flight translation means no "escape" to guard against: the camera is only ever pulled
*toward* the center (idle) or to a chosen frame (focus) or the overview (reset). The old
ellipsoid rim-steering/clamp is removed.

### 4. Reset / recenter + launch (always available)
Small always-visible ⟲ control (plus the wordmark's sibling role). Tap → camera eases (no snap)
**outward to the whole-cloud vantage** at ~1.9R, looking in — you see the entire globe. It
**holds the overview ~4 s**, then the idle behavior draws you gently back into the center. The
**same vantage is the launch establishing shot** (opens on the whole cloud, holds ~2.5 s, then
draws in), so reset always returns you somewhere you recognize. Reset also exits focus.
Grabbing (pointer down) during the ease-out cancels it and hands you control.

### Implementation note — camera orientation
All camera orientation (drift, idle pan, reset, focus framing) is derived as **yaw/pitch →
Euler 'YXZ'** (camera convention, forward = −Z). We must NOT copy an `Object3D.lookAt`
quaternion onto the camera: for a non-camera object `lookAt` turns **+Z** toward the target,
which aims the camera 180° the wrong way (verified: it would break reset + focus). `lookAt` is
still used for the *photo planes* (a mesh's front +Z correctly faces center).

### 4b. Leaving orbit (Esc → masonry)
Esc escalates: **focus open → exit focus; else info open → close info; else → leave orbit**
back to the default masonry page. The wordmark also leaves orbit (real `href` to `main.html`,
JS intercepts only to step out of focus first); the ⟲ button stays the view-reset. In the
standalone sandbox "leave" navigates to `main.html`; ported into `main.html` the scene exposes
`isFocus()/exitFocus()/isInfoOpen()/closeInfo()` and `main.html`'s existing `orbitKeydown` →
`exitOrbit()` closes the overlay and restores the masonry (this contract already exists there).

### 5. Diving in — focus (kept, cleaned up)
Tap a photo → ease in, frame it head-on; step through that pocket's neighbors via
arrows / drag / on-screen prev-next, bare `n / total` counter (no titles). Tap empty / close /
Esc / ⟲ to leave — resume the drift from wherever you are. Old scroll/pinch throttle removed;
pinch is inert in drift (reserved for a possible future focus dolly).

### 6. Chrome & fallbacks (mostly as-is)
Keep wordmark/home, info panel, loader, reduced-motion path (calmer/slower glide, no
bob/sway/parallax/roll), and the WebGL-fail fallback grid. Add the ⟲ control; update the
entry hint to "drag to look around · release to drift".

### 7. Build order
Prototype in `mockups/orbit.html`; once the feel settles, port the model into `main.html`'s
`#orbit-overlay` easter egg.

## Non-goals
Album titles/labels; jump-to-album navigation; a UI minimap; changing the visual language,
palette, chrome, or the shoot list.
