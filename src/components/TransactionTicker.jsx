import React from 'react';

export default function TransactionTicker({ events }) {
  if (!events || events.length === 0) return <div className="ticker"></div>;

  return (
    <div className="ticker">
      <div className="ticker-events">
        {events.slice(0, 10).map((e, i) => (
          <div key={`${e.tick}-${i}`} className={`ticker-event ${e.level}`}>
            <span style={{color: 'var(--dim2)'}}>T{e.tick}</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
