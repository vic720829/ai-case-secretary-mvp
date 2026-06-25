export function getReadableError(caught: unknown) {
  if (!(caught instanceof Error)) {
    return "發生未知錯誤，請稍後再試。";
  }

  if (caught.message.includes("Missing or insufficient permissions")) {
    return "Firestore 權限不足。請到 Firebase Console 的 Firestore Rules 發布登入後可讀寫的規則。";
  }

  return caught.message;
}
