// The Den's cozy room, drawn in one SVG (400×250, floor from y=182).
import { useId } from "react";
import { leafPath, puffPath, sparklePath } from "./shapes";

export type PetRoomItemId = "rug" | "plant" | "lamp" | "shelf" | "frame" | "lights" | "cushion";

export const PET_ROOM_ITEMS: readonly PetRoomItemId[] = ["rug", "plant", "lamp", "shelf", "frame", "lights", "cushion"];

export type DenTime = "day" | "night";

/** Horizontal position (0–100%) of the cushion, where a sleeping pet rests. */
export const DEN_CUSHION_X = 30;

const FLOOR_Y = 182;

// Everything important stays inside x 36–364 so a 4:3 crop (mobile) keeps it.
function Window({ time, uid }: { readonly time: DenTime; readonly uid: string }) {
  return (
    <g>
      <rect x={214} y={30} width={100} height={90} rx={8} fill="#fff9f0" stroke="#c9a47f" strokeWidth={2} />
      <rect x={221} y={37} width={86} height={76} rx={4} fill={`url(#${uid}-sky-${time})`} />
      {time === "day" ? (
        <g>
          <circle cx={246} cy={60} r={16} fill="#ffe7a0" opacity={0.55} />
          <circle cx={246} cy={60} r={10} fill="#ffd166" />
          <path d={puffPath(284, 90, 8, 5)} fill="#fff" opacity={0.95} />
          <path d={puffPath(270, 93, 6, 5)} fill="#fff" opacity={0.95} />
        </g>
      ) : null}
      <path d="M264 37V113M221 75H307" stroke="#fff9f0" strokeWidth={4} />
      <path d="M264 37V113M221 75H307" stroke="#e6cdb0" strokeWidth={1} opacity={0.6} />
      <path d="M206 24C214 50 210 90 200 122L222 122C224 90 222 52 222 24Z" fill="#f7a58f" stroke="#d9785f" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M322 24C314 50 318 90 328 122L306 122C304 90 306 52 306 24Z" fill="#f7a58f" stroke="#d9785f" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M210 36Q214 70 208 110M318 36Q314 70 320 110" fill="none" stroke="#e98b74" strokeWidth={1.2} opacity={0.7} />
      <rect x={200} y={20} width={128} height={6} rx={3} fill="#c9a47f" />
      <rect x={208} y={118} width={112} height={7} rx={3} fill="#ecd3b6" stroke="#c9a47f" strokeWidth={1.5} />
    </g>
  );
}

function NightSky() {
  const stars: Array<[number, number, number]> = [[234, 50, 2], [296, 48, 1.6], [240, 96, 1.4], [290, 100, 1.8], [276, 84, 1.2]];
  return (
    <g>
      <circle cx={284} cy={58} r={17} fill="#fff3c4" opacity={0.18} />
      <path d="M284 47A11 11 0 0 0 284 69A8.4 11 0 0 1 284 47Z" transform="rotate(-24 284 58)" fill="#fff3c4" />
      {stars.map(([x, y, r]) => <path key={`${x}-${y}`} className="pet-den-star" d={sparklePath(x, y, r * 1.4)} fill="#fff6d6" />)}
    </g>
  );
}

function Plant() {
  return (
    <g>
      <path d={leafPath(34, 20)} transform="translate(58 158) rotate(-38)" fill="#6cbf62" stroke="#3f8a45" strokeWidth={1.5} />
      <path d={leafPath(40, 22)} transform="translate(58 158) rotate(4)" fill="#7fcc6c" stroke="#3f8a45" strokeWidth={1.5} />
      <path d={leafPath(30, 18)} transform="translate(58 158) rotate(40)" fill="#5fb35a" stroke="#3f8a45" strokeWidth={1.5} />
      <path d="M58 156Q59 140 58 124" fill="none" stroke="#3f8a45" strokeWidth={1.2} opacity={0.6} />
      <path d="M42 156H74L70 184H46Z" fill="#e2825b" stroke="#b85c3c" strokeWidth={1.5} strokeLinejoin="round" />
      <rect x={39} y={152} width={38} height={8} rx={3} fill="#ec936c" stroke="#b85c3c" strokeWidth={1.5} />
    </g>
  );
}

function Lamp({ time, uid }: { readonly time: DenTime; readonly uid: string }) {
  return (
    <g>
      {time === "night" && <circle cx={346} cy={104} r={78} fill={`url(#${uid}-lamp)`} />}
      <ellipse cx={346} cy={184} rx={13} ry={3.5} fill="#8b6a52" />
      <path d="M346 184V100" stroke="#8b6a52" strokeWidth={3} strokeLinecap="round" />
      <path d="M330 100L336 78H356L362 100Z" fill={time === "night" ? "#ffe9b0" : "#fbe0a8"} stroke="#d19c4c" strokeWidth={1.5} strokeLinejoin="round" />
    </g>
  );
}

function Shelf() {
  return (
    <g>
      <rect x={34} y={86} width={96} height={6} rx={2} fill="#c9a47f" stroke="#a37e5b" strokeWidth={1.2} />
      <rect x={42} y={64} width={9} height={22} rx={1.5} fill="#7f9be0" stroke="#566fb5" strokeWidth={1.1} />
      <rect x={52} y={68} width={8} height={18} rx={1.5} fill="#f7a58f" stroke="#d9785f" strokeWidth={1.1} />
      <rect x={61} y={62} width={10} height={24} rx={1.5} fill="#9bd576" stroke="#5fa654" strokeWidth={1.1} transform="rotate(8 66 86)" />
      <path d="M104 86H118V82Q118 76 111 76Q104 76 104 82Z" fill="#ffd45c" stroke="#b27a10" strokeWidth={1.2} />
      <path d={sparklePath(111, 68, 7)} fill="#ffd45c" stroke="#b27a10" strokeWidth={1.2} />
    </g>
  );
}

