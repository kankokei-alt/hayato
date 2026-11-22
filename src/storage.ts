// iPhoneの中（このアプリ専用の保存領域）に設定・メモ・会話を保存する。
// ホーム画面に追加したアプリの保存領域は、Safariの「7日で消える」制限の対象外。
// 保存できない状況（プライベートブラウズなど）もあるので、読み書きは必ず try で囲む。

const PREFIX = "hayato.";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** 保存に成功したら true */
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* noop */
  }
}
