import React from 'react';

export default function DeadlockAlert({ deadlock, onResolve }) {
  if (!deadlock || !deadlock.hasCycle) return null;

  return (
    <div className="deadlock-alert">
      <div className="deadlock-alert-header">
        ⚠️ DEADLOCK DETECTED
      </div>
      
      <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
        A circular wait condition has occurred between {deadlock.cycle.length} components. 
        Production has halted. OS intervention is required.
      </div>
      
      <div className="deadlock-cycle">
        {deadlock.cycle.map((node, i) => (
          <span key={i}>
            {node.botId || node.machineId} {i < deadlock.cycle.length - 1 ? ' ➔ ' : ' ➔ ' + (deadlock.cycle[0].botId || deadlock.cycle[0].machineId)}
          </span>
        ))}
      </div>
      
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
        <button className="danger" onClick={() => onResolve('reset')}>
          Force Preempt (Kill Victim)
        </button>
        <button className="danger" onClick={() => onResolve('smart')} style={{ opacity: 0.8 }}>
          Smart Sequencing (Reset All)
        </button>
      </div>
    </div>
  );
}
