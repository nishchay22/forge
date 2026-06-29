import React from 'react';

export default function Conveyor({ slots }) {
  return (
    <>
      {slots.map((c, i) => (
        <div key={i} className={`slot ${c ? 'fill' : ''}`}></div>
      ))}
    </>
  );
}
