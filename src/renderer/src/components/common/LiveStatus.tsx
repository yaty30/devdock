export function LiveStatus({ label = "Live" }: { label?: string }): JSX.Element {
  return (
    <span className="live-status">
      <span className="status-dot" />
      {label}
    </span>
  );
}
