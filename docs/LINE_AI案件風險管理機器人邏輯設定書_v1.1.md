# LINE AI 案件風險管理機器人邏輯設定書 v1.1

## 一、系統定位

本系統是給室內設計與工程公司使用的 LINE AI 案件風險管理機器人。

它不是一般客服機器人，也不是單純聊天 AI。核心目標是：

1. 防止客戶訊息漏回。
2. 防止公司承諾沒有追蹤。
3. 防止客戶變更沒有留下紀錄。
4. 防止請款、付款、發票、對帳遺漏。
5. 防止工期、進場、關鍵節點逾期。
6. 防止員工看到不屬於自己的案件資料。
7. 所有 AI 判斷只能先建立待審核草稿，不得直接建立正式任務。

核心定位一句話：

> 這個機器人不是聊天機器人，而是客戶群風險監聽器 + 公司後台案件秘書。

## 二、最高指導原則

| 原則 | 說明 |
|---|---|
| 客戶群絕對不回覆 | 不文字、不按鈕、不錯誤訊息、不說不能回。客戶群只監聽、記錄、分析。 |
| 公司後台群才互動 | 只有後台群可以問問題、收提醒、按按鈕、查案件。 |
| 網站是正式後台 | LINE 是提醒與快速操作；案件、待辦、審核、附件、紀錄以網站為準。 |
| AI 不直接建立正式資料 | AI 只建立待審核草稿，人核准後才變正式待辦。 |
| 重要才推 LINE | LINE 額度有限，只推高價值事件，不推一般統計或網站操作。 |
| 所有判斷要可追溯 | AI 為什麼建立草稿、來源訊息、圖片、審核結果都要能回查。 |

## 三、LINE 群組類型

### 1. 客戶案件群組 project group

這是公司、客戶、廠商一起溝通的案件群。

規則：

- AI 不可以在客戶群主動回覆。
- AI 不可以在客戶群出現任何按鈕。
- AI 不可以在客戶群顯示錯誤訊息。
- AI 只記錄訊息。
- AI 可以分析風險。
- AI 可以建立待審核草稿。
- AI 可以把重大提醒推送到公司後台群組。

### 2. 公司後台群組 admin group

這是公司內部使用的後台 LINE 群。

規則：

- AI 可以在這裡發提醒。
- AI 可以在這裡顯示每日風險摘要。
- AI 可以讓員工點按鈕處理提醒。
- AI 可以查詢今日風險、未回覆客戶、逾期待辦、AI 草稿、工期表。

### 3. 未綁定群組

規則：

- 可記錄 groupId。
- 不建立 AI 草稿。
- 不回覆客戶群。
- 可提醒主要後台群：發現未綁定 LINE 群組。

## 四、後台群通知分層

為了節省 LINE 推播額度，後台群必須分層。

### 後台群類型

| 類型 | 用途 | 即時推播 | 每日摘要 | 主動查詢 |
|---|---|---:|---:|---:|
| 主要後台群 primary admin group | 老闆或核心管理群 | 是 | 是 | 是 |
| 一般後台群 secondary admin group | 設計師、工務、助理群 | 否 | 是 | 是 |
| 測試後台群 test admin group | 測試功能用 | 否 | 否 | 是 |
| 停用後台群 none | 不接任何通知 | 否 | 否 | 否 |

### 通知原則

| 事件 | 主要後台群 | 一般後台群 | 測試後台群 |
|---|---:|---:|---:|
| critical 即時重大風險 | 立即推播 | 不推 | 不推 |
| high 高風險 | 立即推播 | 不推 | 不推 |
| medium 一般待審草稿 | 不即時推，進每日摘要 | 不即時推，進每日摘要 | 不推 |
| low 低風險 | 不推 | 不推 | 不推 |
| 每日 8:30 摘要 | 推播 | 推播 | 不推 |
| 使用者主動查詢 | 可回覆 | 可回覆 | 可回覆 |
| 網站新增待辦 | 不推 | 不推 | 不推 |
| 網站核准 AI 草稿 | 不推 | 不推 | 不推 |

### 建議欄位

`line_groups` 建議增加：

```ts
{
  notificationLevel: "primary" | "secondary" | "test" | "none"
}
```

若尚未增加此欄位，短期可用現有 `groupType = "admin"` 搭配人工指定一個主要後台群。

## 五、LINE 發話者身份

### senderRole

