// Tiny SVG helpers shared by frames, badges and emblems.

/** Evenly spaced gradient stops. */
export function Stops({ colors }: { readonly colors: readonly string[] }) {
  return (
    <>
      {colors.map((color, index) => (
        <stop key={index} offset={colors.length === 1 ? 0 : index / (colors.length - 1)} stopColor={color} />
      ))}
    </>
  );
}

/** A curved feather pointing along -x from the origin (wings on frames and emblems). */
export function featherPath(length: number, width: number): string {
  const l = length;
  const w = width;
  return `M0 0 C${-l * 0.25} ${-w} ${-l * 0.7} ${-w * 1.1} ${-l} ${-w * 0.2} C${-l * 0.72} ${w * 0.4} ${-l * 0.3} ${w * 0.62} 0 0Z`;
}
