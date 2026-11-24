// guard の判定部分(ファイルを読まない純粋な関数)。
// エージェント(Claude の step)が変更してよい場所を、ここで決める。

/**
 * エージェントが書いてよい場所と、そこに置ける拡張子。
 *   drafts/・journal/   日記の下書きと行動ログ(Markdown)
 *   cosense/pages/      用語ページの中身、cosense/append/ ツッコミへの返信(どちらも cosense-sync が送る)
 * state/・RULES.md・entries/ は、まだ書かせていない(entries/ は lint だけが書く)。
 */
export const AGENT_WRITABLE: readonly { dir: string; ext: string; flat?: boolean }[] = [
  { dir: "drafts/", ext: ".md" },
  { dir: "journal/", ext: ".md" },
  { dir: "cosense/pages/", ext: ".txt", flat: true },
  { dir: "cosense/append/", ext: ".txt", flat: true },
];

export interface Change {
  /** git status の2文字(例: " M" "??" " D") */
  status: string;
  path: string;
}

/**
 * `git status --porcelain=v1 -z` の出力を読む。
 * 区切りは NUL。改名・複製(R / C)は、直後にもう1つ元のパスが続くので、両方を変更として数える。
 */
export function parsePorcelain(raw: string): Change[] {
  const tokens = raw.split("\0").filter((t) => t !== "");
  const changes: Change[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i].slice(0, 2);
    changes.push({ status, path: tokens[i].slice(3) });
    if (status.includes("R") || status.includes("C")) {
      i++;
      if (i < tokens.length) changes.push({ status, path: tokens[i] });
    }
  }
  return changes;
}

function rule(path: string): { dir: string; ext: string; flat?: boolean } | null {
  if (path.split("/").includes("..") || path.startsWith("/")) return null;
  return AGENT_WRITABLE.find((w) => path.startsWith(w.dir)) ?? null;
}

export function isWritable(path: string): boolean {
  return rule(path) !== null;
}

/** 違反の理由。問題なければ null */
export function violation(change: Change): string | null {
  const r = rule(change.path);
  if (r === null) return "書いてよい場所の外";
  if (change.status.includes("D")) return null;
  if (!change.path.endsWith(r.ext)) return `拡張子が ${r.ext} ではない`;
  if (r.flat && change.path.slice(r.dir.length).includes("/")) return "この場所には、下の階層を作らない";
  return null;
}