| 身份 | 說明 |
|---|---|
| internal | 公司內部人員，例如老闆、設計師、助理、工務。 |
| client | 客戶、業主、客戶窗口。 |
| vendor | 廠商，例如木工、水電、油漆、系統櫃。 |
| unknown | 尚未設定身份的人。 |

規則：

- unknown 不可以被當成 internal。
- unknown 預設視為外部風險來源。
- unknown 發話不可用來判定「公司已回覆客戶」。

## 六、核心資料表

### users

```ts
{
  email: string
  displayName: string
  role: "owner" | "admin" | "staff" | "viewer"
  active: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

### projects

```ts
{
  name: string
  clientName: string
  currentStage: string
  designer: string
  assistant: string
  status: "active" | "paused" | "completed" | "archived"
  expectedFinishDate: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

### project_members

這是正式多人使用時的權限控管核心。

```ts
{
  projectId: string
  userId: string
  userEmail: string
  displayName: string
  roleInProject: "owner" | "designer" | "assistant" | "viewer"
  canRead: boolean
  canWrite: boolean
  canViewFinance: boolean
  canViewFiles: boolean
  active: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

規則：

- owner / admin 可以看全部案件。
- staff 只能看自己被加入 project_members 的案件。
- viewer 只能讀取被授權的案件。
- 沒有 project_members 權限的人，不可以讀取該案件的 messages、tasks、ai_tasks、files、finance 資料。

### line_groups

```ts
{
  groupId: string
  projectId: string
  groupName: string
  groupType: "project" | "admin"
  allowAssistantReplies: boolean
  notificationLevel: "primary" | "secondary" | "test" | "none"
  createdAt: timestamp
  updatedAt: timestamp
}
```

規則：

- groupType = project：客戶案件群，AI 不可主動回覆。
- groupType = admin：公司後台群，AI 可回覆、提醒、查詢。
- notificationLevel 控制推播層級。

### line_members

```ts
{
  lineUserId: string
  displayName: string
  role: "internal" | "client" | "vendor"
  projectId: string
  note: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

### messages

```ts
{
  projectId: string
  groupId: string
  lineMessageId: string
  senderId: string
  senderName: string
  senderRole: "internal" | "client" | "vendor" | "unknown"
  messageType: "text" | "image" | "audio" | "file"
  text: string
  fileUrl: string
  timestamp: timestamp
  isProcessed: boolean
  createdAt: timestamp
}
```

規則：

- 所有 LINE 訊息都要先存 messages。
- 文字、圖片、語音、檔案都要存。
- 圖片或語音如果沒有文字，text 可用「客戶傳送圖片」「客戶傳送語音」等摘要。
- 圖片與語音不可被忽略。

### ai_tasks

AI 任務草稿，不是正式任務。

```ts
{
  projectId: string
  sourceMessageId: string
  sourceGroupId: string
  sourceSenderId: string
  sourceSenderName: string
  sourceSenderRole: "internal" | "client" | "vendor" | "unknown"

  title: string
  description: string
  taskType: "promise" | "change" | "followup" | "payment" | "invoice" | "complaint" | "schedule" | "file"
  riskLevel: "low" | "medium" | "high" | "critical"

  status: "todo" | "doing" | "done"
  assignedTo: string
  dueDate: timestamp | null

  createdByAI: true
  reviewStatus: "pending" | "approved" | "rejected"
  approvedTaskId: string

  resolutionStatus: "open" | "maybe_answered" | "confirmed_resolved"
  linkedAiTaskId: string
  resolutionHint: string

  adminNotifiedAt: timestamp | null

  createdAt: timestamp
  updatedAt: timestamp
}
```

### tasks

正式任務，只能由人工核准 AI 草稿後建立，或由使用者手動建立。

```ts
{
  projectId: string
  title: string
  description: string
  assignee: string
  dueDate: string
  status: "todo" | "doing" | "done"
  source: "manual" | "ai" | "line"
  riskLevel: "low" | "medium" | "high" | "critical"
  createdAt: timestamp
  updatedAt: timestamp
}
```

### reminder_logs

所有提醒統一寫入 reminder_logs。

```ts
{
  key: string
  sourceType: "task" | "ai_task" | "message" | "stage" | "milestone" | "payment" | "invoice"
  sourceId: string
  reminderType:
    | "customer_message_unanswered"
    | "customer_followup_unanswered"
    | "ai_task_pending_review"
    | "due_today"
    | "overdue"
    | "high_risk"
    | "stage_before_start"
    | "milestone_before_due"
    | "payment_due"
    | "invoice_missing"
    | "change_unconfirmed"

  projectId: string
  title: string
  description: string
  sourceLabel: string
  dueDate: string
  priority: "normal" | "high" | "critical"

  status: "pending" | "confirmed"
  firstTriggeredOn: string
  lastRemindedOn: string
  snoozedUntil: string

  confirmedBy: string
  confirmedAt: timestamp | null
  actionBy: string
  lastAction: string

  createdAt: timestamp
  updatedAt: timestamp
}
```

## 七、AI 風險判斷流程

```text
LINE message
→ 儲存 messages
→ 判斷 groupType
→ project group：客戶群不回覆，只分析風險
→ admin group：可回覆查詢指令
→ 重要事件建立 ai_tasks pending 草稿
→ 依 riskLevel 與 notificationLevel 決定是否推播後台
→ 人工核准後才建立 tasks
```

## 八、風險分類規則

| 類型 | 條件摘要 | taskType | 預設風險 |
|---|---|---|---|
| 公司承諾 | internal 說明天給、再確認、安排師傅、傳圖面、給工期表 | promise | medium |
| 客戶追問 | client 或 unknown 問報價、工期、圖面、是否處理 | followup | medium |
| 客戶變更 | 改、變更、不做、取消、新增、尺寸調整、顏色更換 | change | high |
| 客訴 / 缺失 | 不滿意、很爛、品質不好、漏水、裂縫、要修補 | complaint | critical |
| 請款 | 請款、收款、付款、訂金、二期款、尾款、對帳 | payment | high |
| 發票 | 發票、統編、抬頭、收據、報帳 | invoice | high |
| 工期 | 進場、退場、工期、延期、改期、趕工、今天沒來 | schedule | high |
| 圖面 / 檔案 | CAD、圖面、施工圖、報價單、工程表、合約、沒收到 | file | medium |

升級規則：

- 客戶明顯不滿、客訴、漏水、品質不好：critical。
- 延期、沒來、趕工：critical。
- 客戶催促或語氣急迫：high。
- 變更可能影響報價、工期或責任歸屬時，description 必須提醒人工確認。

## 九、客戶訊息未回覆掃描

這是核心功能之一，不能只依賴 AI 是否有建立草稿。

掃描規則：

1. 掃描 messages。
2. 只看 project group。
3. 只看 senderRole = client 或 unknown 的訊息。
4. 依 projectId + groupId 分組。
5. 找出每組最後一則客戶訊息。
6. 檢查該訊息之後是否有 senderRole = internal 的訊息。
7. 如果沒有 internal 回覆，且超過指定時間，建立 reminder_logs。
8. reminderType = customer_message_unanswered。
9. sourceType = message。
10. key = message_{messageId}_customer_message_unanswered。
11. 已 confirmed 的 reminder 不得覆蓋。
12. pending 的 reminder 可更新 lastRemindedOn、updatedAt。
13. 圖片、語音、檔案也要納入。

建議時間規則：

- 上班時間：4 小時未回覆提醒。
- 下班後訊息：隔天 09:30 檢查。
- critical 關鍵字：不等 4 小時，立即提醒主要後台群。

提醒內容需包含：

- 案件名稱
- 客戶名稱
- 訊息摘要
- 訊息時間
- 已等待多久

## 十、AI 草稿審核規則

所有 ai_tasks 必須先進入 pending。

admin group 推送格式：

```text
AI 發現案件風險

案件：{projectName}
發話者：{senderName} / {senderRole}
風險等級：{riskLevel}
類型：{taskType}
標題：{title}
內容：{description}

請人工確認後再建立正式任務。
```

按鈕：

- 通過並建立任務
- 拒絕
- 明天再提醒
- 延後 3 天
- 標記已處理

通過後：

```text
ai_tasks.reviewStatus = approved
建立 tasks
tasks.source = ai
ai_tasks.approvedTaskId = taskId
```

拒絕後：

```text
ai_tasks.reviewStatus = rejected
```

## 十一、AI 不可做的事情

AI 不可以：

1. 在客戶群直接回覆客戶。
2. 直接建立正式任務。
3. 自動判斷變更是否免費。
4. 自動判斷客訴已解決。
5. 自動刪除訊息。
6. 自動關閉發票、請款、變更、客訴任務。
7. 把 unknown 當成 internal。
8. 讓沒有案件權限的人看到案件資料。
9. 把圖片或語音直接忽略。
10. 因為有人回「好」就判定事情已完成。
11. 因為使用者在網站新增待辦，就再推 LINE 通知。
12. 因為使用者在網站核准草稿，就再推 LINE 通知。

## 十二、每日風險摘要

每天早上 8:30 推送。

推送對象：

- 主要後台群：收到每日摘要。
- 一般後台群：收到每日摘要。
- 測試後台群：不收到正式每日摘要。

內容順序：

```text
AI 案件風險摘要｜YYYY/MM/DD

一、客戶訊息未回覆
二、AI 草稿待審核
三、今日到期
四、已逾期
五、高風險 / 重大風險
六、工期 / 進場提醒
七、請款 / 發票提醒
八、客戶變更未確認
```

每一筆提醒顯示：

```text
案件：{projectName}
類型：{reminderType}
內容：{title}
時間：{dueDate 或 messageTime}
狀態：待處理
```

## 十三、即時重大風險推送

以下情況不等每日摘要，立即推送主要後台群：

1. 客訴。
2. 漏水。
3. 客戶明顯不滿。
4. 工期延期。
5. 客戶催促未回。
6. 發票 / 請款問題。
7. 重大變更。
8. 客戶說「我要取消」「不做了」「不滿意」。

即時推送原則：

- 只推主要後台群。
- 一般後台群等每日摘要。
- 測試群不接正式即時推播。
- 如果 LINE 額度用完，必須寫入 webhook_logs / reminder_logs 的錯誤原因。

## 十四、後台群查詢能力

後台群可以主動問：

- 今天有什麼事情？
- 明天有什麼事情？
- 有哪些案件有風險？
- 有哪些客戶訊息還沒回？
- 有哪些 AI 草稿待審？
- 某案件工期表？
- 某案件做到哪裡？
- 有哪些款項要收？
- 有哪些發票還沒開？

查詢回覆只允許在 admin group。

## 十五、權限規則

### owner

- 可看全部。
- 可管理使用者。
- 可管理所有案件。
- 可看財務、文件、LINE 訊息。

### admin

- 可看全部案件。
- 可管理案件與任務。
- 可看財務。
- 可審核 AI 草稿。

### staff

- 只能看自己參與的案件。
- 只能看 project_members 授權的 projectId。
- 不可看其他案件。
- 財務資料需 canViewFinance = true 才可看。
- 檔案資料需 canViewFiles = true 才可看。

### viewer

- 只能讀取被授權案件。
- 不可修改。

## 十六、最小可行開發順序

### Phase 1：整理 LINE 訊息風控核心

1. LINE webhook 接收訊息。
2. 儲存 messages。
3. 判斷 line_groups。
4. 客戶群完全不回覆。
5. 後台群可接收提醒與查詢。
6. 建立主要後台群 / 一般後台群 / 測試後台群策略。

### Phase 2：AI 草稿

1. 分析 LINE 訊息。
2. 建立 ai_tasks pending。
3. 根據 riskLevel 決定是否推主要後台群。
4. 人工通過後建立 tasks。
5. 網站手動新增待辦與網站核准草稿不推 LINE。

### Phase 3：未回覆掃描

1. 掃描客戶最後訊息。
2. 超過指定時間沒有 internal 回覆。
3. 建立 reminder_logs。
4. 每日摘要顯示。
5. critical 關鍵字立即推主要後台群。

### Phase 4：每日提醒

1. 今日到期。
2. 已逾期。
3. 高風險。
4. AI 草稿待審核。
5. 工期進場提醒。
6. 客戶變更未確認。
7. 請款 / 發票提醒。

### Phase 5：案件權限

1. 建立 project_members。
2. 修改 Firestore rules。
3. staff 只能讀自己的案件。
4. messages、tasks、ai_tasks 都要套用案件權限。

## 十七、完成標準

完成後需要達成：

1. 客戶群說話後，訊息會存進 messages。
2. 客戶群不會收到 AI 回覆。
3. AI 能建立 pending 草稿。
4. high / critical 風險會立即推送主要後台群。
5. medium 風險進網站待審與每日摘要。
6. 人工通過後才會建立正式 task。
7. 網站新增待辦不推 LINE。
8. 網站核准 AI 草稿不推 LINE。
9. 客戶最後訊息超過指定時間沒人回，會產生 reminder。
10. 每日 8:30 會推送風險摘要。
11. staff 不能看到未授權案件。
12. LINE 額度不足時，網站能查到失敗原因。
13. npm run typecheck 通過。
14. npm run build 通過。

