import { Flag } from 'lucide-react';
export default function PriorityChip({ priority = 'standard' }) {
  return <span className={`priority priority--${priority}`}><Flag aria-hidden="true" />{priority === 'important' ? 'Important' : 'Standard'}</span>;
}
