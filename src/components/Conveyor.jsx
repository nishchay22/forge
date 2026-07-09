import React from 'react';

export default function Conveyor({ conveyor }) {
  const capacity = conveyor?.capacity || 8;
  const slots = conveyor?.slots || Array(capacity).fill(null);
  
  const fillPct = slots.length > 0 ? (slots.filter(s => s !== null).length / slots.length) * 100 : 0;

  return (
    <div className="conveyor-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
        <span>Fabrication &rarr;</span>
        <span>&rarr; Shipping</span>
      </div>
      
      <div className="conveyor-track">
        {slots.map((item, i) => (
          <div key={`conv-slot-${i}`} className={`conveyor-slot ${item ? 'filled' : ''}`}>
            {item && <span className="item" title={item.product}>📦</span>}
          </div>
        ))}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
        <div className="progress-bar-bg" style={{ flex: 1 }}>
          <div className="progress-bar-fill" style={{ width: `${fillPct}%`, background: fillPct > 80 ? 'var(--accent-red)' : 'var(--accent-cyan)' }} />
        </div>
        <span className="mono" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{fillPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
