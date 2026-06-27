import { EVALUATION_QUERY_SET_NAMES, evaluationCasesForQuerySet, type EvaluationCase } from "../evaluation/retrieval-eval.js";
import { readBoundedJsonFile } from "../utils/bounded-json.js";
import { normalizePath } from "../utils/text.js";

export type AgentRunMode = "with_mdgraph" | "without_mdgraph";

export interface AgentRunRecord {
  id: string;
  questionId: string;
  question: string;
  mode: AgentRunMode;
  startedAt: string;
  completedAt: string;
  toolCalls: Array<{ name: string; outputChars?: number }>;
  directFileReads: Array<{ path: string; chars?: number }>;
  textSearches: Array<{ query: string; resultCount?: number }>;
  mdgraphCalls: Array<{ tool: string; query?: string; resultCount?: number; chars?: number }>;
  finalCitations: Array<{ path: string; line?: number; correct?: boolean | "unknown" }>;
  rawFileFallback: boolean;
  tokenEstimate?: number;
  characterBudget?: number;
  latencyMs: number;
  notes?: string[];
}

export interface BenchmarkRunMetrics {
  toolCalls: {
    count: number;
    outputChars: number;
  };
  directFileReads: {
    count: number;
    chars: number;
  };
  textSearches: {
    count: number;
    resultCount: number;
  };
  mdgraphCalls: {
    count: number;
    chars: number;
    resultCount: number;
  };
  tokenEstimate?: number;
  characterBudget?: number;
  latencyMs: number;
  rawFileFallback: boolean;
  citations: {
    total: number;
    correct: number;
    incorrect: number;
    unknown: number;
    correctnessRate: number | null;
  };
}

export interface BenchmarkDelta {
  toolCalls: number;
  toolCallOutputChars: number;
  directFileReads: number;
  directFileReadChars: number;
  textSearches: number;
  textSearchResults: number;
  mdgraphCalls: number;
  mdgraphCallChars: number;
  mdgraphCallResults: number;
  tokenEstimate: number | null;
  characterBudget: number | null;
  latencyMs: number;
  rawFileFallback: number;
  citationCorrectnessRate: number | null;
  citationUnknown: number;
}

export interface BenchmarkPairReport {
  questionId: string;
  question: string;
  withMdgraph: BenchmarkRunMetrics;
  withoutMdgraph: BenchmarkRunMetrics;
  delta: BenchmarkDelta;
}

export interface SkippedBenchmarkPair {
  questionId: string;
  reason: string;
  recordIds: string[];
}

export interface BenchmarkReport {
  format: "mdgraph-benchmark";
  formatVersion: 1;
  generatedAt: string;
  querySets: string[];
  records: number;
  summary: {
    questions: number;
    completePairs: number;
    skippedPairs: number;
    aggregateDelta: BenchmarkDelta;
  };
  pairs: BenchmarkPairReport[];
  skipped: SkippedBenchmarkPair[];
}

export function loadBenchmarkReport(filePath: string): BenchmarkReport {
  return generateBenchmarkReport(parseAgentRunRecords(readBoundedJsonFile(filePath, "Benchmark input")));
}

export function parseAgentRunRecords(value: unknown): AgentRunRecord[] {
  const records = Array.isArray(value) ? value : runsProperty(value);
  return records.map((record, index) => validateRunRecord(record, index));
}

