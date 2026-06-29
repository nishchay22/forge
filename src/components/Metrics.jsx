import React from 'react';

export default function Metrics({ metrics }) {
  const { avgLeadTime, throughput, botUtilization, gridlocks, defects, cacheHitRatio } = metrics;
  
  const metricCards = [
    { label: 'Avg Lead Time', value: `${avgLeadTime}s`, trend: 'down', good: true },
    { label: 'Throughput', value: `${throughput}/m`, trend: 'up', good: true },
    { label: 'Utilization', value: `${botUtilization}%`, trend: 'up', good: botUtilization > 50 },
    { label: 'Gridlocks', value: gridlocks, trend: 'up', good: gridlocks === 0 },
    { label: 'Defects', value: defects, trend: 'down', good: defects < 5 },
    { label: 'Cache Hit', value: `${cacheHitRatio}%`, trend: 'up', good: cacheHitRatio > 70 },
  ];

  return (
    <div className="metrics-dashboard panel">
      {metricCards.map((m, idx) => (
        <div key={idx} className="metric-card">
          <div className="metric-label">{m.label}</div>
          <div className={`metric-value ${m.good ? 'positive' : 'negative'}`}>
            {m.value}
            <span className="trend-arrow">{m.trend === 'up' ? '↑' : '↓'}</span>
          </div>
          <div className="sparkline"></div>
        </div>
      ))}
    </div>
  );
}
