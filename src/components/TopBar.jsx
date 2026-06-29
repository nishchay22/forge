import React from 'react';

export default function TopBar({ cash, power, rating, lastCheckpointAt, chaosMode, onToggleChaos, onCheckpoint, onSurge }) {
  const secAgo = lastCheckpointAt ? Math.round((Date.now() - lastCheckpointAt) / 1000) : null;
  const cpText = secAgo !== null ? `Saved ${secAgo}s ago` : 'No checkpoint yet';

  return (
    <div className="topbar">
      <div className="logo">⚙ FORGE <small>smart factory simulator</small></div>
      <div className="stat-group">
        <div className="stat"><span className="ic">⭐</span><b>{rating.toFixed(1)}</b></div>
        <div className="stat"><span className="ic">💰</span><b>${Math.round(cash).toLocaleString()}</b></div>
        <div className="stat"><span className="ic">⚡</span><b>{power}</b>kW</div>
        <div className="stat"><span className="ic">💾</span><span>{cpText}</span></div>
      </div>
      <div className="actions">
        <button className="iconbtn" onClick={onCheckpoint} title="Save a snapshot of every table">💾 Checkpoint</button>
        <button className="iconbtn" onClick={onSurge} title="Simulate a crash to see the recovery process">⚡ Simulate Surge</button>
        <button className={`iconbtn danger ${chaosMode ? 'on' : ''}`} onClick={onToggleChaos} title="Disable machine locks">
          🧨 Chaos Mode: {chaosMode ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
}
