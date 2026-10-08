import { lazy, Suspense } from 'react';
import ImageCarViewer from './ImageCarViewer.jsx';

const ThreeCarViewer = lazy(() => import('./ThreeCarViewer.jsx'));

/**
 * Renderer boundary. The shell, donations and catalogue talk to the car only through
 * this contract: { viewId, selectedPartId, hoveredPartId, onPartSelect, onPartHover }.
 * The live 3D scene is the default. Image mode is an explicit fallback and the
 * development calibration surface, using the same part-selection contract.
 */
export default function CarViewer({ mode = 'three', ...props }) {
  if (mode === 'image') return <ImageCarViewer {...props} />;
  if (mode === 'three') return (
    <Suspense fallback={<div className="viewer three-loading" role="status">Opening the 3D garage…</div>}>
      <ThreeCarViewer {...props} />
    </Suspense>
  );
  throw new Error(`CarViewer mode "${mode}" is not implemented yet.`);
}
