// Shared gallery/lightbox logic
let imageLayoutData = [];
let currentImageIndex = 0;

// ── Anime.js helpers ─────────────────────────────────────────────────────────

function loadAnime() {
  return new Promise((resolve) => {
    if (window.anime) { resolve(window.anime); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js';
    s.integrity = 'sha384-fXdIufVbE9aU7STmdk/DWK0imNOozId9fTwzM/gi0NfPjphEIC3gq0M760UnsKVy';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.anime);
    document.head.appendChild(s);
  });
}

// Desktop: photos drop and settle into their scattered positions on load
function animatePhotoToss(gallery, onComplete) {
  loadAnime().then(anime => {
    const imgs = Array.from(gallery.querySelectorAll('img'));
    anime({
      targets: imgs,
      opacity: [0, 1],
      top: (el) => {
        const t = parseFloat(el.style.top) || 0;
        return [t - 18 - Math.random() * 18, t];
      },
      duration: () => 480 + Math.random() * 220,
      delay: anime.stagger(40, { from: 'random' }),
      easing: 'spring(1, 85, 9, 0)',
      complete: onComplete,
    });
  });
}

// All pages: wordmark spring entrance on load
function animateWordmark() {
  loadAnime().then(anime => {
    const el = document.querySelector('header h1 svg');
    if (!el) return;
    anime({ targets: el, opacity: [0, 1], scale: [0.88, 1], duration: 700, easing: 'spring(1, 75, 7, 0)' });
  });
}

// Mobile: infinite carousel with depth effect — center card in foreground, sides recede
function setupInfiniteCarousel(gallery) {
  const origCards = Array.from(gallery.querySelectorAll('a'));
  const n = origCards.length;
  if (n === 0) return;

  // Prepend clones (reversed insertion = original order prepended)
  // so immediately left of first real card is the last album
  [...origCards].reverse().forEach(c => {
    const clone = c.cloneNode(true);
    gallery.insertBefore(clone, gallery.firstChild);
  });
  // Append clones so scrolling right past last wraps to first
  origCards.forEach(c => {
    const clone = c.cloneNode(true);
    gallery.appendChild(clone);
  });

  function getCards() { return Array.from(gallery.querySelectorAll('a')); }

  function updateDepth() {
    const cards = getCards();
    const galleryCenter = gallery.scrollLeft + gallery.offsetWidth / 2;
    cards.forEach(card => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(galleryCenter - cardCenter);
      const norm = Math.min(dist / (gallery.offsetWidth * 0.6), 1);
      const scale = 1 - norm * 0.18;
      const brightness = 1 - norm * 0.35;
      const img = card.querySelector('img');
      if (img) {
        img.style.transform = `scale(${scale.toFixed(3)})`;
        img.style.filter = `brightness(${brightness.toFixed(2)})`;
      }
    });
  }

  // Center the first real card on init (index n in the 3n total).
  // Double-rAF: first frame lets flex layout settle after clones are inserted;
  // snap is disabled during the jump so the browser doesn't re-snap to a wrong card.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const cards = getCards();
      const firstReal = cards[n];
      if (firstReal) {
        gallery.style.scrollSnapType = 'none';
        const gRect = gallery.getBoundingClientRect();
        const cRect = firstReal.getBoundingClientRect();
        gallery.scrollLeft += (cRect.left + cRect.width / 2) - (gRect.left + gRect.width / 2);
        requestAnimationFrame(() => {
          gallery.style.scrollSnapType = '';
          updateDepth();
        });
      }
    });
  });

  // After scroll settles, jump back to real cards if in clone zone
  let scrollTimer;
  let rafId = null;
  gallery.addEventListener('scroll', () => {
    // Throttle depth updates to one per animation frame to prevent jitter
    if (!rafId) {
      rafId = requestAnimationFrame(() => { updateDepth(); rafId = null; });
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const cards = getCards();
      const galleryCenter = gallery.scrollLeft + gallery.offsetWidth / 2;
      let centeredIdx = 0, minDist = Infinity;
      cards.forEach((c, i) => {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - galleryCenter);
        if (d < minDist) { minDist = d; centeredIdx = i; }
      });
      if (centeredIdx < n || centeredIdx >= 2 * n) {
        const step = n > 1
          ? cards[n + 1].offsetLeft - cards[n].offsetLeft
          : (cards[n] ? cards[n].offsetWidth : 300) + 14;
        const jump = centeredIdx < n ? n * step : -(n * step);
        gallery.style.scrollSnapType = 'none';
        gallery.scrollLeft += jump;
        requestAnimationFrame(() => {
          gallery.style.scrollSnapType = '';
          updateDepth();
        });
      }
    }, 200);
  });
}

function getAlbumFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const albumFromQuery = params.get('album');
  if (albumFromQuery) return albumFromQuery;

  const hashAlbum = window.location.hash.replace(/^#/, '').trim();
  if (hashAlbum) return decodeURIComponent(hashAlbum);

  const pathMatch = window.location.pathname.match(/album(?:\.html)?\/([^/]+)/i);
  if (pathMatch && pathMatch[1]) return decodeURIComponent(pathMatch[1]);

  return null;
}

function getSiteBasePath() {
  const galleryScript = document.querySelector('script[src*="js/gallery.js"]');
  if (!galleryScript) return "/";

  const scriptUrl = new URL(galleryScript.src, window.location.href);
  return scriptUrl.pathname.replace(/js\/gallery\.js$/, "");
}

function buildImagePath(folder, imageIndex) {
  return `${getSiteBasePath()}images/${folder}/${imageIndex}.jpg`;
}

async function imageExists(path) {
  try {
    const headResponse = await fetch(path, { method: "HEAD", cache: "no-store" });
    if (headResponse.ok) return true;
  } catch (_err) {
    // Fallback below covers static hosts that do not support HEAD requests.
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = `${path}${path.includes("?") ? "&" : "?"}probe=${Date.now()}`;
  });
}

async function detectTotalImages(folder, maxProbe = 1000) {
  if (!(await imageExists(buildImagePath(folder, 1)))) return 0;

  let low = 1;
  let high = 2;
  while (high <= maxProbe && (await imageExists(buildImagePath(folder, high)))) {
    low = high;
    high *= 2;
  }

  let left = low;
  let right = Math.min(high - 1, maxProbe);

  while (left < right) {
    const mid = Math.ceil((left + right) / 2);
    if (await imageExists(buildImagePath(folder, mid))) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  return left;
}

function adjustGalleryHeight() {
  const gallery = document.getElementById("gallery");
  const images = gallery.querySelectorAll("img");
  let maxBottom = 0;

  images.forEach(img => {
    const top = parseFloat(img.style.top);
    const height = img.offsetHeight || 0;
    if (top + height > maxBottom) {
      maxBottom = top + height;
    }
  });

  gallery.style.height = `${Math.ceil(maxBottom + window.innerHeight * 0.15)}px`;
}

function showNextImage(folder) {
  if (currentImageIndex < imageLayoutData.length - 1) {
    currentImageIndex++;
    document.getElementById('lightbox-img').src = buildImagePath(folder, imageLayoutData[currentImageIndex].imgIndex);
  }
}

function showPrevImage(folder) {
  if (currentImageIndex > 0) {
    currentImageIndex--;
    document.getElementById('lightbox-img').src = buildImagePath(folder, imageLayoutData[currentImageIndex].imgIndex);
  }
}

function openImage(src, folder) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  // Use endsWith to avoid index 1 matching "10.jpg", "11.jpg", etc.
  const index = imageLayoutData.findIndex(d => src.endsWith(`/${d.imgIndex}.jpg`));
  if (index !== -1) {
    currentImageIndex = index;
  }
  img.src = src;
  img.style.opacity = '0';
  img.style.transform = 'scale(0.88)';
  lightbox.style.display = 'flex';
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('noscroll');
  img.focus();
  loadAnime().then(anime => {
    anime({
      targets: img,
      opacity: [0, 1],
      scale: [0.88, 1],
      duration: 500,
      easing: 'spring(1, 90, 8, 0)',
    });
  });
}

