import "./CompletionBurst.css";

type Props = { readonly trigger: number };

export function CompletionBurst({ trigger }: Props) {
  if (!trigger) return null;

  return (
    <span key={trigger} className="completion-burst" aria-hidden="true">
      <span className="completion-burst-ring" />
      <span className="completion-burst-particle" />
      <span className="completion-burst-particle" />
      <span className="completion-burst-particle" />
      <span className="completion-burst-particle" />
      <span className="completion-burst-particle" />
      <span className="completion-burst-particle" />
    </span>
  );
}
