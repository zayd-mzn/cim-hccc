import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileCheck2,
  HandCoins,
  Radio,
  Send,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { useRef, useState } from "react";
import type { JobView, StepType } from "../lib/mirror";

// ── per-step presentation ──────────────────────────────────────────────────
// Maps our 5 handshake message types to the timeline's visual language.

interface StepMeta {
  label: string;
  title: string;
  method: string;
  icon: typeof Database;
  dotColor: string;
  statusClass: string;
  blurb: string;
}

const STEP_META: Record<StepType, StepMeta> = {
  request: {
    label: "NODE 01",
    title: "Service Request",
    method: "request → provider",
    icon: Send,
    dotColor: "var(--cim-cyan)",
    statusClass: "text-cim-cyan bg-cim-cyan/10 border-cim-cyan/30",
    blurb: "Consumer agent requested a capability from the provider.",
  },
  offer: {
    label: "NODE 02",
    title: "Price Offer",
    method: "offer → consumer",
    icon: Tag,
    dotColor: "var(--cim-violet)",
    statusClass: "text-cim-violet-soft bg-cim-violet/10 border-cim-violet/30",
    blurb: "Provider quoted a price in credits with the escrow contract and token.",
  },
  accept: {
    label: "NODE 03",
    title: "Accept Offer",
    method: "accept → provider",
    icon: CheckCheck,
    dotColor: "var(--cim-cyan)",
    statusClass: "text-cim-cyan bg-cim-cyan/10 border-cim-cyan/30",
    blurb: "Consumer accepted the quoted price. Terms are now locked.",
  },
  pay: {
    label: "NODE 04",
    title: "Escrow Payment",
    method: "pay → settlement contract",
    icon: HandCoins,
    dotColor: "var(--cim-warning)",
    statusClass: "text-cim-warning bg-cim-warning/10 border-cim-warning/30",
    blurb: "Consumer funded the AgentEscrow contract. Credits are HELD, not yet released.",
  },
  deliver: {
    label: "NODE 05",
    title: "Delivery + Release",
    method: "deliver → consumer",
    icon: Database,
    dotColor: "var(--cim-success)",
    statusClass: "text-cim-success bg-cim-success/10 border-cim-success/30",
    blurb: "Provider delivered the result hash. Escrow RELEASED the held credits.",
  },
};

const STEP_ORDER: StepType[] = ["request", "offer", "accept", "pay", "deliver"];

