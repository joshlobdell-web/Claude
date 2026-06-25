import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArtifactMapEngine } from './ArtifactMapEngine';
import { getArtifactMapData } from './getArtifactMapData';
import { retrieveBriefs } from 'api-client/briefs';
import type { BriefWithOwner } from 'api-client/briefs';

interface Props {
  isOpen:              boolean;
  onClose:             () => void;
  briefId:             number;
  briefTitle:          string;
  initialArtifactId?:  string;
  openFocusOnLoad?:    boolean;
  topOffset?:          number;
}

export function ArtifactMapOverlay({
  isOpen, onClose, briefId, briefTitle, initialArtifactId, openFocusOnLoad, topOffset = 0,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const engineRef     = useRef<ArtifactMapEngine | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [pickerOpen,     setPickerOpen]     = useState(false);
  const [allBriefs,      setAllBriefs]      = useState<BriefWithOwner[]>([]);
  const [briefsLoading,  setBriefsLoading]  = useState(false);
  const [loadedBriefIds, setLoadedBriefIds] = useState<Set<number>>(new Set());
  const [addingPlanId,   setAddingPlanId]   = useState<number | null>(null);
  const [fullscreen,     setFullscreen]     = useState(false);

  // Mount engine and load the primary plan
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;

    const engine = new ArtifactMapEngine(container, {
      onClose,
      onAddPlan: () => setPickerOpen(true),
      onToggleFullscreen: () => setFullscreen(prev => !prev),
    });
    engineRef.current = engine;
    setLoading(true);
    setError(null);
    setLoadedBriefIds(new Set([briefId]));

    getArtifactMapData(briefId, briefTitle)
      .then(data => {
        if (cancelled) return;
        setLoading(false);
        engine.loadData(data);
        if (initialArtifactId) {
          requestAnimationFrame(() =>
            engine.selectArtifact(initialArtifactId, openFocusOnLoad ?? false)
          );
        }
      })
      .catch(err => {
        if (cancelled) return;
        setLoading(false);
        setError(String(err?.message ?? err));
        console.error('[ArtifactMap] data fetch failed', err);
      });

    return () => {
      cancelled = true;
      engine.destroy();
      engineRef.current = null;
      setPickerOpen(false);
      setLoadedBriefIds(new Set());
    };
  }, [isOpen, briefId, briefTitle, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all briefs when the picker opens
  useEffect(() => {
    if (!pickerOpen) return;
    setBriefsLoading(true);
    retrieveBriefs()
      .then(res => {
        const list = Object.values(res.data)
          .filter(b => b.id !== briefId)
          .sort((a, b) => a.title.localeCompare(b.title));
        setAllBriefs(list);
      })
      .catch(err => console.error('[ArtifactMap] failed to load briefs', err))
      .finally(() => setBriefsLoading(false));
  }, [pickerOpen, briefId]);

  // Keep engine button label in sync with fullscreen state
  useEffect(() => {
    engineRef.current?.setFullscreen(fullscreen);
  }, [fullscreen]);

  const addPlan = useCallback(async (b: BriefWithOwner) => {
    const engine = engineRef.current;
    if (!engine) return;
    setAddingPlanId(b.id);
    setPickerOpen(false);
    try {
      const data = await getArtifactMapData(b.id, b.title);
      engine.loadData(data);
      setLoadedBriefIds(prev => new Set([...prev, b.id]));
    } catch (err) {
      console.error('[ArtifactMap] failed to add plan', err);
    } finally {
      setAddingPlanId(null);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', top: fullscreen ? 0 : topOffset, right: 0, bottom: 0, left: fullscreen ? 0 : '16.375rem', zIndex: 9999, background: '#f8f9fa' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {loading && (
        <div style={OVERLAY_CENTER}>
          <Spinner />
          <span>Building artifact map…</span>
        </div>
      )}

      {error && (
        <div style={{ ...OVERLAY_CENTER, color: '#dc3545' }}>
          <span>Failed to load artifact map</span>
          <span style={{ fontSize: '0.75rem', color: '#5b687b' }}>{error}</span>
          <button onClick={onClose} style={CLOSE_BTN} tabIndex={0}>Close</button>
        </div>
      )}

      {addingPlanId !== null && (
        <div style={TOAST_STYLE}>
          <Spinner size={16} />
          <span>Adding plan…</span>
        </div>
      )}

      {pickerOpen && (
        <>
          <div
            onClick={() => setPickerOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.25)' }}
          />
          <div style={PICKER_PANEL} role="dialog" aria-label="Add plan to map">
            <div style={PICKER_HEADER}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#212529' }}>
                Add Plan to Map
              </span>
              <button onClick={() => setPickerOpen(false)} style={CLOSE_BTN}>
                Close
              </button>
            </div>

            <div style={{ overflowY: 'auto', maxHeight: 360, padding: '4px' }}>
              {briefsLoading && (
                <div style={{ padding: 20, display: 'flex', justifyContent: 'center' }}>
                  <Spinner size={20} />
                </div>
              )}
              {!briefsLoading && allBriefs.length === 0 && (
                <div style={{ padding: '12px 8px', color: '#5b687b', fontSize: '0.8125rem' }}>
                  No other plans found.
                </div>
              )}
              {!briefsLoading && allBriefs.map(b => {
                const loaded = loadedBriefIds.has(b.id);
                return (
                  <PlanPickerRow
                    key={b.id}
                    brief={b}
                    loaded={loaded}
                    onSelect={() => !loaded && addPlan(b)}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PlanPickerRow({
  brief, loaded, onSelect,
}: { brief: BriefWithOwner; loaded: boolean; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onSelect}
      disabled={loaded}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', textAlign: 'left', padding: '8px 10px',
        border: 'none', borderRadius: '0.375rem',
        background: hover && !loaded ? '#f8f9fa' : 'transparent',
        cursor: loaded ? 'default' : 'pointer',
        fontSize: '0.8125rem', color: loaded ? '#adb5bd' : '#212529',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        transition: 'background 0.1s',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: loaded ? '#adb5bd' : '#7357ff', display: 'inline-block',
      }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {brief.title}
      </span>
      {loaded && (
        <span style={{ fontSize: '0.6875rem', color: '#adb5bd', flexShrink: 0 }}>loaded</span>
      )}
    </button>
  );
}

function Spinner({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 32 32"
      style={{ animation: 'am-spin 0.9s linear infinite', flexShrink: 0 }}
    >
      <style>{`@keyframes am-spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="16" cy="16" r="12" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3" />
      <circle
        cx="16" cy="16" r="12" fill="none" stroke="#3170aa" strokeWidth="3"
        strokeDasharray="20 56" strokeLinecap="round"
      />
    </svg>
  );
}

const OVERLAY_CENTER: React.CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  gap: 16, color: '#57606a', fontSize: '0.875rem',
  pointerEvents: 'none',
};

const CLOSE_BTN: React.CSSProperties = {
  marginTop: 8, padding: '6px 16px',
  borderRadius: '0.375rem', border: '1px solid #dde2e9',
  background: '#ffffff', color: '#212529',
  cursor: 'pointer', fontSize: '0.8125rem',
  pointerEvents: 'auto',
};

const TOAST_STYLE: React.CSSProperties = {
  position: 'absolute', bottom: 16, right: 16,
  display: 'flex', alignItems: 'center', gap: 8,
  background: '#fff', border: '1px solid #dde2e9', borderRadius: '0.375rem',
  padding: '8px 12px', fontSize: '0.75rem', color: '#5b687b',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 10000,
};

const PICKER_PANEL: React.CSSProperties = {
  position: 'fixed', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 10001,
  background: '#ffffff', border: '1px solid #dde2e9',
  borderRadius: '0.5rem', width: 360, maxWidth: '90vw',
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const PICKER_HEADER: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 14px', borderBottom: '1px solid #dde2e9',
};
