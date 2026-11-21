import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  GitPullRequest,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { NodeVisualState } from "../../shared/types.ts";
import { deriveNodeState, type RunUiState } from "../state/reducer.ts";

interface FlowNodeData extends Record<string, unknown> {
  predictionId: string;
  flowName: string;
  flowKind: string;
  visualState: NodeVisualState;
  pBreak?: number;
  foundBy: string[];
  selected: boolean;
  onSelect: (predictionId: string) => void;
}

const STATE_META: Record<
  NodeVisualState,
  { label: string; border: string; bg: string; text: string }
> = {
  predicted: {
    label: "Predicted",
    border: "border-slate-300",
    bg: "bg-white",
    text: "text-slate-700",
  },
  verifying: {
    label: "Verifying",
    border: "border-amber-400",
    bg: "bg-amber-50/70",
    text: "text-amber-800",
  },
  confirmed: {
    label: "Confirmed break",
    border: "border-red-500",
    bg: "bg-red-50",
    text: "text-red-800",
  },
  false_alarm: {
    label: "False alarm",
    border: "border-slate-400",
    bg: "bg-slate-100",
    text: "text-slate-800",
  },
  unverified: {
    label: "Unverified",
    border: "border-amber-500",
    bg: "bg-amber-50",
    text: "text-amber-900",
  },
  low_risk: {
    label: "Not flagged",
    border: "border-emerald-400",
    bg: "bg-emerald-50/70",
    text: "text-emerald-800",
  },
};

function StateIcon({ state }: { state: NodeVisualState }) {
  switch (state) {
    case "verifying":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-700" aria-hidden="true" />;
    case "confirmed":
      return <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />;
    case "false_alarm":
      return <ShieldAlert className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />;
    case "unverified":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />;
    case "low_risk":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />;
    default:
      return <CircleDot className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />;
  }
}

function FlowPredictionNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const meta = STATE_META[data.visualState];
  return (
    <button
      type="button"
      onClick={() => data.onSelect(data.predictionId)}
      className={`w-64 rounded-xl border text-left p-3 transition-shadow focus-visible:outline-2 focus-visible:outline-blue-600 ${
        meta.border
      } ${meta.bg} ${data.selected ? "ring-2 ring-blue-600" : "hover:shadow-sm"}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.text}`}>
          <StateIcon state={data.visualState} />
          <span>{meta.label}</span>
        </span>
        {typeof data.pBreak === "number" && (
          <span className="font-mono text-slate-600 tabular-nums">
            P={(data.pBreak * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="mt-1.5 font-display text-sm font-semibold text-slate-900 truncate">
        {data.flowName}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        <span>{data.flowKind}</span>
        <span aria-hidden="true">·</span>
        <span>{data.foundBy.join(" + ")}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
    </button>
  );
}

function PrRootNode({
  data,
}: NodeProps<Node<{ label: string; sha: string }>>) {
  return (
    <div className="w-56 rounded-xl border border-slate-300 bg-slate-900 px-3.5 py-3 text-white">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Pull Request Head</span>
      </div>
      <div className="mt-1 font-display text-sm font-semibold truncate">
        {data.label}
      </div>
      <div className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
        {data.sha.slice(0, 10)}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-blue-500" />
    </div>
  );
}

const nodeTypes = {
  flowPrediction: FlowPredictionNode,
  prRoot: PrRootNode,
};

interface FlowGraphProps {
  state: RunUiState;
  selectedPredictionId: string | null;
  onSelectPrediction: (id: string) => void;
}

export function FlowGraph({
  state,
  selectedPredictionId,
  onSelectPrediction,
}: FlowGraphProps) {
  const [viewMode, setViewMode] = useState<"graph" | "table">("graph");
  const [filter, setFilter] = useState<"all" | NodeVisualState>("all");

  const flowMap = useMemo(() => {
    const m = new Map<string, { name: string; kind: string }>();
    for (const f of state.flows) {
      m.set(f.id, { name: f.name, kind: f.kind });
    }
    return m;
  }, [state.flows]);

  const filteredPredictions = useMemo(() => {
    return state.predictions.filter((p) => {
      if (filter === "all") return true;
      return deriveNodeState(state, p.id) === filter;
    });
  }, [state, filter]);

  const { nodes, edges } = useMemo(() => {
    const builtNodes: Node[] = [];
    const builtEdges: Edge[] = [];

    if (state.pr) {
      builtNodes.push({
        id: "pr-root",
        type: "prRoot",
        position: { x: 24, y: Math.max(80, filteredPredictions.length * 46) },
        data: {
          label: `${state.pr.owner}/${state.pr.repo}#${state.pr.number}`,
          sha: state.pr.headSha,
        },
        draggable: false,
      });
    }

    filteredPredictions.forEach((pred, idx) => {
      const flowInfo = flowMap.get(pred.flowId);
      const visualState = deriveNodeState(state, pred.id);
      const scoredItem = state.scored[pred.id];
      const col = Math.floor(idx / 5);
      const row = idx % 5;

      builtNodes.push({
        id: pred.id,
        type: "flowPrediction",
        position: {
          x: 330 + col * 300,
          y: 24 + row * 124,
        },
        data: {
          predictionId: pred.id,
          flowName: flowInfo?.name ?? pred.flowId,
          flowKind: flowInfo?.kind ?? "flow",
          visualState,
          pBreak: scoredItem?.pBreak,
          foundBy: pred.foundBy,
          selected: selectedPredictionId === pred.id,
          onSelect: onSelectPrediction,
        },
      });

      if (state.pr) {
        builtEdges.push({
          id: `e-root-${pred.id}`,
          source: "pr-root",
          target: pred.id,
          animated: visualState === "verifying",
          style: {
            stroke:
              visualState === "confirmed"
                ? "#dc2626"
                : visualState === "verifying"
                  ? "#d97706"
                  : "#94a3b8",
            strokeWidth: visualState === "confirmed" ? 2 : 1.5,
          },
        });
      }
    });

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    state,
    filteredPredictions,
    flowMap,
    selectedPredictionId,
    onSelectPrediction,
  ]);

  return (
    <section
      id="flow-graph"
      aria-label="Affected User Flows Graph"
      className="flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Affected User Flows
          </h2>
          <p className="text-xs text-slate-500">
            Select a flow node for claim, screenshot, log, and SHA-256 hashes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                ["all", "All"],
                ["confirmed", "Confirmed"],
                ["false_alarm", "False Alarms"],
                ["unverified", "Unverified"],
                ["low_risk", "Not Flagged"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === key
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode("graph")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === "graph"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Graph
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === "table"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {state.predictions.length === 0 ? (
        <div className="flex h-[520px] flex-col items-center justify-center p-8 text-center">
          <p className="font-display text-sm font-semibold text-slate-800">
            {state.status === "running"
              ? "Triaging and analyzing repository flows..."
              : "No flow predictions loaded yet"}
          </p>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
            {state.status === "running"
              ? "Hydrogen is triaging the diff, then Carbon and Argon will generate independent flow predictions."
              : "Submit a public GitHub pull request URL above to triage with Hydrogen, analyze in parallel with Carbon and Argon, score with Decisions API, and verify live in Managed Agent browsers."}
          </p>
        </div>
      ) : viewMode === "graph" ? (
        <div className="h-[520px] w-full bg-slate-50" data-testid="flow-graph-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Flow</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Found By</th>
                <th className="px-4 py-2.5 text-right">Risk Score</th>
                <th className="px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPredictions.map((pred) => {
                const flow = flowMap.get(pred.flowId);
                const visual = deriveNodeState(state, pred.id);
                const meta = STATE_META[visual];
                const scored = state.scored[pred.id];
                return (
                  <tr key={pred.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">
                        {flow?.name ?? pred.flowId}
                      </div>
                      <div className="text-xs text-slate-500 truncate max-w-md">
                        {pred.hypothesis}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
                        <StateIcon state={visual} />
                        <span>{meta.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {pred.foundBy.join(" + ")}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-800 tabular-nums">
                      {scored ? `${(scored.pBreak * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => onSelectPrediction(pred.id)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
                      >
                        Inspect Evidence
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
