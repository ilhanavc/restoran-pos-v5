/**
 * "Saatlik Ciro" chart placeholder — gerçek chart Phase 3'te.
 * SVG ile pure-tailwind, recharts dep eklemeden minimal skeleton.
 */
const HOURS = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '00:00', '02:00'];

export function HourlyRevenueSkeleton() {
  return (
    <div className="relative">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">₺0K</p>
      <div className="relative h-[200px] overflow-hidden rounded-lg bg-stone-50/60">
        <div
          aria-hidden="true"
          className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-amber-200/30 to-transparent"
          style={{ animation: 'shimmer 2.5s ease-in-out infinite' }}
        />
        <div className="absolute inset-0 flex flex-col justify-between p-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-stone-200/40" />
          ))}
        </div>
        <div className="absolute inset-x-3 bottom-0 flex items-end justify-between gap-1 pb-2">
          {Array.from({ length: 21 }).map((_, i) => (
            <div key={i} className="w-full max-w-[12px] rounded-t bg-stone-200/60" style={{ height: '4px' }} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-1.5 h-px bg-stone-300/60" />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        {HOURS.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <style>
        {`@keyframes shimmer {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }`}
      </style>
    </div>
  );
}
