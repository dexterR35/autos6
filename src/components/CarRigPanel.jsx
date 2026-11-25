import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_CAR_POSE, RIG_PANELS } from '../lib/carRig.js';

export default function CarRigPanel({ pose, onChange, onClose, panelRef }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const dismiss = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && (panelRef.current?.contains(event.target) || event.target.closest('.three-toolbar__panels'))) return;
      onClose();
      if (event.type === 'keydown') document.querySelector('.three-toolbar__panels')?.focus();
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', dismiss);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', dismiss); };
  }, [onClose, panelRef]);
  const toggle = id => onChange({ ...pose, openPanels: pose.openPanels.includes(id) ? pose.openPanels.filter(key => key !== id) : [...pose.openPanels, id] });
  return (
    <section ref={panelRef} id="car-rig" className="wheel-setup car-rig" aria-label="Doors, panels and steering">
      <div className="wheel-setup__head"><h2>Explore the A6</h2><button ref={closeRef} type="button" onClick={onClose} aria-label="Close car controls"><X aria-hidden="true" /></button></div>
      <div className="car-rig__panels">{RIG_PANELS.map(([id, label]) => <button type="button" key={id} aria-pressed={pose.openPanels.includes(id)} onClick={() => toggle(id)}><span>{label}</span><small>{pose.openPanels.includes(id) ? 'Open' : 'Closed'}</small></button>)}</div>
      <label className="car-rig__slider" htmlFor="car-steering">Front steering <output>{pose.steering}°</output></label>
      <input id="car-steering" aria-label="Front steering" type="range" min="-30" max="30" step="1" value={pose.steering} onChange={event => onChange({ ...pose, steering: Number(event.target.value) })} />
      <label className="car-rig__slider" htmlFor="car-wheel-turn">Wheel rotation <output>{pose.wheelRotation}°</output></label>
      <input id="car-wheel-turn" aria-label="Wheel rotation" type="range" min="0" max="360" step="5" value={pose.wheelRotation} onChange={event => onChange({ ...pose, wheelRotation: Number(event.target.value) })} />
      <button type="button" className="wheel-setup__reset" onClick={() => onChange({ ...DEFAULT_CAR_POSE })}>Close all & reset wheels</button>
    </section>
  );
}
