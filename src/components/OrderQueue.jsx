import React from 'react';

export default function OrderQueue({ orders, onAddOrder }) {
  const queued = orders.filter(o => o.status === 'PENDING' || o.status === 'QUEUED');
  
  return (
    <div className="panel">
      <h3>Order Queue <span className="hint">{queued.length} waiting</span></h3>
      <div>
        {queued.length > 0 ? (
          queued.slice(0, 12).map((o, i) => (
            <div key={i} className={`order ${o.priority_label ? o.priority_label.toLowerCase() : 'standard'}`}>
              <span className="pid">{o.order_id} · {o.product}</span>
              <div className="meta">
                <span className={`pill ${o.priority_label || 'Standard'}`}>{o.priority_label || 'Standard'}</span> · {o.build_time}s build
              </div>
            </div>
          ))
        ) : (
          <div style={{ color: 'var(--dim)', fontSize: '11.5px' }}>
            Queue is empty — new orders arrive automatically.
          </div>
        )}
      </div>
    </div>
  );
}
