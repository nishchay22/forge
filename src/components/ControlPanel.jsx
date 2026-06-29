import React from 'react';

export default function ControlPanel({ strategy, onSetStrategy, onHireBot, onFireBot, onBuyMachine, onExpandWarehouse, onRestock, onBuyEnergy, onAddOrder }) {
  return (
    <div className="panel">
      <h3>Production strategy <span className="hint">how bots pick the next job</span></h3>
      <select value={strategy} onChange={e => onSetStrategy(e.target.value)}>
        <option value="FCFS">🟢 Sequential — first come, first served</option>
        <option value="SJF">🟡 Quick jobs first — shortest job first</option>
        <option value="Priority">🔴 Client priority — critical jobs jump the line</option>
        <option value="RoundRobin">🔵 Balanced load — round robin</option>
      </select>
      <div className="btnrow">
        <button onClick={onHireBot}>＋ Hire bot · $500</button>
        <button onClick={onFireBot}>－ Retire bot</button>
      </div>
      <div className="btnrow">
        <button onClick={onBuyMachine}>＋ Buy machine · $800</button>
        <button onClick={onExpandWarehouse}>＋ Expand warehouse · $600</button>
      </div>
      <div className="btnrow">
        <button onClick={onRestock}>＋ Restock Materials</button>
        <button onClick={onBuyEnergy}>＋ Buy Energy</button>
      </div>
      <div className="btnrow">
        <button className="full" onClick={onAddOrder}>＋ Place new order</button>
      </div>
    </div>
  );
}
