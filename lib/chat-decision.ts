import { detectTools, type ToolName } from "@/lib/tools";
import { jevConfidenceThreshold, type BooleanDecision, type JevContext, type VivianDecision } from "@/lib/jev";

export interface ChatPlan {
  scene: import("@/lib/scenes").SceneDecision;
  shouldSearch: boolean;
  retrieveMemory: boolean;
  prepareIntegrations: boolean;
  localTools: ToolName[];
  modelRoute: "text" | "search" | "vision";
  responseHint: string;
}

function confidentYes(decision: BooleanDecision | undefined): boolean {
  return Boolean(decision?.required && decision.confidence >= jevConfidenceThreshold);
}

// JEV proposes; existing explicit requests and actual input capabilities win.
export function resolveChatPlan(context: JevContext, decision: VivianDecision | null, passive: boolean): ChatPlan {
  const localTools = passive ? [] : detectTools(context.message);
  const shouldSearch = !passive && (localTools.includes("web_search") || (context.capabilities.search && confidentYes(decision?.freshInformation)));
  if (shouldSearch && !localTools.includes("web_search")) localTools.push("web_search");
  if (!passive) {
    for (const name of ["time", "weather", "calculator"] as const) {
      if (confidentYes(decision?.tool[name]) && !localTools.includes(name)) localTools.push(name);
    }
  }
  const memoryRecall = decision?.intent.type === "memory" && decision.intent.confidence >= jevConfidenceThreshold;
  const retrieveMemory = passive || localTools.includes("memory_retrieval") || memoryRecall || !decision || decision.memory.required || decision.memory.confidence < jevConfidenceThreshold;
  const prepareIntegrations = context.capabilities.integrations && !passive && (context.toolkitCandidates.length > 0 || !decision || decision.tool.integrations.required || decision.tool.integrations.confidence < jevConfidenceThreshold);
  const hints: string[] = [];
  if (!passive && decision && decision.responseMode.confidence >= jevConfidenceThreshold) {
    if (decision.responseMode.mode === "supportive") hints.push("Respond with gentle support while keeping Vivian's established personality. Do not diagnose the user.");
    if (decision.responseMode.mode === "explanation") hints.push("Explain the answer clearly with enough reasoning for the request, while keeping Vivian's established personality.");
  }
  if (!passive && !context.hasImage && confidentYes(decision?.vision)) hints.push("No image was supplied. If seeing the subject is necessary, ask for an image; do not claim to see it.");
  const scene = decision?.scene;
  const validatedScene = !passive && context.scenes?.autoScene && scene?.change === true && typeof scene.id === "string" && scene.id !== context.scenes.activeSceneId && context.scenes.available.some((item) => item.id === scene.id)
    ? { change: true as const, id: scene.id } : { change: false as const };
  return {
    scene: validatedScene,
    shouldSearch,
    retrieveMemory,
    prepareIntegrations,
    localTools,
    modelRoute: context.hasImage ? "vision" : shouldSearch ? "search" : "text",
    responseHint: hints.length ? `\n\nResponse guidance:\n${hints.join("\n")}` : "",
  };
}
