import { useEffect, useRef } from "react";
import { bayer, cn, prefersReducedMotion } from "./lib";

// the font's "t" is short with a slanted top; square it off and raise it to the next letter's height before sampling
const squareStem = (ctx: CanvasRenderingContext2D, tRight: number, nextRight: number, H: number, size: number) => {
  const w = Math.min(ctx.canvas.width, Math.ceil(nextRight));
  const img = ctx.getImageData(0, 0, w, H).data;
  const solid = (x: number, y: number) => img[(y * w + x) * 4 + 3] >= 128;
  const topIn = (from: number, to: number) => {
    for (let y = 0; y < H; y++) for (let x = from; x < to; x++) if (solid(x, y)) return y;
    return -1;
  };
  const t = Math.ceil(tRight);
  const top = topIn(0, t);
  if (top < 0) return;
  const target = Math.max(0, Math.min(top, topIn(t, w) < 0 ? top : topIn(t, w)));
  const ref = Math.min(H - 1, top + Math.round(size * 0.07));
  let x0 = -1;
  let x1 = -1;
  for (let x = 0; x < t; x++) {
    if (solid(x, ref)) {
      if (x0 < 0) x0 = x;
      x1 = x;
    } else if (x0 >= 0) break;
  }
  if (x0 < 0) return;
  ctx.fillRect(x0, target, x1 - x0 + 1, ref - target);
};

// The wordmark in ordered-dither dots: paper letters, an accent full stop
export const DitherWordmark = ({ text, className }: { text: string; className?: string }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = prefersReducedMotion();

    // per dot: x, y, homeX, homeY, vx, vy
    let dots = new Float32Array(0);
    // 1 for dots that belong to the trailing full stop
    let isDot = new Uint8Array(0);
    let count = 0;
    let cell = 6;
    let W = 0;
    let H = 0;
    let raf = 0;
    let running = false;
    let started = reduced;
    const cs = getComputedStyle(wrap);
    const colors = { paper: cs.getPropertyValue("--paper").trim(), accent: cs.getPropertyValue("--accent").trim() };
    const pointer = { x: 0, y: 0, active: false };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const s = cell - 1;
      for (const accent of [false, true]) {
        ctx.fillStyle = accent ? colors.accent : colors.paper;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const o = i * 6;
          const off = Math.abs(dots[o] - dots[o + 2]) + Math.abs(dots[o + 1] - dots[o + 3]) > 4;
          if ((off || isDot[i] === 1) === accent) ctx.rect(Math.round(dots[o]), Math.round(dots[o + 1]), s, s);
        }
        ctx.fill();
      }
    };

    const step = () => {
      const R = Math.max(70, W * 0.075);
      const R2 = R * R;
      let moving = false;
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        let x = dots[o];
        let y = dots[o + 1];
        let vx = dots[o + 4];
        let vy = dots[o + 5];
        if (pointer.active) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = (1 - d / R) * 2.4;
            vx += (dx / d) * f;
            vy += (dy / d) * f;
          }
        }
        vx = (vx + (dots[o + 2] - x) * 0.05) * 0.85;
        vy = (vy + (dots[o + 3] - y) * 0.05) * 0.85;
        x += vx;
        y += vy;
        dots[o] = x;
        dots[o + 1] = y;
        dots[o + 4] = vx;
        dots[o + 5] = vy;
        if (!moving && Math.abs(vx) + Math.abs(vy) + Math.abs(x - dots[o + 2]) + Math.abs(y - dots[o + 3]) > 0.15) moving = true;
      }
      return moving;
    };

    const loop = () => {
      const moving = step();
      draw();
      if (moving) raf = requestAnimationFrame(loop);
      else running = false;
    };

    const kick = () => {
      if (running || !started || reduced) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    let generation = 0;
    const build = async () => {
      const gen = ++generation;
      const width = wrap.clientWidth;
      if (!width) return;
      const family = getComputedStyle(wrap).fontFamily;
      const font = (size: number) => `620 ${size}px ${family}`;
      try {
        await document.fonts.load(font(200), text);
      } catch {
        /* fall back to whatever font is ready */
      }
      if (gen !== generation) return;

      cell = width < 640 ? 4 : width < 1100 ? 5 : 6;
      const off = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      const setFont = (size: number) => {
        off.font = font(size);
        off.fontStretch = "semi-expanded";
        off.letterSpacing = `${-0.035 * size}px`;
      };
      setFont(200);
      const probe = off.measureText(text);
      const size = (200 * width) / (probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight);
      setFont(size);
      const m = off.measureText(text);
      W = width;
      H = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + cell * 2;
      // where the trailing full stop starts, if the text ends with one
      const dotX = text.endsWith(".") ? m.actualBoundingBoxLeft + off.measureText(text.slice(0, -1)).width : Infinity;
      off.canvas.width = W;
      off.canvas.height = H;
      setFont(size);
      off.fillStyle = "#fff";
      off.fillText(text, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent + cell);
      if (text.startsWith("t")) squareStem(off, m.actualBoundingBoxLeft + off.measureText("t").width, m.actualBoundingBoxLeft + off.measureText(text.slice(0, 2)).width, H, size);
      const data = off.getImageData(0, 0, W, H).data;

      const pts: number[] = [];
      const flags: number[] = [];
      for (let gy = 0; gy * cell < H; gy++) {
        for (let gx = 0; gx * cell < W; gx++) {
          const sx = Math.min(W - 1, gx * cell + (cell >> 1));
          const sy = Math.min(H - 1, gy * cell + (cell >> 1));
          if (data[(sy * W + sx) * 4 + 3] < 128) continue;
          // solid at the top, thinning toward the baseline without breaking up
          const shade = 1.3 - (sy / H) * 0.85;
          if (shade < bayer(gx, gy)) continue;
          pts.push(gx * cell, gy * cell);
          flags.push(sx >= dotX ? 1 : 0);
        }
      }

      count = pts.length / 2;
      dots = new Float32Array(count * 6);
      isDot = Uint8Array.from(flags);
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        const hx = pts[i * 2];
        const hy = pts[i * 2 + 1];
        dots[o + 2] = hx;
        dots[o + 3] = hy;
        if (started) {
          dots[o] = hx;
          dots[o + 1] = hy;
        } else {
          // scattered until it scrolls into view
          dots[o] = hx + (Math.random() - 0.5) * W * 0.5;
          dots[o + 1] = hy + (Math.random() - 0.2) * H * 2.2;
        }
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      wrap.style.aspectRatio = "auto";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = true;
      kick();
    };
    const onLeave = () => {
      pointer.active = false;
      kick();
    };

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(build, 120);
    });
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started) return;
        started = true;
        kick();
      },
      { threshold: 0.35 },
    );

    build();
    ro.observe(wrap);
    io.observe(wrap);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    return () => {
      generation++;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
    };
  }, [text]);

  return (
    <div ref={wrapRef} role="img" aria-label={text} className={cn("relative aspect-[3.4/1] touch-pan-y select-none", className)}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
};
