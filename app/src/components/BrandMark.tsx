export function BrandMark({ small = false }: { small?: boolean }) {
  return <img className={`brand-mark ${small ? "small" : ""}`} src="/prior-mark.svg" alt="" aria-hidden="true" />;
}
