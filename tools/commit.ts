// commit: エージェントと wake が書いてよい場所だけを main に commit して push する。
// push 前に pull --rebase する。変更が無ければ何もしない。
//
// 実行: node tools/commit.ts [agent]   (GitHub Actions の中だけ。手元で試すときは --local を付ける)
//   引数なし: wake の記録を commit する(メッセージは beat: …)
//   agent   : エージェントが書いたものを commit する(メッセージは agent: …)
// 環境変数:
//   GITHUB_TOKEN  push に使うトークン。checkout には認証を残さず(persist-credentials: false)、
//                 この step の env にだけ渡す。Claude の step からトークンを読めないようにするため

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

import { jst } from "./lib/time.ts";

const BRANCH = "main";
/** commit の対象。ここに無い場所の変更は commit しない */
const PATHS = ["state", "journal", "drafts", "entries", "cosense", "RULES.md"];
const PUSH_RETRIES = 3;
/** エージェントが書いたものの commit か(メッセージが変わるだけ) */
const AGENT = process.argv.includes("agent");

/** GITHUB_TOKEN があれば、この実行の間だけ git に認証ヘッダーを持たせる(.git/config には書かない) */
function gitEnv(): Record<string, string | undefined> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return process.env;
  const basic = btoa(`x-access-token:${token}`);
  console.log(`::add-mask::${basic}`); // ログに出ても伏せ字になるようにする
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

const ENV = gitEnv();

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: ENV }).trim();
}

function message(): string {
  try {
    const c = JSON.parse(readFileSync("state/cursor.json", "utf8"));
    const t = jst(new Date(c.lastBeat));
    return AGENT ? `agent: ${t.date} ${t.hhmm} JST` : `beat: ${t.date} ${t.hhmm} JST act=${c.act}`;
  } catch {
    return AGENT ? "agent" : "beat";
  }
}

if (process.env.GITHUB_ACTIONS !== "true" && !process.argv.includes("--local")) {
  console.error("GitHub Actions の外では動かさない(手元で試すなら --local)");
  process.exit(1);
}

const targets = PATHS.filter((p) => existsSync(p));
if (git("status", "--porcelain", "--", ...targets) === "") {
  console.log("変更なし。commit しない");
  process.exit(0);
}

git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("add", "-A", "--", ...targets);
git("commit", "-m", message());

for (let attempt = 1; ; attempt++) {
  try {
    git("pull", "--rebase", "--autostash", "origin", BRANCH);
    git("push", "origin", `HEAD:${BRANCH}`);
    console.log("push した");
    break;
  } catch (e) {
    if (attempt >= PUSH_RETRIES) throw e;
    console.warn(`push に失敗(${attempt}回目)。やり直す`);
  }
}
