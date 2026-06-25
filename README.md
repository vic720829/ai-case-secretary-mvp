# AI 案件秘書 MVP

這是一套給室內設計與工程公司使用的 LINE AI 案件秘書。第一階段目標不是一般 CRM，而是把案件、任務、施工工期、關鍵節點、LINE 訊息與風險提醒集中管理，降低承諾漏追、工期漏提醒、客戶訊息遺漏的風險。

## 目前功能

- 案件管理：案件列表、新增案件、案件詳情、工程進度。
- 任務管理：任務列表、新增任務、任務可綁定案件。
- 今日風險中心：高風險任務、逾期任務、今天到期任務、高風險案件、關鍵點預警。
- 施工工期表：每個案件都有自己的月曆，可新增施工工期，並設定進場前幾天提醒。
- 工期總表：依指定日期查看當天有哪些案場與工程，並可集中查看全部案件的工期節點、逾期狀態與關鍵節點。
- 關鍵節點：可綁定案件與工期，設定到期日、風險等級、提前提醒天數。
- LINE 群組管理：可綁定案件群組與公司後台群組。
- LINE 成員身份：標記 LINE 發話者為內部人員、客戶或廠商。
- LINE 訊息中心：接收 LINE Webhook，儲存文字、圖片、語音訊息，並可依案件與群組篩選。
- LINE Webhook 紀錄：記錄成功、略過、錯誤與 AI 草稿建立數，方便除錯。
- LINE 回覆限制：客戶群只同步與記錄，助理只在公司後台群組回答問題與發提醒。
- LINE 提醒按鈕：公司後台群組可直接點「已確認」「明天再提醒」「延後3天」「仍待處理」。
- AI 任務審核：案件 LINE 群組會依發話者身份產生 AI 草稿，並即時通知公司後台群組，可先編輯再核准成正式任務。
- Firebase Authentication：Email/Password 登入。
- Firestore Rules：MVP4 角色權限版，支援 `owner` / `admin` / `staff` / `viewer`。
- Netlify 部署與排程提醒。

## 技術架構

- Next.js
- TypeScript
- Tailwind CSS
- Firebase Authentication
- Firebase Firestore
- Firebase Storage
- Firebase Admin SDK
- LINE Messaging API
- OpenAI API
- Netlify

## 本機啟動

1. 複製環境變數範本：

```bash
cp .env.example .env.local
```

2. 到 Firebase Console 建立 Web App，開啟 Authentication 的 Email/Password provider，並把 Firebase config 填入 `.env.local`。

3. 安裝並啟動：

```bash
npm install
npm run dev
```

## 環境變數

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_SERVICE_ACCOUNT_BASE64=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LINE_SKIP_SIGNATURE_VERIFY=false

