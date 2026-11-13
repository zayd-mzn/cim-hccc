import { motion } from "framer-motion";

const beams = [
  { left: "6%",  delay: 0.2, duration: 5.2, color: "var(--cim-violet)" },
  { left: "18%", delay: 3.1, duration: 6.4, color: "var(--cim-cyan)" },
  { left: "31%", delay: 1.4, duration: 4.8, color: "var(--cim-violet)" },
  { left: "47%", delay: 0.6, duration: 5.6, color: "var(--cim-cyan)" },
  { left: "62%", delay: 2.8, duration: 4.4, color: "var(--cim-violet)" },
  { left: "76%", delay: 1.9, duration: 6.0, color: "var(--cim-cyan)" },
  { left: "89%", delay: 3.7, duration: 5.0, color: "var(--cim-violet)" },
];

// 8 spark angles in degrees (0 = up, clockwise)
const SPARK_ANGLES = [-90, -65, -45, -20, -110, -135, -155, -170];

function CollisionSplash({
  color,
  impactDelay,
  period,
}: {
  color: string;
  impactDelay: number;
  period: number;
}) {
  return (
    <div className="absolute inset-0">
      {/* ── outer ring – slow expand ── */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ borderColor: color, width: 8, height: 8 }}
        animate={{ width: [8, 220], height: [8, 220], opacity: [0.75, 0] }}
        transition={{ duration: 1.0, delay: impactDelay, repeat: Infinity, repeatDelay: period, ease: "easeOut" }}
      />

      {/* ── inner ring – fast tight burst ── */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{ borderColor: color, boxShadow: `0 0 10px ${color}`, width: 4, height: 4 }}
        animate={{ width: [4, 80], height: [4, 80], opacity: [1, 0] }}
        transition={{ duration: 0.5, delay: impactDelay, repeat: Infinity, repeatDelay: period, ease: "easeOut" }}
      />

      {/* ── impact flash dot ── */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: color, boxShadow: `0 0 18px 4px ${color}`, width: 6, height: 6 }}
        animate={{ width: [0, 10, 0], height: [0, 10, 0], opacity: [0, 1, 0] }}
        transition={{ duration: 0.3, delay: impactDelay, repeat: Infinity, repeatDelay: period, ease: "easeOut" }}
      />

      {/* ── spark particles ── */}
      {SPARK_ANGLES.map((angleDeg, i) => {
        const rad = (angleDeg * Math.PI) / 180;
        const dist = 55 + (i % 3) * 20;
        const tx = Math.cos(rad) * dist;
        const ty = Math.sin(rad) * dist;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              background: color,
              width: i % 2 === 0 ? 2 : 1.5,
              height: i % 2 === 0 ? 8 : 6,
              originX: "50%",
              originY: "100%",
              rotate: angleDeg + 90,
              boxShadow: `0 0 4px ${color}`,
            }}
            animate={{
              x: [0, tx * 0.3, tx],
              y: [0, ty * 0.3, ty],
              opacity: [0, 1, 0],
              scaleY: [1, 0.4],
            }}
            transition={{
              duration: 0.5 + i * 0.03,
              delay: impactDelay + 0.02,
              repeat: Infinity,
              repeatDelay: period,
              ease: [0.2, 0.6, 0.3, 1],
            }}
          />
        );
      })}
    </div>
  );
}

export function BackgroundBeams() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* ambient radial glows */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(124,58,237,0.12),transparent_32%),radial-gradient(circle_at_14%_78%,rgba(24,213,242,0.07),transparent_28%)]" />

      {/* beam trails */}
      {beams.map((beam, index) => (
        <motion.span
          key={beam.left}
          className="absolute -top-40 h-32 w-px"
          style={{
            left: beam.left,
            background: `linear-gradient(to bottom, transparent, ${beam.color})`,
            boxShadow: `0 0 12px ${beam.color}`,
          }}
          animate={{ y: [0, "105vh"], opacity: [0, 0.85, 0.85, 0] }}
          transition={{ duration: beam.duration, delay: beam.delay, repeat: Infinity, ease: "linear" }}
        >
          <span className="sr-only">beam {index + 1}</span>
        </motion.span>
      ))}

      {/* collision splashes pinned to the bottom */}
      {beams.map((beam) => {
        // Beam starts falling at `beam.delay`, reaches bottom at `beam.delay + beam.duration`
        // Splash fires exactly then, then waits a full `beam.duration` before firing again
        const SPLASH_DUR  = 1.1;  // longest animation in CollisionSplash
        const impactDelay = beam.delay + beam.duration;
        const period      = beam.duration - SPLASH_DUR;  // gap between splashes = one full beam cycle
        return (
          <div
            key={`splash-${beam.left}`}
            className="absolute h-1 w-1"
            style={{ left: beam.left, bottom: 0 }}
          >
            <CollisionSplash
              color={beam.color}
              impactDelay={impactDelay}
              period={period}
            />
          </div>
        );
      })}

      {/* collision floor line */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cim-violet/50 to-transparent" />
    </div>
  );
}
