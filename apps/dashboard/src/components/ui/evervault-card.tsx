import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useEffect, useState } from "react";
import { cn } from "../../lib/utils";

function randomHex(length = 24) {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16))
    .join("")
    .toUpperCase();
}

export function EvervaultCard({
  title,
  children,
  className,
}: {
  title:     string;
  children:  ReactNode;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [cipher, setCipher] = useState(() => Array.from({ length: 22 }, () => randomHex()));

  useEffect(() => {
    if (!hovered) return;
    const timer = window.setInterval(() => {
      setCipher(Array.from({ length: 22 }, () => randomHex()));
    }, 80);
    return () => window.clearInterval(timer);
  }, [hovered]);

  return (
    <motion.article
      className={cn(
        "group relative min-h-[310px] overflow-hidden border border-cim-border bg-cim-canvas",
        className,
      )}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ borderColor: "rgba(124,58,237,0.7)" }}
      transition={{ duration: 0.2 }}
    >
      <AnimatePresence>
        {hovered && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-cim-canvas/95 p-3 font-mono text-[9px] leading-[1.55] text-cim-violet-soft/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* hex grid */}
            <div className="grid grid-cols-2 gap-x-3 break-all">
              {cipher.map((line, i) => (
                <span key={`${i}-${line}`}>0x{line}</span>
              ))}
            </div>

            {/* dark vignette so center text pops */}
            <div className="absolute inset-0" style={{ background: "radial-gradient(circle at center, transparent 30%, var(--cim-canvas) 80%)" }} />

            {/* service name revealed in center */}
            <motion.div
              className="absolute inset-0 grid place-items-center px-6"
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.22 }}
            >
              <span className="text-center font-sans text-2xl font-semibold tracking-tight text-cim-text drop-shadow-[0_0_20px_rgba(124,58,237,0.8)]">
                {title}
              </span>
            </motion.div>

            {/* scan line */}
            <motion.div
              className="absolute inset-x-0 h-px bg-cim-cyan/75 shadow-[0_0_14px_rgba(24,213,242,0.8)]"
              animate={{ top: ["0%", "100%"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* card content sits below the overlay */}
      <div className="relative z-0 h-full">{children}</div>
    </motion.article>
  );
}
