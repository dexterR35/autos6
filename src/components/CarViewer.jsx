import ImageCarViewer from './ImageCarViewer.jsx';

/**
 * Renderer boundary. The shell, donations and catalogue talk to the car only through
 * this contract: { viewId, selectedPartId, hoveredPartId, onPartSelect, onPartHover }.
 * mode="three" is reserved for a future Three.js renderer with its own 3D anchors.
 */
export default function CarViewer({ mode = 'image', ...props }) {
  if (mode === 'image') return <ImageCarViewer {...props} />;
  throw new Error(`CarViewer mode "${mode}" is not implemented yet.`);
}
