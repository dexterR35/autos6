import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CarViewer from './CarViewer.jsx';
import AngleSelector from './AngleSelector.jsx';
import FundingPanel from './FundingPanel.jsx';
import PartDetailsDrawer from './PartDetailsDrawer.jsx';
import { filterParts } from '../lib/parts.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { useShell } from '../hooks/useShell.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { getView } from '../data/views.js';

export default function GarageStage() {
  const { parts, partsById, project } = useProjectData();
  const g = useGarageState();
  const { headerRef } = useShell();
  const angleRef = useRef(null);
  const fundingRef = useRef(null);
  const drawerRef = useRef(null);
  const [viewError, setViewError] = useState(null);
  const [params, setParams] = useSearchParams();
  const [imageFallback, setImageFallback] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const stacked = useMediaQuery('(max-width: 900px)');
  const calibrate = import.meta.env.DEV && params.get('calibrate') === '1';
  const mode = calibrate || imageFallback || params.get('viewer') === 'image' ? 'image' : 'three';
  const choosePreset = (id) => {
    g.setViewId(id);
    setResetKey((value) => value + 1);
  };
  const enable3D = () => {
    setImageFallback(false);
    setViewError(null);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('viewer');
      return next;
    }, { replace: true });
  };

  // Search and status filter hide the same parts on the car as in the list.
  const visiblePartIds = useMemo(
    () => new Set(filterParts(parts, { query: g.search, status: g.statusFilter }).map((p) => p.id)),
    [parts, g.search, g.statusFilter],
  );
  const selected = g.selectedPartId ? partsById[g.selectedPartId] : null;
  const currency = project.currency ?? 'usd';
  const reservedRefs = stacked ? [headerRef] : [headerRef, angleRef, fundingRef];
  const overlayRefs = [drawerRef];
  const view = getView(g.viewId);

  return (
    <section className="garage-stage" aria-label="Garage" data-viewer-mode={mode}>
      <div className="stage">
        <CarViewer
          mode={mode}
          resetKey={resetKey}
          viewId={g.viewId}
          partsById={partsById}
          visiblePartIds={visiblePartIds}
          selectedPartId={g.selectedPartId}
          hoveredPartId={g.hoveredPartId}
          onPartSelect={g.selectPart}
          onPartHover={g.setHoveredPartId}
          reservedRefs={reservedRefs}
          overlayRefs={overlayRefs}
          compact={stacked}
          currency={currency}
          calibrate={calibrate}
          onViewError={setViewError}
          onFallback={() => { setViewError(null); setImageFallback(true); }}
        />
        {mode === 'image' && !calibrate && (
          <div className="viewer-mode-banner">
            <span>Image view</span>
            <button type="button" onClick={enable3D}>Open interactive 3D</button>
          </div>
        )}
        <p className="visually-hidden" aria-live="polite">
          {view ? `Showing ${view.label} view.` : ''}
          {selected ? ` Selected ${selected.name}.` : ''}
        </p>
        {mode === 'image' && viewError && (
          <p className="toast" role="status">
            That camera angle could not be loaded.{' '}
            <button type="button" className="link-btn" onClick={() => setViewError(null)}>Dismiss</button>
          </p>
        )}
        {selected && (
          <PartDetailsDrawer
            ref={drawerRef}
            part={selected}
            viewId={g.viewId}
            currency={currency}
            onClose={g.clearSelection}
            onFund={(partId) => g.openDonation({ partId })}
            onViewChange={g.setViewId}
            showVisibility={mode === 'image'}
          />
        )}
        <div className="stage-bottom">
          <AngleSelector ref={angleRef} mode={mode} viewId={g.viewId} onChange={choosePreset} selectedPartId={g.selectedPartId} />
          <FundingPanel ref={fundingRef} />
        </div>
      </div>
    </section>
  );
}