function Frame() {
  return (
    <g>
      <rect x={140} y={40} width={52} height={42} rx={4} fill="#fff9f0" stroke="#b98d63" strokeWidth={3} />
      <rect x={146} y={46} width={40} height={30} rx={2} fill="#d9eefc" />
      <path d="M146 76L159 61L168 68L177 57L186 67V76Z" fill="#9bd576" />
      <circle cx={177} cy={51} r={3.6} fill="#ffd166" />
    </g>
  );
}

function Lights({ time }: { readonly time: DenTime }) {
  const colors = ["#ffd166", "#f7876c", "#7fc8a9", "#8fa7ff"];
  const bulbs = Array.from({ length: 13 }, (_, index) => {
    const x = 12 + index * 31.3;
    const t = ((x % 200) / 200) * Math.PI;
    return [x, 14 + Math.sin(t) * 14] as const;
  });
  return (
    <g>
      <path d="M0 12Q100 42 200 12Q300 42 400 12" fill="none" stroke="#8b6a52" strokeWidth={1.2} opacity={0.7} />
      {bulbs.map(([x, y], index) => (
        <g key={x}>
          {time === "night" && <circle cx={x} cy={y + 5} r={7} fill={colors[index % colors.length]} opacity={0.28} />}
          <ellipse cx={x} cy={y + 5} rx={2.6} ry={3.4} fill={colors[index % colors.length]} />
        </g>
      ))}
    </g>
  );
}

function Cushion() {
  const x = (DEN_CUSHION_X / 100) * 400;
  return (
    <g>
      <ellipse cx={x} cy={FLOOR_Y + 30} rx={42} ry={11} fill="#8fa7e6" stroke="#6179bf" strokeWidth={1.5} />
      <ellipse cx={x} cy={FLOOR_Y + 27} rx={32} ry={7} fill="#b4c6f2" />
    </g>
  );
}

function Rug() {
  return (
    <g>
      <ellipse cx={204} cy={FLOOR_Y + 40} rx={128} ry={20} fill="#f4a48d" />
      <ellipse cx={204} cy={FLOOR_Y + 40} rx={108} ry={15} fill="none" stroke="#ffe3d6" strokeWidth={2} strokeDasharray="6 5" />
      <ellipse cx={204} cy={FLOOR_Y + 40} rx={70} ry={8} fill="#f7b8a4" />
    </g>
  );
}

export function PetDenRoom({ time, items, label }: { readonly time: DenTime; readonly items: readonly PetRoomItemId[]; readonly label?: string }) {
  const uid = `den${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const has = (item: PetRoomItemId) => items.includes(item);
  return (
    <svg className={`pet-den-room-art pet-den-room-art--${time}`} viewBox="0 0 400 250" preserveAspectRatio="xMidYMax slice" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <defs>
        <linearGradient id={`${uid}-sky-day`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9dbff" />
          <stop offset="1" stopColor="#e6f5ff" />
        </linearGradient>
        <linearGradient id={`${uid}-sky-night`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e2550" />
          <stop offset="1" stopColor="#3b4382" />
        </linearGradient>
        <radialGradient id={`${uid}-lamp`}>
          <stop offset="0" stopColor="#ffd98a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${uid}-paper`} width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="1.4" fill="#ecd7bf" />
          <circle cx="16" cy="16" r="1.4" fill="#ecd7bf" />
        </pattern>
      </defs>
      <rect width={400} height={FLOOR_Y} fill="#f8ebdb" />
      <rect width={400} height={150} fill={`url(#${uid}-paper)`} />
      <rect y={148} width={400} height={FLOOR_Y - 148} fill="#f0dcc4" />
      <rect y={146} width={400} height={4} fill="#e2c7a6" />
      <rect y={FLOOR_Y - 6} width={400} height={8} fill="#dcbd98" />
      <rect y={FLOOR_Y} width={400} height={250 - FLOOR_Y} fill="#e2bd92" />
      <path d={`M0 ${FLOOR_Y + 16}H400M0 ${FLOOR_Y + 36}H400M0 ${FLOOR_Y + 58}H400M70 ${FLOOR_Y}V${FLOOR_Y + 16}M230 ${FLOOR_Y}V${FLOOR_Y + 16}M150 ${FLOOR_Y + 16}V${FLOOR_Y + 36}M320 ${FLOOR_Y + 16}V${FLOOR_Y + 36}M40 ${FLOOR_Y + 36}V${FLOOR_Y + 58}M260 ${FLOOR_Y + 36}V${FLOOR_Y + 58}`} stroke="#cfa679" strokeWidth={1.4} />
      <Window time={time} uid={uid} />
      {has("frame") && <Frame />}
      {has("shelf") && <Shelf />}
      {has("rug") && <Rug />}
      {has("cushion") && <Cushion />}
      {has("plant") && <Plant />}
      {has("lamp") && <Lamp time="day" uid={uid} />}
      {time === "night" && <rect width={400} height={250} fill="#1a1f3d" opacity={0.46} />}
      {time === "night" && <NightSky />}
      {time === "night" && has("lamp") && <Lamp time="night" uid={uid} />}
      {has("lights") && <Lights time={time} />}
    </svg>
  );
}
