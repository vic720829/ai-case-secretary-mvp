# Siri Shortcut Assistant

這個專案提供獨立的 Siri 捷徑問答入口：

```text
/api/siri/ask
```

這個 endpoint 只會把答案回傳給 Siri 捷徑，不會呼叫 LINE reply 或 push API，也不會改變客戶群組的回覆規則。

## 環境變數

在 `.env.local` 與部署平台設定：

```env
SIRI_ASSISTANT_TOKEN=請換成一組夠長的隨機密碼
```

## 捷徑設定

1. 在 iPhone 開啟「捷徑」App。
2. 新增捷徑，名稱可以取成 `小楓`、`楓纖秘書` 或你想叫的名字。
3. 加入「詢問輸入」動作，提示文字可填 `你想問什麼？`。
4. 加入「取得 URL 內容」動作。
5. URL 填：

```text
https://你的網域/api/siri/ask
```

6. 方法選 `POST`。
7. Headers 加入：

```text
Authorization: Bearer 你的 SIRI_ASSISTANT_TOKEN
Content-Type: application/json
```

8. Request Body 選 JSON，內容：

```json
{
  "question": "捷徑詢問輸入的結果"
}
```

9. 從回傳結果取出 `speakText` 或 `answer`。
10. 加入「朗讀文字」動作，朗讀 `speakText`。

## 使用方式

你可以說：

```text
嘿 Siri，小楓
```

Siri 會問：

```text
你想問什麼？
```

你可以問：

```text
今天有哪些事情？
```

或：

```text
哪些案子有請款要追？
```

Siri 會朗讀系統回傳的答案；答案不會發到 LINE。
