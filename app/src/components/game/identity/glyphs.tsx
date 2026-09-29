// Small vector glyphs used by the inventory: stardust currency, stand-in
// previews for pet accessories (the pet module owns the real art) and confetti.
import { useId, type CSSProperties } from "react";
import { seededRandom } from "./rules";

export function StardustIcon({ size = 16 }: { readonly size?: number }) {
  const fill = `gi-stardust-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="gi-stardust" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef3ff" />
          <stop offset="0.45" stopColor="#c7a6ff" />
          <stop offset="1" stopColor="#6d5dfc" />
        </linearGradient>
      </defs>
      <path d="M10 2.5 L12 8.6 L18 10.5 L12 12.4 L10 18.5 L8 12.4 L2 10.5 L8 8.6 Z" fill={`url(#${fill})`} stroke="#5b4bd8" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M18.5 13.5 L19.4 16.1 L22 17 L19.4 17.9 L18.5 20.5 L17.6 17.9 L15 17 L17.6 16.1 Z" fill="#f0abfc" stroke="#a21caf" strokeWidth="0.6" strokeLinejoin="round" />
      <circle cx="18.5" cy="5" r="1.3" fill="#a5b4fc" />
    </svg>
  );
}

export type PetGlyphId = "top-hat" | "party-hat" | "crown" | "beanie" | "glasses" | "bowtie" | "scarf" | "plant" | "lamp";

export function PetGlyph({ glyph, size = 44 }: { readonly glyph: PetGlyphId; readonly size?: number }) {
  const common = { stroke: "rgb(0 0 0 / 0.35)", strokeWidth: 1.2, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {glyph === "top-hat" && (
        <g {...common}>
          <ellipse cx="24" cy="36" rx="17" ry="4.5" fill="#2b2a33" />
          <path d="M13 35 V14 C13 11 35 11 35 14 V35 Z" fill="#3a3945" />
          <path d="M13 28 H35 V32 H13 Z" fill="#f35f43" stroke="none" />
          <path d="M16 15 V33" stroke="rgb(255 255 255 / 0.18)" strokeWidth="2.4" />
        </g>
      )}
      {glyph === "party-hat" && (
        <g {...common}>
          <path d="M24 5 L37 40 H11 Z" fill="#8f7bff" />
          <path d="M20.5 15 L27.5 15 L29.5 21 L18.5 21 Z M16 27 L32 27 L34 33 L14 33 Z" fill="#ffd43b" stroke="none" />
          <circle cx="24" cy="5" r="3.5" fill="#ff4fd8" />
        </g>
      )}
      {glyph === "crown" && (
        <g {...common}>
          <path d="M8 36 L6 14 L16 22 L24 9 L32 22 L42 14 L40 36 Z" fill="#f6c445" />
          <path d="M8 36 H40 V40 H8 Z" fill="#d99a0b" />
          <circle cx="24" cy="28" r="3.2" fill="#ef4444" />
          <circle cx="15" cy="30" r="2" fill="#3b82f6" />
          <circle cx="33" cy="30" r="2" fill="#10b981" />
        </g>
      )}
      {glyph === "beanie" && (
        <g {...common}>
          <path d="M9 32 C9 18 15 11 24 11 C33 11 39 18 39 32 Z" fill="#4b86f0" />
          <rect x="7" y="30" width="34" height="8" rx="3" fill="#2f5fc4" />
          <circle cx="24" cy="9" r="4.5" fill="#f4f4f5" />
          <path d="M14 30 V22 M19 30 V17 M24 30 V15 M29 30 V17 M34 30 V22" stroke="rgb(255 255 255 / 0.25)" strokeWidth="1.6" />
        </g>
      )}
      {glyph === "glasses" && (
        <g {...common}>
          <rect x="5" y="17" width="16" height="13" rx="5" fill="#1f2937" />
          <rect x="27" y="17" width="16" height="13" rx="5" fill="#1f2937" />
          <path d="M21 22 C23 20 25 20 27 22" fill="none" stroke="#1f2937" strokeWidth="2.4" />
          <path d="M8 20 L13 20" stroke="rgb(255 255 255 / 0.5)" strokeWidth="2" />
          <path d="M30 20 L35 20" stroke="rgb(255 255 255 / 0.5)" strokeWidth="2" />
        </g>
      )}
      {glyph === "bowtie" && (
        <g {...common}>
          <path d="M5 14 L21 22 L21 26 L5 34 Z" fill="#f35f43" />
          <path d="M43 14 L27 22 L27 26 L43 34 Z" fill="#f35f43" />
          <rect x="20" y="19" width="8" height="10" rx="2" fill="#c43a22" />
        </g>
      )}
      {glyph === "scarf" && (
        <g {...common}>
          <path d="M8 16 C16 22 32 22 40 16 L41 23 C32 29 16 29 7 23 Z" fill="#10b981" />
          <path d="M30 24 L36 42 L29 42 L25 26 Z" fill="#0e9f6e" />
          <path d="M12 19 V25 M18 21 V27 M24 22 V28" stroke="#ecfdf5" strokeWidth="1.6" />
        </g>
      )}
      {glyph === "plant" && (
        <g {...common}>
          <path d="M14 30 H34 L31 42 H17 Z" fill="#c2703d" />
          <path d="M24 30 C24 22 24 16 24 10" fill="none" stroke="#2f7d52" strokeWidth="1.8" />
          <path d="M24 18 C18 18 13 14 12 8 C18 8 23 12 24 18 Z" fill="#4ade80" />
          <path d="M24 22 C30 22 35 18 36 12 C30 12 25 16 24 22 Z" fill="#22c55e" />
        </g>
      )}
      {glyph === "lamp" && (
        <g {...common}>
          <path d="M14 8 H34 L38 24 H10 Z" fill="#fde68a" />
          <path d="M23 24 H25 V38 H23 Z" fill="#78716c" />
          <ellipse cx="24" cy="40" rx="9" ry="3" fill="#57534e" />
          <ellipse cx="24" cy="26" rx="16" ry="3" fill="#fef3c7" opacity="0.6" stroke="none" />
        </g>
      )}
    </svg>
  );
}

export function ConfettiPreview({ colors, seed, size = 56 }: { readonly colors: readonly string[]; readonly seed: string; readonly size?: number }) {
  const random = seededRandom(seed);
  const pieces = Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2 + random() * 0.4;
    const distance = 9 + random() * 13;
    return {
      x: 24 + Math.cos(angle) * distance,
      y: 24 + Math.sin(angle) * distance,
      rotate: random() * 180,
      color: colors[index % colors.length],
      shape: index % 3,
    };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" style={{ overflow: "visible" } as CSSProperties}>
      {pieces.map((piece, index) =>
        piece.shape === 0 ? (
          <rect key={index} x={piece.x - 1.4} y={piece.y - 3} width="2.8" height="6" rx="0.8" fill={piece.color} transform={`rotate(${piece.rotate} ${piece.x} ${piece.y})`} />
        ) : piece.shape === 1 ? (
          <circle key={index} cx={piece.x} cy={piece.y} r="1.9" fill={piece.color} />
        ) : (
          <path key={index} d={`M${piece.x} ${piece.y - 3} L${piece.x + 2.6} ${piece.y + 2} L${piece.x - 2.6} ${piece.y + 2} Z`} fill={piece.color} transform={`rotate(${piece.rotate} ${piece.x} ${piece.y})`} />
        ),
      )}
      <circle cx="24" cy="24" r="3" fill={colors[0]} opacity="0.9" />
    </svg>
  );
}