export function generateBenchmarkReport(records: AgentRunRecord[], options: { cases?: EvaluationCase[] } = {}): BenchmarkReport {
  const cases = options.cases ?? defaultEvaluationCases();
  const caseById = new Map(cases.map((evaluationCase) => [evaluationCase.id, evaluationCase]));
  const groups = groupByQuestionId(records);
  const pairs: BenchmarkPairReport[] = [];
  const skipped: SkippedBenchmarkPair[] = [];

  for (const [questionId, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const skipReason = skippedPairReason(group);
    if (skipReason) {
      skipped.push({
        questionId,
        reason: skipReason,
        recordIds: group.map((record) => record.id).sort()
      });
      continue;
    }
    const withRecord = group.find((record) => record.mode === "with_mdgraph") as AgentRunRecord;
    const withoutRecord = group.find((record) => record.mode === "without_mdgraph") as AgentRunRecord;
    const withMdgraph = runMetrics(withRecord, caseById.get(questionId));
    const withoutMdgraph = runMetrics(withoutRecord, caseById.get(questionId));
    pairs.push({
      questionId,
      question: withRecord.question,
      withMdgraph,
      withoutMdgraph,
      delta: metricDelta(withMdgraph, withoutMdgraph)
    });
  }

  return {
    format: "mdgraph-benchmark",
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    querySets: [...EVALUATION_QUERY_SET_NAMES],
    records: records.length,
    summary: {
      questions: groups.size,
      completePairs: pairs.length,
      skippedPairs: skipped.length,
      aggregateDelta: aggregateDelta(pairs.map((pair) => pair.delta))
    },
    pairs,
    skipped
  };
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines = [
    "MDGraph benchmark",
    `Records: ${report.records}, questions: ${report.summary.questions}, complete pairs: ${report.summary.completePairs}, skipped pairs: ${report.summary.skippedPairs}`,
    `Aggregate delta (with - without): file reads ${formatSigned(report.summary.aggregateDelta.directFileReads)}, text searches ${formatSigned(report.summary.aggregateDelta.textSearches)}, tool calls ${formatSigned(report.summary.aggregateDelta.toolCalls)}, latency ${formatSigned(report.summary.aggregateDelta.latencyMs)} ms`
  ];
  if (report.pairs.length) {
    lines.push("Pairs:");
    for (const pair of report.pairs.slice(0, 10)) {
      lines.push(
        `- ${pair.questionId}: file reads ${formatSigned(pair.delta.directFileReads)}, mdgraph calls ${formatSigned(pair.delta.mdgraphCalls)}, citation rate ${formatRate(pair.withMdgraph.citations.correctnessRate)} vs ${formatRate(pair.withoutMdgraph.citations.correctnessRate)}`
      );
    }
  }
  if (report.skipped.length) {
    lines.push("Skipped:", ...report.skipped.map((item) => `- ${item.questionId}: ${item.reason}`));
  }
  return lines.join("\n");
}

function runsProperty(value: unknown): unknown[] {
  if (value && typeof value === "object" && Array.isArray((value as { runs?: unknown }).runs)) {
    return (value as { runs: unknown[] }).runs;
  }
  throw new Error("Benchmark input must be a JSON array of AgentRunRecord objects or an object with a runs array.");
}

function validateRunRecord(value: unknown, index: number): AgentRunRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`Benchmark run record ${index} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const mode = requiredString(record, "mode", index);
  if (mode !== "with_mdgraph" && mode !== "without_mdgraph") {
    throw new Error(`Benchmark run record ${index} mode must be with_mdgraph or without_mdgraph.`);
  }
  return {
    id: requiredString(record, "id", index),
    questionId: requiredString(record, "questionId", index),
    question: requiredString(record, "question", index),
    mode,
    startedAt: requiredString(record, "startedAt", index),
    completedAt: requiredString(record, "completedAt", index),
    toolCalls: arrayOfObjects(record, "toolCalls", index).map((item, itemIndex) => ({
      name: requiredString(item, "name", index, itemIndex),
      outputChars: optionalNonNegativeNumber(item, "outputChars", index, itemIndex)
    })),
    directFileReads: arrayOfObjects(record, "directFileReads", index).map((item, itemIndex) => ({
      path: normalizePath(requiredString(item, "path", index, itemIndex)),
      chars: optionalNonNegativeNumber(item, "chars", index, itemIndex)
    })),
    textSearches: arrayOfObjects(record, "textSearches", index).map((item, itemIndex) => ({
      query: requiredString(item, "query", index, itemIndex),
      resultCount: optionalNonNegativeNumber(item, "resultCount", index, itemIndex)
    })),
    mdgraphCalls: arrayOfObjects(record, "mdgraphCalls", index).map((item, itemIndex) => ({
      tool: requiredString(item, "tool", index, itemIndex),
      query: optionalString(item, "query", index, itemIndex),
      resultCount: optionalNonNegativeNumber(item, "resultCount", index, itemIndex),
      chars: optionalNonNegativeNumber(item, "chars", index, itemIndex)
    })),
    finalCitations: arrayOfObjects(record, "finalCitations", index).map((item, itemIndex) => ({
      path: normalizePath(requiredString(item, "path", index, itemIndex)),
      line: optionalPositiveInteger(item, "line", index, itemIndex),
      correct: optionalCitationCorrectness(item, index, itemIndex)
    })),
    rawFileFallback: requiredBoolean(record, "rawFileFallback", index),
    tokenEstimate: optionalNonNegativeNumber(record, "tokenEstimate", index),
    characterBudget: optionalNonNegativeNumber(record, "characterBudget", index),
    latencyMs: requiredNonNegativeNumber(record, "latencyMs", index),
    notes: optionalStringArray(record, "notes", index)
  };
}

function runMetrics(record: AgentRunRecord, evaluationCase: EvaluationCase | undefined): BenchmarkRunMetrics {
  return {
    toolCalls: {
      count: record.toolCalls.length,
      outputChars: sum(record.toolCalls.map((toolCall) => toolCall.outputChars))
    },
    directFileReads: {
      count: record.directFileReads.length,
      chars: sum(record.directFileReads.map((read) => read.chars))
    },
    textSearches: {
      count: record.textSearches.length,
      resultCount: sum(record.textSearches.map((search) => search.resultCount))
    },
    mdgraphCalls: {
      count: record.mdgraphCalls.length,
      chars: sum(record.mdgraphCalls.map((call) => call.chars)),
      resultCount: sum(record.mdgraphCalls.map((call) => call.resultCount))
    },
    tokenEstimate: record.tokenEstimate,
    characterBudget: record.characterBudget,
    latencyMs: record.latencyMs,
    rawFileFallback: record.rawFileFallback,
    citations: citationMetrics(record, evaluationCase)
  };
}

function citationMetrics(record: AgentRunRecord, evaluationCase: EvaluationCase | undefined): BenchmarkRunMetrics["citations"] {
  const expectedPaths = evaluationCase ? expectedCitationPaths(evaluationCase) : undefined;
  let correct = 0;
  let incorrect = 0;
  let unknown = 0;
  for (const citation of record.finalCitations) {
    if (expectedPaths) {
      if (expectedPaths.has(normalizePath(citation.path))) {
        correct += 1;
      } else {
        incorrect += 1;
      }
      continue;
    }
    if (citation.correct === true) {
      correct += 1;
    } else if (citation.correct === false) {
      incorrect += 1;
    } else {
      unknown += 1;
    }
  }
  const rated = correct + incorrect;
  return {
    total: record.finalCitations.length,
    correct,
    incorrect,
    unknown,
    correctnessRate: rated ? round(correct / rated) : null
  };
}

function expectedCitationPaths(evaluationCase: EvaluationCase): Set<string> {
  return new Set([
    ...evaluationCase.expectedDocuments,
    ...evaluationCase.expectedSections.map((section) => section.path)
  ].map(normalizePath));
}

function metricDelta(withMdgraph: BenchmarkRunMetrics, withoutMdgraph: BenchmarkRunMetrics): BenchmarkDelta {
  return {
    toolCalls: withMdgraph.toolCalls.count - withoutMdgraph.toolCalls.count,
    toolCallOutputChars: withMdgraph.toolCalls.outputChars - withoutMdgraph.toolCalls.outputChars,
    directFileReads: withMdgraph.directFileReads.count - withoutMdgraph.directFileReads.count,
    directFileReadChars: withMdgraph.directFileReads.chars - withoutMdgraph.directFileReads.chars,
    textSearches: withMdgraph.textSearches.count - withoutMdgraph.textSearches.count,
    textSearchResults: withMdgraph.textSearches.resultCount - withoutMdgraph.textSearches.resultCount,
    mdgraphCalls: withMdgraph.mdgraphCalls.count - withoutMdgraph.mdgraphCalls.count,
    mdgraphCallChars: withMdgraph.mdgraphCalls.chars - withoutMdgraph.mdgraphCalls.chars,
    mdgraphCallResults: withMdgraph.mdgraphCalls.resultCount - withoutMdgraph.mdgraphCalls.resultCount,
    tokenEstimate: optionalDelta(withMdgraph.tokenEstimate, withoutMdgraph.tokenEstimate),
    characterBudget: optionalDelta(withMdgraph.characterBudget, withoutMdgraph.characterBudget),
    latencyMs: withMdgraph.latencyMs - withoutMdgraph.latencyMs,
    rawFileFallback: Number(withMdgraph.rawFileFallback) - Number(withoutMdgraph.rawFileFallback),
    citationCorrectnessRate: optionalDelta(withMdgraph.citations.correctnessRate, withoutMdgraph.citations.correctnessRate),
    citationUnknown: withMdgraph.citations.unknown - withoutMdgraph.citations.unknown
  };
}

function aggregateDelta(deltas: BenchmarkDelta[]): BenchmarkDelta {
  return {
    toolCalls: sum(deltas.map((delta) => delta.toolCalls)),
    toolCallOutputChars: sum(deltas.map((delta) => delta.toolCallOutputChars)),
    directFileReads: sum(deltas.map((delta) => delta.directFileReads)),
    directFileReadChars: sum(deltas.map((delta) => delta.directFileReadChars)),
    textSearches: sum(deltas.map((delta) => delta.textSearches)),
    textSearchResults: sum(deltas.map((delta) => delta.textSearchResults)),
    mdgraphCalls: sum(deltas.map((delta) => delta.mdgraphCalls)),
    mdgraphCallChars: sum(deltas.map((delta) => delta.mdgraphCallChars)),
    mdgraphCallResults: sum(deltas.map((delta) => delta.mdgraphCallResults)),
    tokenEstimate: optionalSum(deltas.map((delta) => delta.tokenEstimate)),
    characterBudget: optionalSum(deltas.map((delta) => delta.characterBudget)),
    latencyMs: sum(deltas.map((delta) => delta.latencyMs)),
    rawFileFallback: sum(deltas.map((delta) => delta.rawFileFallback)),
    citationCorrectnessRate: averageOptional(deltas.map((delta) => delta.citationCorrectnessRate)),
    citationUnknown: sum(deltas.map((delta) => delta.citationUnknown))
  };
}

function groupByQuestionId(records: AgentRunRecord[]): Map<string, AgentRunRecord[]> {
  const groups = new Map<string, AgentRunRecord[]>();
  for (const record of records) {
    groups.set(record.questionId, [...groups.get(record.questionId) ?? [], record]);
  }
  return groups;
}

function skippedPairReason(records: AgentRunRecord[]): string | undefined {
  const withCount = records.filter((record) => record.mode === "with_mdgraph").length;
  const withoutCount = records.filter((record) => record.mode === "without_mdgraph").length;
  const questions = new Set(records.map((record) => record.question.trim()));
  if (questions.size > 1) {
    return "question_text_mismatch";
  }
  if (withCount !== 1 || withoutCount !== 1) {
    return `expected one with_mdgraph and one without_mdgraph record; got with_mdgraph=${withCount}, without_mdgraph=${withoutCount}`;
  }
  return undefined;
}

function defaultEvaluationCases(): EvaluationCase[] {
  return EVALUATION_QUERY_SET_NAMES.flatMap((querySet) => evaluationCasesForQuerySet(querySet));
}

function requiredString(record: Record<string, unknown>, key: string, recordIndex: number, itemIndex?: number): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${recordLabel(recordIndex, itemIndex)} must include non-empty string ${key}.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, recordIndex: number, itemIndex?: number): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${recordLabel(recordIndex, itemIndex)} ${key} must be a string when present.`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string, recordIndex: number): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${recordLabel(recordIndex)} must include boolean ${key}.`);
  }
  return value;
}

function requiredNonNegativeNumber(record: Record<string, unknown>, key: string, recordIndex: number): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${recordLabel(recordIndex)} must include non-negative number ${key}.`);
  }
  return value;
}

