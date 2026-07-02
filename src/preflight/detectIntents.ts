import type { QueryIntent, QueryMode } from "../types.js";
import { cacheKeyForIntents, intentCache } from "../cache/memoryCaches.js";

export const MEMORY_HELPER_TOOL_NAME = "compile_memory_intents";
export const MEMORY_HELPER_MAX_INPUT_RUNES = 500;

export interface CompileMemoryIntentsResult {
  should_recall: boolean;
  gate_reason?: string;
  intents: QueryIntent[];
}

/** Optional small-model helper; null → regex fast-path only (fail-silent). */
export interface MemoryHelperLLM {
  compileIntents(text: string, signal?: AbortSignal): Promise<CompileMemoryIntentsResult>;
}

export interface DetectIntentsOptions {
  forceHelper?: boolean;
  signal?: AbortSignal;
}

interface ExactPattern {
  re: RegExp;
  anchorGroup: number;
}

const exactRelationshipPatterns: ExactPattern[] = [
  {
    re: /^\s*(.+?)\s*(?:与|和|跟)\s*我\s*(?:的)?\s*关系\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*我\s*(?:与|和|跟)\s*(.+?)\s*(?:是\s*)?(?:什么|什麼|啥|怎样|怎樣)?\s*关系\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*我\s*(?:认识|認識|见过|見過)\s*(.+?)\s*(?:吗|嗎)?\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*who\s+is\s+(.+?)\s+to\s+me\s*[?.!]*\s*$/i,
    anchorGroup: 1,
  },
  {
    re: /^\s*my\s+relationship\s+with\s+(.+?)\s*[?.!]*\s*$/i,
    anchorGroup: 1,
  },
  {
    re: /^\s*how\s+do\s+i\s+know\s+(.+?)\s*[?.!]*\s*$/i,
    anchorGroup: 1,
  },
  {
    re: /^\s*what\s+is\s+my\s+(?:connection|relationship)\s+(?:to|with)\s+(.+?)\s*[?.!]*\s*$/i,
    anchorGroup: 1,
  },
  {
    re: /^\s*(?:do|did)\s+i\s+(?:know|meet)\s+(.+?)\s*[?.!]*\s*$/i,
    anchorGroup: 1,
  },
  {
    re: /^\s*where\s+do\s+i\s+know\s+(.+?)\s+from\s*[?.!]*\s*$/i,
    anchorGroup: 1,
  },
  {
    re: /^\s*(.+?)\s*と\s*(?:私|わたし|僕|俺|自分)\s*(?:の)?\s*関係\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*(?:私|わたし|僕|俺|自分)\s*と\s*(.+?)\s*(?:は|って)?\s*(?:どんな|どういう)?\s*関係\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*(.+?)\s*は\s*(?:私|わたし|僕|俺|自分)\s*にとって\s*(?:誰|何)\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*(.+?)\s*を\s*(?:どう|どこで)?\s*知って(?:いる|る)?\s*(?:の|か)?\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
  {
    re: /^\s*(.+?)\s*に\s*会ったこと(?:が)?ある\s*(?:の|か)?\s*[？?。.!！]*\s*$/,
    anchorGroup: 1,
  },
];

const latinEntityPattern =
  /(?:^|[\s"'(（【])([A-Z][\p{L}\p{N}_&.+-]*(?:\s+[A-Z0-9][\p{L}\p{N}_&.+-]*){0,4})/u;

const privateMemoryCues = [
  "remember",
  "recall",
  "last time",
  "previously",
  "before",
  "we discussed",
  "we decided",
  "did we",
  "have we",
  "my ",
  " me ",
  " i ",
  "记得",
  "記得",
  "回忆",
  "回憶",
  "上次",
  "之前",
  "以前",
  "我们聊",
  "我們聊",
  "我们说",
  "我們說",
  "我",
  "我的",
  "覚えて",
  "思い出",
  "前回",
  "以前",
  "前に",
  "話した",
  "決めた",
  "私",
  "わたし",
  "僕",
  "俺",
  "自分",
];

const relationQuestionCues = [
  "relationship",
  "connection",
  "know",
  "met",
  "meet",
  "worked",
  "work with",
  "colleague",
  "coworker",
  "classmate",
  "advisor",
  "mentor",
  "friend",
  "created",
  "built",
  "authored",
  "founded",
  "owns",
  "owned",
  "depends",
  "requires",
  "uses",
  "implemented",
  "runs on",
  "integrates",
  "supports",
  "released",
  "published",
  "forked",
  "inspired",
  "customer",
  "competitor",
  "email",
  "handle",
  "url",
  "path",
  "scheduled",
  "monitors",
  "what does",
  "who created",
  "who owns",
  "who built",
  "关系",
  "關係",
  "认识",
  "認識",
  "见过",
  "見過",
  "合作",
  "同事",
  "同学",
  "同學",
  "导师",
  "導師",
  "朋友",
  "是谁",
  "是誰",
  "工作",
  "任职",
  "任職",
  "创建",
  "創建",
  "作者",
  "拥有",
  "擁有",
  "依赖",
  "依賴",
  "使用",
  "实现",
  "實現",
  "运行",
  "運行",
  "集成",
  "支持",
  "发布",
  "發布",
  "项目",
  "項目",
  "関係",
  "知",
  "会った",
  "仕事",
  "同僚",
  "友達",
  "先生",
  "メンター",
  "作った",
  "作者",
  "所有",
  "依存",
  "使",
  "実装",
  "動",
  "統合",
  "対応",
  "発表",
  "公開",
  "プロジェクト",
];

const typedTargetCues = [
  "which people",
  "which person",
  "which company",
  "which companies",
  "which project",
  "which projects",
  "which tool",
  "which tools",
  "which language",
  "which languages",
  "what projects",
  "what tools",
  "who are",
  "哪些人",
  "哪个公司",
  "哪些公司",
  "哪些项目",
  "哪些項目",
  "哪些工具",
  "什么项目",
  "什麼項目",
  "どの人",
  "どの会社",
  "どのプロジェクト",
  "どのツール",
  "どの言語",
  "誰が",
];

const publicCurrentFactCues = [
  "latest",
  "current",
  "today's",
  "news",
  "stock price",
  "weather",
  "president",
  "ceo of",
  "exchange rate",
  "schedule for",
  "最新",
  "新闻",
  "新聞",
  "股价",
  "股價",
  "天气",
  "天氣",
  "总统",
  "總統",
  "汇率",
  "匯率",
  "ニュース",
  "株価",
  "天気",
  "大統領",
  "為替",
];

const knownMemoryRelations = new Set([
  "employed_at",
  "previously_employed_at",
  "works_on",
  "affiliated_with",
  "studied_under",
  "studied_at",
  "collaborates_with",
  "follows_person",
  "followed_by_person",
  "commented_on",
  "knows_about",
  "has_handle_on",
  "has_email",
  "created",
  "created_by",
  "maintained_by",
  "develops",
  "developed_by_org",
  "owns",
  "owned_by",
  "acquired",
  "acquired_by",
  "subsidiary_of",
  "parent_of",
  "founded",
  "founded_by",
  "invested_in",
  "received_investment_from",
  "customer_of",
  "has_customer",
  "competes_with",
  "banking_relationship",
  "uses",
  "used_by",
  "depends_on",
  "implemented_in",
  "runs_on",
  "integrates_with",
  "supports",
  "powered_by",
  "loaded_via",
  "has_component",
  "part_of",
  "has_property",
  "has_path",
  "stored_at",
  "monitors",
  "targets",
  "enables",
  "enabled_by",
  "generates",
  "generated_from",
  "implements",
  "implemented_by",
  "excludes",
  "deleted_from",
  "published_on",
  "released",
  "latest_release_tag",
  "forked_from",
  "inspired_by",
  "succeeds",
  "preceded_by",
  "describes",
  "described_in",
  "category",
  "has_alias",
  "has_url",
  "located_in",
  "scheduled_for",
  "ranked_on",
  "listed_on",
  "features_project",
  "related_to",
  "other",
]);

/** JSON schema for forced tool_use compile_memory_intents (helper providers). */
export const COMPILE_MEMORY_INTENTS_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    should_recall: {
      type: "boolean",
      description:
        "True only when the user is asking about their own private episodic memory.",
    },
    gate_reason: {
      type: "string",
      description:
        "One short phrase (under 40 chars) describing the gate decision.",
    },
    intents: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            enum: ["direct_relation", "path_query", "typed_neighborhood"],
          },
          anchor_mentions: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 4,
          },
          relation_constraints: {
            type: "array",
            items: { type: "string" },
            maxItems: 4,
          },
          candidate_type: { type: "string" },
          scope_filter: {
            type: "array",
            items: { type: "string" },
            maxItems: 4,
          },
          target_slot: { type: "string", enum: ["head", "tail"] },
          time_window: { type: "string" },
          evidence_budget: { type: "integer", minimum: 1, maximum: 50 },
          result_limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["mode", "anchor_mentions"],
      },
    },
  },
  required: ["should_recall", "intents"],
} as const;

