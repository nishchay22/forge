import React from 'react';

export default function RecoveryOverlay({ active, steps }) {
  if (!active) return null;
  const currentStep = steps[steps.length - 1] || 'System recovery in progress…';
  
  return (
    <div className="surge-overlay">
      <div className="big">⚡ POWER SURGE</div>
      <div className="step">{currentStep}</div>
    </div>
  );
}
