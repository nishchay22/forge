import React from 'react';

export default function Metrics({ metrics, defectCount, bots = [] }) {
  const m = metrics || { completedOrders: 0, avgWaitTime: 0, avgLeadTime: 0, throughput: 0, utilization: 0 };
  const busyBots = bots.filter(b => b.status === 'BUSY').length;
  const totalBots = bots.length;
  
  return (
    <div className="panel" style={{marginBottom: '16px'}}>
      <div className="panel-header">Factory Metrics</div>
      
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Completed</span>
          <span className="metric-val text-green">{m.completedOrders}</span>
        </div>
        
        <div className="metric-card">
          <span className="metric-label">Avg Lead Time</span>
          <span className="metric-val text-cyan">{m.avgLeadTime.toFixed(1)}t</span>
        </div>
        
        <div className="metric-card">
          <span className="metric-label">CPU Util</span>
          <span className="metric-val text-amber">{busyBots} / {totalBots}</span>
        </div>
        
        <div className="metric-card">
          <span className="metric-label">Defects</span>
          <span className="metric-val text-red">{defectCount || 0}</span>
        </div>
      </div>
    </div>
  );
}
