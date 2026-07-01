import { COLORS } from '@/design/tokens';

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div
      className="skeleton"
      style={{
        height,
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
      }}
    />
  );
}

export function SkeletonRow() {
  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="skeleton" style={{ width: 80, height: 18, borderRadius: 4 }} />
        <div className="skeleton" style={{ width: 120, height: 14, borderRadius: 4 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 6 }} />
        <div className="skeleton" style={{ width: 40, height: 28, borderRadius: 6 }} />
        <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 6 }} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
          <div className="skeleton" style={{ width: 24, height: 14, borderRadius: 3 }} />
          <div className="skeleton" style={{ flex: 2, height: 14, borderRadius: 3 }} />
          <div className="skeleton" style={{ flex: 1, height: 14, borderRadius: 3 }} />
          <div className="skeleton" style={{ width: 48, height: 14, borderRadius: 3 }} />
        </div>
      ))}
    </div>
  );
}
