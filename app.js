
  (function () {
    'use strict';

    /* ---------- environment / capability probes ---------- */
    function mm(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
    var reduce = mm('(prefers-reduced-motion: reduce)');
    var fine   = mm('(pointer: fine)');
    var coarse = mm('(pointer: coarse)');

    var GS   = window.gsap || null;
    var ST   = window.ScrollTrigger || null;
    var FLIP = window.Flip || null;
    var LENIS = window.Lenis || null;
    if (GS && ST)   { try { GS.registerPlugin(ST); }   catch (e) { ST = null; } }
    if (GS && FLIP) { try { GS.registerPlugin(FLIP); } catch (e) { FLIP = null; } }

    function hasWebGL() {
      try {
        var c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext &&
                  (c.getContext('webgl') || c.getContext('experimental-webgl')));
      } catch (e) { return false; }
    }
    var CURT = (typeof window.Curtains === 'function' &&
                typeof window.Plane === 'function' &&
                typeof window.Vec2 === 'function');
    /* Init curtains ONLY when: pointer:fine AND not reduced-motion AND WebGL is
       available AND curtains.js loaded. (View===home is enforced at runtime.) */
    var webglCapable = fine && !reduce && CURT && hasWebGL();

    var app        = document.getElementById('app');
    var wordmark   = document.querySelector('.wordmark');
    var shuffleBtn = document.getElementById('shuffleBtn');
    var shuffleIcon= shuffleBtn ? shuffleBtn.querySelector('svg') : null;
    var masonry    = document.getElementById('homeMasonry');
    var albumGrid  = document.getElementById('albumGrid');
    var surfaces   = Array.prototype.slice.call(document.querySelectorAll('.surface'));

    var VIEWS = ['home', 'album'];
    function pad(n) { return ('0' + n).slice(-2); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    /* mobile status/toolbar tint (shared by the lightbox + orbit). iOS Safari often ignores
       attribute mutations on an existing theme-color meta — it reliably notices node
       removal + insertion, so replace the tag outright. */
    function setThemeColor(c) {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m && m.parentNode) m.parentNode.removeChild(m);
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      m.setAttribute('content', c);
      document.head.appendChild(m);
    }

    /* ---------- LENIS momentum smooth-scroll, driven by GSAP ticker ----------
       Kept enabled on ALBUM + INFO. On HOME, when curtains is active we STOP
       Lenis and use native scrolling so curtains' built-in scroll tracking
       stays perfectly glued to each plane. */
    var lenis = null;
    if (GS && LENIS && !reduce && !coarse) {
      try {
        lenis = new LENIS({
          duration: 1.05,
          easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
          smoothWheel: true,
          smoothTouch: false
        });
        if (ST) lenis.on('scroll', ST.update);
        GS.ticker.add(function (t) { if (lenis) lenis.raf(t * 1000); });
        GS.ticker.lagSmoothing(0);
      } catch (e) { lenis = null; }
    }
    function scrollTop() {
      window.scrollTo(0, 0);
      if (lenis) { try { lenis.scrollTo(0, { immediate: true, force: true }); } catch (e) {} }
      lastScrollY = 0;
    }

    /* ================= HOME covers (baked w/h → aspect known synchronously) ================= */
    var COVERS = [
      { p: 'tahoe/1',   w: 2560, h: 1735 },
      { p: 'cdmxye/6',  w: 360,  h: 532  },
      { p: 'playa/2',   w: 2765, h: 4069 },
      { p: 'pdt/26',    w: 2274, h: 1536 },
      { p: 'splash/47', w: 1536, h: 2316 },
      { p: 'kyoto/27',  w: 1536, h: 2317 },
      { p: 'tokyo/13',  w: 1536, h: 2317 },
      { p: 'sapporo/2', w: 2318, h: 1536 },
      { p: 'pv/64',     w: 2292, h: 1536 },
      { p: 'cdmx/9',    w: 1514, h: 2284 },
      { p: 'oax/8',     w: 2048, h: 3089 },
      { p: 'bali/35',   w: 1536, h: 2316 },
      { p: 'japan/19',  w: 2317, h: 1536 }
    ].map(function (c) {
      return {
        folder: c.p.split('/')[0],
        src: '/images/' + c.p.replace('/', '/g/') + '.webp',   /* grid-size rendition; masters stay lightbox-only */
        w: c.w, h: c.h,
        aspect: c.w / c.h
      };
    });

    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    var printNodes   = [];
    var colEls       = [];
    var colTweens    = [];
    var lastColCount = 0;
    var homeReady    = false;
    var revealDone   = false;
    var entrancePending = false;

    function colCountFor(w) { return w >= 1024 ? 4 : (w >= 640 ? 3 : 2); }
    function gapFor(cols)   { return cols <= 2 ? 6 : 8; }

    function makePrint(cover, index) {
      var a = document.createElement('a');
      a.className = 'print';
      a.href = '/album/' + cover.folder + '/';
      a.setAttribute('data-nav', 'album');
      /* distinct, anonymous accessible names (all 13 were identical "View album") */
      a.setAttribute('aria-label', 'View album — ' + (ALBUM_META[cover.folder] || '') + ' photographs');
      a._folder = cover.folder;
      a._aspect = cover.aspect;

      var base = document.createElement('img');
      base.className = 'ph-base';
      base.src = cover.src;
      base.alt = '';
      base.loading = 'eager';
      base.decoding = 'async';
      base.width = cover.w;      /* baked intrinsic size → aspect known before load */
      base.height = cover.h;
      base.setAttribute('data-sampler', 'uTexture');   /* curtains texture (harmless in fallback) */
      try { base.fetchPriority = 'high'; } catch (e) {}
      a._baseImg = base;
      a.appendChild(base);

      /* live-peek overlay ONLY in the non-WebGL path (WebGL uses the shader hover
         instead; skipping the extra <img>s also keeps curtains' autoloader clean) */
      if (!webglCapable) {
        var peek = document.createElement('span');
        peek.className = 'peek';
        peek.setAttribute('aria-hidden', 'true');
        var pkA = document.createElement('img'); pkA.className = 'pk'; pkA.alt = '';
        var pkB = document.createElement('img'); pkB.className = 'pk'; pkB.alt = '';
        peek.appendChild(pkA); peek.appendChild(pkB);
        a._peek = peek; a._pkA = pkA; a._pkB = pkB;
        a.appendChild(peek);
      }

      var idx = document.createElement('span');
      idx.className = 'idx';
      /* the album's photo count — "a set lives here" — instead of a shuffle-order
         number that implied a sequence the masonry scrambles on every reshuffle */
      idx.textContent = String(ALBUM_META[cover.folder] || '');
      a._idxEl = idx;
      a.appendChild(idx);

      bindHover(a);
      return a;
    }

    /* remove per-column parallax before a re-layout rebuilds the columns */
    function killColTweens() {
      colTweens.forEach(function (tw) {
        try { if (tw.scrollTrigger) tw.scrollTrigger.kill(); tw.kill(); } catch (e) {}
      });
      colTweens = [];
    }

    /* subtle, transform-only, scrubbed per-column parallax (non-WebGL desktop only).
       Disabled under WebGL: column transforms would drift the glued planes. */
    function setupColumnParallax() {
      if (webglCapable) return;
      if (!(GS && ST) || reduce || !fine || coarse) return;
      colEls.forEach(function (col, i) {
        var dir = (i % 2 === 0) ? -1 : 1;
        var amt = (i % 2 === 0) ? 8 : 5;      /* tiny — never opens a visible gap */
        var tw = GS.fromTo(col,
          { yPercent: 0, y: -dir * amt },
          {
            y: dir * amt, ease: 'none',
            scrollTrigger: { trigger: masonry, start: 'top bottom', end: 'bottom top', scrub: 0.6 }
          });
        colTweens.push(tw);
      });
    }

    /* distribute uncropped covers into the currently-shortest column */
    function layout(skipParallax) {
      var cols = colCountFor(window.innerWidth);
      var gap  = gapFor(cols);
      lastColCount = cols;

      masonry.style.setProperty('--mcol-gap', gap + 'px');
      killColTweens();
      masonry.innerHTML = '';
      colEls = [];
      for (var c = 0; c < cols; c++) {
        var d = document.createElement('div');
        d.className = 'mcol';
        masonry.appendChild(d);
        colEls.push(d);
      }

      /* MEASURE real column width; guard the zero-width (hidden container) case */
      var colW = colEls[0].getBoundingClientRect().width;
      if (!colW || colW < 1) {
        var mw = masonry.getBoundingClientRect().width || (masonry.clientWidth || 0);
        colW = (mw - gap * (cols - 1)) / cols;
      }
      if (!colW || colW < 1) colW = 260;   /* last-ditch sane default */

      var heights = [];
      var rows = [];
      for (var k = 0; k < cols; k++) { heights.push(0); rows.push(0); }

      printNodes.forEach(function (node) {
        var min = 0;
        for (var i = 1; i < cols; i++) { if (heights[i] < heights[min]) min = i; }
        node._col = min;
        node._row = rows[min]++;
        colEls[min].appendChild(node);
        heights[min] += (colW / (node._aspect || 0.75)) + gap;   /* rendered height */
      });

      /* verify: with 13 covers no column should be empty; rebalance if ever so */
      for (var e = 0; e < cols; e++) {
        if (!colEls[e].children.length) {
          var tallest = 0;
          for (var f = 0; f < cols; f++) {
            if (colEls[f].children.length > colEls[tallest].children.length) tallest = f;
          }
          var moved = colEls[tallest].lastElementChild;
          if (moved) colEls[e].appendChild(moved);
        }
      }

      if (!skipParallax) setupColumnParallax();
    }

    /* ---- reveal helpers ---- */
    function showAllPrints() {
      printNodes.forEach(function (p) { p.style.opacity = ''; p.style.transform = ''; });
    }

    /* Entrance: in WebGL mode a brief, self-contained fade+rise on the DOM
       covers, THEN hand off to curtains (planes only appear once the covers
       have settled, so nothing is mid-transform when the glued planes snap in).
       In the non-WebGL path, the base scroll-batch cascade + column parallax. */
    function setupReveal() {
      if (revealDone) return;
      revealDone = true;

      if (reduce || !GS) {
        showAllPrints();
        if (webglCapable && currentView() === 'home') buildCurtainsNow();
        return;
      }

      if (webglCapable) {
        entrancePending = true;
        try {
          GS.set(printNodes, { opacity: 0, y: 22 });
          GS.to(printNodes, {
            opacity: 1, y: 0, duration: 0.7, ease: 'power3.out',
            stagger: function (i, el) { return (el._col || 0) * 0.06 + (el._row || 0) * 0.04; },
            onComplete: function () {
              showAllPrints();
              entrancePending = false;
              if (currentView() === 'home') buildCurtainsNow();
            }
          });
        } catch (e) {
          showAllPrints(); entrancePending = false;
          if (currentView() === 'home') buildCurtainsNow();
        }
        /* failsafe: never leave a cover invisible, and always attempt the handoff */
        setTimeout(function () {
          showAllPrints();
          if (entrancePending) {
            entrancePending = false;
            if (currentView() === 'home') buildCurtainsNow();
          }
        }, 3200);
        return;
      }

      /* ---- non-WebGL cascade reveal ---- */
      try {
        if (ST) {
          GS.set(printNodes, { opacity: 0, y: 22 });
          ST.batch(printNodes, {
            start: 'top 94%',
            onEnter: function (batch) {
              GS.to(batch, {
                opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', overwrite: true,
                stagger: function (i, el) { return (el._col || 0) * 0.08 + (el._row || 0) * 0.045; }
              });
            }
          });
          ST.refresh();
        } else {
          GS.from(printNodes, { opacity: 0, y: 22, duration: 0.7, ease: 'power3.out', stagger: 0.05 });
        }
      } catch (e) { showAllPrints(); }
      setTimeout(function () {
        printNodes.forEach(function (p) {
          if (p.style.opacity === '0' || getComputedStyle(p).opacity === '0') {
            p.style.opacity = '1'; p.style.transform = 'none';
          }
        });
      }, 3600);
    }

    /* ================= WebGL cover-hover (curtains.js) ================= */
    var VS = [
      'precision mediump float;',
      'attribute vec3 aVertexPosition;',
      'attribute vec2 aTextureCoord;',
      'uniform mat4 uMVMatrix;',
      'uniform mat4 uPMatrix;',
      'uniform float uTime;',
      'uniform float uScroll;',
      'uniform float uHover;',
      'uniform float uReveal;',
      'uniform vec2 uMouse;',
      'varying vec3 vVertexPosition;',
      'varying vec2 vTextureCoord;',
      'void main() {',
      '  vec3 pos = aVertexPosition;',
      '  float rev = clamp(uReveal, 0.0, 1.0);',
      '  pos.xy *= (mix(0.94, 1.0, rev) + uHover * 0.04);',     /* scroll-reveal scale + hover pop */
      '  pos.y -= (1.0 - rev) * 0.03;',                         /* gentle rise into place */
      '  float dm = distance(pos.xy, uMouse);',
      '  pos.z += uHover * smoothstep(0.9, 0.0, dm) * 0.03;',   /* much gentler bulge toward cursor */
      '  vTextureCoord = aTextureCoord;',
      '  vVertexPosition = pos;',
      '  gl_Position = uPMatrix * uMVMatrix * vec4(pos, 1.0);',
      '}'
    ].join('\n');

    var FS = [
      'precision mediump float;',
      'uniform sampler2D uTexture;',
      'uniform float uTime;',
      'uniform float uHover;',
      'uniform float uDim;',
      'uniform float uReveal;',
      'uniform vec2 uMouse;',
      'varying vec3 vVertexPosition;',
      'varying vec2 vTextureCoord;',
      'void main() {',
      '  vec2 uv = vTextureCoord;',
      '  vec2 fromMouse = vVertexPosition.xy - uMouse;',
      '  float dist = length(fromMouse);',
      '  float fall = smoothstep(0.85, 0.0, dist);',
      '  float ring = sin(dist * 13.0 - uTime * 3.2);',
      '  vec2 dir = fromMouse / (dist + 0.0001);',
      '  vec2 disp = dir * ring * (0.006 * uHover * fall);',
      '  vec2 uvOff = vec2(disp.x, -disp.y) * 0.5;',            /* plane-space -> uv (y flip) */
      '  vec2 split = vec2(dir.x, -dir.y) * (0.014 * uHover * fall);',
      '  float r = texture2D(uTexture, uv + uvOff + split).r;',
      '  float g = texture2D(uTexture, uv + uvOff).g;',
      '  float b = texture2D(uTexture, uv + uvOff - split).b;',
      '  vec3 col = vec3(r, g, b);',
      '  col *= (1.0 - uDim * 0.12);',                          /* sibling spotlight dim */
      '  float rev = clamp(uReveal, 0.0, 1.0);',
      '  col = mix(vec3(0.945, 0.925, 0.882), col, rev);',      /* scroll-reveal: fade in from paper */
      '  gl_FragColor = vec4(col, 1.0);',                       /* rev=1,uHover=0,uDim=0 => plain image */
      '}'
    ].join('\n');

    var curtains = null;
    var planes = [];
    var curtainsBuilt = false;
    var curtainsOK = false;
    var hoverCount = 0;
    var glIdleFrames = 0;   /* consecutive settled frames; past ~90 the canvas stops redrawing */
    function wakeCurtains() {
      glIdleFrames = 0;
      if (curtainsOK && curtains && curtainsActive()) { try { curtains.enableDrawing(); } catch (e) {} }
    }
    var scrollEffect = 0;
    var lastScrollY = (window.pageYOffset || 0);

    function curtainsActive() {
      return curtainsOK && !!curtains &&
             document.documentElement.classList.contains('curtains-on');
    }

    function onHomeScroll() {
      if (document.documentElement.getAttribute('data-view') !== 'home') return;
      var y = window.pageYOffset || 0;
      var dv = y - lastScrollY;
      lastScrollY = y;
      scrollEffect = clamp(scrollEffect + dv * 0.006, -0.6, 0.6);
      wakeCurtains();   /* resume drawing if idle-parked */
    }

    function initCurtains() {
      try {
        curtains = new window.Curtains({
          container: 'curtains-canvas',
          pixelRatio: Math.min(1.5, window.devicePixelRatio || 1),
          antialias: true,
          alpha: true,
          watchScroll: true,      /* native scroll on home => curtains tracks it directly */
          production: true
        });
      } catch (e) { return false; }

      if (!curtains || !curtains.gl) { return false; }

      /* Any failure downgrades to the plain <img> grid (imgs stay visible behind
         the transparent canvas) and re-enables the CSS/GSAP fallback hover. */
      curtains.onError(function () {
        curtainsOK = false;
        document.documentElement.classList.remove('curtains-on');
      });
      curtains.onContextLost(function () {
        /* show the DOM covers while the context is gone — if restoration never lands,
           the grid must not sit blank under a dead canvas */
        document.documentElement.classList.remove('curtains-on');
        try { curtains.restoreContext(); } catch (e) {}
      });
      curtains.onContextRestored(function () {
        if (curtainsOK && currentView() === 'home') {
          document.documentElement.classList.add('curtains-on');
          try { repositionPlanes(); } catch (e) {}
        }
      });
      curtains.onRender(function () {
        scrollEffect *= 0.90;
        if (Math.abs(scrollEffect) < 0.001) scrollEffect = 0;
        /* idle gate: when nothing animates (no hover/dim/reveal easing, no scroll momentum,
           no reshuffle), stop redrawing — identical frames were burning GPU/battery forever */
        var busy = scrollEffect !== 0 || hoverCount > 0 || reshuffling || !revealDone;
        if (!busy) {
          for (var i = 0; i < planes.length; i++) {
            var p = planes[i];
            if (p._h > 0.002 || p._dim > 0.002 || Math.abs(p._revealTarget - p._reveal) > 0.002) { busy = true; break; }
          }
        }
        glIdleFrames = busy ? 0 : glIdleFrames + 1;
        if (glIdleFrames > 90) { try { curtains.disableDrawing(); } catch (e) {} }   /* ~1.5s settled */
      });

      planes = [];
      printNodes.forEach(function (node, i) {
        if (!node._baseImg) return;
        var params = {
          vertexShader: VS,
          fragmentShader: FS,
          widthSegments: 20,
          heightSegments: 20,
          drawCheckMargins: { top: 4000, right: 0, bottom: 4000, left: 0 },
          uniforms: {
            uTime:   { name: 'uTime',   type: '1f', value: 0 },
            uHover:  { name: 'uHover',  type: '1f', value: 0 },
            uScroll: { name: 'uScroll', type: '1f', value: 0 },
            uDim:    { name: 'uDim',    type: '1f', value: 0 },
            uReveal: { name: 'uReveal', type: '1f', value: 1 },
            uMouse:  { name: 'uMouse',  type: '2f', value: [0, 0] }
          }
        };
        var plane;
        try { plane = new window.Plane(curtains, node, params); }
        catch (e) { return; }
        if (!plane) return;

        plane._ht = 0; plane._h = 0; plane._dim = 0;
        plane._mx = -99999; plane._my = -99999;
        /* scroll-reveal: 0 = faded to paper + slightly small/low, 1 = fully shown */
        var r0 = node.getBoundingClientRect();
        plane._reveal = (r0.top < window.innerHeight && r0.bottom > 0) ? 1 : 0;
        plane._revealTarget = plane._reveal;

        plane.onRender(function () {
          plane.uniforms.uTime.value += 1;
          plane._reveal += (plane._revealTarget - plane._reveal) * 0.085;
          plane.uniforms.uReveal.value = plane._reveal;
          plane._h += (plane._ht - plane._h) * 0.07;
          plane.uniforms.uHover.value = plane._h;
          plane.uniforms.uScroll.value = scrollEffect;
          var dimTarget = (hoverCount > 0 && plane._ht === 0) ? 1 : 0;
          plane._dim += (dimTarget - plane._dim) * 0.08;
          plane.uniforms.uDim.value = plane._dim;
          if (plane._h > 0.002) {
            var cc = plane.mouseToPlaneCoords(new window.Vec2(plane._mx, plane._my));
            var m = plane.uniforms.uMouse.value;
            plane.uniforms.uMouse.value = [
              m[0] + (cc.x - m[0]) * 0.2,
              m[1] + (cc.y - m[1]) * 0.2
            ];
          }
        });

        node._plane = plane;
        planes.push(plane);
      });

      if (!planes.length) { return false; }

      /* scroll-reveal: reveal each cover as it enters the viewport (tiles stay in place) */
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting && en.target._plane) {
              en.target._plane._revealTarget = 1;
              io.unobserve(en.target);
            }
          });
        }, { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
        printNodes.forEach(function (n) { if (n._plane && n._plane._reveal < 1) io.observe(n); });
      } else {
        planes.forEach(function (p) { p._revealTarget = 1; });
      }

      window.addEventListener('scroll', onHomeScroll, { passive: true });
      document.documentElement.classList.add('curtains-on');
      return true;
    }

    /* curtains.resize() + per-plane reposition — call after any layout change */
    function repositionPlanes() {
      if (!curtainsOK || !curtains) return;
      wakeCurtains();
      /* re-sync curtains' internal scroll to the REAL scroll first: after the scroll-locked orbit
         session its tracked value can be stale, which offsets every plane by the scroll amount
         (the scrambled/overlapping masonry). Then re-measure + re-glue each plane. */
      try { if (typeof curtains.updateScrollValues === 'function') curtains.updateScrollValues(0, window.pageYOffset || 0); } catch (e) {}
      try { curtains.resize(); } catch (e) {}
      planes.forEach(function (p) {
        try { if (typeof p.resize === 'function') p.resize(); } catch (e) {}
        try { if (typeof p.updatePosition === 'function') p.updatePosition(); } catch (e) {}
      });
    }

    function buildCurtainsNow() {
      if (curtainsBuilt || !webglCapable) return;
      if (currentView() !== 'home' || entrancePending) return;
      curtainsBuilt = true;
      /* clear any transient fallback hover state so planes align to untransformed boxes */
      if (GS) { try { GS.set(printNodes, { clearProps: 'transform' }); } catch (e) {} }
      printNodes.forEach(function (n) { n.classList.remove('is-hover'); stopPeek(n); });
      masonry.classList.remove('is-focusing');
      hoverCount = 0;
      curtainsOK = initCurtains();
      if (curtainsOK) {
        repositionPlanes();
        lastScrollY = window.pageYOffset || 0;
        /* Lenis stays running on home; it drives window scroll so curtains still tracks planes */
      }
    }

    /* Full teardown + fresh rebuild of the curtains layer — matches what a page reload does. Used on
       orbit exit: while orbit's heavy (texture-streaming) WebGL context is alive, curtains' context
       can be lost under GPU/VRAM pressure, leaving its planes corrupted (the scrambled/overlapping
       masonry) in a way a mere reposition can't repair. Dropping curtains-on FIRST reveals the DOM
       photo covers (the correct flexbox grid), so there is no broken intermediate state. */
    function rebuildCurtains() {
      if (!webglCapable) return;
      document.documentElement.classList.remove('curtains-on');
      document.documentElement.classList.remove('curtains-reshuffling');
      try { if (curtains && typeof curtains.dispose === 'function') curtains.dispose(); } catch (e) {}
      curtains = null;
      planes = [];
      curtainsBuilt = false;
      curtainsOK = false;
      /* drop any leftover <canvas> so the fresh context attaches cleanly */
      try {
        var cc = document.getElementById('curtains-canvas');
        if (cc) { var old = cc.querySelectorAll('canvas'); for (var i = 0; i < old.length; i++) old[i].remove(); }
      } catch (e) {}
      if (currentView() === 'home') buildCurtainsNow();
    }

    function enterHome() {
      if (!webglCapable) return;               /* plain masonry + Lenis smooth (handled in render) */
      if (!curtainsBuilt) {
        if (!entrancePending) buildCurtainsNow();
        return;
      }
      if (curtainsOK) {
        document.documentElement.classList.add('curtains-on');
        try { curtains.enableDrawing(); } catch (e) {}
        repositionPlanes();
        lastScrollY = window.pageYOffset || 0;
      }
    }

    function leaveHome() {
      if (curtainsOK && curtains) { try { curtains.disableDrawing(); } catch (e) {} }
      document.documentElement.classList.remove('curtains-on');
      /* drain hover state: a cover is always hovered when it's clicked, and its mouseleave
         fires after curtains-on is gone — without this the leaked _ht/hoverCount left the
         whole home grid dimmed 12% (and one cover popped) on every return home. */
      hoverCount = 0;
      planes.forEach(function (p) { if (p) p._ht = 0; });
      printNodes.forEach(function (n) { n.classList.remove('is-hover'); stopPeek(n); });
      masonry.classList.remove('is-focusing');
    }

    /* ---- FLIP reshuffle: the signature affordance ---- */
    var reshuffling = false;
    function reshuffle() {
      if (!homeReady || reshuffling) return;
      if (GS && shuffleIcon && !reduce) GS.to(shuffleIcon, { rotate: '+=180', duration: 0.6, ease: 'power2.out' });

      /* if the entrance is still animating, settle it first so Flip starts clean */
      if (entrancePending) {
        entrancePending = false;
        if (GS) { try { GS.killTweensOf(printNodes); } catch (e) {} }
        showAllPrints();
      }

      var wasCurtains = curtainsActive();

      if (!GS || !FLIP || reduce) {   /* graceful: re-randomise + relayout, no animation */
        shuffle(printNodes); layout(); showAllPrints();
        if (wasCurtains) repositionPlanes();
        else if (webglCapable && !curtainsBuilt && currentView() === 'home') buildCurtainsNow();
        return;
      }
      reshuffling = true;

      /* curtains can't follow a Flip tween: hide the canvas (plain <img>s show &
         animate) and pause drawing for the brief reshuffle. */
      if (wasCurtains) {
        document.documentElement.classList.add('curtains-reshuffling');
        try { curtains.disableDrawing(); } catch (e) {}
      }

      var state = FLIP.getState(printNodes, { props: 'opacity' });
      shuffle(printNodes);
      layout(true);                    /* mutate DOM to the final arrangement (parallax off during FLIP) */
      showAllPrints();                 /* ensure everything visible before FLIP measures */
      FLIP.from(state, {
        duration: 0.7,
        ease: 'power3.inOut',
        absolute: true,
        stagger: { amount: 0.28, from: 'center' },
        onComplete: function () {
          reshuffling = false;
          if (wasCurtains) {
            repositionPlanes();                      /* re-glue planes to the new layout */
            try { curtains.enableDrawing(); } catch (e) {}
            /* reveal the canvas a couple frames later, once planes have redrawn in place */
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                document.documentElement.classList.remove('curtains-reshuffling');
              });
            });
          } else if (webglCapable && !curtainsBuilt && currentView() === 'home') {
            buildCurtainsNow();          /* entrance was pre-empted by a reshuffle: build now */
          } else {
            setupColumnParallax();       /* restore woven parallax (non-WebGL) */
          }
          if (ST) { try { ST.refresh(); } catch (e) {} }
        }
      });
    }

    /* ---- hover: WebGL shader ripple/RGB-split OR (fallback) GSAP pop + live-peek ---- */
    function bindHover(node) {
      node.addEventListener('mouseenter', function () {
        if (reduce || !fine) return;
        node.classList.add('is-hover');
        if (curtainsActive()) {
          wakeCurtains();   /* the canvas may be idle-parked */
          if (node._plane) node._plane._ht = 1;   /* shader IS the hover effect — no transform */
          hoverCount++;
        } else {
          masonry.classList.add('is-focusing');
          if (GS) GS.to(node, { scale: 1.035, duration: 0.5, ease: 'back.out(2.2)', overwrite: 'auto' });
          startPeek(node);
        }
      });
      node.addEventListener('mouseleave', function () {
        if (reduce || !fine) return;
        node.classList.remove('is-hover');
        if (curtainsActive()) {
          if (node._plane) node._plane._ht = 0;
          hoverCount = Math.max(0, hoverCount - 1);
        } else {
          masonry.classList.remove('is-focusing');
          if (GS) GS.to(node, { scale: 1, duration: 0.45, ease: 'power2.out', overwrite: 'auto' });
          stopPeek(node);
        }
      });
      node.addEventListener('mousemove', function (e) {
        if (curtainsActive() && node._plane) { node._plane._mx = e.clientX; node._plane._my = e.clientY; }
      });
    }

    function startPeek(node) {
      var wrap = node._peek, a = node._pkA, b = node._pkB;
      if (!wrap) return;                 /* no peek overlay in WebGL-capable builds */
      if (!node._pkList) {
        node._pkList = ['1', '2', '3'].map(function (n) { return '/images/' + node._folder + '/g/' + n + '.webp'; });
        node._pkList.forEach(function (u) { var im = new Image(); im.src = u; });
      }
      wrap.style.opacity = '1';
      node._pkPos = 0;
      node._pkFront = 'a';
      a.src = node._pkList[0];
      a.style.opacity = '1';
      b.style.opacity = '0';
      node._pkTimer = setInterval(function () {
        node._pkPos = (node._pkPos + 1) % node._pkList.length;
        var front = node._pkFront === 'a' ? b : a;
        var back  = node._pkFront === 'a' ? a : b;
        var show = function () { front.style.opacity = '1'; back.style.opacity = '0'; };
        front.src = node._pkList[node._pkPos];
        if (front.complete && front.naturalWidth) { show(); }
        else { front.addEventListener('load', show, { once: true }); }
        node._pkFront = node._pkFront === 'a' ? 'b' : 'a';
      }, 1000);
    }
    function stopPeek(node) {
      if (node._pkTimer) { clearInterval(node._pkTimer); node._pkTimer = null; }
      if (node._peek) node._peek.style.opacity = '0';
    }

    /* ---- build home once, when the surface is actually visible/measurable ---- */
    function ensureHome() {
      if (!homeReady) {
        shuffle(COVERS);
        printNodes = COVERS.map(makePrint);
        homeReady = true;
        layout();
        setupReveal();
        /* re-read true dimensions once loaded (baked values already match, but be robust) */
        window.addEventListener('load', function () {
          var changed = false;
          printNodes.forEach(function (n) {
            var im = n._baseImg;
            if (im && im.naturalWidth && im.naturalHeight) {
              var ar = im.naturalWidth / im.naturalHeight;
              if (Math.abs(ar - n._aspect) > 0.02) { n._aspect = ar; changed = true; }
            }
          });
          if (changed && currentView() === 'home') layout();
          if (curtainsOK && currentView() === 'home') repositionPlanes();
          if (ST) { try { ST.refresh(); } catch (e) {} }
        });
      } else {
        /* returning to home: relayout only if the column count changed while away */
        if (colCountFor(window.innerWidth) !== lastColCount) layout();
        if (ST) { try { ST.refresh(); } catch (e) {} }
      }
    }

    /* re-run masonry only when the column count actually changes; keep planes glued */
    var rz;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        if (homeReady && colCountFor(window.innerWidth) !== lastColCount) layout();
        if (curtainsOK && currentView() === 'home') repositionPlanes();
        if (ST) { try { ST.refresh(); } catch (e) {} }
      }, 160);
    });

    /* ================= ALBUM ================= */
    /* single source of truth: album counts derive from the generated album-aspects.js
       manifest (gen-aspects.py reads the filesystem), so adding photos can't drift */
    var ALBUM_META = (function () {
      var m = {}, A = window.ALBUM_ASPECTS || {};
      for (var k in A) m[k] = A[k].length;
      return m;
    })();
    function albumFromLocation() {
      var m = (location.pathname || '').match(/\/album\/([a-z0-9]+)\/?$/i);
      return (m && ALBUM_META[m[1]]) ? m[1] : null;
    }
    var ALBUM_FOLDER = (document.body.dataset.album && ALBUM_META[document.body.dataset.album]) ? document.body.dataset.album
                     : (albumFromLocation() || 'kyoto');
    var ALBUM_COUNT  = ALBUM_META[ALBUM_FOLDER];
    var frames = [];

    function buildAlbum() {
      /* kill the outgoing album's scroll-reveal triggers before detaching its frames —
         otherwise each album visit leaks a batch of dead ScrollTriggers re-measured forever */
      if (ST) { try { ST.getAll().forEach(function (t) { if (t.trigger && albumGrid.contains(t.trigger)) t.kill(); }); } catch (e) {} }
      var html = '';
      var aspects = (window.ALBUM_ASPECTS && window.ALBUM_ASPECTS[ALBUM_FOLDER]) || null;
      for (var i = 1; i <= ALBUM_COUNT; i++) {
        var pinned = (i % 15 === 0) ? ' pinned' : '';
        var load = (i <= 4) ? 'eager' : 'lazy';
        /* reserve each frame's exact height BEFORE the image loads → no lazy-load reflow/jank */
        var ar = (aspects && aspects[i - 1]) ? ' style="aspect-ratio:' + aspects[i - 1] + '"' : '';
        html +=
          '<button class="frame' + pinned + '" type="button" data-i="' + (i - 1) + '">' +
            '<img src="/images/' + ALBUM_FOLDER + '/g/' + i + '.webp" alt="Photograph ' + pad(i) + '" loading="' + load + '" decoding="async"' + ar + ' />' +
            '<span class="fnum">' + pad(i) + ' / ' + ALBUM_COUNT + '</span>' +
          '</button>';
      }
      albumGrid.innerHTML = html;
      frames = Array.prototype.slice.call(albumGrid.querySelectorAll('.frame'));
      frames.forEach(function (f) {
        f.addEventListener('click', function () {
          openLightbox(parseInt(f.getAttribute('data-i'), 10), f);
        });
      });
    }
    /* built lazily: on album deep-links it builds during the initial render below; on home
       visits it waits for the first album navigation (the old unconditional boot call made
       every home load eagerly fetch the fallback album's first four photos into a hidden grid) */

    /* switch which album the album-view renders (used by in-app nav + popstate);
       re-arms the reveal stagger so each newly-entered album animates in */
    function switchAlbum(name) {
      if (!ALBUM_META[name] || name === ALBUM_FOLDER) return;
      ALBUM_FOLDER = name;
      ALBUM_COUNT  = ALBUM_META[name];
      buildAlbum();
      albumPrimed = false;
    }

    var albumPrimed = false;
    function primeAlbum() {
      if (albumPrimed) return;
      albumPrimed = true;
      if (reduce || !GS) return;         /* frames are visible by default */
      try {
        if (ST) {
          GS.set(frames, { opacity: 0, y: 18 });
          ST.batch(frames, {
            start: 'top 96%',
            onEnter: function (batch) {
              GS.to(batch, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.05, overwrite: true });
            }
          });
          ST.refresh();
        } else {
          GS.from(frames, { opacity: 0, y: 18, duration: 0.6, ease: 'power3.out', stagger: 0.03 });
        }
      } catch (e) { GS.set(frames, { opacity: 1, y: 0 }); }
      setTimeout(function () {
        frames.forEach(function (f) {
          if (f.style.opacity === '0' || getComputedStyle(f).opacity === '0') { f.style.opacity = '1'; f.style.transform = 'none'; }
        });
      }, 3600);
    }

    /* ================= INFO : editorial reveal (gentle GSAP stagger) ================= */
    var infoPrimed = false;
    function primeInfo() {
      if (infoPrimed) return;
      infoPrimed = true;
      if (reduce || !GS) return;         /* content visible by default */
      var eyebrow = document.querySelector('.info-eyebrow');
      var hero    = document.getElementById('infoHero');
      var blocks  = Array.prototype.slice.call(document.querySelectorAll('.info-block'));
      var all = [eyebrow, hero].concat(blocks);
      try {
        GS.set(all, { opacity: 0 });
        var tl = GS.timeline({ defaults: { ease: 'power3.out' } });
        tl.fromTo(eyebrow, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.52 })
          .fromTo(hero,    { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.62 }, '-=0.28')
          .fromTo(blocks,  { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12 }, '-=0.40');
      } catch (e) { GS.set(all, { opacity: 1, y: 0 }); }
      setTimeout(function () {
        all.forEach(function (el) {
          if (el && (el.style.opacity === '0' || getComputedStyle(el).opacity === '0')) { el.style.opacity = '1'; el.style.transform = 'none'; }
        });
      }, 3200);
    }

    /* ================= routing (base behaviour + curtains/Lenis lifecycle) ================= */
    /* current view: an in-app pushState/popstate entry (history.state) is authoritative once
       one exists; the very first load (no state yet) is decided from data-album / the real
       /album/<name>/ URL path, falling back to the legacy #hash / ?view= scheme, then Home. */
    function currentView() {
      var st = history.state;
      if (st && VIEWS.indexOf(st.view) !== -1) return st.view;
      if ((document.body.dataset.album && ALBUM_META[document.body.dataset.album]) || albumFromLocation()) return 'album';
      var h = (location.hash || '').replace('#', '').toLowerCase();
      if (VIEWS.indexOf(h) !== -1) return h;
      var q = (new URLSearchParams(location.search).get('view') || '').toLowerCase();
      if (VIEWS.indexOf(q) !== -1) return q;
      return 'home';
    }

    /* DOM-only view switch (no URL/History side effects) — used for the initial render,
       for popstate restores, and as the last step of navigate() below. */
    var prevView = null;
    var homeScroll = 0;   /* masonry position, restored when returning home from an album */
    function navigateView(v) {
      document.documentElement.setAttribute('data-view', v);
      surfaces.forEach(function (s) { s.hidden = (s.getAttribute('data-surface') !== v); });

      if (v !== prevView) {
        if (prevView === 'home') { homeScroll = window.pageYOffset || 0; leaveHome(); }  /* pause WebGL when leaving home */
        if (v === 'home' && prevView === 'album') {
          /* return to where the visitor left the masonry instead of dumping them at the top */
          window.scrollTo(0, homeScroll);
          if (lenis) { try { lenis.scrollTo(homeScroll, { immediate: true, force: true }); } catch (e) {} }
        } else {
          scrollTop();
        }
        if (v === 'home')  { ensureHome(); enterHome(); }
        if (v === 'album') { if (!frames.length) buildAlbum(); primeAlbum(); }

        /* Lenis smooth-scroll stays on for every view; it drives window scroll so
           curtains keeps tracking planes on home. Only orbit / lightbox pause it. */
        if (lenis) { try { lenis.start(); } catch (e) {} }

        prevView = v;
        if (ST) requestAnimationFrame(function () { try { ST.refresh(); } catch (e) {} });
      }
    }

    function render() { navigateView(currentView()); }

    /* navigate('home') or navigate('album', folder): switches the DOM view, then pushes the
       real shareable URL (/album/<name>/ or /) so Back/Forward/refresh behave. */
    function navigate(v, name) {
      if (v === 'album' && name) switchAlbum(name);
      navigateView(v);
      var album = (v === 'album') ? (name || ALBUM_FOLDER) : null;
      var url = album ? ('/album/' + album + '/') : '/';
      if (location.pathname !== url) history.pushState({ view: v, album: album }, '', url);
    }

    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-nav]') : null;
      if (!t) return;
      /* let modified clicks (cmd/ctrl/shift/alt) fall through so an album opens in a new tab/window */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      /* clicking the wordmark while already home = reshuffle, not navigate */
      if (t === wordmark && currentView() === 'home') { e.preventDefault(); reshuffle(); return; }
      e.preventDefault();
      navigate(t.getAttribute('data-nav'), t._folder);
    });
    /* set by the orbit section (nested scope): returns true when it consumed the pop */
    var orbitPop = null;
    window.addEventListener('popstate', function (e) {
      /* overlays first: Back closes the open layer instead of switching the view under it */
      if (lightbox.classList.contains('open')) dismissLightbox();
      if (orbitPop && orbitPop()) return;   /* orbit exit — the view beneath it never changed */
      var st = e.state || {};
      if (st.view === 'album' && st.album && ALBUM_META[st.album]) {
        switchAlbum(st.album);
        navigateView('album');
      } else {
        navigateView('home');
      }
    });
    window.addEventListener('hashchange', render);

    /* ================= LIGHTBOX ================= */
    var lightbox  = document.getElementById('lightbox');
    var lbImg     = document.getElementById('lb-img');
    var lbCounter = lightbox.querySelector('.lb-counter');
    var backdrop  = lightbox.querySelector('.lb-backdrop');
    var figure    = lightbox.querySelector('.lb-figure');
    var lbPrev    = lightbox.querySelector('.lb-prev');
    var lbNext    = lightbox.querySelector('.lb-next');
    var lbClose   = lightbox.querySelector('.lb-close');
    var curIdx = 0;
    var lastTrigger = null;

    var lbLoadToken = 0;
    function masterSrc(i) { return '/images/' + ALBUM_FOLDER + '/' + (i + 1) + '.webp'; }
    function setFrame(i, animate) {
      lbResetZoom();                           /* each frame starts unzoomed */
      var img = frames[i].querySelector('img');
      lbImg.src = img.currentSrc || img.src;   /* instant: the already-decoded grid rendition */
      lbImg.alt = img.alt;
      /* swap in the full-res master once it arrives (token-guarded against fast paging) */
      var token = ++lbLoadToken;
      var hi = new Image();
      hi.onload = function () { if (token === lbLoadToken) lbImg.src = hi.src; };
      hi.src = masterSrc(i);
      lbCounter.textContent = pad(i + 1) + ' / ' + frames.length;
      if (animate && !reduce) {
        if (GS) GS.fromTo(lbImg, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power1.out' });
        else if (lbImg.animate) lbImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease' });
      }
      /* warm the neighbours so arrows/swipes feel instant */
      if (frames.length > 1) {
        new Image().src = masterSrc((i + 1) % frames.length);
        new Image().src = masterSrc((i - 1 + frames.length) % frames.length);
      }
    }

    function openLightbox(i, trigger) {
      lastTrigger = trigger;
      curIdx = i;
      setFrame(i, false);
      lightbox.classList.add('open');
      lightbox.setAttribute('aria-hidden', 'false');
      app.setAttribute('inert', '');
      document.documentElement.classList.add('lb-open');
      setThemeColor('#17130F');   /* dark viewer → dark status/toolbar bars */
      /* sentinel history entry so Back closes the viewer (the mobile-native gesture)
         instead of switching the view underneath the open modal */
      try { history.pushState({ view: 'album', album: ALBUM_FOLDER, overlay: 'lb' }, '', location.pathname + location.search); } catch (e) {}
      if (lenis) { try { lenis.stop(); } catch (e) {} }
      if (!reduce) {
        if (GS) {
          GS.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: 'power2.out' });
          GS.fromTo(figure, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)' });
        } else if (figure.animate) {
          backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease' });
          figure.animate(
            [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }],
            { duration: 440, easing: 'cubic-bezier(.34,1.28,.4,1)' });
        }
      }
      lbClose.focus();
    }

    function go(d) {
      curIdx = (curIdx + d + frames.length) % frames.length;
      setFrame(curIdx, true);
    }

    /* UI close consumes the sentinel entry via history.back() → popstate → dismissLightbox(),
       so the history stack stays consistent whichever way the viewer is closed. */
    function closeLightbox() {
      if (history.state && history.state.overlay === 'lb') { history.back(); return; }
      dismissLightbox();
    }
    function dismissLightbox() {
      var finish = function () {
        lightbox.classList.remove('open');
        lightbox.setAttribute('aria-hidden', 'true');
        app.removeAttribute('inert');
        document.documentElement.classList.remove('lb-open');
        setThemeColor('#F4F1EA');
        lbResetZoom();
        if (lenis) { try { lenis.start(); } catch (e) {} }
        if (lastTrigger) lastTrigger.focus();
      };
      if (!reduce && GS) {
        GS.to(figure, { opacity: 0, scale: 0.96, duration: 0.18, ease: 'power1.in', onComplete: finish });
      } else if (!reduce && figure.animate) {
        var a = figure.animate(
          [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.96)' }],
          { duration: 180, easing: 'ease' });
        a.onfinish = finish;
      } else { finish(); }
    }

    lbPrev.addEventListener('click', function () { go(-1); });
    lbNext.addEventListener('click', function () { go(1); });
    lbClose.addEventListener('click', closeLightbox);

    lightbox.addEventListener('click', function (e) {
      if (e.target.closest('.lb-figure, .lb-nav, .lb-close')) return;
      closeLightbox();
    });

    /* trap over the VISIBLE controls (arrows are display:none on touch) */
    function trap(e) {
      var f = [lbPrev, lbNext, lbClose].filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (f.indexOf(document.activeElement) === -1) { e.preventDefault(); first.focus(); }
    }

    /* document-level so Esc/arrows keep working even when focus has left the lightbox
       (e.g. after clicking the photo or backdrop, which aren't focusable) */
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'Tab') { trap(e); }
    }, true);

    /* touch: swipe left/right through frames (suppressed while zoomed / multi-touch) */
    var tsx = null, tsy = null;
    lightbox.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) { tsx = tsy = null; return; }   /* pinches never read as swipes */
      tsx = e.changedTouches[0].clientX; tsy = e.changedTouches[0].clientY;
    }, { passive: true });
    lightbox.addEventListener('touchend', function (e) {
      if (tsx === null || lbZoom > 1) { if (e.touches.length === 0 && lbZoom <= 1) { tsx = tsy = null; } return; }
      var dx = e.changedTouches[0].clientX - tsx;
      var dy = e.changedTouches[0].clientY - tsy;
      tsx = tsy = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    /* ---- zoom: pinch + double-tap into the full-res master (touch); click-halves paging (desktop) ---- */
    var lbZoom = 1, lbPanX = 0, lbPanY = 0;
    var pinchD0 = 0, pinchZ0 = 1, panSX = 0, panSY = 0, lastTapT = 0;
    function touchDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    function lbApply(animate) {
      var mx = (lbZoom - 1) * figure.clientWidth / 2;    /* pan bounds: edges stay pinned to the frame */
      var my = (lbZoom - 1) * figure.clientHeight / 2;
      lbPanX = clamp(lbPanX, -mx, mx);
      lbPanY = clamp(lbPanY, -my, my);
      lbImg.style.transition = animate ? 'transform .28s cubic-bezier(.2,.7,.2,1)' : '';
      lbImg.style.transform = (lbZoom === 1) ? '' : 'translate(' + lbPanX + 'px,' + lbPanY + 'px) scale(' + lbZoom + ')';
    }
    function lbResetZoom() {
      lbZoom = 1; lbPanX = lbPanY = 0;
      lbImg.style.transition = ''; lbImg.style.transform = '';
    }
    figure.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        pinchD0 = touchDist(e.touches); pinchZ0 = lbZoom;
        e.preventDefault();
      } else if (e.touches.length === 1 && lbZoom > 1) {
        panSX = e.touches[0].clientX - lbPanX; panSY = e.touches[0].clientY - lbPanY;
      }
    }, { passive: false });
    figure.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinchD0 > 0) {
        lbZoom = clamp(pinchZ0 * (touchDist(e.touches) / pinchD0), 1, 4);
        lbApply(false); e.preventDefault();
      } else if (e.touches.length === 1 && lbZoom > 1) {
        lbPanX = e.touches[0].clientX - panSX; lbPanY = e.touches[0].clientY - panSY;
        lbApply(false); e.preventDefault();
      }
    }, { passive: false });
    figure.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) pinchD0 = 0;
      if (lbZoom < 1.05 && lbZoom !== 1) lbResetZoom();   /* snap back from a near-1 pinch */
      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        var now = performance.now();
        if (now - lastTapT < 300) {   /* double-tap: toggle 1x <-> 2.5x at the tapped point */
          if (lbZoom > 1) { lbZoom = 1; lbPanX = lbPanY = 0; }
          else {
            var r = figure.getBoundingClientRect();
            lbZoom = 2.5;
            lbPanX = (r.left + r.width / 2 - e.changedTouches[0].clientX) * (lbZoom - 1);
            lbPanY = (r.top + r.height / 2 - e.changedTouches[0].clientY) * (lbZoom - 1);
          }
          lbApply(true);
          lastTapT = 0;
        } else { lastTapT = now; }
      }
    });
    figure.addEventListener('click', function (e) {
      /* desktop: click the photo's left/right half to page (middle sliver is neutral) */
      if (!fine || lbZoom !== 1) return;
      var r = figure.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width;
      if (x < 0.45) go(-1);
      else if (x > 0.55) go(1);
    });

    /* ---- reshuffle control ---- */
    if (shuffleBtn) shuffleBtn.addEventListener('click', function () { reshuffle(); });

    /* =========================================================
       EASTER EGG — long-press the mark to warp into orbit.
       Quick tap keeps the mark's normal behaviour (navigate to
       info). Orbit (Three.js + its textures) is only imported the
       first time the egg fires. Everything is guarded so a WebGL
       failure degrades to a quiet "nope" and never breaks the site.
       ========================================================= */
    var markBtn = document.querySelector('.info-btn');
    var overlay = document.getElementById('orbit-overlay');

    if (markBtn && overlay) {
      var HOLD_MS = 900, RING_DELAY = 150;   /* ring appears only past a deliberate hold, not on a tap */
      var holdTimer = null, ringTimer = null, holding = false, suppressClick = false, suppressTimer = null;
      var orbitOpen = false, orbitBusy = false;
      var savedScroll = 0, savedView = 'home', wasCurtains = false;

      /* ============ INFO popup (quick-tap the mark) ============ */
      var siteInfo  = document.getElementById('site-info');
      var infoScrim = document.getElementById('site-info-scrim');
      var infoOpen = false, infoLastFocus = null, sheetDrag = { on: false, y: 0, active: false };

      function infoIsSheet() { return mm('(max-width: 560px)') || mm('(pointer: coarse)'); }
      function infoFocusables() {
        return Array.prototype.slice.call(
          siteInfo.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
        ).filter(function (n) { return n.offsetParent !== null; });
      }
      function openInfo() {
        if (infoOpen || !siteInfo) return;
        infoOpen = true;
        infoLastFocus = document.activeElement;
        var sheet = infoIsSheet();
        siteInfo.hidden = false; siteInfo.setAttribute('aria-hidden', 'false');
        if (sheet) { infoScrim.hidden = false; document.documentElement.classList.add('info-open'); }
        void siteInfo.offsetWidth;
        siteInfo.classList.add('open');
        if (sheet) infoScrim.classList.add('open');
        markBtn.setAttribute('aria-expanded', 'true');
        var f = infoFocusables(); if (f.length) { try { f[0].focus(); } catch (e) {} }
        document.addEventListener('keydown', infoKeydown, true);
        document.addEventListener('pointerdown', infoOutside, true);
        bindSheetDrag(sheet);
      }
      function closeInfo() {
        if (!infoOpen) return;
        infoOpen = false;
        siteInfo.classList.remove('open');
        if (infoScrim) infoScrim.classList.remove('open');
        markBtn.setAttribute('aria-expanded', 'false');
        document.documentElement.classList.remove('info-open');
        document.removeEventListener('keydown', infoKeydown, true);
        document.removeEventListener('pointerdown', infoOutside, true);
        bindSheetDrag(false);
        setTimeout(function () {
          if (infoOpen) return;   /* reopened meanwhile */
          siteInfo.hidden = true; siteInfo.setAttribute('aria-hidden', 'true');
          if (infoScrim) infoScrim.hidden = true;
          siteInfo.style.transform = ''; siteInfo.style.transition = '';
        }, reduce ? 220 : 380);
        if (infoLastFocus && infoLastFocus.focus) { try { infoLastFocus.focus(); } catch (e) {} }
      }
      function toggleInfo() { infoOpen ? closeInfo() : openInfo(); }

      function infoKeydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeInfo(); return; }
        if (e.key === 'Tab') {
          var f = infoFocusables(); if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (!siteInfo.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      function infoOutside(e) {
        if (siteInfo.contains(e.target) || markBtn.contains(e.target)) return;
        closeInfo();
      }

      /* swipe / drag the sheet down to dismiss (mobile) */
      function onSheetStart(e) { sheetDrag.active = true; sheetDrag.y = (e.touches ? e.touches[0].clientY : e.clientY); siteInfo.style.transition = 'none'; }
      function onSheetMove(e) {
        if (!sheetDrag.active) return;
        var dy = (e.touches ? e.touches[0].clientY : e.clientY) - sheetDrag.y;
        if (dy > 0) siteInfo.style.transform = 'translateY(' + dy + 'px)';
      }
      function onSheetEnd(e) {
        if (!sheetDrag.active) return;
        sheetDrag.active = false;
        siteInfo.style.transition = '';
        var dy = ((e.changedTouches ? e.changedTouches[0].clientY : e.clientY) || sheetDrag.y) - sheetDrag.y;
        if (dy > 70) closeInfo();
        else siteInfo.style.transform = '';
      }
      function bindSheetDrag(on) {
        if (on === sheetDrag.on) return;
        sheetDrag.on = on;
        var fn = on ? 'addEventListener' : 'removeEventListener';
        siteInfo[fn]('touchstart', onSheetStart, { passive: true });
        siteInfo[fn]('touchmove', onSheetMove, { passive: true });
        siteInfo[fn]('touchend', onSheetEnd);
        siteInfo[fn]('touchcancel', onSheetEnd);
      }

      /* --- warp OUT: the prints scatter/scale/blur off into space --- */
      function warpOut(done) {
        var nodes = printNodes || [];
        var homeWarp = (currentView() === 'home' && nodes.length);
        if (!GS || reduce || !homeWarp) {                 /* reduced-motion / non-home: calm crossfade */
          if (GS && nodes.length) { try { GS.to(nodes, { opacity: 0, duration: 0.3, overwrite: true }); } catch (e) {} }
          else nodes.forEach(function (n) { n.style.opacity = '0'; });
          if (done) done();
          return;
        }
        try {
          GS.killTweensOf(nodes);
          var vw = window.innerWidth, vh = window.innerHeight;
          GS.to(nodes, {
            duration: 0.72, ease: 'power2.in', opacity: 0,
            x: function () { return (Math.random() * 2 - 1) * vw * 0.55; },
            y: function () { return (Math.random() * 2 - 1) * vh * 0.55 - 50; },
            scale: function () { return 1.5 + Math.random() * 0.9; },
            rotation: function () { return (Math.random() * 2 - 1) * 34; },
            filter: 'blur(16px)',
            stagger: { amount: 0.34, from: 'center' },
            overwrite: true,
            onComplete: done
          });
        } catch (e) { nodes.forEach(function (n) { n.style.opacity = '0'; }); if (done) done(); }
      }

      /* --- warp IN: reverse — the prints fly back into place --- */
      function warpIn(done) {
        var nodes = printNodes || [];
        var clear = function () {
          nodes.forEach(function (n) { n.style.opacity = ''; n.style.transform = ''; n.style.filter = ''; });
          if (done) done();
        };
        var homeWarp = (savedView === 'home' && nodes.length);
        if (!GS || reduce || !homeWarp) {
          if (GS && nodes.length) { try { GS.to(nodes, { opacity: 1, duration: 0.3, overwrite: true, onComplete: clear }); } catch (e) { clear(); } }
          else clear();
          return;
        }
        try {
          GS.killTweensOf(nodes);
          GS.to(nodes, {
            duration: 0.72, ease: 'power3.out',
            opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, filter: 'blur(0px)',
            stagger: { amount: 0.3, from: 'edges' }, overwrite: true,
            onComplete: function () { try { GS.set(nodes, { clearProps: 'transform,filter,opacity' }); } catch (e) {} clear(); }
          });
        } catch (e) { clear(); }
      }

      function nopeCue() {
        if (reduce) return;
        markBtn.classList.remove('nope'); void markBtn.offsetWidth; markBtn.classList.add('nope');
        setTimeout(function () { markBtn.classList.remove('nope'); }, 480);
      }

      /* pause the main site while orbit runs */
      function pauseMain() {
        savedScroll = window.pageYOffset || 0;
        savedView = currentView();
        wasCurtains = curtainsActive();
        if (lenis) { try { lenis.stop(); } catch (e) {} }
        document.documentElement.classList.add('orbit-open');
        setThemeColor('#0C0A07');   /* orbit is dark → tint the mobile status/toolbar bars to match the scene */
        if (app) app.setAttribute('inert', '');
        if (wasCurtains) {                                 /* hide WebGL canvas so DOM covers can warp */
          document.documentElement.classList.add('curtains-reshuffling');
          if (curtains) { try { curtains.disableDrawing(); } catch (e) {} }
        }
      }
      function restoreMain() {
        if (app) app.removeAttribute('inert');
        document.documentElement.classList.remove('orbit-open');
        setThemeColor('#F4F1EA');   /* back to the paper site */
        window.scrollTo(0, savedScroll);
        if (lenis) { try { lenis.start(); } catch (e) {} }
        if (lastScrollY !== undefined) lastScrollY = savedScroll;
        if (curtainsBuilt) {
          /* Rebuild the curtains WebGL layer from scratch whenever an instance EXISTED — not just
             when it was actively shown (wasCurtains): entering orbit from an ALBUM view left the
             live-but-hidden curtains context exposed to the same corruption, un-rebuilt. Orbit's
             context pressure can corrupt it, and a mere re-glue can't repair that. Deferred a frame
             so the scroll restore + reflow settle; the DOM covers carry the grid during the swap. */
          requestAnimationFrame(function () {
            rebuildCurtains();
            if (ST) { try { ST.refresh(); } catch (e) {} }
          });
        }
      }

      /* main-owned orbit controls (bound only while open) */
      function orbitKeydown(e) {
        if (e.key !== 'Escape') return;
        if (window.orbitApp && window.orbitApp.isFocus()) { window.orbitApp.exitFocus(); e.stopPropagation(); return; }
        if (window.orbitApp && window.orbitApp.isInfoOpen()) { window.orbitApp.closeInfo(); e.stopPropagation(); return; }
        e.stopPropagation(); exitOrbit();
      }
      function obHomeClick(e) {
        e.preventDefault();
        if (window.orbitApp && window.orbitApp.isFocus()) window.orbitApp.exitFocus();
        else exitOrbit();
      }
      function obExitClick(e) { e.preventDefault(); exitOrbit(); }
      function bindOrbitControls(bind) {
        var fn = bind ? 'addEventListener' : 'removeEventListener';
        window[fn]('keydown', orbitKeydown, true);
        var hl = document.getElementById('ob-home-link'); if (hl) hl[fn]('click', obHomeClick);
        var ex = document.getElementById('ob-exit'); if (ex) ex[fn]('click', obExitClick);
      }

      function beginOrbit() {
        if (orbitOpen || orbitBusy) return;
        if (!window.orbitApp || !hasWebGL()) { nopeCue(); return; }  /* clean fail: no overlay, no warp */
        orbitBusy = true;
        closeInfo();                                       /* never leave the popup open behind orbit */
        pauseMain();

        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');      /* the overlay IS the page while open (app is inert) */
        void overlay.offsetWidth;                          /* reflow so the fade animates */
        overlay.classList.add('visible');
        warpOut();                                         /* prints fly off as the overlay + loader rise */

        var settled = false;
        var watchdog = setTimeout(function () {
          if (settled) return; settled = true;
          try { window.orbitApp.destroy(); } catch (e) {}
          failOrbit();
        }, 9000);

        Promise.resolve().then(function () { return window.orbitApp.init(); }).then(function (ok) {
          if (settled) { if (ok) { try { window.orbitApp.destroy(); } catch (e) {} } return; }
          settled = true; clearTimeout(watchdog);
          if (ok) succeedOrbit(); else failOrbit();
        }).catch(function (err) {
          if (settled) return; settled = true; clearTimeout(watchdog);
          if (window.console) console.warn('[orbit] launch failed', err);
          failOrbit();
        });
      }

      function succeedOrbit() {
        orbitOpen = true; orbitBusy = false;
        bindOrbitControls(true);
        /* sentinel history entry so Back exits the orbit instead of silently switching
           the (hidden) view underneath the overlay */
        try { history.pushState({ view: savedView, album: (savedView === 'album' ? ALBUM_FOLDER : null), overlay: 'orbit' }, '', location.pathname + location.search); } catch (e) {}
      }

      /* graceful failure: dissolve the overlay, warp the prints back, quiet cue */
      function failOrbit() {
        try { window.orbitApp.destroy(); } catch (e) {}
        overlay.classList.remove('visible');
        setTimeout(function () {
          overlay.hidden = true;
          overlay.setAttribute('aria-hidden', 'true');
          warpIn(function () { orbitBusy = false; });
          restoreMain();
          nopeCue();
        }, reduce ? 160 : 420);
      }

      /* UI exits (Esc / wordmark) consume the sentinel entry via history.back() → popstate →
         exitOrbitNow(), so the stack stays consistent however the orbit is left. */
      function exitOrbit() {
        if (!orbitOpen || orbitBusy) return;
        if (history.state && history.state.overlay === 'orbit') { history.back(); return; }
        exitOrbitNow();
      }
      function exitOrbitNow() {
        if (!orbitOpen || orbitBusy) return;
        orbitBusy = true;
        bindOrbitControls(false);
        overlay.classList.remove('visible');             /* orbit field fades with the overlay */
        setTimeout(function () {
          overlay.hidden = true;
          overlay.setAttribute('aria-hidden', 'true');
          try { window.orbitApp.destroy(); } catch (e) {}
          restoreMain();
          warpIn(function () { orbitOpen = false; orbitBusy = false; });
        }, reduce ? 160 : 620);
      }
      /* bridge for the outer popstate handler (orbitOpen lives in this scope) */
      orbitPop = function () {
        if (orbitOpen || orbitBusy) { exitOrbitNow(); return true; }
        return false;
      };

      /* ---- long-press detection (mouse / pen / touch via Pointer Events) ---- */
      function startHold(e) {
        if (orbitOpen || orbitBusy) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        holding = true;
        if (ringTimer) clearTimeout(ringTimer);
        ringTimer = setTimeout(function () { if (holding) markBtn.classList.add('holding'); }, RING_DELAY);
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(function () {
          holdTimer = null;
          if (!holding) return;
          holding = false;
          markBtn.classList.remove('holding');
          suppressClick = true;                            /* swallow the click that follows the hold */
          if (suppressTimer) clearTimeout(suppressTimer);
          suppressTimer = setTimeout(function () { suppressClick = false; }, 700);
          beginOrbit();
        }, HOLD_MS);
      }
      function cancelHold() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
        holding = false;
        markBtn.classList.remove('holding');
      }
      markBtn.addEventListener('pointerdown', startHold);
      markBtn.addEventListener('pointerup', cancelHold);
      markBtn.addEventListener('pointerleave', cancelHold);
      markBtn.addEventListener('pointercancel', cancelHold);
      /* capture phase: block the delegated [data-nav] navigation after a completed hold */
      markBtn.addEventListener('click', function (e) {
        if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; }
      }, true);

      /* quick tap toggles the info popup (the capture handler above swallows the click if a long-press completed) */
      markBtn.addEventListener('click', function () { toggleInfo(); });
      var protoInfo = document.getElementById('protoInfo');
      if (protoInfo) protoInfo.addEventListener('click', function () { toggleInfo(); });
    }

    /* ================= boot ================= */
    /* prime the initial history entry with real state so a Back to it (after in-app nav)
       restores the correct view/album instead of falling through to Home */
    try {
      var initView = currentView();
      history.replaceState({ view: initView, album: (initView === 'album') ? ALBUM_FOLDER : null }, '', location.href);
    } catch (e) {}
    render();
    if (GS && !reduce && wordmark) {
      GS.from(wordmark, { opacity: 0, scale: 0.96, duration: 0.8, ease: 'back.out(1.5)' });
    }
  })();
  