function optionalNonNegativeNumber(record: Record<string, unknown>, key: string, recordIndex: number, itemIndex?: number): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${recordLabel(recordIndex, itemIndex)} ${key} must be a non-negative number when present.`);
  }
  return value;
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string, recordIndex: number, itemIndex?: number): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${recordLabel(recordIndex, itemIndex)} ${key} must be a positive integer when present.`);
  }
  return value;
}

function optionalCitationCorrectness(record: Record<string, unknown>, recordIndex: number, itemIndex: number): boolean | "unknown" | undefined {
  const value = record.correct;
  if (value === undefined || value === true || value === false || value === "unknown") {
    return value;
  }
  throw new Error(`${recordLabel(recordIndex, itemIndex)} correct must be boolean or "unknown" when present.`);
}

function optionalStringArray(record: Record<string, unknown>, key: string, recordIndex: number): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${recordLabel(recordIndex)} ${key} must be a string array when present.`);
  }
  return value;
}

function arrayOfObjects(record: Record<string, unknown>, key: string, recordIndex: number): Array<Record<string, unknown>> {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${recordLabel(recordIndex)} must include array ${key}.`);
  }
  if (value.some((item) => !item || typeof item !== "object")) {
    throw new Error(`${recordLabel(recordIndex)} ${key} must contain objects.`);
  }
  return value as Array<Record<string, unknown>>;
}

function recordLabel(recordIndex: number, itemIndex?: number): string {
  return itemIndex === undefined ? `Benchmark run record ${recordIndex}` : `Benchmark run record ${recordIndex} item ${itemIndex}`;
}

function optionalDelta(left: number | null | undefined, right: number | null | undefined): number | null {
  return left === null || left === undefined || right === null || right === undefined ? null : round(left - right);
}

function optionalSum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? sum(present) : null;
}

function averageOptional(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? round(sum(present) / present.length) : null;
}

function sum(values: Array<number | undefined>): number {
  let total = 0;
  for (const value of values) {
    total += value ?? 0;
  }
  return round(total);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
