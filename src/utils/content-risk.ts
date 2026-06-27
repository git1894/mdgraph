export interface ContentRiskLine {
  line: number;
  reason: string;
}

export function scanContentRiskLines(content: string): ContentRiskLine[] {
  const risks: ContentRiskLine[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (lower.includes("ignore previous instructions") || lower.includes("system prompt")) {
      risks.push({ line: index + 1, reason: "possible prompt injection text" });
    }
    if (/<\s*(script|iframe)\b/i.test(line)) {
      risks.push({ line: index + 1, reason: "HTML script or iframe" });
    }
    if (/data:text\/html|data:application\/javascript/i.test(line)) {
      risks.push({ line: index + 1, reason: "active data URI" });
    }
    if (/\p{Cf}/u.test(line)) {
      risks.push({ line: index + 1, reason: "hidden Unicode format character" });
    }
  });
  return risks;
}
