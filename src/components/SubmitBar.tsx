import { useState, type RefObject } from "react";
import { Play, KeyRound, AlertCircle, History } from "lucide-react";

export interface RecordingOption {
  name: string;
  prTitle?: string;
  eventCount: number;
}

interface SubmitBarProps {
  prInputRef: RefObject<HTMLInputElement | null>;
  authConfigured: boolean;
  authMode: "env" | "claimed" | "unconfigured";
  isSubmitting: boolean;
  submitError: string | null;
  recordings: RecordingOption[];
  activeReplayName: string | null;
  onClaimAccessCode: (code: string) => Promise<void>;
  onSubmitPr: (prUrl: string, accessCode: string) => Promise<void>;
  onSelectReplay: (name: string) => void;
}

export function SubmitBar({
  prInputRef,
  authConfigured,
  isSubmitting,
  submitError,
  recordings,
  activeReplayName,
  onClaimAccessCode,
  onSubmitPr,
  onSelectReplay,
}: SubmitBarProps) {
  const [prUrl, setPrUrl] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (setupCode.trim().length < 4) {
      setLocalError("Access code must be at least 4 characters.");
      return;
    }
    if (setupCode !== setupConfirm) {
      setLocalError("Access codes do not match.");
      return;
    }
    setIsClaiming(true);
    try {
      await onClaimAccessCode(setupCode.trim());
      setAccessCode(setupCode.trim());
      setSetupCode("");
      setSetupConfirm("");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to save access code.");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const trimmedUrl = prUrl.trim();
    if (!trimmedUrl) {
      setLocalError("Enter a public GitHub PR URL.");
      return;
    }
    if (!accessCode.trim()) {
      setLocalError("Enter the access code.");
      return;
    }
    await onSubmitPr(trimmedUrl, accessCode);
  };

  const displayedError = localError || submitError;

  return (
    <section
      aria-label="Submit Pull Request"
      className="border-b border-slate-200 bg-white"
    >
      <div className="mx-auto max-w-[1440px] px-6 py-5">
        {!authConfigured ? (
          <form
            onSubmit={handleClaim}
            className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4 md:flex-row md:items-end"
          >
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <KeyRound className="h-4 w-4 text-amber-700" aria-hidden="true" />
                <span>First-Run Access Code Setup</span>
              </div>
              <p className="text-xs text-slate-600">
                No ACCESS_CODE secret is set in the environment yet. Claim an initial
                access code on the server to protect verification quota.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div>
                <label
                  htmlFor="setup-access-code"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  New Access Code
                </label>
                <input
                  id="setup-access-code"
                  type="password"
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value)}
                  placeholder="Min 4 chars"
                  className="h-10 w-44 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="setup-access-confirm"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Confirm Code
                </label>
                <input
                  id="setup-access-confirm"
                  type="password"
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                  placeholder="Repeat code"
                  className="h-10 w-44 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isClaiming}
                className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isClaiming ? "Saving..." : "Set Access Code"}
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 lg:flex-row lg:items-end"
          >
            <div className="flex-1">
              <label
                htmlFor="pr-url-input"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Public GitHub Pull Request URL
              </label>
              <input
                ref={prInputRef}
                id="pr-url-input"
                type="url"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="w-full lg:w-56">
              <label
                htmlFor="access-code-input"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Access Code
              </label>
              <input
                id="access-code-input"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Server access code"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                <span>{isSubmitting ? "Starting..." : "Verify PR"}</span>
              </button>

              {recordings.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="replay-select" className="sr-only">
                    Load Saved Recording
                  </label>
                  <div className="relative flex items-center">
                    <History
                      className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500"
                      aria-hidden="true"
                    />
                    <select
                      id="replay-select"
                      value={activeReplayName ?? ""}
                      onChange={(e) => {
                        if (e.target.value) onSelectReplay(e.target.value);
                      }}
                      className="h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs font-medium text-slate-700 hover:border-slate-400 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">Replay saved run...</option>
                      {recordings.map((rec) => (
                        <option key={rec.name} value={rec.name}>
                          {rec.prTitle ? `${rec.name} — ${rec.prTitle}` : rec.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </form>
        )}

        {displayedError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>{displayedError}</span>
          </div>
        )}
      </div>
    </section>
  );
}