// ── tracing beam (unchanged visual) ─────────────────────────────────────────
function TracingBeam({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 40%"] });
  const spring = useSpring(scrollYProgress, { stiffness: 80, damping: 22 });
  const height = useTransform(spring, [0, 1], ["0%", "100%"]);

  return (
    <div ref={ref} className="relative pl-12 md:pl-16">
      <div className="absolute bottom-0 left-[15px] top-0 w-px bg-cim-border md:left-[21px]" />
      <motion.div
        className="absolute left-[13px] top-0 w-[5px] rounded-full md:left-[19px]"
        style={{
          height,
          background: "linear-gradient(to bottom, var(--cim-violet), var(--cim-cyan))",
          boxShadow: "0 0 14px rgba(124,58,237,0.55)",
        }}
      />
      <motion.div
        className="absolute left-[11px] h-3 w-3 rounded-full border border-cim-cyan bg-cim-canvas shadow-[0_0_16px_rgba(24,213,242,0.7)] md:left-[17px]"
        style={{ top: height }}
      />
      <div>{children}</div>
    </div>
  );
}

// ── collapsible payload block ────────────────────────────────────────────────
function PayloadBlock({ payload }: { payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 overflow-hidden rounded border border-cim-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-cim-surface-2/80 px-3 py-2 text-left font-mono text-[9px] font-bold uppercase tracking-widest text-cim-subtle transition hover:text-cim-text"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        SIGNED HCS PAYLOAD
      </button>
      {open && (
        <motion.pre
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="overflow-x-auto bg-cim-canvas/90 p-4 font-mono text-[10px] leading-5 text-cim-text"
        >
          {JSON.stringify(payload, null, 2)}
        </motion.pre>
      )}
    </div>
  );
}

// ── human-readable meta rows per step type ───────────────────────────────────
function metaFor(type: StepType, payload: Record<string, unknown>): Record<string, string> {
  switch (type) {
    case "request":
      return { Capability: String(payload.capability ?? "—") };
    case "offer":
      return {
        Price: `${payload.price ?? "—"} credits`,
        Token: String(payload.tokenId ?? "—"),
        Escrow: String(payload.contractAddress ?? "—"),
      };
    case "accept":
      return { "Accepted price": `${payload.acceptedPrice ?? "—"} credits` };
    case "pay":
      return {
        Amount: `${payload.amount ?? "—"} credits`,
        "Tx id": String(payload.txId ?? "—"),
        "Escrow slot": String(payload.contractJobRef ?? "—").slice(0, 18) + "…",
      };
    case "deliver":
      return {
        "Result hash": String(payload.resultHash ?? "—").slice(0, 18) + "…",
        Location: String(payload.resultLocation ?? "—"),
      };
  }
}

// ── single timeline node ──────────────────────────────────────────────────────
function TimelineNode({
  type,
  index,
  job,
}: {
  type: StepType;
  index: number;
  job: JobView;
}) {
  const meta = STEP_META[type];
  const Icon = meta.icon;
  const step = job.steps[type];
  const present = !!step;

  const ts = step ? new Date(step.consensusMs).toISOString().replace("T", " ").slice(0, 19) : "";
  const payload = (step?.message.payload ?? {}) as Record<string, unknown>;

  return (
    <motion.div
      className="relative mb-8 last:mb-0"
      initial={{ opacity: 0, x: 18 }}
      animate={present ? { opacity: 1, x: 0 } : { opacity: 0.35, x: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div
        className="absolute -left-[45px] top-[18px] h-3 w-3 rounded-full border border-cim-border-strong bg-cim-canvas shadow-lg md:-left-[53px]"
        style={{ boxShadow: present ? `0 0 12px ${meta.dotColor}` : "none", borderColor: meta.dotColor }}
      >
        <div
          className="absolute inset-[2px] rounded-full"
          style={{ background: meta.dotColor, opacity: present ? 1 : 0.25 }}
        />
      </div>

      <div className="rounded-xl border border-cim-border bg-cim-surface/90 p-5 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border"
              style={{
                borderColor: `color-mix(in srgb, ${meta.dotColor} 28%, transparent)`,
                background: `color-mix(in srgb, ${meta.dotColor} 8%, transparent)`,
                color: meta.dotColor,
              }}
            >
              <Icon size={17} />
            </span>
            <div>
              <div className="font-mono text-[8px] font-bold tracking-[.18em] text-cim-subtle">{meta.label}</div>
              <h3 className="mt-0.5 text-base font-semibold text-cim-text">{meta.title}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded border px-2 py-0.5 font-mono text-[8px] font-bold tracking-widest ${meta.statusClass}`}>
              {present ? "CONFIRMED" : "PENDING"}
            </span>
            {present && step!.hashOk && (
              <span className="flex items-center gap-1 rounded border border-cim-success/40 bg-cim-success/10 px-1.5 py-0.5 font-mono text-[7px] font-bold tracking-widest text-cim-success">
                <ShieldCheck size={9} /> HASH OK
              </span>
            )}
            {present && !step!.hashOk && (
              <span className="rounded border border-cim-danger/40 bg-cim-danger/10 px-1.5 py-0.5 font-mono text-[7px] font-bold tracking-widest text-cim-danger">
                HASH MISMATCH
              </span>
            )}
            {present && (
              <span className="flex items-center gap-1 font-mono text-[8px] text-cim-subtle">
                <Radio size={10} className="animate-pulse" style={{ color: meta.dotColor }} />
                {ts}
              </span>
            )}
          </div>
        </div>

        <div className="mb-4 inline-block rounded bg-cim-surface-2 px-3 py-1.5 font-mono text-[9px] text-cim-text">
          &gt; {meta.method}
        </div>

        <p className="mb-4 text-sm leading-6 text-cim-muted">{meta.blurb}</p>

        {present && (
          <div className="mb-1 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-cim-border/60 pt-4 font-mono text-[9px]">
            {Object.entries(metaFor(type, payload)).map(([k, v]) => (
              <div key={k}>
                <span className="text-cim-faint">{k}: </span>
                <span className="text-cim-text">{v}</span>
              </div>
            ))}
          </div>
        )}

        {present && type === "deliver" && (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded border border-cim-success/30 bg-cim-success/10 px-3 py-1.5 font-mono text-[9px] font-bold text-cim-success">
            <FileCheck2 size={11} /> Escrow released to provider
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 border-t border-cim-border/60 pt-3 font-mono text-[8px] text-cim-faint">
          <Clock size={9} />
          <span>STEP {index + 1} OF {STEP_ORDER.length}</span>
          <ArrowUpRight size={9} className="ml-auto" />
        </div>

        {present && <PayloadBlock payload={step!.message.payload} />}
      </div>
    </motion.div>
  );
}

// ── exported component ────────────────────────────────────────────────────────
export function AgentTimeline({ job }: { job: JobView }) {
  return (
    <div className="h-[calc(100vh-140px)] overflow-y-auto pr-2">
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-cim-border bg-cim-surface-2/60 p-4 font-mono text-[9px] text-cim-subtle">
        <span className="flex items-center gap-1 text-cim-cyan">
          <CheckCircle2 size={12} /> JOB {job.jobId.slice(0, 8)}…
        </span>
        <span>consumer {job.consumer || "—"}</span>
        <span>provider {job.provider || "—"}</span>
        {job.latencyMs !== undefined && <span>latency {(job.latencyMs / 1000).toFixed(1)}s</span>}
        <span className="ml-auto uppercase tracking-widest">escrow: {job.escrow}</span>
      </div>
      <TracingBeam>
        <div className="pb-8 pt-2">
          {STEP_ORDER.map((type, index) => (
            <TimelineNode key={type} type={type} index={index} job={job} />
          ))}
        </div>
      </TracingBeam>
    </div>
  );
}
