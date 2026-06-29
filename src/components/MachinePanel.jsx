import React from 'react';

export default function MachinePanel({ machine }) {
  const lockedBy = machine.locked_by || [];
  const waitQueue = machine.wait_queue || [];
  const full = lockedBy.length >= machine.capacity;
  const waitTxt = waitQueue.length ? ` · ${waitQueue.length} waiting` : '';
  const isLocked = lockedBy.length > 0;
  
  return (
    <div className={`machine ${isLocked ? 'locked' : ''} ${full ? 'full' : ''}`}>
      <span className="dot"></span>
      <span className="name">{machine.type}</span>
      <span className="load">
        {isLocked ? lockedBy.join(', ') : 'free'} ({lockedBy.length}/{machine.capacity}){waitTxt}
      </span>
    </div>
  );
}
