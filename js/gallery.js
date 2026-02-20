// Shared gallery/lightbox logic
let imageLayoutData = [];
let currentImageIndex = 0;

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
  img.classList.remove('visible');
  img.src = src;
  lightbox.style.display = 'flex';
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('noscroll');
  img.focus();
  setTimeout(() => img.classList.add('visible'), 10);
}

function closeImage() {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.classList.remove('visible');
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
      if (img.alt && !img.parentElement.querySelector('.album-label')) {
        const label = document.createElement("span");
        label.className = "album-label";
        label.textContent = img.alt.toLowerCase();
        img.parentElement.appendChild(label);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initIndexImages();
    layoutIndexGallery();
  });
  window.addEventListener("resize", layoutIndexGallery);

  if (document.body.classList.contains('index-page')) {
    const links = document.querySelectorAll('#gallery a');
    const flash = document.getElementById('flash-overlay');

    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        flash.classList.remove('flash');
        void flash.offsetWidth; // force reflow
        flash.classList.add('flash');
        setTimeout(() => {
          window.location.href = link.href;
        }, 100);
      });
    });
  }
})();
