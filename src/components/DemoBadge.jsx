export default function DemoBadge({ children = 'Demo data' }) {
  return (
    <span className="demo-badge" title="Sample values for review only — not real contributions">
      {children}
    </span>
  );
}
