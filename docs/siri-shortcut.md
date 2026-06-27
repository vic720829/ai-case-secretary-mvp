# Siri Shortcut Assistant

這個專案提供兩個獨立的 Siri 捷徑問答入口。

建議 iPhone 捷徑使用純文字入口：

```text
/api/siri/speak
```

它會直接回傳可朗讀的純文字，不需要在捷徑裡解析 JSON。

進階 JSON 入口：

```text
/api/siri/ask
```

這兩個 endpoint 都只會把答案回傳給 Siri 捷徑，不會呼叫 LINE reply 或 push API，也不會改變客戶群組的回覆規則。

## 環境變數

在 `.env.local` 與部署平台設定：

```env
SIRI_ASSISTANT_TOKEN=請換成一組夠長的隨機密碼
```

## 捷徑設定

1. 在 iPhone 開啟「捷徑」App。
2. 新增捷徑，名稱可以取成 `小楓`、`楓纖秘書` 或你想叫的名字。
3. 加入「要求輸入」動作，提示文字可填 `你想問什麼？`。
4. 加入「URL」動作，填入：

```text
https://你的網域/api/siri/speak?token=你的_SIRI_ASSISTANT_TOKEN&question=要求輸入
```

5. 加入「取得 URL 內容」動作。
6. 加入「朗讀文字」動作，朗讀「URL 內容」。

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
