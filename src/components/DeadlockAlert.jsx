import React from 'react';

export default function DeadlockAlert({ deadlock, onResolve }) {
  if (!deadlock) return null;
  return (
    <div className="deadlock-banner">
      <div className="msg">
        <b>⚠ Deadlock detected</b>
        <span className="cycle">Wait-for cycle: {deadlock.cycle.join(' → ')} — on {deadlock.machines.join(', ')}</span>
      </div>
      <div className="btns">
        <button onClick={() => onResolve('reset')}>Force reset locks</button>
        <button className="alt" onClick={() => onResolve('buy')}>Buy machine ($800)</button>
      </div>
    </div>
  );
}
