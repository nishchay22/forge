import React from 'react';

export default function Toast({ toasts, onDismiss }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className="toast">
          <b>⚠ {t.type}</b>
          {t.message}
        </div>
      ))}
    </div>
  );
}
