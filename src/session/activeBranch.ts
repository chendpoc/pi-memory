import path from "node:path";

interface UnknownRecord {
  [key: string]: unknown;
}

export interface ActiveBranchTurn {
  role: string;
  content: string;
  turnIndex: number;
}

export interface ParsedSession {
  id: string;
  title: string;
  createdAt: string;
  turns: ActiveBranchTurn[];
  parentSessionId?: string;
  parentSessionFile?: string;
}

interface JsonlNodeInfo {
  parentId?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
}

interface ParsedJsonlLine {
  id?: string;
  parentId?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  role?: string;
  content?: unknown;
  timestamp?: string;
  createdAt?: string;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function getStringField(obj: UnknownRecord, names: string[]): string | undefined {
  for (const name of names) {
    const found = asString(obj[name]);
    if (found) return found;
  }
  return undefined;
}

function getBooleanField(obj: UnknownRecord, names: string[]): boolean | undefined {
  for (const name of names) {
    if (typeof obj[name] === "boolean") return obj[name];
  }
  return undefined;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (block && typeof block === "object") {
      const b = block as UnknownRecord;
      if (typeof b.text === "string") parts.push(b.text);
      else if (typeof b.content === "string") parts.push(b.content);
    }
  }
  return parts.join("\n");
}

function extractMessage(line: ParsedJsonlLine): { role: string; content: unknown } | null {
  if (line.message?.role && line.message.content !== undefined) {
    return { role: line.message.role, content: line.message.content };
  }
  if (line.role && line.content !== undefined) {
    return { role: line.role, content: line.content };
  }
  return null;
}

function pickActiveLeafHint(obj: UnknownRecord): string | undefined {
  const explicitByName = getStringField(obj, [
    "activeSessionId",
    "active_session_id",
    "activeSession",
    "active_session",
    "activeLeafId",
    "active_leaf_id",
    "activeLeafSessionId",
    "active_leaf_session_id",
    "currentSessionId",
    "current_session_id",
    "leafSessionId",
    "leaf_session_id",
  ]);
  if (explicitByName) return explicitByName;

  if (getBooleanField(obj, ["active", "is_active", "isActive", "activeLeaf"])
    && typeof obj.id === "string") {
    return obj.id;
  }
  return undefined;
}

function parseSessionIdFromPath(filePath: string | undefined): string | undefined {
  const normalized = asString(filePath);
  if (!normalized) return undefined;
  const base = path.basename(normalized, path.extname(normalized));
  const underscore = base.lastIndexOf("_");
  if (underscore >= 0 && underscore < base.length - 1) {
    return base.slice(underscore + 1);
  }
  return base || undefined;
}

