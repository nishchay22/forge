import React, { useState } from 'react';

export default function ControlPanel({ 
  strategy, timeQuantum, maxQueueSize, cash, 
  onSetStrategy, onSetTimeQuantum, onSetMaxQueueSize, onHireBot, onFireBot, 
  onBuyMachine, onSellMachine, onExpandWarehouse, onShrinkWarehouse, onRestock, 
  autoDefrag, onToggleAutoDefrag, autoRestock, onToggleAutoRestock, onBuyEnergy, onAddOrder 
}) {
  const [machineType, setMachineType] = useState('CNC');

  return (
    <div className="panel control-panel">
      <div className="panel-header">Control Panel</div>
      
      <div className="control-group">
        <label>CPU Scheduler Strategy</label>
        <select value={strategy} onChange={e => onSetStrategy(e.target.value)}>
          <option value="FCFS">FCFS (First Come First Serve)</option>
          <option value="SJF">SJF (Shortest Job First)</option>
          <option value="Priority">Priority (Preemptive)</option>
          <option value="RoundRobin">Round Robin</option>
        </select>
        
        {strategy === 'RoundRobin' && (
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px'}}>
            <label style={{margin: 0}}>Quantum: {timeQuantum}</label>
            <input 
              type="range" min="1" max="10" 
              value={timeQuantum} 
              onChange={e => onSetTimeQuantum(parseInt(e.target.value))} 
            />
          </div>
        )}
        <div style={{display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px'}}>
          <label style={{margin: 0}}>Max Queue: {maxQueueSize || 15}</label>
          <input 
            type="range" min="5" max="50" step="5"
            value={maxQueueSize || 15} 
            onChange={e => onSetMaxQueueSize(parseInt(e.target.value))} 
          />
        </div>
      </div>

      <div className="control-group">
        <label>Equipment</label>
        <div className="control-row">
          <select value={machineType} onChange={e => setMachineType(e.target.value)}>
            <option value="CNC">CNC ($3000)</option>
            <option value="Laser">Laser ($3500)</option>
            <option value="Welder">Welder ($2500)</option>
          </select>
          <button onClick={() => onBuyMachine(machineType)} disabled={cash < 2500}>Buy</button>
          <button onClick={() => onSellMachine(machineType)}>Sell</button>
        </div>
      </div>

      <div className="control-group">
        <label>Workforce</label>
        <div className="control-row">
          <button onClick={onHireBot} disabled={cash < 2000}>Hire Bot ($2000)</button>
          <button onClick={onFireBot}>Fire Idle Bot</button>
        </div>
      </div>
      
      <div className="control-group">
        <label>Operations</label>
        <div className="control-row" style={{ gap: '4px' }}>
          <button onClick={onExpandWarehouse} disabled={cash < 800}>Expand ($800)</button>
          <button onClick={onShrinkWarehouse}>Shrink (+$400)</button>
          <button onClick={onRestock} disabled={cash < 2000}>Restock ($2k)</button>
        </div>
        <div className="control-row" style={{ marginTop: '8px', justifyContent: 'flex-start', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={autoDefrag} onChange={onToggleAutoDefrag} style={{ accentColor: 'var(--accent-cyan)' }} />
            Auto Defrag
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={autoRestock} onChange={onToggleAutoRestock} style={{ accentColor: 'var(--accent-cyan)' }} />
            Auto Restock ($2k)
          </label>
        </div>
        <div className="control-row">
          <button onClick={onBuyEnergy} disabled={cash < 250}>Buy Energy ($250)</button>
          <button onClick={onAddOrder}>Place Custom Order</button>
        </div>
      </div>
    </div>
  );
}
