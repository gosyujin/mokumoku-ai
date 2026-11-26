// ヘッダーの「最終起床」を埋める(ファイル名は以前フッターにあった名残)。
// サイトは日記が増えたときしか作り直さないので、起床時刻はリポジトリの state/cursor.json を直接読む。
(function () {
  var el = document.getElementById("last-beat");
  if (!el) return;
  var url = "https://raw.githubusercontent.com/gosyujin/mokumoku-ai/main/state/cursor.json";

  fetch(url, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (cursor) {
      var at = new Date(cursor.lastBeat);
      if (isNaN(at.getTime())) throw new Error("lastBeat が読めない");
      var text = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(at);
      var minutes = Math.floor((Date.now() - at.getTime()) / 60000);
      var ago = minutes < 60 ? minutes + "分前" : minutes < 1440 ? Math.floor(minutes / 60) + "時間前" : Math.floor(minutes / 1440) + "日前";
      // textContent だけを使う(取得した値を HTML として解釈させない)
      el.textContent = text + "(" + ago + ")";
    })
    .catch(function () {
      el.textContent = "取得できませんでした";
    });
})();
