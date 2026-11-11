export function Mark({ size = 88 }: { size?: number }) {
  return (
    <div className="mark" style={{ width: size, height: size }} aria-hidden="true">
      <span className="mark-ring" />
      <span className="mark-ring-2" />
      <span className="mark-core" />
      <span className="mark-spin" aria-hidden="true">
        <span className="mark-dot" />
        <span className="mark-dot" />
        <span className="mark-dot" />
      </span>
    </div>
  );
}
