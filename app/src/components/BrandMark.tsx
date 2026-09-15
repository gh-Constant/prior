export function BrandMark({ small = false, withTitle = false }: { small?: boolean; withTitle?: boolean }) {
  return (
    <span className={`brand-lockup ${small ? "small" : ""} ${withTitle ? "with-title" : ""}`}>
      <img className="brand-mark" src="/prior-logo.png" alt="" aria-hidden="true" />
      {withTitle && <span className="brand-title">Prior</span>}
    </span>
  );
}
