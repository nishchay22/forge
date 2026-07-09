import React from 'react';

export default function OrderQueue({ orders, strategy, maxQueueSize, onAddOrder }) {
  // Only show pending or in progress
  let visible = orders.filter(o => o.status === 'PENDING' || o.status === 'IN_PROGRESS');
  const pendingCount = orders.filter(o => o.status === 'PENDING').length;

  visible.sort((a, b) => {
    // In-progress always bubbles to the top
    if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
    if (b.status === 'IN_PROGRESS' && a.status !== 'IN_PROGRESS') return 1;
    
    if (strategy === 'SJF') {
      return a.build_time - b.build_time;
    } else if (strategy === 'Priority') {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.arrived_tick - b.arrived_tick;
    } else {
      // FCFS or RoundRobin (sort by arrival)
      return a.arrived_tick - b.arrived_tick;
    }
  });

  visible = visible.slice(0, 15);

  return (
    <div className="panel order-queue">
      <div className="panel-header">Order Queue ({pendingCount}/{maxQueueSize || 15})</div>
      <div className="order-list">
        {visible.map(order => (
          <div key={order.order_id} className="order-card">
            <div className="header">
              <span className="title">{order.product}</span>
              <span className={`badge ${
                order.priority_label === 'Critical' ? 'red' : 
                order.priority_label === 'Rush' ? 'amber' : 'dim'
              }`}>
                {order.priority_label}
              </span>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <span className="id">{order.order_id}</span>
              <span style={{fontSize: '11px', color: 'var(--dim)', textTransform: 'uppercase'}}>{order.status}</span>
            </div>
            <div className="progress-bg">
              <div 
                className="progress-fill" 
                style={{width: `${order.build_time > 0 ? (order.progress / order.build_time) * 100 : 0}%`}}
              />
            </div>
          </div>
        ))}
        {visible.length === 0 && <div style={{color: 'var(--dim)', textAlign: 'center', padding: '24px 0'}}>Queue is empty</div>}
      </div>
      <button onClick={onAddOrder} style={{width: '100%', marginTop: '16px'}}>Generate Random Order</button>
    </div>
  );
}
