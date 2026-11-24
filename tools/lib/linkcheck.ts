// URL が生きているかを確かめる(lint と cosense-sync が使う)。秘密情報は付けない。

import { USER_AGENT } from "./feed.ts";
import { classifyStatus } from "./lint.ts";
import type { LinkVerdict } from "./lint.ts";

const FETCH_TIMEOUT_MS = 15000;

/** GET して状態だけを見る。本文は読まない */
export async function checkUrl(url: string): Promise<{ verdict: LinkVerdict; detail: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return { verdict: classifyStatus(res.status), detail: String(res.status) };
  } catch (e) {
    // 名前が引けないのは、存在しないサイト。それ以外(時間切れ・接続の失敗)は一時的かもしれない
    const code = String((e as { cause?: { code?: unknown } }).cause?.code ?? "");
    const message = e instanceof Error ? e.message : String(e);
    if (code === "ENOTFOUND" || /ENOTFOUND|dns error|failed to lookup/i.test(message)) {
      return { verdict: "dead", detail: "サイトが見つからない" };
    }
    return { verdict: "retry", detail: "取得できなかった" };
  }
}

/** URL の一覧を確かめて、問題だけを返す。403 などは警告を出して通す */
export async function linkProblems(urls: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const url of urls) {
    const { verdict, detail } = await checkUrl(url);
    if (verdict === "dead") problems.push(`出典の URL が生きていない(${detail}): ${url}`);
    else if (verdict === "retry") problems.push(`出典の URL を確かめられなかった(${detail})。次の起床でもう一度試す: ${url}`);
    else if (verdict === "blocked") console.warn(`  警告: 機械からの取得を断られた(${detail})。あるものとして通す: ${url}`);
  }
  return problems;
}
