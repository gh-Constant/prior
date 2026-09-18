import { useEffect, useId, useRef } from "react";
import "./AgentIdentity.css";

type AgentIdentityProps = {
  readonly thinking?: boolean;
  readonly size?: "tiny" | "small" | "hero";
};

export function AgentIdentity({ thinking = false, size = "small" }: AgentIdentityProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uid = useId().replaceAll(":", "");
  const gradientId = `agent-white-grad-${uid}`;
  const shadowId = `agent-white-shadow-${uid}`;

  // WebGL Fluid Shader for hero and small sizes
  useEffect(() => {
    if (size === "tiny" || !canvasRef.current) return undefined;
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl");
    if (!gl) return undefined;

    let animId: number;
    let isCancelled = false;

    const vsSource = `
      attribute vec2 p;
      varying vec2 uv;
      void main() {
        uv = p * 0.5 + 0.5;
        gl_Position = vec4(p, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 uv;
      uniform float uTime;
      uniform float uSpeed;

      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) {
          v += a * snoise(p);
          p *= 2.05;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 p = uv * 2.0 - 1.0;
        float t = uTime * 0.4 * uSpeed;
        vec2 q = vec2(fbm(p + vec2(0.0, t * 0.25)), fbm(p + vec2(1.7, 2.3 - t * 0.2)));
        vec2 r = vec2(fbm(p + 2.5 * q + vec2(t * 0.35, 0.8)), fbm(p + 2.5 * q + vec2(1.2, t * 0.3)));
        float f = fbm(p + 3.0 * r);

        vec3 terracotta = vec3(0.72, 0.22, 0.12);
        vec3 coral      = vec3(0.98, 0.40, 0.29);
        vec3 amber      = vec3(1.00, 0.65, 0.36);
        vec3 cream      = vec3(1.00, 0.94, 0.88);

        vec3 col = mix(terracotta, coral, clamp(f * f * 2.2, 0.0, 1.0));
        col = mix(col, amber, clamp(length(q) * 1.1, 0.0, 1.0));
        col = mix(col, cream, clamp(pow(r.x, 3.0) * 1.4, 0.0, 1.0));

        float mask = smoothstep(1.05, 0.55, length(p));
        gl_FragColor = vec4(col * mask, 1.0);
      }
    `;

    function compile(type: number, src: string) {
      const s = gl?.createShader(type);
      if (!s || !gl) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return undefined;

    const prog = gl.createProgram();
    if (!prog) return undefined;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const pLoc = gl.getAttribLocation(prog, "p");
    const tLoc = gl.getUniformLocation(prog, "uTime");
    const sLoc = gl.getUniformLocation(prog, "uSpeed");

    const px = size === "hero" ? 236 : 72;
    canvas.width = px;
    canvas.height = px;
    gl.viewport(0, 0, px, px);

    const start = performance.now();
    function loop(time: number) {
      if (isCancelled || !gl || !prog) return;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.enableVertexAttribArray(pLoc);
      gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(tLoc, (time - start) * 0.001);
      gl.uniform1f(sLoc, thinking ? 2.4 : 1.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animId = requestAnimationFrame(loop);
    }
    animId = requestAnimationFrame(loop);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animId);
      if (gl) {
        gl.deleteBuffer(posBuffer);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      }
    };
  }, [size, thinking]);

  return (
    <span
      className={`agent-identity agent-identity-${size} ${thinking ? "is-thinking" : "is-idle"}`}
      data-state={thinking ? "thinking" : "idle"}
      aria-hidden="true"
    >
      <span className="agent-fluid-wrapper">
        <canvas ref={canvasRef} className="agent-fluid-canvas" />
        <span className="agent-fluid-css-fallback" />
      </span>
      <svg className="agent-white-symbol" viewBox="0 0 100 100" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="20" y1="15" x2="80" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#f7efe8" />
            <stop offset="100%" stopColor="#ebe1d8" />
          </linearGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="-1" dy="3" stdDeviation="3" floodColor="#000000" floodOpacity="0.35" />
          </filter>
        </defs>
        {/* Outer loop of the P in white */}
        <path
          className="agent-mark-loop"
          fill={`url(#${gradientId})`}
          d="M 32 20 C 32 20, 52 20, 68 20 C 82 20, 88 32, 88 44 C 88 56, 80 66, 64 66 C 52 66, 42 66, 42 66 L 42 50 C 42 50, 50 50, 60 50 C 68 50, 72 46, 72 43 C 72 40, 68 36, 60 36 L 32 36 Z"
        />
        {/* Lower stem in white */}
        <path
          className="agent-mark-stem"
          fill={`url(#${gradientId})`}
          d="M 32 50 C 37 50, 42 54, 42 60 L 42 80 C 42 85, 37 88, 32 88 C 27 88, 24 85, 24 80 L 24 60 C 24 54, 28 50, 32 50 Z"
        />
        {/* Diagonal fold ribbon with dimension in pure white */}
        <path
          className="agent-mark-ribbon"
          filter={`url(#${shadowId})`}
          fill="#ffffff"
          d="M 28 20 C 22 20, 18 25, 18 32 C 18 42, 26 50, 38 56 L 56 65 C 62 68, 66 64, 66 58 C 66 52, 60 48, 52 44 L 38 36 C 32 32, 32 24, 38 22 C 41 21, 35 20, 28 20 Z"
        />
      </svg>
    </span>
  );
}
