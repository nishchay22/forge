import React from 'react';

export default function BotCard({ bot, orders, onFire }) {
  const isBusy = bot.status === 'BUSY';
  const isWaiting = bot.status === 'WAITING';
  const isDeadlocked = bot.status === 'DEADLOCKED';
  
  const order = bot.current_order ? (orders || []).find(o => o.order_id === bot.current_order) : null;
  const progressPct = order ? Math.min(100, (order.progress / order.build_time) * 100) : 0;
  
  // Calculate progress circle stroke
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progressPct / 100) * circumference;

  return (
    <div className={`bot-card status-${bot.status}`}>
      <div className="bot-avatar">
        🤖
        <svg className="bot-ring" width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r={radius} />
          {(isBusy || isWaiting || isDeadlocked) && (
            <circle 
              className="progress" 
              cx="30" cy="30" r={radius} 
              style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
            />
          )}
        </svg>
      </div>
      
      <div className="bot-info">
        <div className="bot-name">{bot.name} <span className="text-dim">({bot.bot_id.split('-')[1]})</span></div>
        <div className="bot-status">
          {bot.status}
        </div>
        {order && <div style={{fontSize: '9px', marginTop: '2px', color: 'var(--text-secondary)'}}>{order.product}</div>}
      </div>
      
      {bot.status === 'IDLE' && onFire && (
        <button className="danger" onClick={() => onFire(bot.bot_id)} style={{position: 'absolute', top: 4, right: 4, padding: '2px 6px', fontSize: '10px'}}>
          FIRE
        </button>
      )}
    </div>
  );
}
