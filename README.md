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
- LINE 回覆限制：客戶群只同步與記錄，助理只在公司後台群組回答問題與發提醒。
- LINE 提醒按鈕：公司後台群組可直接點「已確認」「明天再提醒」「仍待處理」。
- AI 任務審核：案件 LINE 群組會依發話者身份產生 AI 草稿，人工核准後才轉成正式任務。
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
- 只有已綁定案件的客戶群組會建立 AI 任務草稿。
- 若 `line_members` 有登記發話者身份，AI 會依身份區分公司承諾、等待客戶回覆、追蹤廠商承諾。
- 文字訊息存到 Firestore `messages.text`。
- 圖片與語音會下載到 Firebase Storage，並把公開下載連結存到 `messages.fileUrl`。

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
- 待補：LINE 按鈕支援指定負責人、延後自訂日期。