function closeImage() {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.style.opacity = '';
  img.style.transform = '';
  lightbox.style.display = 'none';
  lightbox.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('noscroll');
}

function setupLightbox(folder) {
  const swipeArea = document.getElementById('lightbox-swipe-area');
  const lightboxImg = document.getElementById('lightbox-img');
  let startX = 0;
  let isSwiping = false;

  // Null guard: swipe area only exists on album pages
  if (swipeArea) {
    swipeArea.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      isSwiping = true;
    });

    swipeArea.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      const diffX = e.touches[0].clientX - startX;
      if (Math.abs(diffX) > 50) {
        isSwiping = false;
        if (diffX > 0) {
          showPrevImage(folder);
        } else {
          showNextImage(folder);
        }
      }
    });

    swipeArea.addEventListener('touchend', () => {
      isSwiping = false;
    });
  }

  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') {
      closeImage();
    }
  });

  if (lightboxImg) {
    lightboxImg.addEventListener('click', closeImage);
  }

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightbox').style.display === 'flex') {
      switch (e.key) {
        case 'Escape':
          closeImage();
          break;
        case 'ArrowLeft':
          showPrevImage(folder);
          break;
        case 'ArrowRight':
          showNextImage(folder);
          break;
      }
    }
  });
}

// Loads and lays out images in the gallery, using global albumFolder and totalImages
function loadImages(initial = false) {
  const gallery = document.getElementById("gallery");
  const isMobile = window.innerWidth < 768;
  const imageGap = 10;

  if (!initial) {
    const containerPadding = parseFloat(getComputedStyle(gallery).paddingLeft);
    const maxCols = isMobile ? 2 : Math.floor((window.innerWidth - 2 * containerPadding) / 325);
    const colWidth = (window.innerWidth - 2 * containerPadding - (maxCols + 1) * imageGap) / maxCols;
    const rowHeights = Array(maxCols).fill(0);

    imageLayoutData.forEach((data, i) => {
      const aspectRatio = data.height / data.width;
      const width = colWidth;
      const height = width * aspectRatio;

      let bestCol = 0;
      let minY = rowHeights[0];
      for (let c = 1; c < maxCols; c++) {
        if (rowHeights[c] < minY) {
          minY = rowHeights[c];
          bestCol = c;
        }
      }

      const left = containerPadding + imageGap + bestCol * (colWidth + imageGap);
      const top = minY + imageGap;
      rowHeights[bestCol] = top + height;

      const domImg = gallery.children[i];
      domImg.style.width = `${width}px`;
      domImg.style.height = `${height}px`;
      domImg.style.left = `${left}px`;
      domImg.style.top = `${top}px`;
    });
    adjustGalleryHeight();
    return;
  }

  gallery.innerHTML = "";

  const containerPadding = parseFloat(getComputedStyle(gallery).paddingLeft);
  const maxCols = isMobile ? 2 : Math.floor((window.innerWidth - 2 * containerPadding) / 220);
  const colWidth = (window.innerWidth - 2 * containerPadding - (maxCols + 1) * imageGap) / maxCols;
  const rowHeights = Array(maxCols).fill(0);
  const imageIndexes = Array.from({ length: totalImages }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  let imagesLoaded = 0;
  // Counter for z-index based on DOM insertion order (consistent across reloads)
  let domZIndex = 0;

  imageLayoutData = [];

  imageIndexes.forEach((imgIndex) => {
    const img = new Image();
    img.src = buildImagePath(albumFolder, imgIndex);

    img.onload = () => {
      const aspectRatio = img.naturalHeight / img.naturalWidth;
      const width = colWidth;
      const height = width * aspectRatio;
      const rotate = Math.floor(Math.random() * 10) - 5;

      let bestCol = 0;
      let minY = rowHeights[0];
      for (let c = 1; c < maxCols; c++) {
        if (rowHeights[c] < minY) {
          minY = rowHeights[c];
          bestCol = c;
        }
      }

      const left = containerPadding + imageGap + bestCol * (colWidth + imageGap);
      const top = minY + imageGap;
      rowHeights[bestCol] = top + height;

      const placedImage = {
        imgIndex,
        rotate,
        left,
        top,
        width,
        height
      };
      imageLayoutData.push(placedImage);

      const myZIndex = domZIndex++;
      const domImg = document.createElement("img");
      // Set loading before src so the hint takes effect for offscreen images
      domImg.loading = "lazy";
      domImg.src = img.src;
      domImg.alt = `${albumFolder} photo ${imgIndex}`;
      domImg.tabIndex = 0;
      domImg.style.left = `${left}px`;
      domImg.style.top = `${top}px`;
      domImg.style.width = `${width}px`;
      domImg.style.height = `${height}px`;
      domImg.style.setProperty('--base-rotate', `${rotate}deg`);
      domImg.style.transform = `rotate(calc(var(--base-rotate)))`;
      domImg.style.zIndex = myZIndex;
      domImg.addEventListener("mouseenter", () => {
        domImg.style.zIndex = 9999;
      });
      domImg.addEventListener("mouseleave", () => {
        domImg.style.zIndex = myZIndex;
      });
      domImg.style.transition = "transform 0.3s ease, box-shadow 0.3s ease";
      domImg.onload = () => {
        domImg.classList.add("loaded");
        domImg.classList.add("fade-in");
      };
      domImg.addEventListener("click", () => openImage(domImg.src, albumFolder));
      domImg.addEventListener("keydown", (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openImage(domImg.src, albumFolder);
        }
      });
      gallery.appendChild(domImg);

      imagesLoaded++;
      if (imagesLoaded === totalImages) {
        setTimeout(() => {
          loadImages(false);
          gallery.style.visibility = 'visible';
          if (window.innerWidth >= 768) animatePhotoToss(gallery);

          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                entry.target.classList.add('visible');
              }
            });
          }, {
            threshold: 0.1
          });

          document.querySelectorAll('.fade-in').forEach(img => {
            observer.observe(img);
          });
        }, 10);
      }
    };
  });
}

