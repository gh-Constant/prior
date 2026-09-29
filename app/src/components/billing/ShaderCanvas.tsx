import { useEffect, useRef } from "react";

/**
 * A slow, warm "liquid light" field drawn by a WebGL fragment shader:
 * domain-warped noise mixed through Prior's coral, peach, cream and lilac.
 * It pauses off-screen and when the tab is hidden, draws a single frame for
 * reduced motion, and falls back to the CSS gradient behind it when WebGL is
 * unavailable (tests, old GPUs).
 */

export type ShaderVariant = "dawn" | "dusk" | "ember" | "night";

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec2 pointer;
uniform vec3 c0;
uniform vec3 c1;
uniform vec3 c2;
uniform vec3 c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    amp *= 0.5;
  }
  return value;
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * resolution.xy) / min(resolution.x, resolution.y);
  float t = time * 0.045;
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  vec2 r = vec2(fbm(p * 1.8 + 2.2 * q + vec2(1.7, 9.2) + t * 1.3), fbm(p * 1.8 + 2.2 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.2 + 2.6 * r);
  float glow = smoothstep(0.55, 0.0, distance(uv, pointer)) * 0.18;
  vec3 color = mix(c0, c1, clamp(f * f * 2.2, 0.0, 1.0));
  color = mix(color, c2, clamp(length(q) * 0.9, 0.0, 1.0));
  color = mix(color, c3, clamp(r.x * r.x * 1.4 + glow, 0.0, 1.0));
  float grain = (hash(gl_FragCoord.xy + time) - 0.5) * 0.035;
  gl_FragColor = vec4(color + grain, 1.0);
}
`;

const PALETTES: Record<ShaderVariant, [string, string, string, string]> = {
  // Light, airy: cream into peach and coral with a lilac undertone.
  dawn: ["#fff7f1", "#fbd3c4", "#f6a489", "#d9d2f6"],
  // Dawn for the dark theme: the same currents, turned down to embers.
  dusk: ["#1c1816", "#3b221b", "#a8472f", "#3a2d55"],
  // Deeper, for the featured plan card.
  ember: ["#1f1b1a", "#f35f43", "#8f3fd6", "#ffb38f"],
  // The admin header: mostly dark, with coral and violet currents.
  night: ["#141112", "#2a1f24", "#f35f43", "#6b3fd6"],
};

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function ShaderCanvas({ variant = "dawn", className = "" }: { readonly variant?: ShaderVariant; readonly className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
    } catch {
      gl = null;
    }
    if (!gl || gl.isContextLost()) return undefined;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return undefined;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl!.getUniformLocation(program, name);
    const resolution = uniform("resolution");
    const time = uniform("time");
    const pointer = uniform("pointer");
    PALETTES[variant].forEach((hex, index) => gl!.uniform3fv(uniform(`c${index}`), hexToRgb(hex)));

    const pointerTarget = { x: 0.7, y: 0.6 };
    const pointerNow = { x: 0.7, y: 0.6 };
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    const started = performance.now() - Math.random() * 60_000;

    const resize = () => {
      // Half resolution: the field is soft, and this keeps it cheap.
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl!.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (now: number) => {
      frame = 0;
      resize();
      pointerNow.x += (pointerTarget.x - pointerNow.x) * 0.04;
      pointerNow.y += (pointerTarget.y - pointerNow.y) * 0.04;
      gl!.uniform2f(resolution, canvas.width, canvas.height);
      gl!.uniform1f(time, (now - started) / 1000);
      gl!.uniform2f(pointer, pointerNow.x, pointerNow.y);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!reducedMotion && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointerTarget.x = (event.clientX - rect.left) / rect.width;
      pointerTarget.y = 1 - (event.clientY - rect.top) / rect.height;
    };
    const onVisibility = () => { if (!document.hidden && visible) start(); };
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (visible) start();
      })
      : null;
    observer?.observe(canvas);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    canvas.dataset.ready = "true";
    start();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      // The context stays with the canvas (React may mount the effect again
      // on the same element); only this effect's GL objects are released.
      gl?.deleteProgram(program);
      gl?.deleteShader(vertex);
      gl?.deleteShader(fragment);
      gl?.deleteBuffer(buffer);
    };
  }, [variant]);

  return <canvas ref={canvasRef} className={`shader-canvas shader-${variant} ${className}`} aria-hidden="true" />;
}