export function parseJsonlSession(raw: string, filePath: string): ParsedSession | null {
  const lines = raw.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;

  const parsedLines: ParsedJsonlLine[] = [];
  const nodes = new Map<string, JsonlNodeInfo>();

  let headerSessionId: string | undefined;
  let headerTitle = "";
  let headerCreatedAt = "";
  let lastNodeId: string | undefined;
  let explicitLeafHint: string | undefined;
  let fallbackParentSessionId: string | undefined;
  let fallbackParentSessionFile: string | undefined;

  for (const rawLine of lines) {
    let obj: UnknownRecord;
    try {
      obj = JSON.parse(rawLine) as UnknownRecord;
    } catch {
      continue;
    }

    const id = getStringField(obj, ["id", "entryId", "entry_id"]);
    const parentId = getStringField(obj, ["parentId", "parent_id"]);
    const parentSessionId = getStringField(obj, [
      "parentSessionId",
      "parent_session_id",
    ]);
    const parentSessionFile = getStringField(obj, [
      "parentSessionFile",
      "parent_session_file",
      "parentSessionPath",
      "parent_session_path",
      "parentSession",
      "parent_session",
    ]);
    const type = asString(obj.type);
    const message: ParsedJsonlLine["message"] = obj.message as ParsedJsonlLine["message"] | undefined;

    const line: ParsedJsonlLine = {
      id,
      parentId,
      parentSessionId,
      parentSessionFile,
      message,
      role: asString(obj.role),
      content: obj.content,
      timestamp: asString(obj.timestamp),
      createdAt: asString(obj.createdAt),
    };

    const explicitLeafId = pickActiveLeafHint(obj);
    if (explicitLeafId) explicitLeafHint = explicitLeafId;

    if (type === "session") {
      headerSessionId = asString(obj.id) ?? headerSessionId;
      headerTitle = asString(obj.title) ?? headerTitle;
      headerCreatedAt = asString(obj.timestamp) ?? asString(obj.created_at) ?? asString(obj.createdAt) ?? headerCreatedAt;
      if (!fallbackParentSessionId) {
        fallbackParentSessionId = getStringField(obj, ["parentSessionId", "parent_session_id"]);
      }
      if (!fallbackParentSessionFile) {
        fallbackParentSessionFile = getStringField(obj, [
          "parentSessionFile",
          "parent_session_file",
          "parentSessionPath",
          "parent_session_path",
          "parentSession",
          "parent_session",
        ]);
      }
      if (!fallbackParentSessionId && fallbackParentSessionFile) {
        fallbackParentSessionId = parseSessionIdFromPath(fallbackParentSessionFile);
      }
    }

    if (id && type !== "session") {
      nodes.set(id, {
        parentId,
        parentSessionId,
        parentSessionFile,
      });
      lastNodeId = id;
    }

    parsedLines.push(line);
  }

  if (parsedLines.length === 0) return null;

  const hasBranchNodes = nodes.size > 0;
  let activeLeafId = explicitLeafHint ?? lastNodeId;
  if (activeLeafId && explicitLeafHint && explicitLeafHint !== lastNodeId && !nodes.has(activeLeafId)) {
    activeLeafId = lastNodeId;
  }
  const activeSessionId = activeLeafId ?? headerSessionId ?? path.basename(filePath, path.extname(filePath));
  let parentSessionId: string | undefined = fallbackParentSessionId;
  let parentSessionFile: string | undefined = fallbackParentSessionFile;

  const activeNodeIds = new Set<string>();
  if (hasBranchNodes && activeLeafId) {
    let cursor: string | undefined = activeLeafId;
    const leafNode = nodes.get(activeLeafId);
    if (leafNode) {
      if (leafNode.parentSessionId) {
        parentSessionId = leafNode.parentSessionId;
      }
      if (leafNode.parentSessionFile) {
        parentSessionFile = leafNode.parentSessionFile;
      }
      if (!parentSessionId && parentSessionFile) {
        parentSessionId = parseSessionIdFromPath(parentSessionFile);
      }
    }
    for (let i = 0; i < nodes.size + 5; i++) {
      if (!cursor || activeNodeIds.has(cursor)) break;
      activeNodeIds.add(cursor);
      const node = nodes.get(cursor);
      if (!node) break;
      if (!node.parentId) break;
      cursor = node.parentId;
      if (!nodes.has(cursor)) break;
    }
  }

  const includeLine = (line: ParsedJsonlLine): boolean => {
    if (!hasBranchNodes || !activeLeafId) return true;
    if (!line.id && !line.parentId) return false;
    if (line.id) return activeNodeIds.has(line.id);
    if (line.parentId) return activeNodeIds.has(line.parentId);
    return false;
  };

  const turns: ActiveBranchTurn[] = [];
  let turnIndex = 0;
  for (const line of parsedLines) {
    if (!includeLine(line)) continue;

    const messageObj = extractMessage(line);
    if (!messageObj?.role || !messageObj.content) continue;
    if (messageObj.role !== "user" && messageObj.role !== "assistant") continue;
    const text = messageText(messageObj.content);
    if (!text.trim()) continue;

    turns.push({
      role: messageObj.role,
      content: text,
      turnIndex: turnIndex++,
    });
  }

  if (turns.length === 0) return null;

  return {
    id: activeSessionId,
    title: headerTitle,
    createdAt: headerCreatedAt,
    turns,
    parentSessionId,
    parentSessionFile,
  };
}

export { messageText };
