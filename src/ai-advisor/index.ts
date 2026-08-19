// Barrel surface: only names imported through `@/ai-advisor` elsewhere in the repo.
// `ADVISOR_CONFIG` itself now lives in `@/domain/advisor` — pure and client-legal — so this is
// a re-export for the route files that reach it through this barrel, not its source of truth.
export { ADVISOR_CONFIG } from "@/domain/advisor";
export { assembleAdvisorContext, type AdvisorContext, type AdvisorTeamContext } from "./context";
export type { Advice, AdvisorLlmDeps } from "./llm-fallback";
export { createStartSitAdvisor, type StartSitFn } from "./start-sit";
export { createTradeAnalyzer, type TradeAssessment, type TradeAnalyzerFn } from "./trade";
