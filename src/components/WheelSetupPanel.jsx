import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_WHEEL_SETUP } from '../lib/wheelSetup.js';

const rimColors = [['Graphite', '#657080'], ['Silver', '#bec5ce'], ['Gloss black', '#171b23'], ['Bronze', '#a67c46']];
const brakeColors = [['Red', '#c81924'], ['Yellow', '#e5b62a'], ['Blue', '#2365cc'], ['Black', '#20242b']];

export default function WheelSetupPanel({ setup, onChange, onClose, panelRef }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const dismiss = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && (panelRef.current?.contains(event.target) || event.target.closest('.three-toolbar__wheels'))) return;
      onClose();
      if (event.type === 'keydown') document.querySelector('.three-toolbar__wheels')?.focus();
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', dismiss);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', dismiss); };
  }, [onClose, panelRef]);
  const update = (key, value) => onChange({ ...setup, [key]: value });
  return (
    <section ref={panelRef} id="wheel-setup" className="wheel-setup" aria-label="Wheels and brakes">
      <div className="wheel-setup__head"><h2>Wheels & brakes</h2><button ref={closeRef} type="button" onClick={onClose} aria-label="Close wheel customization"><X aria-hidden="true" /></button></div>
      {[['rimColor', 'Rim colour', rimColors], ['caliperColor', 'Caliper colour', brakeColors]].map(([key, label, colors]) => (
        <fieldset key={key}><legend>{label}</legend><div className="wheel-setup__colors">
          {colors.map(([name, color]) => <button type="button" key={name} aria-label={`${label}: ${name}`} title={name}
            aria-pressed={setup[key].toLowerCase() === color} style={{ '--swatch': color }} onClick={() => update(key, color)} />)}
          <label className="wheel-setup__custom" title={`Custom ${label.toLowerCase()}`}><span>Custom</span><input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={setup[key]} onChange={event => update(key, event.target.value)} /></label>
        </div></fieldset>
      ))}
      <fieldset><legend>Tyres</legend><div className="wheel-setup__tyres">
        {[['road', 'Road', 'Grooved everyday tread'], ['track', 'Track', 'Semi-slick tread']].map(([value, title, hint]) => (
          <button type="button" key={value} aria-pressed={setup.tyre === value} onClick={() => update('tyre', value)}><strong>{title}</strong><small>{hint}</small></button>
        ))}
      </div></fieldset>
      <button type="button" className="wheel-setup__reset" onClick={() => onChange({ ...DEFAULT_WHEEL_SETUP })}>Reset wheel setup</button>
    </section>
  );
}