export function detectExactMemoryIntents(query: string): QueryIntent[] {
  const q = query.trim();
  if (!q) return [];
  for (const p of exactRelationshipPatterns) {
    const m = q.match(p.re);
    if (m && m[p.anchorGroup]) {
      const anchor = cleanMemoryAnchor(m[p.anchorGroup]!);
      if (anchor) return [defaultDirectMemoryIntent(anchor)];
    }
  }
  return [];
}

export function defaultDirectMemoryIntent(anchor: string): QueryIntent {
  return {
    mode: "direct_relation",
    anchor_mentions: [anchor],
    evidence_budget: 5,
    result_limit: 10,
  };
}

export function cleanMemoryAnchor(s: string): string {
  let t = s.trim();
  t = t.replace(/^[\s"'""''`.,，。?？!！:：;；()[\]【】]+|[\s"'""''`.,，。?？!！:：;；()[\]【】]+$/g, "");
  if (t.startsWith("the ")) t = t.slice(4);
  if (t.startsWith("The ")) t = t.slice(4);
  for (const prefix of ["关于", "和", "与", "跟", "to ", "with "]) {
    if (t.startsWith(prefix)) t = t.slice(prefix.length).trim();
  }
  if (!t || isPronounAnchor(t) || looksLikeTaskText(t)) return "";
  return t;
}

export function isPronounAnchor(s: string): boolean {
  switch (s.trim().toLowerCase()) {
    case "i":
    case "me":
    case "my":
    case "mine":
    case "myself":
    case "user":
    case "the user":
    case "我":
    case "我的":
    case "自己":
    case "本人":
    case "私":
    case "わたし":
    case "僕":
    case "俺":
      return true;
    default:
      return false;
  }
}

export function looksLikeTaskText(s: string): boolean {
  const lower = s.toLowerCase();
  if (
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes("\n") ||
    lower.includes("```")
  ) {
    return true;
  }
  for (const marker of [
    " fix ",
    " implement ",
    " debug ",
    " code ",
    " file ",
    " error ",
    " stack trace ",
    "修复",
    "修改",
    "实现",
    "代码",
    "文件",
    "錯誤",
    "错误",
    "测试",
    "構建",
    "构建",
  ]) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

function truncateRunes(s: string, max: number): string {
  const runes = [...s];
  if (runes.length <= max) return s;
  return runes.slice(0, max).join("");
}

function containsAny(s: string, markers: string[]): boolean {
  return markers.some((m) => s.includes(m));
}

function hasEntityishSurface(s: string): boolean {
  if (latinEntityPattern.test(s)) return true;
  if (/["'""''`「」『』]/.test(s)) return true;
  const hasCJKOrKana = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
  return hasCJKOrKana && [...s].length <= 80;
}

export function looksMemoryRelevant(query: string): boolean {
  const lower = query.toLowerCase();
  const hasMemoryCue = containsAny(lower, privateMemoryCues);
  const hasRelationCue = containsAny(lower, relationQuestionCues);
  const hasTypedTarget = containsAny(lower, typedTargetCues);
  const hasEntity = hasEntityishSurface(query);
  if (!(hasMemoryCue || hasRelationCue || hasTypedTarget || hasEntity)) return false;
  if (containsAny(lower, publicCurrentFactCues) && !hasMemoryCue) return false;
  return true;
}

function isBroadMemoryRelation(rel: string): boolean {
  return rel === "related_to" || rel === "other";
}

function isSnakeRelation(rel: string): boolean {
  let base = rel.replace(/^\^/, "").replace(/\^-1$/, "");
  if (!base) return false;
  return /^[a-z0-9_]+$/.test(base);
}

function isKnownMemoryRelation(rel: string): boolean {
  const base = rel.replace(/^\^/, "").replace(/\^-1$/, "");
  return knownMemoryRelations.has(base);
}

function cleanAnchorList(inAnchors: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of inAnchors) {
    const anchor = cleanMemoryAnchor(raw);
    if (!anchor) continue;
    const key = anchor.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
}

function cleanRelationConstraints(inRels: string[]): string[] {
  const out: string[] = [];
  for (const raw of inRels) {
    const rel = raw.trim();
    if (!rel || isBroadMemoryRelation(rel) || !isSnakeRelation(rel) || !isKnownMemoryRelation(rel)) {
      continue;
    }
    out.push(rel);
  }
  return out;
}

export function sanitizeMemoryIntents(intents: QueryIntent[]): QueryIntent[] {
  const out: QueryIntent[] = [];
  const seen = new Set<string>();
  for (const raw of intents) {
    const intent: QueryIntent = { ...raw };
    intent.anchor_mentions = cleanAnchorList(intent.anchor_mentions ?? []);
    if (intent.anchor_mentions.length === 0) continue;
    if (!intent.mode) intent.mode = "direct_relation";
    if (!intent.evidence_budget || intent.evidence_budget <= 0 || intent.evidence_budget > 50) {
      intent.evidence_budget = 5;
    }
    if (!intent.result_limit || intent.result_limit <= 0 || intent.result_limit > 100) {
      intent.result_limit = 10;
    }
    intent.relation_constraints = cleanRelationConstraints(intent.relation_constraints ?? []);
    switch (intent.mode as QueryMode) {
      case "direct_relation":
        break;
      case "path_query": {
        const rc = intent.relation_constraints ?? [];
        if (rc.length < 2 || rc.length > 4) continue;
        intent.target_slot = "tail";
        break;
      }
      case "typed_neighborhood": {
        const ct = intent.candidate_type?.trim();
        const rc = intent.relation_constraints ?? [];
        if (!ct || rc.length !== 1) continue;
        intent.candidate_type = ct;
        intent.target_slot = "tail";
        break;
      }
      default:
        continue;
    }
    const key = JSON.stringify(intent);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(intent);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Compile user message into QueryIntent values.
 * Regex fast-path bypasses helper; otherwise helper LLM when provided.
 */
export async function detectMemoryIntents(
  query: string,
  helper: MemoryHelperLLM | null | undefined,
  options: DetectIntentsOptions = {},
): Promise<QueryIntent[]> {
  const exact = detectExactMemoryIntents(query);
  if (exact.length > 0) return exact;

  if (!helper) return [];

  const helperInput = truncateRunes(query, MEMORY_HELPER_MAX_INPUT_RUNES);
  const trimmed = helperInput.trim();
  if (!trimmed || [...trimmed].length > MEMORY_HELPER_MAX_INPUT_RUNES) return [];
  if (looksLikeTaskText(helperInput)) return [];
  if (!options.forceHelper && !looksMemoryRelevant(helperInput)) return [];

  const cacheKey = cacheKeyForIntents(helperInput);
  const cached = intentCache.get(cacheKey);
  if (cached) return cached;

  try {
    const out = await helper.compileIntents(helperInput, options.signal);
    if (!out.should_recall) return [];
    const intents = sanitizeMemoryIntents(out.intents ?? []).slice(0, 3);
    if (intents.length > 0) intentCache.set(cacheKey, intents);
    return intents;
  } catch {
    return [];
  }
}
