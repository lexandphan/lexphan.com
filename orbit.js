
  window.orbitApp = (function () {
    'use strict';
    var THREE = null;
    var ctx = null;                 // control object returned by build()
    var status = 'idle';            // idle | loading | ready

    function hasWebGL() {
      try {
        var c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
      } catch (e) { return false; }
    }

    async function init() {
      if (status === 'ready') return true;
      if (status === 'loading') return false;
      status = 'loading';
      if (!hasWebGL()) { status = 'idle'; return false; }
      try {
        if (!THREE) THREE = await import('/vendor/three.module.js');   // LAZY: first fetch of three here (direct path, no importmap → strict script CSP)
      } catch (e) {
        if (window.console) console.warn('[orbit] three load failed', e);
        status = 'idle'; return false;
      }
      try {
        ctx = build(THREE);
      } catch (e) {
        if (window.console) console.warn('[orbit] init error', e);
        try { if (ctx && ctx.destroy) ctx.destroy(); } catch (_) {}
        ctx = null; status = 'idle'; return false;
      }
      if (!ctx) { status = 'idle'; return false; }
      status = 'ready';
      return true;
    }

    function destroy() {
      if (ctx && ctx.destroy) { try { ctx.destroy(); } catch (e) {} }
      ctx = null;
      status = 'idle';
    }

    return {
      init: init,
      destroy: destroy,
      isFocus: function () { return !!(ctx && ctx.isFocus()); },
      isInfoOpen: function () { return !!(ctx && ctx.isInfoOpen()); },
      exitFocus: function () { if (ctx && ctx.exitFocus) ctx.exitFocus(); },
      closeInfo: function () { if (ctx && ctx.closeInfo) ctx.closeInfo(); }
    };

    // ============================ scene builder ============================
    function build(THREE) {
      const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const HOVERABLE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      const SMALL = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;

      // ---- teardown registry (main.html owns the open/close lifecycle) ----
      const listeners = [];
      function on(t, ty, fn, o) { t.addEventListener(ty, fn, o); listeners.push([t, ty, fn, o]); }
      let disposed = false;
      let lastHover = null;
      const overlayEl = document.getElementById('orbit-overlay');

        // ---- config ----
        const BG = 0x0C0A07;   // dark warm backdrop (renders ~#3E3A31 after sRGB output) — photos pop,
                               // fog recedes far frames into shadow toward this same tone
        const FOLDERS = ['tahoe','cdmxye','playa','pdt','splash','kyoto','tokyo','sapporo','pv','cdmx','oax','bali','japan'];
        const FRAMES_PER = SMALL ? 5 : 9;    // size of the LIVE (resident) set: ~65 mobile / ~117 desktop
        // per-album image counts (mirror /images/<album>/N.webp) — the full library streamed in phase 2
        const COUNTS = { tahoe:61, cdmxye:22, playa:22, pdt:28, splash:51, kyoto:43, tokyo:30, sapporo:13, pv:84, cdmx:33, oax:13, bali:40, japan:31 };
        const MAX_EDGE = SMALL ? 640 : 1024; // trimmed for the higher frame count
        const FOG_DENSITY = 0.0175;
        const FOV = 56;

        // ---- cloud + camera framing (enveloping field, not a corridor) ----
        const center  = new THREE.Vector3(0, 0, 0);
        const R        = 35;            // cloud radius (x/z)
        const Y_FLAT   = 0.62;          // vertical squish -> slightly oblate, gives a sense of "level"
        const MIN_SEP  = 9.5;           // minimum spacing between frames — larger now that frames are bigger
        const IDLE_DELAY = 1.4;         // seconds of no input before the camera settles to center
        const ORBIT_SPIN = REDUCED ? 0 : 0.040;   // cloud's primary revolution around you (rad/s)
        const DRIFT_AMP  = REDUCED ? 0 : 0.45;     // in/out depth drift (fraction of radius) — background
                                                    // frames travel deep and swing forward over time
        const DRIFT_MIN_R = 8;                      // never let a drifting frame come closer than this to you
        // home vantage: outside the cloud, looking in, framing the whole field (~1.9R away).
        // Camera orientation is derived as yaw/pitch (Object3D.lookAt orients +Z toward the target,
        // which is BACKWARDS for a camera — so we never copy a lookAt quaternion onto the camera).
        const homePos  = new THREE.Vector3(0, R * 0.42, R * 1.85);
        const _hf      = center.clone().sub(homePos).normalize();
        const homeYaw  = Math.atan2(-_hf.x, -_hf.z);
        const homePitch = Math.asin(THREE.MathUtils.clamp(_hf.y, -1, 1));

        // ---- two modes on a zoom axis: ORB (outside, examine) <-> NUCLEUS (inside, look around) ----
        const orbDir  = homePos.clone().normalize();     // camera rides this ray; camPos = orbDir * zoom
        const Z_ORB   = homePos.length();                // farthest zoom = the whole-orb vantage
        const SHELL   = R * 0.55;                         // zoom below this = nucleus mode (drag = look)
        const ZOOM_RATE = 7.0;                            // how fast zoom eases toward its target (snappy)
        const ROT_ORB = 0.006;                            // horizontal trackball sensitivity (rad per px)
        const ROT_ORB_V = 0.006 * 0.4;                    // vertical is gentler -> harder to tip the orb over
        const MAX_PITCH = THREE.MathUtils.degToRad(58);   // clamp the tilt so the orb never goes upside down
        const SPIN_DECAY = 2.4;                           // trackball momentum decay (per sec)
        const WORLD_UP = new THREE.Vector3(0, 1, 0);
        const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

        // ---- renderer ----
        const canvas = document.getElementById('ob-canvas');
        const stage = document.getElementById('ob-stage');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.setClearColor(BG, 1);
        if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
        const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;


        const scene = new THREE.Scene();
        const fogColor = new THREE.Color(BG);
        scene.background = fogColor;
        scene.fog = new THREE.FogExp2(BG, FOG_DENSITY); // used by the dust points

        const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 600);

        // ---- shared shader uniforms (referenced by every plane) ----
        const uFog = { value: fogColor };
        const uFogDensity = { value: FOG_DENSITY };
        const uBorder = { value: new THREE.Color(0xFBF7EE) };
        const uLightDir = { value: new THREE.Vector3(-0.35, 0.55, 0.75).normalize() };
        const uOrb = { value: 0 };        // 0 = nucleus, 1 = orb (front bright -> back recedes)
        const uShellR = { value: R };     // cloud radius
        const uCamDist = { value: Z_ORB };// camera distance from cloud center -> locates the orb's near surface

        const VERT = `
          varying vec2 vUv;
          varying float vDepth;
          varying vec3 vWorldN;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mv.z;
            vWorldN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
            gl_Position = projectionMatrix * mv;
          }
        `;
        const FRAG = `
          precision highp float;
          uniform sampler2D uMap;
          uniform float uAspect;   // w / h
          uniform float uHover;
          uniform float uFocus;
          uniform float uDim;
          uniform float uReveal;
          uniform float uOpacity;
          uniform vec3  uFog;
          uniform float uFogDensity;
          uniform vec3  uBorder;
          uniform vec3  uLightDir;
          uniform float uOrb;      // 0 = nucleus, 1 = orb
          uniform float uShellR;
          uniform float uCamDist;
          varying vec2 vUv;
          varying float vDepth;
          varying vec3 vWorldN;

          void main() {
            vec2 uv = vUv;
            // a double-sided quad seen from behind is mirrored; un-mirror the back so both sides read
            // identically as the FRONT (no wrong/mirrored back is ever visible, in any mode)
            if (!gl_FrontFacing) uv.x = 1.0 - uv.x;

            // rounded-rect shape (equal world-space corner radius)
            vec2 pc = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);
            vec2 halfExt = vec2(0.5 * uAspect, 0.5);
            float r = 0.045;
            vec2 q = abs(pc) - (halfExt - vec2(r));
            float sdf = length(max(q, 0.0)) - r;
            float shape = 1.0 - smoothstep(0.0, 0.006, sdf);
            if (shape <= 0.001) discard;

            // print border (uniform world thickness)
            float bK = 0.03;
            float bx = bK / uAspect;
            vec2 lo = vec2(bx, bK);
            vec2 hi = vec2(1.0 - bx, 1.0 - bK);
            float inPhoto = step(lo.x, uv.x) * step(uv.x, hi.x) * step(lo.y, uv.y) * step(uv.y, hi.y);

            vec3 col;
            if (inPhoto > 0.5) {
              vec2 puv = (uv - lo) / (hi - lo);
              col = texture2D(uMap, puv).rgb;
              // subtle inner edge shade for depth
              float edge = min(min(puv.x, 1.0 - puv.x), min(puv.y, 1.0 - puv.y));
              col *= 0.965 + 0.035 * smoothstep(0.0, 0.06, edge);
            } else {
              col = uBorder;
            }

            // hover / focus lift + gentle saturation swell
            float lift = uHover * 0.13 + uFocus * 0.22;
            col *= (1.0 + lift);
            float lum = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(lum), col, 1.0 + uHover * 0.10 + uFocus * 0.14);

            // faux warm directional light for dimensionality
            float nl = clamp(dot(normalize(vWorldN), uLightDir) * 0.5 + 0.5, 0.0, 1.0);
            col *= 0.92 + 0.10 * nl;

            // dim non-focused frames toward haze when a frame is in focus
            col = mix(col, uFog, uDim * 0.62);

            // haze. NUCLEUS mode: camera sits at the center, so plain exponential depth-fog dims the far
            // shell and keeps the near frames bright. ORB mode: viewed from outside, so haze should build
            // naturally from the orb's NEAR surface inward — the front hemisphere facing you stays bright
            // and the back side recedes into shadow. "behind" = depth past the near surface (0 at the
            // front), so exp-fog on it gives a physical front-to-back gradient. Blend the two by uOrb.
            float fDepth = clamp(1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth), 0.0, 1.0);
            float behind = max(0.0, vDepth - (uCamDist - uShellR));
            float ob = (0.69 / uShellR) * behind;
            float fOrb = 1.0 - exp(-ob * ob);
            float f = mix(fDepth, fOrb, uOrb);
            col = mix(col, uFog, f * (1.0 - uFocus));   // the focused frame ignores fog -> full brightness

            float alpha = shape * uReveal * uOpacity * (1.0 - f * 0.2);
            gl_FragColor = vec4(col, alpha);
          }
        `;

        // ---- deterministic layout (stable across loads) ----
        function mulberry32(a) {
          return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }
        const rng = mulberry32(20260708);
        const rand = (a, b) => a + (b - a) * rng();

        // ---- the full library IN ALBUM ORDER (album by album, numbered within) — canonical for focus stepping
        const ALBUM_SEQ = [];
        FOLDERS.forEach((f) => { const n = COUNTS[f] || 0; for (let i = 1; i <= n; i++) ALBUM_SEQ.push({ folder: f, idx: i, count: n, url: `/images/${f}/g/${i}.webp` }); });   // grid renditions: textures are capped at MAX_EDGE anyway
        const N_SEQ = ALBUM_SEQ.length;
        // streaming hands out a SHUFFLED order of indices into ALBUM_SEQ (variety in the live cloud)
        const POOL_ORDER = ALBUM_SEQ.map((_, i) => i);
        for (let i = POOL_ORDER.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = POOL_ORDER[i]; POOL_ORDER[i] = POOL_ORDER[j]; POOL_ORDER[j] = t; }
        let poolCursor = 0;
        const nextSeq = () => POOL_ORDER[(poolCursor++) % POOL_ORDER.length];   // next library index (shuffled)

        const layout = []; // one entry per plane
        const N_OCC = FOLDERS.length;
        const GOLDEN = Math.PI * (3 - Math.sqrt(5));   // golden angle
        // 1) seed each shoot as a loose pocket; pockets spread through the whole volume.
        for (let i = 0; i < N_OCC; i++) {
          // even angular coverage (Fibonacci sphere) so every direction has a pocket;
          // varied radius so pockets sit at different depths -> dense pockets with quiet gaps.
          const yv = 1 - ((i + 0.5) / N_OCC) * 2;        // 1 .. -1
          const rr = Math.sqrt(Math.max(0, 1 - yv * yv));
          const ph = i * GOLDEN;
          const rad = R * (0.40 + 0.60 * rng());         // 0.40R .. 1.0R — hollow nucleus (breathing room at center)
          const cc = new THREE.Vector3(
            Math.cos(ph) * rr * rad,
            yv * rad * Y_FLAT,                            // squish vertical -> oblate cloud
            Math.sin(ph) * rr * rad
          );
          for (let j = 0; j < FRAMES_PER; j++) {
            layout.push({
              occ: i, idx: j,
              pos: new THREE.Vector3(cc.x + rand(-9.5, 9.5), cc.y + rand(-7, 7), cc.z + rand(-9.5, 9.5)),
              baseH: rand(3.7, 6.1),                       // ~+20% bigger frames -> less whitespace
              bobPhase: rand(0, Math.PI * 2),
              bobSpeed: rand(0.28, 0.52),
              bobAmp: REDUCED ? 0 : rand(0.14, 0.34),
              rollAmp: REDUCED ? 0 : rand(0.008, 0.03),
              driftPhase: rand(0, Math.PI * 2),            // in/out depth drift (phase 1 of "serve up new")
              driftSpeed: rand(0.010, 0.028)          // very slow, calm depth cycling
            });
          }
        }
        // 2) relax: push apart any two frames closer than MIN_SEP so none overlap in space,
        //    then pull any stragglers back inside the oblate cloud. Deterministic (fixed seeds).
        const _sep = new THREE.Vector3();
        for (let pass = 0; pass < 22; pass++) {
          for (let a = 0; a < layout.length; a++) {
            for (let b = a + 1; b < layout.length; b++) {
              const pa = layout[a].pos, pb = layout[b].pos;
              _sep.subVectors(pa, pb);
              let d = _sep.length();
              if (d < 1e-4) { _sep.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); d = _sep.length() || 1; }
              if (d < MIN_SEP) {
                _sep.multiplyScalar(((MIN_SEP - d) * 0.5) / d);
                pa.add(_sep); pb.sub(_sep);
              }
            }
          }
          for (let a = 0; a < layout.length; a++) {
            const p = layout[a].pos;
            const nrm = Math.hypot(p.x / R, p.y / (R * Y_FLAT), p.z / R);
            if (nrm > 0.98) p.multiplyScalar(0.98 / nrm);
          }
        }
        // 3) orient each frame to face the cloud center (reads face-on from any radial vantage) + jitter.
        //    Object3D.lookAt is CORRECT here: for a plane it turns the +Z/front toward the target.
        const _plq = new THREE.Object3D(); _plq.up.set(0, 1, 0);
        for (let a = 0; a < layout.length; a++) {
          const L = layout[a];
          _plq.position.copy(L.pos); _plq.lookAt(center);
          _plq.rotateX(rand(-0.16, 0.16)); _plq.rotateY(rand(-0.22, 0.22)); _plq.rotateZ(rand(-0.06, 0.06));
          L.quat = _plq.quaternion.clone();
        }

        // ---- dust motes (atmosphere) ----
        let dust = null;
        {
          const N = SMALL ? 240 : 460;
          const g = new THREE.BufferGeometry();
          const p = new Float32Array(N * 3);
          for (let k = 0; k < N; k++) {
            p[k * 3]     = rand(-R * 1.25, R * 1.25);
            p[k * 3 + 1] = rand(-R * 0.95, R * 0.95);
            p[k * 3 + 2] = rand(-R * 1.25, R * 1.25);
          }
          g.setAttribute('position', new THREE.BufferAttribute(p, 3));
          const m = new THREE.PointsMaterial({
            color: 0xC9A47A, size: SMALL ? 0.09 : 0.075, sizeAttenuation: true,
            transparent: true, opacity: 0.5, depthWrite: false, fog: true
          });
          dust = new THREE.Points(g, m);
          dust.frustumCulled = false;
          scene.add(dust);
        }

        // ---- texture loading via LoadingManager ----
        const manager = new THREE.LoadingManager();
        const imgLoader = new THREE.ImageLoader(manager);
        const meshes = [];

        const fill = document.getElementById('ob-load-fill');
        manager.onProgress = (url, loaded, total) => {
          if (fill && total) fill.style.width = Math.round((loaded / total) * 100) + '%';
        };
        manager.onLoad = () => { if (!disposed) startReveal(); };
        manager.onError = (url) => { console.warn('[orbit] failed:', url); };

        const geo = new THREE.PlaneGeometry(1, 1);

        function makeTexture(img) {
          const long = Math.max(img.width, img.height);
          const scale = Math.min(1, MAX_EDGE / long);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(4, maxAniso);
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          return tex;
        }

        const camStart = homePos;   // reveal staggers inward from the establishing vantage
        let maxRevealDist = 1;

        layout.forEach((L) => {
          const seq0 = nextSeq();   // initial image from the shuffled library order
          imgLoader.load(ALBUM_SEQ[seq0].url, (img) => {
            if (disposed) return;
            const aspect = img.width / img.height;
            const tex = makeTexture(img);
            const mat = new THREE.ShaderMaterial({
              uniforms: {
                uMap: { value: tex }, uAspect: { value: aspect },
                uHover: { value: 0 }, uFocus: { value: 0 }, uDim: { value: 0 },
                uReveal: { value: 0 }, uOpacity: { value: 1 },
                uFog, uFogDensity, uBorder, uLightDir, uOrb, uShellR, uCamDist
              },
              vertexShader: VERT, fragmentShader: FRAG,
              // OPAQUE: rounded-corner cutout via discard (no blending) -> no back-to-front re-sort flicker.
              transparent: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geo, mat);
            const baseW = L.baseH * aspect, baseH = L.baseH;
            mesh.position.copy(L.pos);
            mesh.quaternion.copy(L.quat);
            mesh.scale.set(baseW, baseH, 1);
            mesh.renderOrder = 1;
            mesh.userData = {
              home: L.pos.clone(), baseW, baseH, aspect,
              baseQuat: L.quat.clone(), bobPhase: L.bobPhase, bobSpeed: L.bobSpeed,
              bobAmp: L.bobAmp, rollAmp: L.rollAmp,
              driftPhase: L.driftPhase, driftSpeed: L.driftSpeed, homeR: L.pos.length(),
              live: L.pos.clone(),   // live world position (eased toward drift target, repelled from neighbors)
              // --- streaming state ---
              tex,                   // current resident texture (disposed when swapped)
              seqIndex: seq0,        // which ALBUM_SEQ image this frame currently shows (for focus stepping)
              swapArmed: true,       // ready to request the next pool image at the next OUT (far) extreme
              pendingTex: null, pendingAspect: 1,   // loaded but not yet shown (applied only while hidden)
              swapScale: 1,          // eased 1 -> 0 at the OUT extreme; masks the texture swap
              hover: 0, focus: 0, dim: 0, revealDelay: 0
            };
            const d = L.pos.distanceTo(camStart);
            mesh.userData.dist = d;
            if (d > maxRevealDist) maxRevealDist = d;
            scene.add(mesh);
            meshes.push(mesh);
          }, undefined, () => {});
        });

        // ---- streaming: swap a frame's texture at its far extreme (masked by the scale-down) ----
        const swapManager = new THREE.LoadingManager();   // separate from the initial LoadingManager
        const swapLoader = new THREE.ImageLoader(swapManager);
        let activeLoads = 0;
        function requestSwap(m) {   // returns true only if a load actually started (so the caller keeps armed on a no-op)
          if (m.userData.pendingTex || activeLoads >= 4) return false;   // one in flight per mesh; cap concurrency
          const si = nextSeq();
          activeLoads++;
          swapLoader.load(ALBUM_SEQ[si].url, (img) => {
            activeLoads--;
            if (disposed) return;
            m.userData.pendingTex = makeTexture(img);
            m.userData.pendingAspect = img.width / img.height;
            m.userData.pendingSeq = si;
          }, undefined, () => { activeLoads--; });   // on error just free the slot
          return true;
        }
        function applyPending(m) {   // called only while the mesh is hidden (swapScale ~ 0)
          const u = m.userData;
          if (u.tex) u.tex.dispose();                // free the outgoing texture's VRAM
          u.tex = u.pendingTex;
          u.aspect = u.pendingAspect;
          u.seqIndex = u.pendingSeq;
          u.baseW = u.baseH * u.aspect;
          m.material.uniforms.uMap.value = u.tex;
          m.material.uniforms.uAspect.value = u.aspect;
          u.pendingTex = null;
        }

        // reveal delays once all present (computed in onLoad via dist)
        function computeDelays() {
          meshes.forEach((m) => {
            m.userData.revealDelay = REDUCED ? 0 : Math.min(0.6, (m.userData.dist / maxRevealDist) * 0.6);
          });
        }

        // ---- camera state (drag = look around; idle = settle in the center and slowly pan) ----
        const cam = {
          pos: homePos.clone(),
          yaw: homeYaw, pitch: homePitch,      // smoothed (rendered) look angles
          tYaw: homeYaw, tPitch: homePitch     // drag target — cam eases toward this each frame
        };
        const LOOK_FOLLOW = 18;                // how fast the look damps toward the target (higher = snappier)
        const tmpQ = new THREE.Quaternion();
        const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
        const _fE  = new THREE.Euler(0, 0, 0, 'YXZ');    // scratch for focus orientation
        const forward = new THREE.Vector3();
        const _fwd2   = new THREE.Vector3();
        const desiredPos = new THREE.Vector3();
        const desiredQuat = new THREE.Quaternion();
        // cloud rotation: the whole field slowly revolves around you (rigid -> spacing preserved)
        const cloudQuat = new THREE.Quaternion();
        const cloudE    = new THREE.Euler(0, 0, 0, 'YXZ');
        const _op       = new THREE.Vector3();   // scratch: a frame's drift+rotation target position
        const _rep      = new THREE.Vector3();   // scratch: repulsion axis between two frames
        const _fo       = new THREE.Object3D(); _fo.up.set(0, 1, 0);   // squares a focused frame upright
        // shortest signed angular difference target-current, wrapped to [-PI, PI]
        const angDiff = (target, cur) => Math.atan2(Math.sin(target - cur), Math.cos(target - cur));

        // cloud rotation = gentle auto-revolution (autoQuat, from cloudT) * user trackball (spinQuat)
        const autoQuat = new THREE.Quaternion();
        const spinQuat = new THREE.Quaternion();       // user orb spin, rebuilt each frame from yaw/pitch
        let userYaw = 0, userPitch = 0;                // orb longitude (free) + latitude (clamped upright)
        let yawVel = 0, pitchVel = 0;                  // fling momentum, per-axis scalars
        const _qy = new THREE.Quaternion(), _qp = new THREE.Quaternion();   // scratch: yaw/pitch quats
        const _dq      = new THREE.Quaternion();       // scratch delta rotation
        const _prevCloud = new THREE.Quaternion();     // last frame's cloudQuat (for the rigid per-frame spin delta)
        const _deltaCloud = new THREE.Quaternion();    // this frame's incremental cloud rotation (world frame)
        const _qInv    = new THREE.Quaternion();       // scratch inverse
        let focusYawTarget = 0;                         // while viewing in orb mode: yaw that brings `focused` to front
        const _sv      = new THREE.Vector3();          // scratch: a frame's home direction

        let focusMode = false;
        let focused = null;
        let focusOrbMode = false;         // true = viewing in ORB mode (spin-to-front); false = NUCLEUS (fly-to)
        let focusExitAt = -999;           // clock time focus was exited -> brief ease so we don't teleport back
        let pointerDown = false;          // true while a finger / button is held
        let lastInteract = -999;          // clock time of the last user input
        let cloudT = 0;                   // accumulated cloud-rotation time (freezes while you drive)
        let orbitFactor = 0;              // 0..1 eased gate on the cloud's revolution
        let zoom = Z_ORB;                 // camera distance from center: Z_ORB = orb vantage (outside), 0 = nucleus
        let zoomTarget = Z_ORB;           // launch in ORB mode
        const mouseNDC = new THREE.Vector2(0, 0);
        const parallax = new THREE.Vector2(0, 0);

        cam.tYaw = cam.yaw = homeYaw; cam.tPitch = cam.pitch = homePitch;
        camera.position.copy(orbDir).multiplyScalar(zoom);
        tmpE.set(cam.pitch, cam.yaw, 0); camera.quaternion.setFromEuler(tmpE);

        // ---- focus helpers ----
        // Orientation is built from yaw/pitch (camera convention: forward = -Z). We deliberately do
        // NOT use Object3D.lookAt for the camera — for a non-camera object it turns +Z toward the
        // target, which would aim the camera 180deg the wrong way.
        function focusTarget(mesh, outPos, outQuat) {
          // use the frame's INTENDED facing (base + cloud, not its live re-orienting quaternion), so the
          // camera placement is stable while the focused frame squares up to the viewer.
          const n = forward.set(0, 0, 1).applyQuaternion(mesh.userData.baseQuat).applyQuaternion(cloudQuat).normalize();
          const h = mesh.userData.baseH, w = mesh.userData.baseW;
          const vAspect = camera.aspect;
          const half = THREE.MathUtils.degToRad(FOV) * 0.5;
          const fillH = h / 0.74;
          const fillW = w / (0.82 * vAspect);
          const dist = (Math.max(fillH, fillW) * 0.5) / Math.tan(half);
          outPos.copy(mesh.position).addScaledVector(n, dist);            // stand off the front of the frame
          const f = _fwd2.copy(mesh.position).sub(outPos).normalize();    // camera forward -> toward the frame
          _fE.set(Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)), Math.atan2(-f.x, -f.z), 0);
          outQuat.setFromEuler(_fE);
        }

        // focus = a moving tour of the clicked photo's album, IN ORDER, through the cloud: each step
        // loads the next album photo onto a nearby frame and the camera flies to it.
        let focusSeq = 0, focusLoadToken = 0, focusPrev = null;
        function nearestMeshTo(m, avoid) {   // closest OTHER frame (short flight), skipping the one we came from
          let best = m, bestD = Infinity; const p = m.position;
          for (let i = 0; i < meshes.length; i++) {
            const o = meshes[i]; if (o === m || o === avoid) continue;
            const d = o.position.distanceToSquared(p);
            if (d < bestD) { bestD = d; best = o; }
          }
          return best;
        }
        function loadFocusImage(si, mesh) {   // load ALBUM_SEQ[si] into `mesh` (ignore stale loads)
          const token = ++focusLoadToken;
          swapLoader.load(ALBUM_SEQ[si].url, (img) => {
            if (disposed || token !== focusLoadToken || !focusMode || mesh !== focused) return;
            const u = mesh.userData, tex = makeTexture(img);
            if (u.tex) u.tex.dispose();
            u.tex = tex; u.aspect = img.width / img.height; u.seqIndex = si;
            u.baseW = u.baseH * u.aspect;
            mesh.material.uniforms.uMap.value = tex;
            mesh.material.uniforms.uAspect.value = u.aspect;
          }, undefined, () => {});
        }
        // set the orb-spin target that rotates `focused` to the FRONT (toward the camera) for viewing
        function aimFrontToFocus() {
          if (!focused) return;
          _sv.copy(focused.userData.home).applyQuaternion(autoQuat);   // this photo's current world direction
          focusYawTarget = -Math.atan2(_sv.x, _sv.z);                  // the yaw that turns it to the front (globe turn)
        }
        function enterFocus(mesh) {
          focusMode = true;
          focused = mesh;
          focusOrbMode = zoom > SHELL;   // ORB viewer (spin-to-front) vs NUCLEUS viewer (fly-to)
          mesh.userData.swapScale = 1;   // never view a frame that's mid-shrink
          focusSeq = mesh.userData.seqIndex;   // begin stepping from THIS photo's spot in its album
          focusPrev = null;
          yawVel = 0; pitchVel = 0;            // a tap ends any fling -> no stale momentum survives the focus session
          if (focusOrbMode) { zoomTarget = Z_ORB; aimFrontToFocus(); }   // orb: stay outside, spin photo to front
          lastInteract = clock.getElapsedTime();
          document.getElementById('ob-focusUI').classList.add('active');
          overlayEl.classList.add('in-focus');
          updateCounter();
          hideHint();
        }
        // adopt the camera's current pose into the drift state (no snap on resume)
        function syncCamFromCamera() {
          cam.pos.copy(camera.position);
          const fdir = forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
          cam.yaw = cam.tYaw = Math.atan2(-fdir.x, -fdir.z);
          cam.pitch = cam.tPitch = Math.asin(THREE.MathUtils.clamp(fdir.y, -1, 1));
        }
        function exitFocus() {
          if (!focusMode) return;
          syncCamFromCamera();
          focusMode = false;
          focused = null;
          focusExitAt = clock.getElapsedTime();   // ease the camera back for a moment (don't snap)
          lastInteract = -999;   // return to center immediately on exit — no need to touch the mouse
          document.getElementById('ob-focusUI').classList.remove('active');
          overlayEl.classList.remove('in-focus');
        }
        // reset: zoom back out to the whole-orb vantage (orb mode) and stop any trackball momentum
        function recenter() {
          if (focusMode) exitFocus();
          zoomTarget = Z_ORB;
          yawVel = 0; pitchVel = 0; userPitch = 0;   // stop the fling and level the orb
          hideHint();
        }
        function stepFocus(dir) {   // tour the album IN ORDER: fly to a nearby frame carrying the next photo
          if (!focusMode || !focused) return;
          focusSeq = (focusSeq + dir + N_SEQ) % N_SEQ;
          const prev = focused;
          const target = nearestMeshTo(focused, focusPrev);   // skip where we came from -> no ping-pong
          target.userData.swapScale = 1;    // don't fly toward a mid-shrink frame
          focusPrev = prev;
          focused = target;
          loadFocusImage(focusSeq, target); // load the next album photo into it
          if (focusOrbMode) aimFrontToFocus();   // orb: spin to front (nucleus: the camera flies to it)
          updateCounter();
        }
        function updateCounter() {   // position WITHIN the current album (anonymous — no album name)
          if (!focusMode) return;
          const item = ALBUM_SEQ[focusSeq];
          document.getElementById('ob-fcount').innerHTML = '<b>' + item.idx + '</b> / ' + item.count;
        }

        // ---- raycasting ----
        const raycaster = new THREE.Raycaster();
        function pick(nx, ny) {
          raycaster.setFromCamera({ x: nx, y: ny }, camera);
          const hits = raycaster.intersectObjects(meshes, false);
          return hits.length ? hits[0].object : null;
        }

        // ---- input ----
        const pointers = new Map();
        let dragging = false, tapCandidate = false, downTime = 0, downX = 0, downY = 0;
        let lastX = 0, lastY = 0, lastMoveT = 0;
        let focusDragAccum = 0;
        let lastPinch = 0;   // previous two-finger distance (pinch-to-zoom)
        let ROT = 0.0032;   // aim sensitivity, retuned per pointerType on each press

        function toNDC(x, y) {
          mouseNDC.x = (x / window.innerWidth) * 2 - 1;
          mouseNDC.y = -(y / window.innerHeight) * 2 + 1;
        }

        canvas.addEventListener('pointerdown', (e) => {
          canvas.setPointerCapture(e.pointerId);
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          pointerDown = true;
          overlayEl.classList.add('dragging');   // disables backdrop-filter blur while the pointer is down
          lastInteract = clock.getElapsedTime();
          firstInteraction();
          if (pointers.size === 1) {
            dragging = true; tapCandidate = true;
            ROT = e.pointerType === 'touch' ? 0.0044 : 0.0030;   // touch needs more travel per turn
            downTime = performance.now(); downX = e.clientX; downY = e.clientY;
            lastX = e.clientX; lastY = e.clientY; lastMoveT = downTime;
            focusDragAccum = 0;
            canvas.classList.add('dragging');
          } else if (pointers.size === 2) {
            dragging = false; tapCandidate = false; lastPinch = 0;   // two fingers: begin pinch-to-zoom
          }
        });

        canvas.addEventListener('pointermove', (e) => {
          if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          toNDC(e.clientX, e.clientY);

          if (pointers.size >= 2) {   // two fingers = pinch to zoom (bridges orb <-> nucleus)
            const pts = [...pointers.values()];
            const pd = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            if (lastPinch > 0) zoomTarget = THREE.MathUtils.clamp(zoomTarget - (pd - lastPinch) * 0.24, 0, Z_ORB);
            lastPinch = pd;
            lastInteract = clock.getElapsedTime();
            return;
          }
          if (!dragging) return;
          lastInteract = clock.getElapsedTime();

          const now = performance.now();
          const dt = Math.max(0.008, (now - lastMoveT) / 1000);
          const dx = e.clientX - lastX, dy = e.clientY - lastY;
          lastX = e.clientX; lastY = e.clientY; lastMoveT = now;
          if (Math.abs(e.clientX - downX) > 7 || Math.abs(e.clientY - downY) > 7) tapCandidate = false;

          if (focusMode) {
            focusDragAccum += dx;
            const TH = 90;
            if (focusDragAccum > TH) { stepFocus(-1); focusDragAccum = 0; }
            else if (focusDragAccum < -TH) { stepFocus(1); focusDragAccum = 0; }
            return;
          }

          if (zoom > SHELL) {
            // ORB mode: spin like a globe. Horizontal = free longitude; vertical = gentler and CLAMPED
            // latitude, so multidirectional exploring never tips the orb upside down.
            userYaw -= dx * ROT_ORB;
            userPitch = THREE.MathUtils.clamp(userPitch - dy * ROT_ORB_V, -MAX_PITCH, MAX_PITCH);
            yawVel += (-dx * ROT_ORB / dt - yawVel) * 0.35;         // horizontal fling carries
            pitchVel += (-dy * ROT_ORB_V / dt - pitchVel) * 0.35;
          } else {
            // NUCLEUS mode: look around (accumulate into the look target; inverted axes, no timing math)
            cam.tYaw += dx * ROT;
            cam.tPitch = THREE.MathUtils.clamp(cam.tPitch + dy * ROT, -1.15, 1.15);
          }
        });

        function endPointer(e, isCancel) {
          if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
          // a tap is only a genuine quick release — never a system-cancelled or capture-lost gesture
          if (!isCancel && tapCandidate && pointers.size === 0) {
            const dt = performance.now() - downTime;
            if (dt < 320) handleTap(e.clientX, e.clientY);
          }
          lastPinch = 0;   // pinch ends when a finger lifts
          if (pointers.size === 1) {
            // dropped from two fingers back to one: re-arm single-finger drag from the survivor
            const p = [...pointers.values()][0];
            dragging = true; tapCandidate = false;
            downX = lastX = p.x; downY = lastY = p.y; lastMoveT = performance.now();
          } else if (pointers.size === 0) {
            dragging = false; pointerDown = false;
            canvas.classList.remove('dragging'); overlayEl.classList.remove('dragging');
          }
          lastInteract = clock.getElapsedTime();
        }
        canvas.addEventListener('pointerup', (e) => endPointer(e, false));
        canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
        canvas.addEventListener('lostpointercapture', (e) => endPointer(e, true));
        on(window, 'blur', () => {   // window switch mid-drag: don't leave input stuck
          pointers.clear(); dragging = false; pointerDown = false;
          canvas.classList.remove('dragging'); overlayEl.classList.remove('dragging');
        });

        function handleTap(x, y) {
          toNDC(x, y);
          const hit = pick(mouseNDC.x, mouseNDC.y);
          if (hit) enterFocus(hit);              // tap any photo (either mode) -> tour its album
          else if (focusMode) exitFocus();
        }

        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          firstInteraction();
          lastInteract = clock.getElapsedTime();
          if (focusMode) {
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (d > 12) stepFocus(1);
            else if (d < -12) stepFocus(-1);
            return;
          }
          // scroll bridges the modes: up = zoom in (dive toward the nucleus), down = pull out to the orb
          zoomTarget = THREE.MathUtils.clamp(zoomTarget + e.deltaY * 0.11, 0, Z_ORB);
        }, { passive: false });

        on(window, 'keydown', (e) => {   // arrows step the album; Esc/leave are owned by main.html
          if (!focusMode) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { stepFocus(1); e.preventDefault(); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { stepFocus(-1); e.preventDefault(); }
        });

        // focus UI buttons (no close button — Esc, the wordmark, or tapping empty space all exit)
        on(document.getElementById('ob-fprev'), 'click', () => stepFocus(-1));
        on(document.getElementById('ob-fnext'), 'click', () => stepFocus(1));

        // chrome: info panel
        const info = document.getElementById('ob-info');
        const infoToggle = document.getElementById('ob-info-toggle');
        function openInfo() { info.classList.add('open'); infoToggle.setAttribute('aria-expanded', 'true'); }
        function closeInfo() { info.classList.remove('open'); infoToggle.setAttribute('aria-expanded', 'false'); }
        on(infoToggle, 'click', () => info.classList.contains('open') ? closeInfo() : openInfo());
        on(document, 'pointerdown', (e) => {
          if (info.classList.contains('open') && !info.contains(e.target) && !infoToggle.contains(e.target)) closeInfo();
        });
        on(document.getElementById('ob-reset'), 'click', recenter);

        // hint — on touch the dive gesture is pinch, not scroll
        const hint = document.getElementById('ob-hint');
        if (SMALL) hint.textContent = 'drag to spin  ·  pinch to dive in';
        let hintTimer = null, interacted = false;
        function showHint() { hint.classList.add('show'); hintTimer = setTimeout(hideHint, 6000); }
        function hideHint() { hint.classList.remove('show'); hint.classList.add('hide'); if (hintTimer) clearTimeout(hintTimer); }
        function firstInteraction() { if (!interacted) { interacted = true; hideHint(); } }

        // desktop hover feedback
        let hoverThrottle = 0;

        // ---- reveal ----
        let revealStart = -1;
        const revealDur = REDUCED ? 0.5 : 2.2;
        function startReveal() {
          computeDelays();
          revealStart = clock.getElapsedTime();
          const loader = document.getElementById('ob-loader');
          loader.classList.add('done');
          setTimeout(() => { loader.style.display = 'none'; }, 950);
          canvas.classList.add('ready');
          document.getElementById('ob-chrome').classList.add('ready');
          if (!REDUCED) setTimeout(showHint, 900);
        }

        // ---- resize ----
        function onResize() {
          const w = window.innerWidth, h = window.innerHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
          renderer.setSize(w, h, false);
        }
        on(window, 'resize', onResize);

        // ---- clock / visibility ----
        const clock = new THREE.Clock();
        let rafId = 0, running = true;
        on(document, 'visibilitychange', () => {
          if (disposed) return;
          if (document.hidden) { running = false; }
          else if (!running) { running = true; clock.getDelta(); cancelAnimationFrame(rafId); loop(); }
        });

        const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);

        // ---- main loop ----
        function loop() {
          if (!running) return;
          rafId = requestAnimationFrame(loop);
          const dt = Math.min(0.05, clock.getDelta());
          const t = clock.getElapsedTime();
          // "driving" = a real drag (pointer down AND moved). A mere tap must NOT freeze the auto-spin or
          // snap positions (that catch-up-then-lag reads as the orb pulsing on click-release).
          const driving = pointerDown && !tapCandidate;

          // --- zoom eases toward its target -> sets the mode (orb outside <-> nucleus inside) ---
          zoom += (zoomTarget - zoom) * smooth(ZOOM_RATE, dt);
          const orbMode = zoom > SHELL;
          const nf = THREE.MathUtils.clamp((SHELL - zoom) / SHELL, 0, 1);   // 0 at the shell -> 1 at the center
          // while the zoom is actively moving, pause the expensive per-frame extras (texture streaming's
          // WebP loads + GPU uploads, hover raycasts) so nothing stalls the main thread mid-transition.
          const zoomMoving = Math.abs(zoomTarget - zoom) > 0.4;
          // fog follows the mode: nucleus dims the far shell; orb builds haze from its near surface back.
          uOrb.value = THREE.MathUtils.smoothstep(zoom, SHELL * 0.5, SHELL * 1.3);
          uCamDist.value = zoom;   // camera rides the orb axis at `zoom` from center

          // --- look angles ---
          if (focusMode && focusOrbMode && focused) {
            // orb viewer: aim the (fixed, outside) camera at the focused photo so it's centered
            _sv.copy(focused.position).addScaledVector(orbDir, -zoom).normalize();
            cam.tYaw = Math.atan2(-_sv.x, -_sv.z);
            cam.tPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_sv.y, -1, 1)), -1.2, 1.2);
          } else if (orbMode && !focusMode) {
            cam.tYaw = homeYaw; cam.tPitch = homePitch;   // orb (not viewing): frame the center
          }
          if (pointerDown && !orbMode && !focusMode) {   // nucleus drag: 1:1, zero follow lag
            cam.yaw = cam.tYaw; cam.pitch = cam.tPitch;
          } else {
            cam.yaw += angDiff(cam.tYaw, cam.yaw) * smooth(LOOK_FOLLOW, dt);
            cam.pitch += (cam.tPitch - cam.pitch) * smooth(LOOK_FOLLOW, dt);
          }

          // --- desired camera pose ---
          if (focusMode && !focusOrbMode && focused) {
            focusTarget(focused, desiredPos, desiredQuat);   // NUCLEUS viewer: fly the camera to the photo
          } else {
            // zoom-based (orb, the orb-viewer, and nucleus look). The camera rides the orb axis at the
            // current zoom and NOTHING more: zooming all the way in lands you at the exact nucleus center
            // and holds still — the photos revolving around you supply the motion, not the camera.
            tmpE.set(cam.pitch, cam.yaw, 0);
            desiredQuat.setFromEuler(tmpE);
            desiredPos.copy(orbDir).multiplyScalar(zoom);
          }

          const flyRate = (focusMode && !focusOrbMode) ? 3.4 : 0;   // nucleus viewer flies the camera in
          const exiting = (t - focusExitAt) < 0.5;                  // brief post-exit ease (avoid a snap-back)
          if (pointerDown && !focusMode && !orbMode) {
            camera.position.copy(desiredPos);      // nucleus drag: pure 1:1 look
            camera.quaternion.copy(desiredQuat);
          } else if (flyRate || exiting) {
            // focus fly-in / fly-back: ease the (large) pose change over time
            const r = flyRate || 5;
            camera.position.lerp(desiredPos, smooth(r, dt));
            camera.quaternion.slerp(desiredQuat, smooth(r + 2, dt));
          } else {
            // ZOOM / orb / nucleus-look: `zoom` is already the single easing stage, so drive the position
            // straight from it. Adding a second position ease here cascades two exponentials, and a cascade
            // starts at ZERO velocity — that's the "lag from scroll to motion". Copying makes zoom immediate.
            camera.position.copy(desiredPos);
            camera.quaternion.slerp(desiredQuat, smooth(REDUCED ? 24 : 16, dt));
          }

          // --- reveal progress ---
          let revealProg = 1;
          if (revealStart >= 0) revealProg = Math.min(1, (t - revealStart) / revealDur);

          // --- desktop hover pick ---
          let hoverMesh = null;
          if (HOVERABLE && !focusMode && !dragging && !zoomMoving && revealStart >= 0) {
            hoverThrottle++;
            if (hoverThrottle % 2 === 0) hoverMesh = pick(mouseNDC.x, mouseNDC.y);
            else hoverMesh = lastHover || null;
            lastHover = hoverMesh;
          }
          canvas.classList.toggle('pointing', !!hoverMesh);

          // cloud revolution: a slow spin about a gently precessing (tumbling) axis. It's one
          // rigid rotation shared by every frame, so all pairwise spacing is preserved (no new
          // overlaps) — the photos orbit around the centered viewer like a slow electron cloud.
          if (!REDUCED) {
            // the cloud only revolves when you're NOT driving it: grabbing eases the rotation to a
            // stop (fast) so your drag never fights the motion; releasing lets it gently resume.
            const orbitTarget = (!driving && !focusMode) ? 1 : 0;
            orbitFactor += (orbitTarget - orbitFactor) * smooth(orbitTarget < orbitFactor ? 6.0 : 1.2, dt);
            cloudT += orbitFactor * dt;
            cloudE.set(0.16 * Math.sin(cloudT * 0.011), cloudT * ORBIT_SPIN, 0.11 * Math.sin(cloudT * 0.008));
            autoQuat.setFromEuler(cloudE);   // gentle auto-revolution
            if (focusMode && focusOrbMode) {
              // ORB viewer: turn the orb (yaw) to bring the focused photo to the front, and level it
              userYaw += angDiff(focusYawTarget, userYaw) * smooth(3.0, dt);
              userPitch += (0 - userPitch) * smooth(3.0, dt);
              yawVel = 0; pitchVel = 0;
            } else if (orbMode && !pointerDown && !focusMode && (Math.abs(yawVel) > 1e-4 || Math.abs(pitchVel) > 1e-4)) {
              // fling momentum (ORB mode only): decaying per-axis velocity; pitch stays clamped so it can't flip
              userYaw += yawVel * dt;
              userPitch = THREE.MathUtils.clamp(userPitch + pitchVel * dt, -MAX_PITCH, MAX_PITCH);
              const decay = Math.exp(-SPIN_DECAY * dt);
              yawVel *= decay; pitchVel *= decay;
            } else if (!pointerDown && (yawVel !== 0 || pitchVel !== 0)) {
              // in nucleus / focus with the pointer up: bleed any leftover fling away so it can't freeze
              // and later resurrect as a cloud lurch when you return to orb mode
              const decay = Math.exp(-SPIN_DECAY * dt);
              yawVel *= decay; pitchVel *= decay;
              if (Math.abs(yawVel) < 1e-4 && Math.abs(pitchVel) < 1e-4) { yawVel = 0; pitchVel = 0; }
            }
            // rebuild the user spin = yaw (about world up) then pitch (about world right) -> never rolls/inverts
            _qy.setFromAxisAngle(WORLD_UP, userYaw);
            _qp.setFromAxisAngle(WORLD_RIGHT, userPitch);
            spinQuat.copy(_qy).multiply(_qp);
            cloudQuat.copy(spinQuat).multiply(autoQuat);   // user orb spin on top of the auto-revolution
            // world-frame rotation applied to the cloud since last frame = cloudQuat * prevCloud^-1.
            // Used to spin the live positions RIGIDLY during an orb drag (preserves the relaxed spacing).
            _deltaCloud.copy(cloudQuat).multiply(_qInv.copy(_prevCloud).invert());
            _prevCloud.copy(cloudQuat);

            // 1) drift + rotate the LIVE positions (cheap, O(n)). Runs when idle OR while spinning the
            //    orb — a trackball drag must rotate the WHOLE cloud rigidly (not spin frames in place).
            //    Skipped only during a nucleus look-drag (there the cloud is genuinely frozen).
            const orbSpin = driving && orbMode;   // orb drag: track the spin tightly (fast, no snap)
            if (orbMode || !driving) {
              for (let i = 0; i < meshes.length; i++) {
                const u = meshes[i].userData;
                if (orbSpin) {
                  // orb drag: rotate the PERSISTENT (already-separated) position rigidly by this frame's
                  // cloud-rotation delta. The whole orb turns as one AND the relaxed spacing is preserved
                  // — no snap-to-raw, so nothing contracts on release. (Drift is frozen during a drag.)
                  u.live.applyQuaternion(_deltaCloud);
                } else {
                  let rf = 1 + DRIFT_AMP * Math.sin(cloudT * u.driftSpeed + u.driftPhase);
                  if (u.homeR > 0.01) rf = Math.max(rf, DRIFT_MIN_R / u.homeR);
                  _op.copy(u.home).multiplyScalar(rf).applyQuaternion(cloudQuat);
                  u.live.lerp(_op, smooth(2.2, dt));   // soft ease toward the drifting target when idle
                }
              }
            }
            // 2-3) mutual repulsion + nucleus clamp (O(n^2)). Run while idle AND during an orb spin so the
            //      spacing stays maintained continuously — the orb drag rigidly rotates the already-
            //      separated positions, and this keeps them tidy (and corrects any float drift) so nothing
            //      snaps apart on release. Rotation-equivariant (radial clamp + pairwise repel) ⇒ the orb
            //      still turns as one. Skip only a nucleus look-drag, where the cloud is genuinely frozen.
            if (orbMode || !driving) {
              for (let pass = 0; pass < 2; pass++) {
                for (let a = 0; a < meshes.length; a++) {
                  const pa = meshes[a].userData.live;
                  for (let b = a + 1; b < meshes.length; b++) {
                    const pb = meshes[b].userData.live;
                    _rep.subVectors(pa, pb);
                    const d = _rep.length();
                    if (d > 1e-4 && d < MIN_SEP) {
                      _rep.multiplyScalar(((MIN_SEP - d) * 0.5) / d);
                      pa.add(_rep); pb.sub(_rep);
                    }
                  }
                }
              }
              for (let i = 0; i < meshes.length; i++) {
                const p = meshes[i].userData.live, r = p.length();
                if (r > 0.01 && r < DRIFT_MIN_R) p.multiplyScalar(DRIFT_MIN_R / r);
              }
            }
          }

          // --- per-plane updates ---
          for (let i = 0; i < meshes.length; i++) {
            const m = meshes[i], u = m.userData;
            // place the frame at its live (repelled) position + gentle bob & roll, facing center
            if (!REDUCED) {
              m.position.set(u.live.x, u.live.y + Math.sin(cloudT * u.bobSpeed + u.bobPhase) * u.bobAmp, u.live.z);
              if (focusMode && m === focused) {
                // VIEWED frame (either mode): square it face-on + UPRIGHT with the SHORT rotation — keep
                // whichever side already faces you (both read correctly), so it never does a 180deg flip.
                forward.subVectors(camera.position, m.position).normalize();     // frame -> camera
                _fwd2.set(0, 0, 1).applyQuaternion(m.quaternion);                // current front normal
                const sgn = _fwd2.dot(forward) >= 0 ? 1 : -1;                    // face the near side (no flip)
                _fo.position.copy(m.position);
                _fo.lookAt(m.position.x + forward.x * sgn, m.position.y + forward.y * sgn, m.position.z + forward.z * sgn);
                m.quaternion.slerp(_fo.quaternion, smooth(9, dt));
              } else {
                m.quaternion.copy(cloudQuat).multiply(u.baseQuat);
                m.rotateZ(Math.sin(cloudT * u.bobSpeed * 0.7 + u.bobPhase) * u.rollAmp);
              }
            }
            // focus draws the clicked frame ON TOP (ignores depth) so nothing occludes it
            const wantDepth = !(focusMode && m === focused);
            if (m.material.depthTest !== wantDepth) { m.material.depthTest = wantDepth; m.renderOrder = wantDepth ? 1 : 10; }

            // --- streaming recycle: shrink away at the far (OUT) drift extreme, swap the image while
            //     hidden, then grow back in as a DIFFERENT photo. Opaque-safe (no alpha cross-fade). ---
            if (!REDUCED && revealProg >= 1) {   // don't shrink/swap during the intro reveal
              const sinv = Math.sin(cloudT * u.driftSpeed + u.driftPhase);   // +1 at the OUT extreme
              const hideT = (m === focused) ? 1 : (1 - THREE.MathUtils.smoothstep(sinv, 0.86, 0.99));
              u.swapScale += (hideT - u.swapScale) * smooth(6, dt);
              if (!driving && m !== focused && !zoomMoving) {
                // request while far; stay armed if the load couldn't start (concurrency cap) so it retries
                if (sinv > 0.9 && u.swapArmed && requestSwap(m)) u.swapArmed = false;
                else if (sinv < 0.7) u.swapArmed = true;                                  // re-arm coming in
                // apply only when genuinely hidden AND still shrinking (never on the grow-back)
                if (u.pendingTex && u.swapScale < 0.04 && hideT < u.swapScale) applyPending(m);
              }
            }

            // hover / focus / dim easing
            const hoverT = (m === hoverMesh) ? 1 : 0;
            const focusT = (focusMode && m === focused) ? 1 : 0;
            const dimT = (focusMode && m !== focused) ? 1 : 0;
            const k = smooth(REDUCED ? 24 : 9, dt);
            u.hover += (hoverT - u.hover) * k;
            u.focus += (focusT - u.focus) * k;
            u.dim += (dimT - u.dim) * smooth(REDUCED ? 24 : 6, dt);

            const un = m.material.uniforms;
            un.uHover.value = u.hover;
            un.uFocus.value = u.focus;
            un.uDim.value = u.dim;

            // reveal (staggered scale/opacity)
            const rev = THREE.MathUtils.clamp((revealProg - u.revealDelay) / (1 - u.revealDelay || 1), 0, 1);
            const eased = rev * rev * (3 - 2 * rev);
            un.uReveal.value = eased;
            let s = (REDUCED ? 1 : (0.9 + 0.1 * eased) * (1 + u.hover * 0.05)) * u.swapScale;
            if (!REDUCED && focusMode && focusOrbMode && m === focused) {
              // ORB viewer: the camera stays outside, so enlarge the frame to FILL the view
              // exactly like the nucleus viewer's fly-in does (same 74%/82% framing math).
              const half = THREE.MathUtils.degToRad(FOV) * 0.5;
              const distNuc = (Math.max(u.baseH / 0.74, u.baseW / (0.82 * camera.aspect)) * 0.5) / Math.tan(half);
              const fillS = (camera.position.distanceTo(m.position) / distNuc) * u.swapScale;
              s = THREE.MathUtils.lerp(s, fillS, u.focus);
            }
            m.scale.set(u.baseW * s, u.baseH * s, 1);
          }

          // dust drift
          if (dust && !REDUCED) dust.rotation.y = t * 0.006;

          renderer.render(scene, camera);
        }

        loop();

      // ---- teardown (called by orbitApp.destroy on exit) ----
      function destroy() {
        disposed = true;
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (hintTimer) clearTimeout(hintTimer);
        listeners.forEach((L) => { try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) {} });
        listeners.length = 0;
        focusMode = false; focused = null;
        try {
          meshes.forEach((m) => {
            const u = m.userData;
            if (u && u.tex && u.tex.dispose) u.tex.dispose();
            if (u && u.pendingTex && u.pendingTex.dispose) u.pendingTex.dispose();
            if (m.material) m.material.dispose();
            scene.remove(m);
          });
          if (geo) geo.dispose();
          if (dust) { scene.remove(dust); dust.geometry.dispose(); dust.material.dispose(); }
          renderer.dispose();
          if (renderer.forceContextLoss) renderer.forceContextLoss();
        } catch (e) {}
        // reset the overlay chrome so a fresh launch starts clean
        const q = (id) => document.getElementById(id);
        const loaderEl = q('ob-loader'); if (loaderEl) { loaderEl.classList.remove('done'); loaderEl.style.display = ''; }
        if (fill) fill.style.width = '0%';
        const chromeEl = q('ob-chrome'); if (chromeEl) chromeEl.classList.remove('ready');
        if (info) info.classList.remove('open');
        if (infoToggle) infoToggle.setAttribute('aria-expanded', 'false');
        const fu = q('ob-focusUI'); if (fu) fu.classList.remove('active');
        if (hint) hint.classList.remove('show', 'hide');
        if (overlayEl) overlayEl.classList.remove('dragging', 'in-focus');
        const st = q('ob-stage'); if (st) st.setAttribute('aria-hidden', 'true');
        // swap in a fresh canvas so a new WebGL context can attach on the next launch
        try {
          const parent = canvas.parentNode;
          const fresh = document.createElement('canvas');
          fresh.id = 'ob-canvas';
          if (parent) parent.replaceChild(fresh, canvas);
        } catch (e) {}
      }

      return {
        destroy: destroy,
        isFocus: () => focusMode,
        isInfoOpen: () => info.classList.contains('open'),
        exitFocus: () => exitFocus(),
        closeInfo: () => closeInfo()
      };
    }
  })();
  