// Album page initialization
(function() {
  const params = new URLSearchParams(window.location.search);
  window.albumFolder = getAlbumFromLocation();
  if (!window.albumFolder) return; // skip if not an album page

  // Read image count from data-count attribute first; fall back to query param
  const galleryEl = document.getElementById('gallery');
  const dataCount = galleryEl ? parseInt(galleryEl.dataset.count, 10) : 0;
  window.totalImages = dataCount || parseInt(params.get('count'), 10) || 0;

  const encodedAlbum = encodeURIComponent(window.albumFolder);
  const albumPathMarker = '/album/';
  const basePath = window.location.pathname.includes(albumPathMarker)
    ? window.location.pathname.split(albumPathMarker)[0]
    : window.location.pathname.replace(/\/album\.html$/, '');
  const canonicalPath = `${basePath}${albumPathMarker}${encodedAlbum}/`.replace(/\/{2,}/g, '/');
  if (
    window.location.pathname !== canonicalPath ||
    window.location.search ||
    window.location.hash
  ) {
    window.history.replaceState({}, "", canonicalPath);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.totalImages) {
      // Binary search fallback: only fires when data-count is not set on the gallery element
      window.totalImages = await detectTotalImages(window.albumFolder);
    }
    if (!window.totalImages) {
      console.warn(`No images found for album: ${window.albumFolder}`);
      return;
    }

    loadImages(true);
    setupLightbox(window.albumFolder);
    window.addEventListener("resize", () => loadImages(false));

    let scrollRafId = null;
    window.addEventListener("scroll", () => {
      if (scrollRafId) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        if (window.innerWidth < 768) {
          document.querySelectorAll(".scattered-gallery img").forEach((img, i) => {
            const scrollY = window.scrollY;
            const offset = scrollY * 0.02;
            if (!img.dataset.randomTilt) {
              img.dataset.randomTilt = (Math.random() * 2 - 1.2).toFixed(2);
            }
            if (!img.dataset.shouldPulse) {
              img.dataset.shouldPulse = Math.random() < 0.5 ? "true" : "false";
            }
            const phaseOffset = parseFloat(img.dataset.randomTilt);
            const tilt = Math.sin((scrollY + i * 30) * 0.005 + phaseOffset * 2) * 1.5;
            const baseRotate = parseFloat(img.style.getPropertyValue('--base-rotate')) || 0;
            img.style.transform = `rotate(${baseRotate + tilt}deg) translateY(${offset}px)`;
            if (img.dataset.shouldPulse === "true") {
              const scale = 1 + 0.1 * Math.abs(Math.sin(scrollY * 0.005 + i));
              img.style.transform += ` scale(${scale})`;
            }
          });
        }
      });
    });
  });
})();

