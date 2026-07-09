import React from 'react';

export default function DatabasePanel({ tables, activeTable, onSelectTable, transactions, dbState }) {
  const getColumns = (tableName) => {
    switch (tableName) {
      case 'Orders': return ['order_id', 'product', 'priority_label', 'status', 'bot_id', 'progress', 'revenue'];
      case 'Bots': return ['bot_id', 'name', 'status', 'current_order', 'ticks_busy', 'hire_cost'];
      case 'Machines': return ['machine_id', 'type', 'capacity'];
      case 'Materials': return ['material_id', 'name', 'quantity', 'unit_cost'];
      case 'Transactions': return ['tx_id', 'timestamp', 'type', 'amount', 'description'];
      default: return [];
    }
  };

  const columns = getColumns(activeTable);
  const data = activeTable === 'Transactions' ? transactions : (dbState[activeTable.toLowerCase()] || []);

  const formatVal = (val) => {
    if (val === null) return <span style={{color: 'var(--dim2)'}}>NULL</span>;
    if (typeof val === 'object') return '{...}';
    return val;
  };

  return (
    <div className="panel database-panel" style={{marginBottom: '32px'}}>
      <div className="panel-header">Factory Database</div>
      
      <div className="db-tabs">
        {tables.map(t => (
          <button 
            key={t}
            className={`db-tab ${activeTable === t ? 'active' : ''}`}
            onClick={() => onSelectTable(t)}
          >
            {t}
          </button>
        ))}
      </div>
      
      <div className="db-table-wrapper">
        <table className="db-table">
          <thead>
            <tr>
              {columns.map(c => <th key={c}>{c.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.order_id || row.bot_id || row.machine_id || row.material_id || row.tx_id || i}>
                {columns.map(c => (
                  <td key={`${c}-${i}`}>{formatVal(row[c])}</td>
                ))}
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{textAlign: 'center', padding: '24px', color: 'var(--dim)'}}>
                  0 rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
