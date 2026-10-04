import { useState } from 'react';
import { views } from '../data/views.js';

/**
 * Development-only hotspot calibration (enabled with ?calibrate=1 under `npm run dev`).
 * Pick a part, click the photo to move its anchor, then copy the edited configuration.
 */
export default function CalibrationPanel({ view, partsById, state, setState }) {
  const [copied, setCopied] = useState(false);
  if (!view) return null;

  const exportConfig = () => {
    const edited = views
      .filter((v) => v.available)
      .map((v) => ({
        id: v.id,
        hotspots: [
          ...v.hotspots.map((h) => {
            const o = state.overrides[v.id]?.[h.partId];
            return { partId: h.partId, x: o?.x ?? h.x, y: o?.y ?? h.y, callout: h.callout, featured: h.featured };
          }),
          ...Object.entries(state.overrides[v.id] ?? {})
            .filter(([pid]) => !v.hotspots.some((h) => h.partId === pid))
            .map(([partId, o]) => ({ partId, x: o.x, y: o.y, callout: { side: 'right', dx: 30, dy: 0 }, featured: false })),
        ],
      }));
    const json = JSON.stringify(edited, null, 2);
    console.info('[calibrate] exported views:\n', json);
    navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const partIds = [...new Set([...view.hotspots.map((h) => h.partId), ...Object.keys(partsById)])];

  return (
    <div className="calibration" onClick={(e) => e.stopPropagation()}>
      <strong>Calibration · {view.id}</strong>
      <div className="calibration__readout">
        {state.last ? `x ${state.last.x.toFixed(3)}  y ${state.last.y.toFixed(3)}` : 'Click the photo'}
      </div>
      <label>
        Move anchor for
        <select value={state.target ?? ''} onChange={(e) => setState((s) => ({ ...s, target: e.target.value || null }))}>
          <option value="">— log only —</option>
          {partIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn--ghost btn--sm" onClick={exportConfig}>
        {copied ? 'Copied' : 'Copy view config'}
      </button>
    </div>
  );
}
