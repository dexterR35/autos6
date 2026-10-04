import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import HotspotButton from './HotspotButton.jsx';
import PartCallout from './PartCallout.jsx';
import { isAnchorVisible, projectPoint, rectContains, rectsOverlap } from '../lib/projection.js';
import { calloutScale, layoutCallouts, maxCalloutsFor } from '../lib/calloutLayout.js';

function measureReserved(stageEl, refs) {
  if (!stageEl) return [];
  const s = stageEl.getBoundingClientRect();
  return refs
    .map((r) => r?.current)
    .filter(Boolean)
    .map((el) => el.getBoundingClientRect())
    .filter((b) => b.width > 0 && b.height > 0)
    .map((b) => ({ x: b.left - s.left, y: b.top - s.top, width: b.width, height: b.height }));
}

/**
 * On small renders, anchors that land on top of each other become untappable. Keep the
 * selected one and higher-priority (earlier) ones; the rest stay reachable from the list.
 */
function dropCrowded(anchors, selectedPartId, scale) {
  const minDist = scale < 0.45 ? 26 : 18;
  const ordered = [...anchors].sort((a, b) => (b.partId === selectedPartId) - (a.partId === selectedPartId));
  const kept = [];
  for (const a of ordered) {
    if (kept.every((k) => Math.hypot(k.point.x - a.point.x, k.point.y - a.point.y) >= minDist)) kept.push(a);
  }
  return anchors.filter((a) => kept.includes(a));
}

/**
 * Dots, SVG leaders and callout cards for ONE view. Rendered with a key per view so a
 * camera switch never leaves the previous view's dots on screen.
 */
export default function HotspotLayer({
  view, rect, stageW, stageH, stageRef, reservedRefs = [], overlayRefs = [], partsById, visiblePartIds,
  selectedPartId, hoveredPartId, onSelect, onHover, compact, currency, overrides,
}) {
  // reserved: fixed UI that cards are laid out around (header, bottom panels).
  // overlays: things that open on top (details drawer). They hide what they cover but never
  // trigger a re-layout, so opening the drawer doesn't make cards jump.
  const [reserved, setReserved] = useState([]);
  const [overlays, setOverlays] = useState([]);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  useLayoutEffect(() => {
    const update = () => {
      const r = measureReserved(stageRef.current, reservedRefs);
      const o = measureReserved(stageRef.current, overlayRefs);
      setReserved((prev) => (same(prev, r) ? prev : r));
      setOverlays((prev) => (same(prev, o) ? prev : o));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    [...reservedRefs, ...overlayRefs].forEach((r) => r?.current && ro.observe(r.current));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageW, stageH, selectedPartId, [...reservedRefs, ...overlayRefs].map((r) => Boolean(r?.current)).join()]);

  const anchors = useMemo(() => {
    if (!view || !rect.width) return [];
    // Calibration may add anchors for parts the view doesn't list yet.
    const extra = Object.keys(overrides ?? {})
      .filter((pid) => !view.hotspots.some((h) => h.partId === pid))
      .map((pid) => ({ id: `${view.id}--${pid}`, partId: pid, featured: false, callout: { side: 'right', dx: 30, dy: 0 } }));
    const visible = [...view.hotspots, ...extra]
      .filter((h) => partsById[h.partId] && (!visiblePartIds || visiblePartIds.has(h.partId)))
      .map((h) => {
        const o = overrides?.[h.partId];
        return { ...h, point: projectPoint(rect, o?.x ?? h.x, o?.y ?? h.y) };
      })
      .filter((a) => isAnchorVisible(a.point, { rect, stageW, stageH, reserved }));
    return dropCrowded(visible, selectedPartId, rect.scale);
  }, [view, rect, stageW, stageH, reserved, partsById, visiblePartIds, overrides, selectedPartId]);

  const isCovered = (box) => overlays.some((o) => rectsOverlap(box, o, 4));

  // Hover only restyles; it never changes which cards exist or where they sit.
  const activePartId = hoveredPartId ?? selectedPartId;
  const callouts = useMemo(() => {
    if (compact || !anchors.length) return [];
    const s = calloutScale(stageW);
    const card = stageW >= 1280 ? { width: 222, height: 76 } : { width: 200, height: 68 };
    const topInset = reserved.length ? 0 : 8;
    return layoutCallouts({
      anchors,
      bounds: { x: 10, y: topInset, width: stageW - 20, height: stageH - topInset - 10 },
      reserved,
      card,
      scale: s,
      maxCards: maxCalloutsFor(stageW),
      activePartId: selectedPartId,
    });
  }, [anchors, compact, stageW, stageH, reserved, selectedPartId]);

  // Entry choreography: each element gets its delay ONCE, when it first mounts. Elements
  // that appear with the view stagger in after the photo settles; anything added later (a
  // card for a clicked part) appears at once. The value never changes afterwards, so a
  // re-render can't restart an animation (which is what makes overlays flicker).
  const mountedAt = useRef(null);
  const delays = useRef(new Map());
  if (mountedAt.current === null) mountedAt.current = performance.now();
  const delayFor = (key, base, i, step) => {
    if (performance.now() - mountedAt.current > 1500) return '0ms'; // entry is long over
    if (!delays.current.has(key)) {
      const entering = performance.now() - mountedAt.current < 400;
      delays.current.set(key, entering ? `${base + i * step}ms` : '0ms');
    }
    return delays.current.get(key);
  };

  return (
    <div className="hotspot-layer" data-view={view?.id}>
      <svg className="leaders" width={stageW} height={stageH} aria-hidden="true">
        {callouts.map((c, i) => (
          <g key={c.anchorId} className={`${c.partId === activePartId ? 'is-active' : ''} ${isCovered(c.rect) ? 'is-covered' : ''}`} style={{ '--delay': delayFor(`l-${c.anchorId}`, 420, i, 55) }}>
            <path d={c.leader.d} />
            <circle cx={c.leader.end.x} cy={c.leader.end.y} r="2.5" />
          </g>
        ))}
      </svg>
      {callouts.map((c, i) => (
        <PartCallout
          key={c.anchorId}
          delay={delayFor(`c-${c.anchorId}`, 460, i, 55)}
          part={partsById[c.partId]}
          rect={c.rect}
          active={c.partId === activePartId}
          covered={isCovered(c.rect)}
          currency={currency}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      {anchors.map((a, i) => (
        <HotspotButton
          key={a.id}
          delay={delayFor(`d-${a.id}`, 240, i, 45)}
          part={partsById[a.partId]}
          point={a.point}
          selected={a.partId === selectedPartId}
          covered={overlays.some((o) => rectContains(o, a.point, 6))}
          active={a.partId === activePartId}
          onSelect={onSelect}
          onHover={onHover}
          currency={currency}
        />
      ))}
    </div>
  );
}
