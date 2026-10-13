// Adapted from the Auren landing (MIT), see LICENSE.md. Ordered-dither helpers emitted as tiny SVG masks.
import { useEffect, useState, useSyncExternalStore } from "react";

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Battery = EventTarget & { charging: boolean; level: number };

// low battery, or battery saver (which caps the page near 30fps): skip extras like smooth scrolling
export const useLowPower = () => {
  const [low, setLow] = useState(false);
  useEffect(() => {
    let alive = true;
    let battery: Battery | null = null;
    const check = () => battery && alive && !battery.charging && battery.level <= 0.2 && setLow(true);
    (navigator as Navigator & { getBattery?: () => Promise<Battery> })
      .getBattery?.()
      .then((b) => {
        battery = b;
        check();
        b.addEventListener("levelchange", check);
        b.addEventListener("chargingchange", check);
      })
      .catch(() => {});

    let raf = 0;
    const sample = () => {
      if (document.hidden) return;
      let frames = 0;
      const start = performance.now();
      const tick = (t: number) => {
        frames++;
        if (t - start < 1000) raf = requestAnimationFrame(tick);
        else if (alive && !document.hidden && frames < 40) setLow(true);
      };
      raf = requestAnimationFrame(tick);
    };
    const t = window.setTimeout(sample, 600);
    return () => {
      alive = false;
      clearTimeout(t);
      cancelAnimationFrame(raf);
      battery?.removeEventListener("levelchange", check);
      battery?.removeEventListener("chargingchange", check);
    };
  }, []);
  return low;
};

export const useMediaQuery = (query: string) => {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
};

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

// 8×8 Bayer threshold matrix, values 0 to 63, row-major
const BAYER8: readonly number[] = (() => {
  let m = [[0]];
  for (let n = 1; n < 8; n *= 2) {
    const next = Array.from({ length: n * 2 }, () => new Array<number>(n * 2).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    }
    m = next;
  }
  return m.flat();
})();

// Bayer threshold in [0, 1) for a pixel coordinate
export const bayer = (x: number, y: number) => (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;

const px = (x: number, y: number) => `M${x} ${y}h1v1h-1z`;

const svgUrl = (cols: number, rows: number, d: string, scale: number) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * scale}" height="${rows * scale}" ` +
    `viewBox="0 0 ${cols} ${rows}" shape-rendering="crispEdges" fill="#000">` +
    (d ? `<path d="${d}"/>` : "") +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

// An 8×8 tile with `level` of its 64 pixels lit, in Bayer order
const ditherTile = (level: number, scale: number) => {
  let d = "";
  for (let i = 0; i < 64; i++) if (BAYER8[i] < level) d += px(i % 8, (i / 8) | 0);
  return svgUrl(8, 8, d, scale);
};

const dissolveCache = new Map<number, string[]>();

// 65 mask frames (0 to 64 lit pixels) used to dissolve elements in
export const dissolveSteps = (scale: number) => {
  let steps = dissolveCache.get(scale);
  if (!steps) {
    steps = Array.from({ length: 65 }, (_, level) => ditherTile(level, scale));
    dissolveCache.set(scale, steps);
  }
  return steps;
};

export { API_BASE } from "../lib/shell";
