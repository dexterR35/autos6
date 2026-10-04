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
  const [params] = useSearchParams();
  const stacked = useMediaQuery('(max-width: 900px)');
  const calibrate = import.meta.env.DEV && params.get('calibrate') === '1';

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
    <section className="garage-stage" aria-label="Garage">
      <div className="stage">
        <CarViewer
          mode="image"
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
        />
        <p className="visually-hidden" aria-live="polite">
          {view ? `Showing ${view.label} view.` : ''}
          {selected ? ` Selected ${selected.name}.` : ''}
        </p>
        {viewError && (
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
          />
        )}
        <div className="stage-bottom">
          <AngleSelector ref={angleRef} viewId={g.viewId} onChange={g.setViewId} selectedPartId={g.selectedPartId} />
          <FundingPanel ref={fundingRef} />
        </div>
      </div>
    </section>
  );
}
