// Shared image preloader so a camera switch (or hovering its thumbnail) warms the photo
// before it's needed and the swap never shows a half-loaded image.
const preloaded = new Set();
const pending = new Map();

export const isPreloaded = (src) => preloaded.has(src);
export const markPreloaded = (src) => preloaded.add(src);

export function preloadImage(src) {
  if (!src || preloaded.has(src)) return Promise.resolve();
  if (pending.has(src)) return pending.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      preloaded.add(src);
      pending.delete(src);
      resolve();
    };
    img.onerror = (e) => {
      pending.delete(src);
      reject(e);
    };
    img.src = src;
  });
  pending.set(src, p);
  return p;
}
