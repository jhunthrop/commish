// Barrel surface: only names imported through `@/ai-advisor` elsewhere in the repo.
export { ADVISOR_CONFIG } from "./config";
export { assembleAdvisorContext, type AdvisorContext, type AdvisorTeamContext } from "./context";
export type { Advice, AdvisorLlmDeps } from "./llm-fallback";
export { createStartSitAdvisor, type StartSitFn } from "./start-sit";
export { createTradeAnalyzer, type TradeAssessment, type TradeAnalyzerFn } from "./trade";
