import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { cn, prefersReducedMotion } from "./lib";
import { PRELUDE } from "./shaders";

type Props = {
  // GLSL body; has access to the uniforms and helpers in PRELUDE
  fragment: string;
  // Size of one dither dot in CSS pixels (snapped to whole device pixels)
  pixel?: number;
  className?: string;
  // Palette inks, darkest to lightest
  inks?: [string, string, string, string];
  label?: string;
  // Hold a still frame instead of animating (e.g
  paused?: boolean;
  // Extra uniforms read every frame, as values or getters (vec1–vec3)
  extra?: RefObject<Record<string, number[] | (() => number[])>>;
};

const VERT = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const compile = (gl: WebGLRenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
};

const toRgb = (value: string): [number, number, number] => {
  const hex = value.trim().replace("#", "");
  const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const DitherShader = ({
  fragment,
  pixel = 3,
  className,
  inks = ["var(--ink)", "var(--accent-deep)", "var(--accent)", "var(--paper)"],
  label,
  paused = false,
  extra,
}: Props) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const extraRef = useRef(extra);
  extraRef.current = extra;

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) {
      wrap.dataset.fallback = "";
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, PRELUDE + fragment);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = u("u_res");
    const uTime = u("u_time");
    const uMouse = u("u_mouse");
    const uHover = u("u_hover");
    const cs = getComputedStyle(wrap);
    [u("u_c0"), u("u_c1"), u("u_c2"), u("u_c3")].forEach((loc, i) =>
      gl.uniform3fv(loc, toRgb(cs.getPropertyValue(`--dither-${i}`))),
    );

    // keep every dot an integer number of device pixels
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const css = Math.max(1, Math.round(pixel * dpr)) / dpr;
      const { width, height } = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.ceil(width / css));
      const h = Math.max(1, Math.ceil(height / css));
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${w * css}px`;
      canvas.style.height = `${h * css}px`;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    resize();

    const reduced = prefersReducedMotion();
    const mouse = { x: 0.62, y: 0.42, tx: 0.62, ty: 0.42, hover: 0, th: 0 };
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      mouse.th = inside ? 1 : 0;
      if (inside) {
        mouse.tx = x;
        mouse.ty = y;
      }
    };
    const onLeave = () => (mouse.th = 0);

    let visible = false;
    let raf = 0;
    let time = 7;
    let last = performance.now();

    const extraLocs = new Map<string, WebGLUniformLocation | null>();
    const draw = () => {
      const more = extraRef.current?.current;
      if (more) {
        for (const name in more) {
          if (!extraLocs.has(name)) extraLocs.set(name, gl.getUniformLocation(prog, name));
          const loc = extraLocs.get(name);
          if (!loc) continue;
          const v = more[name];
          const val = typeof v === "function" ? v() : v;
          if (val.length === 3) gl.uniform3fv(loc, val);
          else if (val.length === 2) gl.uniform2fv(loc, val);
          else gl.uniform1f(loc, val[0]);
        }
      }
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uHover, mouse.hover);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      if (dt < 1 / 31) return; // 30fps: the dither reads the same and the GPU does half the work
      last = now;
      if (!reduced) time += dt;
      const k = 1 - Math.pow(0.0025, dt);
      mouse.x += (mouse.tx - mouse.x) * k;
      mouse.y += (mouse.ty - mouse.y) * k;
      mouse.hover += (mouse.th - mouse.hover) * k * 0.6;
      draw();
    };

    const start = () => {
      if (raf || !visible || document.hidden || pausedRef.current) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    // draw once immediately so there is never an empty frame
    draw();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(wrap);
    const onVis = () => (document.hidden ? stop() : start());
    const onPause = () => (pausedRef.current ? stop() : start());

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("dither:pause-changed", onPause);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("dither:pause-changed", onPause);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [fragment, pixel]);

  // pausing/resuming doesn't rebuild the GL program; it just stops or restarts the frame loop
  useEffect(() => {
    pausedRef.current = paused;
    window.dispatchEvent(new Event("dither:pause-changed"));
  }, [paused]);

  return (
    <div
      ref={wrapRef}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("dither-canvas overflow-hidden", className)}
      style={
        {
          "--dither-0": inks[0],
          "--dither-1": inks[1],
          "--dither-2": inks[2],
          "--dither-3": inks[3],
        } as CSSProperties
      }
    >
      <canvas ref={canvasRef} className="block [image-rendering:pixelated]" />
    </div>
  );
};
