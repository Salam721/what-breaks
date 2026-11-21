interface TopBarProps {
  activeSection: "workspace" | "eval";
  onNavigate: (section: "workspace" | "eval") => void;
  onFocusSubmit: () => void;
}

export function TopBar({
  activeSection,
  onNavigate,
  onFocusSubmit,
}: TopBarProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("workspace");
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          What Breaks?
        </a>

        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => onNavigate("workspace")}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              activeSection === "workspace"
                ? "text-slate-900 border-blue-600"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Live Run
          </button>
          <a
            href="#flow-graph"
            onClick={() => onNavigate("workspace")}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-slate-900 hover:border-slate-300 transition-colors"
          >
            Flow Graph
          </a>
          <a
            href="#scoreboard"
            onClick={() => onNavigate("workspace")}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-slate-900 hover:border-slate-300 transition-colors"
          >
            Scoreboard
          </a>
          <button
            type="button"
            onClick={() => onNavigate("eval")}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              activeSection === "eval"
                ? "text-slate-900 border-blue-600"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Eval Benchmark
          </button>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => {
              onNavigate("workspace");
              onFocusSubmit();
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors whitespace-nowrap shrink-0"
          >
            New PR Check
          </button>
        </div>
      </div>
    </header>
  );
}
