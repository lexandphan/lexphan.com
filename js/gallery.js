// Shared gallery/lightbox logic
let imageLayoutData = [];
let currentImageIndex = 0;

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
    document.getElementById('lightbox-img').src = `images/${folder}/${imageLayoutData[currentImageIndex].imgIndex}.jpg`;
  }
}

function showPrevImage(folder) {
  if (currentImageIndex > 0) {
    currentImageIndex--;
    document.getElementById('lightbox-img').src = `images/${folder}/${imageLayoutData[currentImageIndex].imgIndex}.jpg`;
  }
}

function openImage(src, folder) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const index = imageLayoutData.findIndex(d => src.includes(`${d.imgIndex}.jpg`));
  if (index !== -1) {
    currentImageIndex = index;
  }
  img.src = src;
  lightbox.style.display = 'flex';
  document.body.classList.add('noscroll');
}

function closeImage() {
  document.getElementById('lightbox').style.display = 'none';
  document.body.classList.remove('noscroll');
}

function setupLightbox(folder) {
  const swipeArea = document.getElementById('lightbox-swipe-area');
  const lightboxImg = document.getElementById('lightbox-img');
  let startX = 0;
  let isSwiping = false;

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

  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') {
      closeImage();
    }
  });

  lightboxImg.addEventListener('click', closeImage);

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightbox').style.display === 'flex') {
      if (e.key === 'Escape') {
        closeImage();
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

  imageLayoutData = [];

  imageIndexes.forEach((imgIndex, i) => {
    const img = new Image();
    img.src = `images/${albumFolder}/${imgIndex}.jpg`;

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

      const domImg = document.createElement("img");
      domImg.src = img.src;
      domImg.alt = `${albumFolder} ${imgIndex}`;
      domImg.style.left = `${left}px`;
      domImg.style.top = `${top}px`;
      domImg.style.width = `${width}px`;
      domImg.style.height = `${height}px`;
      domImg.style.setProperty('--base-rotate', `${rotate}deg`);
      domImg.style.transform = `rotate(calc(var(--base-rotate)))`;
      domImg.style.zIndex = i;
      domImg.addEventListener("mouseenter", () => {
        domImg.style.zIndex = 9999;
      });
      domImg.addEventListener("mouseleave", () => {
        domImg.style.zIndex = i;
      });
      domImg.style.transition = "transform 0.3s ease, box-shadow 0.3s ease";
      domImg.loading = "lazy";
      domImg.onload = () => {
        domImg.classList.add("loaded");
        domImg.classList.add("fade-in");
      };
      domImg.addEventListener("click", () => openImage(domImg.src, albumFolder));
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