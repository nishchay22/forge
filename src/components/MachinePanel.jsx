import React from 'react';

export default function MachinePanel({ machine }) {
  const hasWaiters = machine.waitQueue && machine.waitQueue.length > 0;
  const isFull = machine.currentLocks.length >= machine.capacity;
  const isUsed = machine.currentLocks.length > 0;
  const locksText = `${machine.currentLocks.length} / ${machine.capacity}`;
  const util = machine.utilizationPct || 0;
  
  let icon = '🏭';
  if (machine.type === 'CNC') icon = '⚙️';
  if (machine.type === 'Laser') icon = '⚡';
  if (machine.type === 'Welder') icon = '🔥';

  let statusText = `READY (0/${machine.capacity})`;
  let statusColor = 'var(--text-dim)';
  if (hasWaiters) {
    statusText = `OVERLOADED (${machine.currentLocks.length}/${machine.capacity})`;
    statusColor = 'var(--accent-red)';
  } else if (isFull) {
    statusText = `MAX CAPACITY (${machine.currentLocks.length}/${machine.capacity})`;
    statusColor = 'var(--accent-amber)';
  } else if (isUsed) {
    statusText = `ACTIVE (${machine.currentLocks.length}/${machine.capacity})`;
    statusColor = 'var(--accent-green)';
  }

  return (
    <div className="machine-card" style={{ '--utilization': `${util}%` }}>
      <div className="machine-header">
        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
          <span className="machine-icon">{icon}</span>
          <span className="machine-name">{machine.type}</span>
        </div>
        <div style={{fontSize: '10px', color: statusColor, fontWeight: 'bold'}}>
          {statusText}
        </div>
      </div>
      
      <div className="machine-stats">
        <span>Usage: {locksText}</span>
        <span>Wait Q: {machine.waitQueue.length}</span>
      </div>

      <div style={{display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px'}}>
        {machine.currentLocks.map((botId, i) => (
          <span key={i} className="lock-pill">🔒 {botId.split('-')[1]}</span>
        ))}
      </div>
    </div>
  );
}
