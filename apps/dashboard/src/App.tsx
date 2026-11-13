import {
  Activity,
  ArrowUpRight,
  Award,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Gauge,
  LayoutGrid,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AgentTimeline } from "./components/AgentTimeline";
import { ThemeToggle } from "./components/ThemeToggle";
import { BackgroundBeams } from "./components/ui/background-beams";
import { RealisticNightGlobe } from "./components/ui/realistic-night-globe";
import { useAuditLog } from "./lib/useAuditLog";
import { useReputation } from "./lib/useReputation";
import { IDS, type JobView } from "./lib/mirror";

type View = "marketplace" | "monitor" | "reputation" | "audit";

const HASHSCAN = "https://hashscan.io/testnet";

const nav = [
  { id: "marketplace" as const, label: "Marketplace", icon: LayoutGrid },
  { id: "monitor" as const, label: "Agent monitor", icon: Activity },
  { id: "reputation" as const, label: "Reputation", icon: Award },
  { id: "audit" as const, label: "Audit log", icon: ListTree },
];

function App() {
  const [view, setView] = useState<View>("marketplace");
  const [collapsed, setCollapsed] = useState(false);
  const audit = useAuditLog();

  const live = audit.source === "live";
  const activeJobs = audit.jobs.length;

  return (
    <div className="min-h-screen bg-cim-canvas text-cim-text">
      <BackgroundBeams />

      {/* ── sidebar ── */}
      <aside
        style={{ width: collapsed ? "72px" : "238px" }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r border-cim-border sidebar-glass backdrop-blur transition-[width] duration-200 ease-in-out md:flex"
      >
        <div className={`flex items-center pt-4 ${collapsed ? "justify-center px-2" : "justify-between px-3"}`}>
          <button onClick={() => setView("marketplace")} className="flex items-center gap-3 text-left">
            <img src="/cim-mark.webp" alt="CIM logo" className="h-10 w-10 flex-shrink-0 object-contain" />
            {!collapsed && (
              <span>
                <strong className="block text-sm tracking-[.16em]">CIM</strong>
                <small className="block text-[9px] tracking-[.14em] text-cim-muted">AGENT MARKET</small>
              </span>
            )}
          </button>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="ml-2 rounded p-1.5 text-cim-faint transition hover:bg-cim-surface-3 hover:text-cim-text" aria-label="Collapse sidebar">
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mt-3 rounded p-1.5 text-cim-faint transition hover:bg-cim-surface-3 hover:text-cim-text" aria-label="Expand sidebar">
            <PanelLeftOpen size={15} />
          </button>
        )}

        <nav className="mt-10 px-2">
          {!collapsed && <p className="mb-3 px-2 text-[9px] font-bold tracking-[.18em] text-cim-subtle">OPERATIONS</p>}
          <div className="space-y-1">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                title={collapsed ? label : undefined}
                className={`relative flex w-full items-center gap-3 rounded-md border px-2.5 py-2.5 text-left text-xs transition ${collapsed ? "justify-center" : ""} ${
                  view === id
                    ? "border-cim-border-strong bg-cim-surface-2 text-cim-text before:absolute before:-left-[9px] before:h-5 before:w-[3px] before:bg-cim-cyan before:shadow-[0_0_14px_rgba(24,213,242,0.45)]"
                    : "border-transparent text-cim-muted hover:bg-cim-surface-3 hover:text-cim-text"
                }`}
              >
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
                {!collapsed && id === "monitor" && activeJobs > 0 && (
                  <i className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-cim-cyan text-[9px] font-bold not-italic text-cim-on-accent">{activeJobs}</i>
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className={`mt-auto mx-2 mb-4 rounded-lg border border-cim-border bg-cim-surface-2 ${collapsed ? "p-2" : "p-4"}`}>
          {collapsed ? (
            <div className="grid place-items-center">
              <i className={`h-2 w-2 animate-pulse rounded-full ${live ? "bg-cim-success" : "bg-cim-warning"} shadow-[0_0_10px_rgba(52,211,153,0.55)]`} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[9px] font-bold tracking-[.12em] text-cim-cyan">
                <i className={`h-1.5 w-1.5 animate-pulse rounded-full ${live ? "bg-cim-success" : "bg-cim-warning"} shadow-[0_0_10px_rgba(52,211,153,0.55)]`} />
                HEDERA TESTNET
              </div>
              <strong className="mt-3 block font-mono text-xs">topic {IDS.topicId}</strong>
              <small className="mt-1 block text-[9px] text-cim-muted">
                Source: {live ? <span className="text-cim-success">● live mirror node</span> : <span className="text-cim-warning">● mock data</span>}
              </small>
            </>
          )}
        </div>
      </aside>

      {/* ── main ── */}
      <div className="min-w-0 transition-[margin] duration-200 ease-in-out" style={{ marginLeft: collapsed ? "72px" : "238px" }}>
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-cim-border header-glass px-5 backdrop-blur-xl lg:px-10">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[.12em] md:hidden">
            <img src="/cim-mark.webp" alt="CIM logo" className="h-[18px] w-[18px] object-contain" /> CIM
          </div>
          <div className="ml-auto flex items-center gap-5">
            <span className="hidden items-center gap-2 text-[9px] font-bold tracking-[.13em] text-cim-subtle sm:flex">
              <i className={`h-1.5 w-1.5 animate-pulse rounded-full ${live ? "bg-cim-success" : "bg-cim-warning"}`} />
              {live ? "READING FROM HEDERA" : "MOCK MODE"}
            </span>
            <ThemeToggle />
            <a
              href={`${HASHSCAN}/topic/${IDS.topicId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded border border-cim-border-strong bg-cim-surface-2 px-3 py-2 text-[9px] font-bold tracking-[.08em] text-cim-text"
            >
              <ShieldCheck size={15} /> HCS AUDIT TRAIL
            </a>
          </div>
        </header>

        <main className="cyber-grid mx-auto min-h-[calc(100vh-72px)] max-w-[1500px] px-5 py-12 lg:px-10">
          {view === "marketplace" && <Marketplace audit={audit} onMonitor={() => setView("monitor")} />}
          {view === "monitor" && <Monitor audit={audit} />}
          {view === "reputation" && <Reputation audit={audit} />}
          {view === "audit" && <AuditLog audit={audit} />}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-4 border-t border-cim-border sidebar-glass p-2 backdrop-blur md:hidden">
        {nav.map(({ id, icon: Icon }) => (
          <button key={id} onClick={() => setView(id)} className={`grid place-items-center rounded ${view === id ? "text-cim-cyan" : "text-cim-subtle"}`} aria-label={id}>
            <Icon size={19} />
          </button>
        ))}
      </nav>
    </div>
  );
}

type AuditState = ReturnType<typeof useAuditLog>;

// ── shared bits ──────────────────────────────────────────────────────────────
function PageHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="mb-12 max-w-3xl">
      <p className="mb-3 text-[10px] font-bold tracking-[.2em] text-cim-cyan">{eyebrow}</p>
      <h1 className="text-4xl font-semibold tracking-[-.045em] sm:text-6xl">{title}</h1>
      <p className="mt-5 max-w-2xl leading-7 text-cim-muted">{text}</p>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="flex gap-3 border-b border-r border-cim-border p-5 text-cim-cyan xl:border-b-0">
      <span>{icon}</span>
      <span>
        <small className="block text-[9px] font-bold uppercase tracking-[.08em] text-cim-muted">{label}</small>
        <strong className="mt-2 block font-mono text-2xl tabular-nums text-cim-text">{value}</strong>
        <em className="mt-1 block text-[9px] not-italic text-cim-subtle">{detail}</em>
      </span>
    </div>
  );
}

function escrowBadge(state: JobView["escrow"]) {
  const map: Record<JobView["escrow"], string> = {
    none: "text-cim-faint border-cim-border",
    held: "text-cim-warning bg-cim-warning/10 border-cim-warning/30",
    released: "text-cim-success bg-cim-success/10 border-cim-success/30",
    refunded: "text-cim-danger bg-cim-danger/10 border-cim-danger/30",
  };
  return map[state];
}

// ── Marketplace ────────────────────────────────────────────────────────────
function Marketplace({ audit, onMonitor }: { audit: AuditState; onMonitor: () => void }) {
  const [query, setQuery] = useState("");

  // Providers derived from the audit log (offers made).
  const providers = useMemo(() => {
    const map = new Map<string, { id: string; jobs: number; capabilities: Set<string> }>();
    for (const job of audit.jobs) {
      if (!job.provider) continue;
      const p = map.get(job.provider) ?? { id: job.provider, jobs: 0, capabilities: new Set<string>() };
      p.jobs += 1;
      if (job.capability) p.capabilities.add(job.capability);
      map.set(job.provider, p);
    }
    return [...map.values()];
  }, [audit.jobs]);

  const totalSettled = audit.jobs
    .filter((j) => j.escrow === "released")
    .reduce((sum, j) => sum + (j.price ?? 0), 0);

  const filtered = providers.filter((p) => p.id.includes(query) || [...p.capabilities].some((c) => c.includes(query)));

  return (
    <section className="view-enter pb-20">
      <div className="grid min-h-[390px] items-center gap-10 border-b border-cim-border lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="mb-3 text-[10px] font-bold tracking-[.2em] text-cim-cyan">MACHINE-TO-MACHINE COMMERCE</p>
          <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl">
            Agents that<br />
            <em className="brand-gradient-text not-italic">pay each other.</em>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-cim-muted">
            Autonomous agents discover services, settle in HTS credits through on-chain escrow, and record every step to an immutable Hedera audit log. Read live from the Mirror Node — never from an agent's private database.
          </p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            <button onClick={onMonitor} className="brand-button flex items-center justify-center gap-2 rounded px-4 py-3 text-xs font-bold transition hover:-translate-y-0.5">
              <Bot size={16} />
              Watch the live loop
            </button>
            <a href={`${HASHSCAN}/topic/${IDS.topicId}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded border border-cim-border-strong px-4 py-3 text-xs font-bold transition hover:bg-cim-surface-3">
              <ArrowUpRight size={16} />
              View on HashScan
            </a>
          </div>
        </div>
        <div className="relative hidden h-[390px] bg-transparent lg:block">
          <RealisticNightGlobe />
        </div>
      </div>

      <div className="my-7 grid grid-cols-2 overflow-hidden border border-cim-border bg-cim-surface xl:grid-cols-4">
        <Metric icon={<Database size={18} />} label="Jobs on chain" value={String(audit.jobs.length)} detail="from HCS topic" />
        <Metric icon={<CheckCircle2 size={18} />} label="Completed" value={String(audit.jobs.filter((j) => j.complete).length)} detail="full handshake" />
        <Metric icon={<CircleDollarSign size={18} />} label="Credits settled" value={String(totalSettled)} detail="released from escrow" />
        <Metric icon={<Bot size={18} />} label="Active providers" value={String(providers.length)} detail="seen in audit log" />
      </div>

      <div className="mb-5 mt-16">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[.2em] text-cim-cyan">PROVIDER REGISTRY</p>
            <h2 className="text-3xl font-semibold tracking-tight">Agents offering services</h2>
          </div>
          <span className="hidden text-[9px] font-bold tracking-[.15em] text-cim-subtle sm:block">{filtered.length} PROVIDERS</span>
        </div>

        <div className="relative mb-6">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cim-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by account id or capability…"
            className="w-full rounded border border-cim-border bg-cim-surface py-2.5 pl-9 pr-4 font-mono text-xs text-cim-text placeholder:text-cim-faint outline-none transition focus:border-cim-violet/60 focus:shadow-[0_0_0_1px_rgba(124,58,237,0.3)]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="grid min-h-[200px] place-items-center rounded border border-cim-border bg-cim-surface font-mono text-[10px] text-cim-faint">
          No providers in the audit log yet
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-0 border border-cim-border lg:grid-cols-3">
          {filtered.map((p, index) => (
            <div
              key={p.id}
              className={[index % 3 !== 2 ? "lg:border-r" : "", index < filtered.length - 3 ? "border-b" : "", "border-cim-border"].join(" ")}
            >
              <div className="flex min-h-[200px] flex-col p-6">
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded border border-cim-cyan/30 bg-cim-blue/10 text-cim-cyan">
                    <Bot size={20} />
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[8px] font-bold tracking-[.1em] text-cim-success">
                    <ShieldCheck size={12} /> ON-CHAIN
                  </span>
                </div>
                <h3 className="mt-6 font-mono text-lg font-semibold text-cim-text">{p.id}</h3>
                <p className="mt-2 flex-1 text-xs leading-6 text-cim-muted">
                  Capabilities: {[...p.capabilities].join(", ") || "—"}
                </p>
                <div className="my-4 grid grid-cols-2 border-y border-cim-border py-3 font-mono text-[9px] text-cim-subtle">
                  <span><b className="block text-cim-text">{p.jobs}</b>JOBS</span>
                  <a href={`${HASHSCAN}/account/${p.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-cim-cyan"><b className="block">VIEW</b>HASHSCAN</a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Agent Monitor (live HCS timeline) ────────────────────────────────────────
function Monitor({ audit }: { audit: AuditState }) {
  const [selected, setSelected] = useState<string | null>(null);
  const job = audit.jobs.find((j) => j.jobId === selected) ?? audit.jobs[0];

  return (
    <section className="view-enter pb-20">
      <PageHead
        eyebrow="AUTONOMOUS WORKFLOW"
        title="Agent activity monitor"
        text="Watch the request → offer → accept → pay → deliver handshake land on Hedera in real time. Every card is a signed HCS record with a verified content hash."
      />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="h-max rounded-lg border border-cim-border bg-cim-surface p-4">
          <p className="mb-3 text-[9px] font-bold tracking-[.18em] text-cim-cyan">JOBS</p>
          {audit.jobs.length === 0 ? (
            <p className="py-6 text-center font-mono text-[10px] text-cim-faint">No jobs yet</p>
          ) : (
            <div className="space-y-1">
              {audit.jobs.map((j) => {
                const isActive = (selected ?? audit.jobs[0]?.jobId) === j.jobId;
                return (
                  <button
                    key={j.jobId}
                    onClick={() => setSelected(j.jobId)}
                    className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                      isActive ? "border-cim-border-strong bg-cim-surface-2" : "border-transparent hover:bg-cim-surface-3"
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] text-cim-text">
                      <span>{j.jobId.slice(0, 8)}…</span>
                      {j.complete ? <CheckCircle2 size={12} className="text-cim-success" /> : <Radio size={12} className="animate-pulse text-cim-cyan" />}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[8px] text-cim-subtle">{j.capability ?? "—"}</span>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-widest ${escrowBadge(j.escrow)}`}>{j.escrow}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <div className="overflow-hidden rounded-lg border border-cim-border bg-cim-surface">
          <div className="flex h-12 items-center border-b border-cim-border px-4">
            <div className="flex gap-1.5">
              <i className="h-2 w-2 rounded-full bg-[#da665b]" />
              <i className="h-2 w-2 rounded-full bg-cim-warning" />
              <i className="h-2 w-2 rounded-full bg-[#6bbf73]" />
            </div>
            <small className="mx-auto font-mono text-[9px] text-cim-muted">
              agent-market · {audit.source === "live" ? <span className="text-cim-cyan">● live</span> : <span className="text-cim-warning">● mock</span>}
            </small>
          </div>
          <div className="p-5">
            {job ? (
              <AgentTimeline job={job} />
            ) : (
              <div className="grid min-h-[360px] place-items-center text-center text-cim-subtle">
                <div>
                  <Gauge size={30} className="mx-auto" />
                  <p className="my-4 text-xs">No job activity on the topic yet</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Reputation ───────────────────────────────────────────────────────────────
function Reputation({ audit }: { audit: AuditState }) {
  const report = useReputation(audit.entries);

  return (
    <section className="view-enter pb-20">
      <PageHead
        eyebrow="BEHAVIOUR-DERIVED TRUST"
        title="Provider reputation"
        text="Scores computed purely from on-chain history — completed jobs, latency, and escrow outcomes. Stateless and replayable: the same audit log always yields the same score."
      />

      {report.providers.length === 0 ? (
        <div className="grid min-h-[200px] place-items-center rounded border border-cim-border bg-cim-surface font-mono text-[10px] text-cim-faint">
          No scored providers yet — a provider needs at least one completed job.
        </div>
      ) : (
        <div className="space-y-4">
          {report.providers.map((p) => (
            <div key={p.accountId} className="rounded-lg border border-cim-border bg-cim-surface p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 place-items-center rounded-full border border-cim-cyan/35 bg-cim-surface-2 text-cim-cyan">
                    <Award size={26} />
                  </div>
                  <div>
                    <p className="font-mono text-sm font-semibold text-cim-text">{p.accountId}</p>
                    <p className="font-mono text-[9px] text-cim-subtle">
                      {p.completed} completed · {p.refunded} refunded · {p.expired} expired · {p.anomalies} anomalies
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <strong className="font-mono text-4xl tabular-nums text-cim-cyan">{p.score.toFixed(0)}</strong>
                  <span className="text-xs text-cim-subtle"> / 100</span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-cim-border/60 pt-4 font-mono text-[9px] sm:grid-cols-4">
                <Bar label="Reliability" value={p.reliability} />
                <Bar label="Speed" value={p.speed} />
                <Bar label="Experience" value={p.experience} />
                <div>
                  <span className="text-cim-faint">Volume: </span>
                  <span className="text-cim-text">{p.volume} credits</span>
                  {p.medianLatencyMs !== undefined && (
                    <div className="mt-1"><span className="text-cim-faint">Median latency: </span><span className="text-cim-text">{(p.medianLatencyMs / 1000).toFixed(1)}s</span></div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between">
        <span className="text-cim-faint">{label}</span>
        <span className="text-cim-text">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cim-surface-2">
        <div className="h-full rounded-full bg-gradient-to-r from-cim-blue to-cim-violet" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

// ── Raw Audit Log ─────────────────────────────────────────────────────────────
function AuditLog({ audit }: { audit: AuditState }) {
  return (
    <section className="view-enter pb-20">
      <PageHead
        eyebrow="IMMUTABLE RECORD"
        title="HCS audit log"
        text="The raw consensus-ordered stream from the topic. Each row is one signed message; the hash badge is recomputed in-browser from the message body."
      />
      {audit.error && (
        <div className="mb-4 rounded border border-cim-warning/30 bg-cim-warning/10 px-4 py-3 font-mono text-[10px] text-cim-warning">
          Mirror node: {audit.error} — showing mock data.
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-cim-border bg-cim-surface">
        <table className="w-full text-left font-mono text-[10px]">
          <thead className="border-b border-cim-border bg-cim-surface-2 text-cim-subtle">
            <tr>
              <th className="px-4 py-3 font-bold tracking-widest">SEQ</th>
              <th className="px-4 py-3 font-bold tracking-widest">TYPE</th>
              <th className="px-4 py-3 font-bold tracking-widest">JOB</th>
              <th className="px-4 py-3 font-bold tracking-widest">FROM → TO</th>
              <th className="px-4 py-3 font-bold tracking-widest">HASH</th>
              <th className="px-4 py-3 font-bold tracking-widest">CONSENSUS</th>
            </tr>
          </thead>
          <tbody>
            {audit.entries
              .slice()
              .reverse()
              .map((e) => (
                <tr key={e.sequenceNumber} className="border-b border-cim-border/50 text-cim-text">
                  <td className="px-4 py-2.5">{e.sequenceNumber}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded border border-cim-border bg-cim-surface-2 px-1.5 py-0.5 text-cim-cyan">{e.record.message.type}</span>
                  </td>
                  <td className="px-4 py-2.5">{e.record.message.jobId.slice(0, 8)}…</td>
                  <td className="px-4 py-2.5 text-cim-muted">{e.record.message.fromAgent} → {e.record.message.toAgent}</td>
                  <td className="px-4 py-2.5">
                    {e.hashOk ? (
                      <span className="flex items-center gap-1 text-cim-success"><ShieldCheck size={11} /> ok</span>
                    ) : (
                      <span className="text-cim-danger">mismatch</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-cim-subtle">{new Date(e.consensusMs).toISOString().replace("T", " ").slice(0, 19)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 flex items-center gap-2 font-mono text-[9px] text-cim-subtle">
        <Zap size={11} className="text-cim-cyan" />
        {audit.entries.length} records · updates every 3s · {audit.source === "live" ? "live Mirror Node" : "mock data"}
      </p>
    </section>
  );
}

export default App;
