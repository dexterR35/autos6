import { useId } from 'react';
import { DONATION_PRESETS_CENTS, formatCents } from '../lib/money.js';

export default function AmountPicker({ amountCents, onChange, custom, onCustom, currency = 'usd', inline = false }) {
  const inputId = useId();
  const customSelected = custom !== null;
  return <div className="amount-picker">
    <div className="presets" role="group" aria-label="Contribution amount">
      {DONATION_PRESETS_CENTS.map((value) => <button key={value} type="button" className={`preset ${!customSelected && amountCents === value ? 'is-active' : ''}`} aria-pressed={!customSelected && amountCents === value} onClick={() => onChange(value)}>{formatCents(value, currency)}</button>)}
      <button type="button" className={`preset ${customSelected ? 'is-active' : ''}`} aria-pressed={customSelected} onClick={() => onCustom(custom ?? '')}>Custom</button>
    </div>
    {customSelected && !inline && <label className="field" htmlFor={inputId}><span>Custom amount ({currency.toUpperCase()})</span><input id={inputId} autoFocus inputMode="decimal" placeholder="e.g. 15.50" maxLength={12} value={custom} onChange={(e) => onCustom(e.target.value)} /></label>}
  </div>;
}
