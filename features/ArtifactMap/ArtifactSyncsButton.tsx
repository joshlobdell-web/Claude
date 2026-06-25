import React, { useState } from 'react';
import { ArtifactMapOverlay } from './ArtifactMapOverlay';

interface Props {
  briefId:    number;
  briefTitle: string;
}

export function ArtifactSyncsButton({ briefId, briefTitle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="View artifact sync map for this plan"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid rgba(88,166,255,0.3)',
          background: 'rgba(88,166,255,0.08)',
          color: '#58a6ff',
          fontSize: '0.8rem',
          fontWeight: 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(88,166,255,0.15)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(88,166,255,0.6)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(88,166,255,0.08)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(88,166,255,0.3)';
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="3"  cy="8"  r="2" fill="currentColor" opacity="0.7" />
          <circle cx="13" cy="3"  r="2" fill="currentColor" />
          <circle cx="13" cy="13" r="2" fill="currentColor" opacity="0.7" />
          <line x1="5" y1="7.2" x2="11" y2="3.8"  stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
          <line x1="5" y1="8.8" x2="11" y2="12.2" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        </svg>
        Artifact Syncs
      </button>

      <ArtifactMapOverlay
        isOpen={open}
        onClose={() => setOpen(false)}
        briefId={briefId}
        briefTitle={briefTitle}
      />
    </>
  );
}
