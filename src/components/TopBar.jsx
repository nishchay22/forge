import React, { useState, useEffect } from 'react';

export default function TopBar({ 
  cash, power, rating, tickCount, lastCheckpointAt, 
  chaosMode, paused, speed, 
  onToggleChaos, onCheckpoint, onSurge, onTogglePause, onSetSpeed 
}) {
  const [prevCash, setPrevCash] = useState(cash);
  const [cashChanged, setCashChanged] = useState(false);

  useEffect(() => {
    if (cash !== prevCash) {
      setCashChanged(true);
      const to = setTimeout(() => setCashChanged(false), 300);
      setPrevCash(cash);
      return () => clearTimeout(to);
    }
  }, [cash, prevCash]);

  return (
    <div className="topbar">
      <div className="logo">&#9881; FORGE</div>
      
      <div className="stats">
        <div className="stat">
          <span className="label">RATING</span>
          <span className="val" style={{color: 'var(--amber)'}}>
            {Array.from({length: 5}).map((_, i) => (
              <span key={`star-${i}`}>{i < rating ? '★' : '☆'}</span>
            ))}
          </span>
        </div>
        
        <div className="stat">
          <span className="label">CASH</span>
          <span className={`val ${cashChanged ? 'changed' : ''}`} style={{color: 'var(--green)'}}>
            ${cash.toLocaleString()}
          </span>
        </div>
        
        <div className="stat">
          <span className="label">ENERGY</span>
          <span className="val" style={{color: 'var(--blue)'}}>{power} kW</span>
        </div>
        
        <div className="stat">
          <span className="label">TICK</span>
          <span className="val tick-counter">{tickCount}</span>
        </div>
      </div>
      
      <div className="controls">
        <div style={{display: 'flex', gap: '4px', background: 'var(--bg)', padding: '4px', borderRadius: '4px'}}>
          <button className={`speed-btn ${speed === 1 ? 'active' : ''}`} onClick={() => onSetSpeed(1)}>1x</button>
          <button className={`speed-btn ${speed === 2 ? 'active' : ''}`} onClick={() => onSetSpeed(2)}>2x</button>
          <button className={`speed-btn ${speed === 4 ? 'active' : ''}`} onClick={() => onSetSpeed(4)}>4x</button>
        </div>
        
        <button className="pause-btn" onClick={onTogglePause}>
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
        
        <button onClick={onCheckpoint}>💾 Checkpoint</button>
        <button onClick={onSurge}>⚡ Surge</button>
        <button className={`chaos-btn ${chaosMode ? 'on' : ''}`} onClick={onToggleChaos}>
          ☢ Chaos Mode
        </button>
      </div>
    </div>
  );
}