// Index page layout
(function() {
  let indexLoadHandlersBound = false;

  function layoutIndexGallery() {
    const gallery = document.getElementById("gallery");
    if (!gallery) return;
    const isMobile = window.innerWidth < 768;
    const imageGap = 20;
    if (isMobile) {
      // reset to natural flow
      Array.from(gallery.querySelectorAll("img")).forEach(img => {
        img.style.position = "";
        img.style.left = "";
        img.style.top = "";
        img.style.width = "";
        img.style.height = "";
      });
      gallery.style.position = "";
      gallery.style.height = "";
      return;
    }
    const containerPadding = parseFloat(getComputedStyle(gallery).paddingLeft) || 0;
    const maxCols = Math.floor((window.innerWidth - 2 * containerPadding) / 325);
    const colWidth = (window.innerWidth - 2 * containerPadding - (maxCols + 1) * imageGap) / maxCols;
    const rowHeights = Array(maxCols).fill(0);
    Array.from(gallery.querySelectorAll("img")).forEach((img) => {
      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;
      const aspectRatio = naturalWidth > 0 ? naturalHeight / naturalWidth : 1;
      const width = colWidth;
      const height = width * aspectRatio;
      let bestCol = 0, minY = rowHeights[0];
      for (let c = 1; c < maxCols; c++) {
        if (rowHeights[c] < minY) {
          minY = rowHeights[c];
          bestCol = c;
        }
      }
      const left = containerPadding + imageGap + bestCol * (colWidth + imageGap);
      const top = minY + imageGap;
      rowHeights[bestCol] = top + height;
      img.style.position = "absolute";
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;
    });
    gallery.style.position = "relative";
    gallery.style.height = `${Math.ceil(Math.max(...rowHeights) + window.innerHeight * 0.15)}px`;
  }

  function initIndexImages() {
    if (indexLoadHandlersBound) return;
    const gallery = document.getElementById("gallery");
    if (!gallery) return;
    indexLoadHandlersBound = true;

    Array.from(gallery.querySelectorAll("img")).forEach((img) => {
      img.classList.add("loaded");
      if (!img.complete) {
        img.addEventListener("load", layoutIndexGallery, { once: true });
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initIndexImages();
    layoutIndexGallery();
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    if (window.innerWidth >= 768) {
      Promise.all(Array.from(gallery.querySelectorAll('img')).map(img =>
        img.complete ? Promise.resolve() : new Promise(r => img.addEventListener('load', r, { once: true }))
      )).then(() => {
        layoutIndexGallery();
        animatePhotoToss(gallery);
      });
    } else {
      setupInfiniteCarousel(gallery);
    }
  });
  window.addEventListener("resize", layoutIndexGallery);

})();

// Wordmark entrance on every page
document.addEventListener("DOMContentLoaded", animateWordmark);
