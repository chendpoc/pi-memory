export type {
  ErrorObject,
  FallbackQuery,
  HealthPayload,
  HopRecord,
  MemoryBlock,
  MemoryCandidateGroup,
  MemoryQuerier,
  MemoryRecallArgs,
  QueryCandidate,
  QueryIntent,
  QueryMode,
  QueryRequest,
  ReloadResponse,
  ResponseEnvelope,
  ServiceStatus,
  ToolResult,
  Warning,
} from "./types.js";

export {
  defaultConsolidationConfig,
  defaultMemoryConfig,
  normalizeMemoryConfig,
  type ConsolidationConfig,
  type ConsolidationScheduleConfig,
  type MemoryConfig,
  type MemoryProvider,
} from "./config.js";

export {
  defaultMemoryConfigPath,
  loadMemoryConfig,
  loadMemorySettings,
  resolveHelperModelSpec,
  type LoadedMemorySettings,
  type MemorySettingsFile,
} from "./settings.js";

export {
  defaultBundleRoot,
  defaultPiHome,
  defaultSessionsDir,
  defaultSocketPath,
  expandPath,
} from "./paths.js";

export {
  classifyHTTP,
  classifyTransportError,
  ErrTransport,
  type ErrorClass,
} from "./errclass.js";

export { SidecarClient } from "./sidecar/client.js";
export {
  currentBundleReadable,
  readCurrentManifest,
  type BundleManifest,
} from "./sidecar/bundle.js";

export {
  installBundle,
  retainBundles,
  validateManifestPath,
  versionInRange,
  type InstallBundleOptions,
  type InstallBundleResult,
} from "./bundle/install.js";

export {
  createFallbackQuery,
  memoryMdSnippet,
  sessionKeywordSearch,
  type FallbackOptions,
  type SessionSearchHit,
} from "./fallback/index.js";
export { SidecarProcess } from "./sidecar/process.js";

export {
  MemoryService,
  type MemoryServiceStatus,
  type QueryBatchResult,
} from "./service.js";

export {
  COMPILE_MEMORY_INTENTS_PARAMETERS,
  MEMORY_HELPER_TOOL_NAME,
  cleanMemoryAnchor,
  defaultDirectMemoryIntent,
  detectExactMemoryIntents,
  detectMemoryIntents,
  looksLikeTaskText,
  looksMemoryRelevant,
  sanitizeMemoryIntents,
  type CompileMemoryIntentsResult,
  type DetectIntentsOptions,
  type MemoryHelperLLM,
} from "./preflight/detectIntents.js";

export {
  PRIVATE_MEMORY_BODY_BYTE_CAP,
  SEMANTIC_FALLBACK_CANDIDATES,
  renderFallbackPrivateMemory,
  renderPrivateMemoryContext,
  sanitizeUserBlock,
  truncatePrivateMemoryBody,
  type FallbackRenderOptions,
  type PreflightQueryResult,
} from "./preflight/render.js";

export {
  injectPrivateMemoryContext,
  stripPrivateMemory,
} from "./preflight/strip.js";

export {
  MEMORY_PREFLIGHT_QUERY_TIMEOUT_MS,
  createBeforeTurnHook,
  runMemoryPreflight,
  type BeforeTurnHook,
  type BeforeTurnInput,
  type MemoryPreflightOptions,
  type MemoryPreflightResult,
} from "./preflight/hook.js";

export {
  createMemoryRecallTool,
  createStubFallback,
  MemoryRecallTool,
  MEMORY_RECALL_DESCRIPTION,
  MEMORY_RECALL_NAME,
  MEMORY_RECALL_PARAMETERS,
} from "./tools/memoryRecall.js";

export {
  appendToMemoryMd,
  createMemoryAppendTool,
  MemoryAppendTool,
  MEMORY_APPEND_DESCRIPTION,
  MEMORY_APPEND_NAME,
  MEMORY_APPEND_PARAMETERS,
} from "./tools/memoryAppend.js";

export {
  default as piMemoryExtension,
  getSharedMemoryService,
  type PiAgentTool,
  type PiExtensionAPI,
} from "./extension.js";

export {
  createMemoryHelperLLM,
  createPiLLMClient,
  createStandaloneLLMClient,
  DEFAULT_HELPER_MODEL,
  DEFAULT_HELPER_PROVIDER,
  parseModelSpec,
  resolveMemoryHelperLLM,
} from "./adapters/piComplete.js";

export {
  trainBundle,
  loadSessionFile,
  loadSessions,
  extractFacts,
  extractFactsFromSessions,
  resolveEntities,
  buildBundle,
  readMarker,
  writeMarker,
  loadExistingBundle,
  deltaMerge,
  RELATION_CATALOG,
  ALL_RELATIONS,
  type TrainBundleConfig,
  type TrainBundleResult,
  type LoadedSession,
  type SessionTurn,
  type SessionLoaderOptions,
  type ExtractedEntity,
  type ExtractedRelation,
  type ExtractedEvent,
  type ExtractionResult,
  type EntityType,
  type LLMFactExtractor,
  type ExtractFactsOptions,
  type ResolvedEntity,
  type ResolvedRelation,
  type ResolvedGraph,
  type BundleData,
  type BuildBundleOptions,
  type BuildBundleResult,
  type ExistingBundle,
  type DeltaOp,
  type DeltaLogEntry,
  type DeltaLog,
  type MergeResult,
} from "./trainer/index.js";

export {
  createLLMFactExtractor,
  type LLMClient,
  type LLMExtractorOptions,
} from "./trainer/llmExtractor.js";

export {
  createTrainScheduler,
  parseInterval,
  type SchedulerConfig,
  type TrainScheduler,
  type SchedulerLog,
  type SchedulerLogger,
} from "./trainer/scheduler.js";

export {
  openSessionIndex,
  type SessionIndex,
  type SqliteDatabase,
} from "./fallback/sessionIndex.js";

export { defaultSessionDbPath } from "./fallback/sessionSearch.js";

export { LocalGraphQuerier } from "./local/graphQuery.js";

export {
  createOllamaLLMClient,
  createOllamaMemoryHelper,
  ollamaHealthCheck,
  DEFAULT_OLLAMA_CONFIG,
  type OllamaConfig,
} from "./adapters/ollamaClient.js";

export {
  createOpenAICompatLLMClient,
  createOpenAICompatMemoryHelper,
  openaiCompatHealthCheck,
  type OpenAICompatConfig,
} from "./adapters/openaiCompatClient.js";

export {
  rerankWithLLM,
  type RerankOptions,
  type RankedResult,
} from "./fallback/llmRerank.js";

export * from "./consolidation/index.js";
