import React from 'react';

export default function BotCard({ bot, orders }) {
  const order = orders.find(o => o.order_id === bot.current_order);
  const pct = order ? Math.round((order.progress / order.build_time) * 100) : 0;
  
  return (
    <div className={`bot ${bot.status === 'BUSY' || bot.status === 'ACTIVE' ? 'active' : ''}`}>
      <div className="name">{bot.bot_id}</div>
      <div className="sub">{bot.status}</div>
      <div className="bar"><i style={{ width: `${pct}%` }}></i></div>
      {order && <div className="order-tag">{order.order_id}</div>}
    </div>
  );
}
