# AI 案件秘書 MVP

室內設計公司用的 AI 案件秘書 MVP。此版本提供 Firebase Authentication、Firestore 案件與任務 CRUD、工期管理、LINE 同步、AI 任務追蹤與今日風險中心。

## 功能

- 今日風險中心：高風險任務、已逾期任務、今天到期任務
- LINE 訊息中心：群組綁定、案件訊息、訊息同步
- AI 任務追蹤：從 LINE 文字訊息分析承諾、變更、追蹤、收款、發票事項
- 案件管理：列表、新增、詳情編輯、刪除
- 工期總表：集中查看全部案件的工期節點、逾期狀態與關鍵節點
- 月曆新增工程表：可從工期總表用月曆建立工程階段
- 進場前提醒：工期節點可設定進場前 N 天提醒，推送到公司後台 LINE 群
- 關鍵節點提前提醒：關鍵節點可設定到期前 N 天提醒
- 提醒中心：提醒預設待處理，按「已處理」後才停止每日提醒
- 案件進度：每個案件可管理工期節點與關鍵節點
- 關鍵節點：可綁定到指定工期節點
- 任務管理：列表、新增、詳情編輯、刪除
- 任務可綁定案件
- Firebase Authentication Email/Password 登入與註冊
- Firestore rules：登入後才可讀寫
- Netlify 部署設定

## 本機啟動

1. 複製環境變數範例：

```bash
cp .env.example .env.local
```

2. 到 Firebase Console 建立 Web App，開啟 Authentication 的 Email/Password provider，並把 Firebase config 填入 `.env.local`。

3. 安裝並啟動：

```bash
npm install
npm run dev
```

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

### line_groups

- groupId
- projectId
- groupName
- groupType: `project` / `admin`
- allowAssistantReplies
- createdAt

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

本機測試需要 tunnel，例如 ngrok 或 Netlify dev tunnel。正式部署後，LINE Developers 後台的 Webhook URL 會像：

```text
https://your-site.netlify.app/api/line/webhook
```

需要設定環境變數：

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
OPENAI_API_KEY=
OPENAI_MODEL=
FIREBASE_SERVICE_ACCOUNT_BASE64=
```

`FIREBASE_SERVICE_ACCOUNT_BASE64` 可放 Firebase service account JSON 的 base64 字串；也可改用：

```env
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

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

## Netlify

Netlify build command:

```bash
npm run build
```

Publish directory:

```text
.next
```

請在 Netlify Site settings 裡設定 `.env.example` 對應的環境變數。

### 每日 LINE 提醒

系統會透過 Netlify Scheduled Function 執行每日提醒：

- Function: `daily-reminder`
- Schedule: `0 1 * * *`
- 台灣時間：每天早上 9:00
- 發送對象：訊息中心設定為「公司後台群組」的 LINE 群組

提醒內容包含：

- 進場提醒
- 關鍵節點提醒
- 今天到期
- 已逾期
- 高風險

部署後可到 Netlify 的 Functions 頁面找到 `daily-reminder`，使用 `Run now` 手動測試。

下一階段待補：

- LINE 提醒訊息中的「已處理」按鈕，直接從 LINE 群組確認提醒。
