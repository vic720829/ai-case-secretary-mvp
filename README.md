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
- LINE 訊息中心：接收 LINE Webhook，儲存文字、圖片、語音訊息，並可依案件與群組篩選。
- LINE 回覆限制：客戶群只同步與記錄，助理只在公司後台群組回答問題與發提醒。
- AI 任務草稿：目前已保留 `ai_tasks` collection 與基本分析流程，完整 MVP4 會再收斂來源與審核流程。
- Firebase Authentication：Email/Password 登入。
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

### messages

- projectId
- groupId
- senderId
- senderName
- messageType: `text` / `image` / `audio`
- text
- fileUrl
- timestamp
- isProcessed
- createdAt

### ai_tasks

- projectId
- sourceMessageId
- title
- description
- taskType: `promise` / `change` / `followup` / `payment` / `invoice`
- status: `todo` / `doing` / `done`
- assignedTo
- dueDate
- createdByAI
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
- createdAt
- updatedAt

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
- 客戶群組只儲存訊息，不主動回覆。
- 公司後台群組可以回答問題與接收提醒。
- 文字訊息存到 Firestore `messages.text`。
- 圖片與語音會下載到 Firebase Storage，並把公開下載連結存到 `messages.fileUrl`。

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
