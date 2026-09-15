export function BrandMark({ small = false }: { small?: boolean }) {
  return <img className={`brand-mark ${small ? "small" : ""}`} src="/prior-logo.png" alt="" aria-hidden="true" />;
}
