// guard の判定部分(ファイルを読まない純粋な関数)。
// エージェント(Claude の step)が変更してよい場所を、ここで決める。

/**
 * エージェントが書いてよい場所。末尾が "/" ならその下すべて、そうでなければそのファイルだけ。
 * 段階4では drafts/ と journal/ だけ。段階5で state/(一部)・cosense/・RULES.md を足す。
 */
export const AGENT_WRITABLE: readonly string[] = ["drafts/", "journal/"];

/** エージェントが書いてよい拡張子(日記・行動ログはどちらも Markdown) */
export const AGENT_EXTENSIONS: readonly string[] = [".md"];

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

export function isWritable(path: string, writable: readonly string[] = AGENT_WRITABLE): boolean {
  if (path.split("/").includes("..") || path.startsWith("/")) return false;
  return writable.some((w) => (w.endsWith("/") ? path.startsWith(w) : path === w));
}

/** 違反の理由。問題なければ null */
export function violation(change: Change, writable: readonly string[] = AGENT_WRITABLE): string | null {
  if (!isWritable(change.path, writable)) return "書いてよい場所の外";
  const deleted = change.status.includes("D");
  if (!deleted && !AGENT_EXTENSIONS.some((ext) => change.path.endsWith(ext))) {
    return `拡張子が ${AGENT_EXTENSIONS.join(" / ")} ではない`;
  }
  return null;
}