OPENAI_API_KEY=
OPENAI_MODEL=
```

`FIREBASE_SERVICE_ACCOUNT_BASE64` 建議使用 Firebase service account JSON 的 base64 版本。若不用 base64，也可以改填 `FIREBASE_ADMIN_PROJECT_ID`、`FIREBASE_ADMIN_CLIENT_EMAIL`、`FIREBASE_ADMIN_PRIVATE_KEY`。

`FIREBASE_STORAGE_BUCKET` 用於 LINE 圖片與語音訊息存到 Firebase Storage。通常可以和 `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` 填同一個值，例如 `your-project.appspot.com`。

## Firestore Collections

### users

- email
- displayName
- role: `owner` / `admin` / `staff` / `viewer`
- active
- createdAt
- updatedAt

### projects

- name
- clientName
- currentStage
- designer
- assistant
- status
- expectedFinishDate
- createdAt
- updatedAt

### tasks

- title
- description
- projectId
- assignee
- dueDate
- status: `todo` / `doing` / `done`
- source: `manual` / `line` / `ai` / `voice`
- riskLevel: `low` / `medium` / `high`
- createdAt
- updatedAt

### projectStages

- projectId
- stageName
- startDate
- endDate
- status: `todo` / `doing` / `done`
- sortOrder
- reminderDaysBefore
- createdAt
- updatedAt

### milestones

- projectId
- stageId
- title
- description
- dueDate
- completed
- riskLevel: `low` / `medium` / `high`
- reminderDaysBefore
- createdAt
- updatedAt

### line_groups

- groupId
- projectId
- groupName
- groupType: `project` / `admin`
- allowAssistantReplies
- createdAt
- updatedAt

### line_members

- lineUserId
- displayName
- role: `internal` / `client` / `vendor`
- projectId
- note
- createdAt
- updatedAt

### messages

- projectId
- groupId
- lineMessageId
- senderId
- senderName
- senderRole: `internal` / `client` / `vendor` / `unknown`
- messageType: `text` / `image` / `audio`
- text
- fileUrl
- timestamp
- isProcessed
- createdAt

### ai_tasks

- projectId
- sourceMessageId
- sourceGroupId
- sourceSenderName
- sourceSenderRole: `internal` / `client` / `vendor` / `unknown`
- title
- description
- taskType: `promise` / `change` / `followup` / `payment` / `invoice`
- status: `todo` / `doing` / `done`
- assignedTo
- dueDate
- createdByAI
- reviewStatus: `pending` / `approved` / `rejected`
- approvedTaskId
- reviewedBy
- reviewedAt
- createdAt

### reminder_logs

- key
- sourceType: `task` / `stage` / `milestone` / `ai_task`
- sourceId
- reminderType: `stage_before_start` / `milestone_before_due` / `due_today` / `overdue` / `high_risk`
- projectId
- title
- sourceLabel
- dueDate
- status: `pending` / `confirmed`
- firstTriggeredOn
- lastRemindedOn
- confirmedBy
- confirmedAt
- snoozedUntil
- actionBy
- lastAction
- createdAt
- updatedAt

### webhook_logs

- eventType
- status: `success` / `skipped` / `error`
- groupId
- userId
- projectId
- messageId
- lineMessageId
- messageType
- aiTaskDrafts
- reason
- errorMessage
- createdAt

## LINE Webhook

Webhook route:

```text
/api/line/webhook
```

正式部署後，LINE Developers 的 Webhook URL 填：

```text
https://your-site.netlify.app/api/line/webhook
```

LINE 訊息進入後會：

- 驗證 LINE signature。
- 依 `groupId` 尋找 `line_groups`。
- 以 LINE 原始 `messageId` 避免重送事件重複建立訊息與 AI 草稿。
- 若已綁定群組但尚未填群組名稱，會嘗試向 LINE 同步群組名稱。
- 客戶群組只儲存訊息，不主動回覆。
- 公司後台群組可以回答問題與接收提醒。
- 只有已綁定案件的客戶群組會建立 AI 任務草稿。
- AI 任務草稿建立後，會立即推播通知到 `groupType=admin` 且允許助理回覆的公司後台群組。
- 若 `line_members` 有登記發話者身份，AI 會依身份區分公司承諾、等待客戶回覆、追蹤廠商承諾。
- 文字訊息存到 Firestore `messages.text`。
- 圖片與語音會下載到 Firebase Storage，並把公開下載連結存到 `messages.fileUrl`。
- 每次 Webhook 處理結果會寫入 `webhook_logs`，可在後台查看成功、略過或錯誤。

## LINE 成員身份

`line_members` 用來讓 AI 判斷誰在說話。

建議規則：

- `internal`：設計師、助理、工務、公司內部人員。
- `client`：業主、客戶窗口。
- `vendor`：木工、水電、系統櫃、油漆等外包廠商。

AI 建任務時會這樣分：

- 內部人員說「我明天確認木工進場」：建立 `公司承諾` 草稿。
- 客戶說「我明天回覆顏色」：建立 `等待客戶回覆` 草稿。
- 廠商說「我明天安排師傅」：建立 `追蹤廠商承諾` 草稿。
- 客戶說「顏色想改」「尺寸改小」：建立 `客戶變更` 草稿。

## Netlify

Build command:

```bash
npm run build
```

Publish directory:

```text
.next
```

環境變數請到 Netlify Site settings 裡依 `.env.example` 新增。更新環境變數後，需要重新部署一次。

### 每日 LINE 提醒

Netlify Scheduled Function:

- Function: `daily-reminder`
- Schedule: `0 1 * * *`
- 台灣時間約早上 9:00 執行。

提醒內容包含：

- 施工進場提醒
- 關鍵節點提前提醒
- 今天到期事項
- 已逾期事項
- 高風險事項

已確認的提醒會寫入 `reminder_logs`，避免同一件事持續被提醒；未確認的提醒會繼續出現在提醒流程中。

## Firestore Rules 角色設定

MVP4 起，`firestore.rules` 改為角色權限版。發布新版 Rules 前，請先到 Firebase Console 建立自己的使用者角色資料，否則登入後會沒有讀寫權限。

請先在 Firestore 建立：

```text
users/{你的 Firebase Authentication uid}
```

範例欄位：

```json
{
  "email": "your-email@example.com",
  "displayName": "VIC",
  "role": "owner",
  "active": true
}
```

角色權限：

- `owner`：可讀寫全部營運資料，也可管理使用者與 LINE 群組設定。
- `admin`：可讀寫全部營運資料，也可管理使用者與 LINE 群組設定。
- `staff`：可讀寫案件、任務、工期、關鍵節點、訊息、AI 任務、提醒紀錄。
- `viewer`：只能查看資料，不能新增、修改、刪除。

## MVP4 待辦

- LINE 提醒訊息加入按鈕：已完成基礎版。
- AI 建立任務來源收斂：已完成基礎版。
- AI 任務審核流程：已完成基礎版。
- Firestore Rules 角色權限：已完成基礎版，發布前需先建立 `users/{uid}`。
- AI 草稿核准前編輯：已完成，核准前可修改案件、標題、內容、類型、負責人與截止日。
- LINE 提醒延後：已完成，支援明天再提醒與延後3天。
- Webhook 除錯紀錄：已完成，支援後台查看 webhook_logs。

## MVP5 LINE AI 問答秘書

公司後台 LINE 群組可以直接用自然語言問系統。客戶群組仍只同步訊息，不會主動回覆。

目前支援：

- 今天有什麼事情？
- 明天有什麼事情？
- 有哪些案件有風險？
- 有哪些款項要收？
- 有哪些發票還沒開？
- 三重元泰做到哪裡？
- 最近有哪些事情被忘記？

查詢範圍：

- `tasks`
- `milestones`
- `projectStages`
- `ai_tasks`
- `projects`

AI 問答會回覆：

- 今日 / 明日到期任務、關鍵節點、工期進場與工期結束。
- 高風險案件與風險原因。
- 已核准或待審核的收款 / 發票 AI 任務。
- 指定案件目前階段、完成比例、下一階段、下一個關鍵節點與風險。
- 逾期任務、逾期關鍵節點、逾期工期與逾期 AI 任務。

### MVP5 理解方式

LINE 後台群組收到問題時，系統會先用 OpenAI 判斷「問題意圖」與「可能的案件名稱」，例如：

- 「元泰那邊現在怎樣」=> 案件進度
- 「錢的部分呢」=> 收款事項
- 「最近有沒有怪怪的」=> 風險案件
- 「那個客人還沒回嗎」=> 被忘記或逾期追蹤

OpenAI 只做分類，不直接產生業務答案。實際回覆仍由 Firestore 查詢 `projects`、`tasks`、`projectStages`、`milestones`、`ai_tasks` 後組合，降低亂編風險。

如果沒有設定 `OPENAI_API_KEY` 或 OpenAI 暫時失敗，系統會改用內建關鍵字規則回答。
