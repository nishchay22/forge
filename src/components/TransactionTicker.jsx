import React from 'react';

export default function TransactionTicker({ events }) {
  const event = events && events.length > 0 ? events[0].message : 'Booting FORGE engine…';
  return (
    <div className="ticker"><span className="led"></span><span>{event}</span></div>
  );
}
