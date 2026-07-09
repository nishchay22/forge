import React from 'react';

export default function Warehouse({ warehouse, onDefrag }) {
  if (!warehouse) return null;
  const blocks = warehouse.blocks || Array(32).fill(null);
  const frag = warehouse.stats?.fragmentation || 0;
  
  return (
    <div className="panel warehouse-panel">
      <div className="panel-header">
        <span>Warehouse Memory (Blocks)</span>
        <button onClick={onDefrag}>Defrag</button>
      </div>
      
      <div className="warehouse-grid">
        {blocks.map((block, i) => {
          const isEmpty = block === null;
          const mat = !isEmpty ? (block.materialId || 'unknown').replace('mat-', '') : '';
          return (
            <div 
              key={`block-${i}`} 
              className={`memory-block ${!isEmpty ? 'occupied' : ''}`}
              title={!isEmpty ? `Block ${i}: ${block.materialId}` : `Block ${i}: Free`}
            >
              {!isEmpty && mat.substring(0, 2).toUpperCase()}
            </div>
          );
        })}
      </div>
      
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '12px', display: 'flex', justifyContent: 'space-between' }}>
        <span>Fragmentation</span>
        <span className="mono">{(frag * 100).toFixed(1)}%</span>
      </div>
      <div className="frag-bar">
        <div className="frag-fill" style={{ width: `${Math.min(100, frag * 100)}%` }} />
      </div>
    </div>
  );
}
