# LINE AI 案件風險管理機器人邏輯設定書 v1.4

> 本文件是機器人行為的總設定書。  
> 目的不是立刻重寫程式，而是先把規則、邏輯、通知、審核、學習與限制整理成唯一依據。  
> 之後任何 LINE webhook、AI 判斷、提醒、網站功能修改，都必須符合本文件。

---

## 1. 系統定位

本系統是給室內設計、裝修工程、工務管理公司使用的 LINE AI 案件風險管理機器人。

它不是客服機器人，也不是聊天機器人。它的核心任務是：

1. 防止客戶訊息漏回。
2. 防止公司承諾沒有追蹤。
3. 防止客戶變更沒有留下紀錄。
4. 防止缺失、客訴、修補、品質問題被忽略。
5. 防止請款、付款、發票、對帳遺漏。
6. 防止工期、進場、關鍵節點逾期。
7. 防止同一件事被 AI 重複建立多筆草稿、待辦、提醒。
8. 防止員工看到不屬於自己的案件資料。
9. 所有 AI 判斷必須可追溯、可審核、可修正。

核心定位一句話：

> 這個機器人是「客戶群風險監聽器 + 公司後台案件秘書 + 事件追蹤系統」，不是客戶群聊天機器人。

---

## 2. 最高指導原則

以下原則不可被任何功能、AI 學習規則、使用者設定覆蓋。

| 原則 | 說明 |
|---|---|
| 客戶群完全不能回覆 | 不文字、不按鈕、不錯誤訊息、不說不能回、不自我介紹。客戶群只能監聽、記錄、分析。 |
| 公司後台群才互動 | 只有後台群可以問問題、收提醒、按按鈕、查案件。 |
| 網站是正式後台 | LINE 是提醒與快速操作；案件、待辦、審核、附件、備忘錄、紀錄以網站為準。 |
| AI 不直接建立正式任務 | AI 只能建立待審草稿，人核准後才建立正式待辦。 |
| Owner 掌握 AI 學習方向 | AI 可以提出建議，但不能自己改規則。只有 owner 可以啟用、停用、修改 AI 規則。 |
| 重要才推 LINE | LINE 額度有限，只推高價值事件；網站手動新增待辦、網站核准草稿不推 LINE。 |
| 所有判斷要可追溯 | 每個草稿、事件、提醒都要能回查來源訊息、圖片、審核人、處理狀態。 |
| 同一件事要合併追蹤 | 同一案件、同一事件、同一時間脈絡，不應重複建立多筆草稿。 |

---

## 3. LINE 群組類型

### 3.1 客戶案件群組 project group

這是公司、客戶、廠商一起溝通的案件群。

規則：

- AI 完全不能在客戶群回覆。
- AI 不能在客戶群出現任何按鈕。
- AI 不能在客戶群顯示錯誤訊息。
- AI 只能記錄訊息。
- AI 可以分析風險。
- 低干擾模式下，一般對話不建立待審草稿、不建立正式待辦。
- AI 只針對「內部人員做出明確時間承諾」建立承諾追蹤提醒。
- AI 可以把重要提醒推送到公司後台群。
- 客戶群的任何錯誤，都只能記錄到系統，不可回到客戶群。

### 3.2 公司後台群組 admin group

這是公司內部使用的 LINE 後台群。

規則：

- AI 可以在這裡發提醒。
- AI 可以在這裡顯示每日摘要。
- AI 可以在這裡回覆查詢指令。
- AI 可以在這裡顯示草稿審核按鈕。
- AI 可以在這裡處理「已回覆、已處理、明天追蹤、通過、拒絕」等快速操作。

### 3.3 未綁定群組

規則：

- 可記錄 groupId。
- 不建立 AI 草稿。
- 不回覆客戶群。
- 可通知主要後台群：發現未綁定 LINE 群組。
- 必須由網站人工綁定成 project group 或 admin group 後，才啟用正式流程。

---

## 4. 後台群通知分層

為了節省 LINE 額度，同時確保重大風險不漏掉，後台群必須分層。

| notificationLevel | 類型 | 用途 | 即時推播 | 每日摘要 | 主動查詢 |
|---|---|---|---:|---:|---:|
| primary | 主要後台群 | 老闆、核心管理群 | high / critical | 是 | 是 |
| secondary | 一般後台群 | 設計師、助理、工務群 | critical | 是 | 是 |
| critical_only | 重大風險群 | 現場處理、維修、工務緊急群 | critical | 否 | 是 |
| test | 測試群 | 測試指令、測試按鈕 | 否 | 否 | 是 |
| none | 停用 | 不接正式通知 | 否 | 否 | 否 |

### 4.1 推播規則

| 事件 | primary | secondary | critical_only | test | none |
|---|---:|---:|---:|---:|---:|
| critical 重大風險 | 立即推 | 立即推 | 立即推 | 不推 | 不推 |
| high 高風險 | 立即推 | 不推 | 不推 | 不推 | 不推 |
| medium 一般草稿 | 每日摘要 | 每日摘要 | 不推 | 不推 | 不推 |
| low 低風險 | 不推 | 不推 | 不推 | 不推 | 不推 |
| 每日 8:30 摘要 | 推 | 推 | 不推 | 不推 | 不推 |
| 使用者主動查詢 | 可回 | 可回 | 可回 | 可回 | 不回 |
| 網站新增待辦 | 不推 | 不推 | 不推 | 不推 | 不推 |
| 網站核准 AI 草稿 | 不推 | 不推 | 不推 | 不推 | 不推 |

### 4.2 critical 定義

以下事件必須視為 critical，並通知所有啟用的後台通知群：

- 缺失
- 修補
- 客訴
- 很爛
- 品質不好
- 漏水
- 裂縫
- 客戶明顯不滿
- 取消案件
- 停工
- 嚴重延期
- 現場重大安全或責任風險

---

## 5. LINE 發話者身份

| senderRole | 說明 |
|---|---|
| internal | 公司內部人員，例如老闆、設計師、助理、工務。 |
| client | 客戶、業主、客戶窗口。 |
| vendor | 廠商，例如木工、水電、油漆、系統櫃。 |
| unknown | 尚未設定身份的人。 |

規則：

1. unknown 不可以被當成 internal。
2. unknown 在客戶案件群中預設視為外部風險來源。
3. unknown 發話不可用來判定「公司已回覆客戶」。
4. 只有 senderRole = internal 的訊息，才能算作公司回覆。

---

## 6. 核心資料模型

### 6.1 messages

LINE 進來的所有訊息都必須先存 messages。

```ts
messages {
  id: string
  projectId: string
  groupId: string
  lineMessageId: string
  senderId: string
  senderName: string
  senderRole: "internal" | "client" | "vendor" | "unknown"
  messageType: "text" | "image" | "audio" | "file"
  text: string
  fileUrl?: string
  incidentId?: string | null
  timestamp: Timestamp
  isProcessed: boolean
  createdAt: Timestamp
}
```

規則：

- 文字、圖片、語音、檔案都要存。
- 圖片或語音如果沒有文字，text 可用「客戶傳送圖片」「客戶傳送語音」。
- 圖片與語音不可被忽略。
- messages 是所有後續 AI 草稿、事件、提醒、附件的來源。

### 6.2 ai_tasks

AI 建立的待審草稿，不是正式待辦。

```ts
ai_tasks {
  id: string
  projectId: string
  incidentId?: string
  sourceMessageId: string
  sourceGroupId: string
  sourceSenderId: string
  sourceSenderName: string
  sourceSenderRole: "internal" | "client" | "vendor" | "unknown"

  title: string
  description: string
  taskType:
    | "promise"
    | "change"
    | "followup"
    | "payment"
    | "invoice"
    | "complaint"
    | "schedule"
    | "file"
  riskLevel: "low" | "medium" | "high" | "critical"

  status: "todo" | "doing" | "done"
  assignedTo?: string
  dueDate?: Timestamp | null

  createdByAI: true
  reviewStatus: "pending" | "approved" | "rejected"
  approvedTaskId?: string
  mergedMessageCount?: number

  adminNotifiedAt?: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### 6.3 tasks

正式待辦。

```ts
tasks {
  id: string
  projectId: string
  title: string
  description: string
  assignee: string
  dueDate: string
  status: "todo" | "doing" | "done"
  source: "manual" | "ai" | "line"
  riskLevel: "low" | "medium" | "high" | "critical"
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

規則：

- AI 草稿核准後才建立 tasks。
- 使用者可在網站手動建立 tasks。
- 網站手動建立待辦不推 LINE。
- 網站核准 AI 草稿建立正式待辦不再推 LINE，避免重複通知。

### 6.4 project_memos

案件備忘錄是正式案件紀錄，給人看，不等於 AI 記憶。

用途：

- 記錄客戶答應過的變更。
- 記錄公司答應過但待辦已完成的事項。
- 記錄尺寸、材質、顏色、做法、現場決議。
- 從待辦轉入，或人工手動新增。

規則：

- 備忘錄不是提醒。
- 備忘錄不是待辦。
- 備忘錄不會自動推 LINE。
- 備忘錄可作為日後 AI 回答案件脈絡的參考來源，但不能覆蓋原始訊息。

---

## 7. Incident Engine 事件中心

### 7.1 設計目的

Incident Engine 用來避免同一件事被 AI 重複建立多筆草稿、待辦、提醒。

例如：

1. 客戶：「我的工期表呢？」
2. 設計師：「明天給您。」
3. 客戶隔天：「還沒收到。」

這三句應該被視為同一個「工期表追蹤事件」，不是三個互不相關的待辦。

### 7.2 incidents collection

```ts
incidents {
  id: string
  projectId: string
  title: string

  incidentType:
    | "followup"
    | "change"
    | "payment"
    | "invoice"
    | "complaint"
    | "schedule"
    | "file"

  status: "open" | "watching" | "resolved" | "closed"
  priority: "low" | "medium" | "high" | "critical"

  sourcePlatform: "line" | "website" | "email" | "ocr" | "voice" | "calendar" | "sketchup"
  sourceType: "text" | "image" | "audio" | "file" | "pdf"

  messageCount: number
  firstMessageId: string
  latestMessageId: string
  latestActivityAt: Timestamp

  linkedAiTaskId?: string | null
  linkedTaskId?: string | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### 7.3 合併規則

新訊息進來時，系統嘗試找到既有 incident。

必須同時符合：

1. 同 projectId。
2. 同 groupId 或同案件相關群組。
3. 同 incidentType。
4. 事件狀態是 open 或 watching。
5. 符合時間窗口。
6. 語意上是同一件事。

預設時間窗口：

| incidentType | 合併時間窗口 |
|---|---:|
| followup | 48 小時 |
| promise | 48 小時 |
| change | 7 天 |
| complaint | 14 天，或直到人工關閉 |
| schedule | 7 天 |
| payment | 14 天 |
| invoice | 14 天 |
| file | 7 天 |

### 7.4 合併後行為

如果符合既有 incident：

- 不建立新的重複 AI 草稿。
- 更新 incident.messageCount。
- 更新 incident.latestMessageId。
- 更新 incident.latestActivityAt。
- 必要時更新 linkedAiTaskId 的描述。
- 如果風險升級，更新 priority。
- 如果原本已提醒過，不重複推相同內容；只在風險升級或超時未處理時再提醒。

如果找不到既有 incident：

- 建立新 incident。
- 依風險判斷是否建立 ai_tasks pending 草稿。
- 依通知規則推送後台。

### 7.5 導入方式

Incident Engine 必須分階段導入：

1. Shadow mode：只建立 incidents，不影響現有 AI 草稿流程。
2. 觀察合併準確度。
3. 確認穩定後，才讓 Incident 控制 AI 草稿去重。
4. 最後才讓 Incident 控制提醒頻率。

不得一次重寫 LINE webhook 核心流程。

---

## 8. 客戶訊息未回覆追蹤

這是核心功能，不可以只依賴 AI 是否有建立草稿。

### 8.1 掃描邏輯

1. 掃描 project group 的 messages。
2. 只看 senderRole = client 或 unknown 的訊息。
3. 圖片、語音、檔案也納入。
4. 找出每個案件群最後一則外部訊息。
5. 檢查該訊息之後是否有 senderRole = internal 的訊息。
6. 如果沒有 internal 回覆，進入未回覆追蹤。

### 8.2 時間規則

| 情境 | 行為 |
|---|---|
| 09:00-21:00 收到客戶訊息 | 超過 3 小時沒有 internal 回覆，推送後台提醒。 |
| 09:00 前收到客戶訊息 | 統一在 10:00 檢查；10:00 前仍沒有 internal 回覆才提醒。 |
| 21:00 後收到客戶訊息 | 隔天 10:00 檢查；仍沒有 internal 回覆才提醒。 |
| 同一案件同類未回覆提醒 | 60 分鐘冷卻，避免連續洗版。 |
| 圖片或語音訊息 | 先存入 messages；未回覆提醒以同一案件群是否有 internal 回覆判斷。 |

### 8.3 提醒內容

提醒需包含：

- 案件名稱
- 客戶名稱
- 發話者
- 訊息摘要
- 訊息時間
- 已等待多久
- 打開網站連結
- 已回覆按鈕
- 明天追蹤按鈕

### 8.4 已回覆與已處理

如果後續有 internal 回覆：

- 系統可標記為 maybe_answered。
- 但不可自動判定事情完成。
- 如果回覆內容包含承諾，例如「明天給您」，應建立或更新 promise incident。

如果員工按「已回覆」：

- reminder_logs.status = confirmed。
- 記錄 confirmedBy、confirmedAt。
- 同一提醒不再重複推送。

---

## 9. AI 草稿建立規則

### 9.0 低干擾模式

目前正式規則：

1. 客戶群一般對話不再自動建立 AI 草稿。
2. 客戶群一般對話不再自動建立正式待辦。
3. 客戶訊息是否需要提醒，改由「3 小時未回覆追蹤」處理。
4. 只有 internal 發話且內容包含明確時間承諾時，建立「承諾追蹤」提醒。
5. 承諾追蹤不是正式待辦，也不是待審草稿；它是提醒中心項目。
6. 若日後要恢復特定類型 AI 草稿，必須由 owner 在規則中明確啟用。

### 9.1 AI 草稿類型

以下是可保留的語意分類，用於事件中心、摘要、未來人工啟用規則；低干擾模式下不代表一定建立待審草稿。

| 類型 | 條件 | taskType | 預設風險 |
|---|---|---|---|
| 公司承諾 | 明天給、再確認、安排、回覆、提供、傳圖、給工期表 | promise | medium |
| 客戶追問 | 工期表呢、報價呢、有處理嗎、什麼時候 | followup | medium |
| 客戶變更 | 改、變更、新增、不做、取消、尺寸、顏色、材質 | change | high |
| 客訴 / 缺失 | 缺失、修補、很爛、品質不好、漏水、裂縫、不滿意 | complaint | critical |
| 請款 | 請款、付款、訂金、二期款、尾款、對帳 | payment | high |
| 發票 | 發票、統編、抬頭、收據、報帳 | invoice | high |
| 工期 | 進場、退場、延期、改期、沒來、趕工 | schedule | high |
| 圖面 / 檔案 | 圖面、施工圖、CAD、報價單、工程表、合約 | file | medium |

### 9.2 圖片與前後文

圖片處理規則：

1. 圖片訊息必須存 messages。
2. 同一發話者在 10 分鐘內連續傳多張圖片，視為同一圖片組。
3. 圖片前後 10 分鐘內的文字，要與圖片一起送入 AI 判斷。
4. 如果文字出現缺失、修補、品質不好、漏水等 critical 關鍵字，圖片組必須合併到 complaint incident。
5. 正式待辦列表不直接塞大圖，只顯示「有附件 / 幾張照片」。
6. 大圖應放在 LINE 訊息中心、LINE 附件中心、待辦詳情。
7. 圖片本身若未做 OCR，不可假裝已看懂圖片內容。

### 9.3 AI 不確定時

如果 AI 不確定是否要建立待辦：

- 可建立低或中風險待審草稿。
- 標題需明確寫「待確認」。
- 不可直接建立正式待辦。
- 不可直接推送所有後台群，除非含 critical 關鍵字。

---

## 10. AI 草稿審核

所有 ai_tasks 必須先進入 pending。

### 10.1 LINE 後台通知格式

```text
AI 發現案件風險

案件：{projectName}
發話者：{senderName} / {senderRole}
類型：{taskType}
風險：{riskLevel}
標題：{title}
內容：{description}

請人工確認後再建立正式待辦。
```

### 10.2 按鈕

後台群可用按鈕：

- 通過建立待辦
- 拒絕草稿
- 已回覆
- 已處理
- 明天追蹤
- 延後 3 天
- 打開網站

### 10.3 多後台群同時操作

如果多個後台群收到同一筆草稿或提醒：

1. 第一個有效操作生效。
2. 後續其他人再按，系統需顯示「此項目已被處理」。
3. 不可重複建立正式待辦。
4. 不可因多個群組按鈕造成狀態互相覆蓋。
5. 所有操作寫入 audit_logs。

---

## 11. Project Memory AI 案件記憶

Project Memory 是 AI 使用的案件摘要，不等於案件備忘錄。

### 11.1 設計目的

避免 AI 每次都掃全部 LINE 歷史，並提升上下文理解。

### 11.2 project_memory

```ts
project_memory {
  projectId: string
  permanentMemory: string
  temporaryMemory: string
  summary: string
  lastSummarizedMessageId: string
  updatedAt: Timestamp
}
```

### 11.3 Permanent Memory

保存長期資訊：

- 客戶偏好
- 施工限制
- 地址
- 停車方式
- 預算
- 長期需求
- 特殊注意事項

### 11.4 Temporary Memory

保存近期資訊：

- 等待木工估價
- 等待圖面
- 等待請款
- 等待客戶確認
- 等待工期表
- 客訴尚未結案

### 11.5 限制

- Project Memory 不能覆蓋原始訊息。
- Project Memory 不能直接建立正式待辦。
- Owner 必須能查看、清除、鎖定重要記憶。
- AI 修改記憶需寫入 audit_logs。

---

## 12. AI 學習與規則建議

### 12.1 原則

AI 可以學習，但不能自己決定公司規則。

只有 owner 可以：

- 新增規則
- 修改規則
- 啟用規則
- 停用規則
- 核准 AI 建議規則

admin / staff 的操作可作為參考紀錄，但不能直接改變 AI 判斷。

### 12.2 ai_rule_suggestions

```ts
ai_rule_suggestions {
  id: string
  title: string
  description: string
  confidence: number
  basedOnCount: number
  examples: string[]
  suggestedRule: string
  status: "pending" | "approved" | "rejected"
  approvedRuleId?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

流程：

```text
AI 發現規律
→ 建立 rule suggestion
→ Owner 審核
→ 核准後建立或更新 ai_learning_rules
→ 後續 AI 判斷才可使用
```

### 12.3 不可學習的內容

AI 不可學習或改變：

1. 客戶群完全不能回覆。
2. AI 只能建立待審草稿。
3. unknown 不可當 internal。
4. critical 事件必須推送所有啟用後台通知群。
5. 權限不足者不可讀案件資料。
6. AI 不可自行核准草稿。
7. AI 不可自行關閉任務。

---

## 13. 後台群查詢指令

後台群可以問：

- 今天有什麼事情？
- 明天有什麼事情？
- 有哪些案件有風險？
- 有哪些客戶訊息還沒回？
- 有哪些待審草稿？
- 某案件工期表？
- 某案件今天做什麼工程？
- 某案件做到哪裡？
- 有哪些款項要收？
- 有哪些發票還沒開？
- 有缺失要處理的嗎？
- 有修補要處理的嗎？

規則：

- 只允許 admin group 回覆。
- project group 絕對不回覆。
- 查詢結果應列出內容，不只列出數量。
- 若查詢結果太多，先列前 5 筆並附網站連結。

---

## 14. 每日與定時提醒

### 14.1 早上 8:30 開工摘要

內容：

1. 客戶訊息未回覆。
2. 承諾追蹤。
3. 逾期承諾。
4. 今日到期待辦。
5. 已逾期待辦。
6. 今天進場工程。
7. 今天關鍵節點。
8. 高風險 / 重大風險。
9. 請款 / 發票提醒。
10. 昨日 LINE 對話摘要：使用前 7 天對話作為上下文，只整理昨天有新對話的案件；若昨天沒有新對話，不產生摘要。

### 14.2 客戶訊息未回覆檢查

規則：

1. 每 10 分鐘掃描一次。
2. 09:00-21:00 內，客戶訊息超過 3 小時沒有 internal 回覆才提醒。
3. 09:00 前或 21:00 後的訊息，統一隔天或當天 10:00 檢查。
4. 不依賴 AI 草稿是否建立。
5. 不在客戶群回覆。

### 14.3 已停用的舊推播

以下舊推播先停用，避免通知疲勞：

1. 下午 14:00 未回覆檢查。
2. 晚上 18:30 收尾提醒。
3. AI 草稿超過 30 分鐘未審核推播。

待 owner 重新確認規則後，才可以恢復。

---

## 15. 今日風險中心

今日風險中心的目的不是統計 AI 做了多少事，而是讓使用者知道現在要處理什麼。

### 15.1 顯示原則

只顯示可行動項目：

- 高風險案件
- 高風險待辦
- 已逾期待辦
- 今天到期待辦
- 待審草稿
- 超過 30 分鐘未審草稿
- 客戶訊息未回覆
- 關鍵節點預警
- 工期進場提醒
- 請款 / 發票提醒

### 15.2 不應顯示的統計

不應把以下項目放成主要卡片：

- AI 來源待辦數量
- AI 來源高風險待辦數量
- AI 來源逾期待辦數量

原因：使用者在乎「要做什麼」，不是 AI 建了多少。

---

## 16. 權限規則

### 16.1 owner

- 看全部案件。
- 管理員工。
- 管理 LINE 群組。
- 管理 AI 學習規則。
- 看 webhook 記錄。
- 看操作紀錄。

### 16.2 admin

- 看全部案件。
- 管理案件與待辦。
- 審核 AI 草稿。
- 不可管理 AI 學習規則。

### 16.3 staff

- 只能看被授權案件。
- 可處理自己負責的待辦。
- 可審核被授權案件的草稿。
- 不可看 webhook 記錄。
- 不可看操作紀錄。
- 不可管理 AI 學習規則。

### 16.4 viewer

- 只能讀取被授權案件。
- 不可修改。

---

## 17. 導入順序

為了避免弄壞目前可用的 LINE 流程，v1.4 必須分段導入。

### Phase 0：凍結最高原則

1. 保留客戶群完全不回覆。
2. 保留 line safety test。
3. 新增任何 LINE 功能前，必須先確認不會改到客戶群回覆規則。

### Phase 1：Incident Shadow Mode

1. 新增 incidents collection。
2. messages 可寫 incidentId。
3. LINE 訊息進來時，只建立或更新 incident。
4. 不影響現有 AI 草稿建立。
5. 做事件中心頁面讓 owner 檢查合併準確度。

### Phase 2：Incident 去重

1. 確認 shadow mode 穩定後，才讓 incident 影響 AI 草稿建立。
2. 同一事件不再重複建立新草稿。
3. 只更新既有草稿或既有事件。

### Phase 3：未回覆追蹤

1. 建立獨立的客戶訊息未回覆掃描。
2. 不依賴 AI 是否建立草稿。
3. 超過時間建立 reminder_logs。
4. critical 關鍵字立即通知。

### Phase 4：Project Memory

1. 建立 project_memory。
2. 只作為 AI 上下文。
3. Owner 可查看、清除、鎖定。

### Phase 5：AI Suggestion Pool

1. AI 只能提出規則建議。
2. Owner 核准後才生效。
3. 所有規則變更寫入 audit_logs。

---

## 18. 驗收標準

完成後必須符合：

1. 客戶群任何情況都不會收到 AI 回覆。
2. 後台群可以查詢案件、風險、工期、款項、發票。
3. 客戶訊息會存入 messages。
4. 圖片、語音、檔案不會被忽略。
5. 同一事件不會重複建立多筆 AI 草稿。
6. critical 事件會通知所有啟用後台群。
7. high 事件只通知主要後台群。
8. medium 事件進每日摘要或網站待審。
9. AI 草稿必須人工核准後才建立正式待辦。
10. 網站手動新增待辦不推 LINE。
11. 網站核准草稿不推 LINE。
12. 客戶訊息未回覆不依賴 AI 草稿，也能被掃描提醒。
13. Owner 可管理 AI 學習規則。
14. AI 不可自行修改規則。
15. 今日風險中心顯示的是可行動事項，不是 AI 統計。
16. 多後台群同時按鈕不會造成重複建立或狀態覆蓋。
17. 所有重要操作可在 audit_logs 回查。
18. `npm run typecheck` 通過。
19. `npm run build` 通過。
20. `npm run test:line-safety` 通過。

---

## 19. 本版結論

v1.4 的核心精神：

> 不再讓 AI 直接用單則訊息做零散判斷，而是先把訊息整理成事件，再由事件推動草稿、提醒、待辦與備忘錄。

但導入時必須保守：

1. 先記錄，不先改行為。
2. 先觀察，不先自動合併正式待辦。
3. 先保護客戶群不回覆，再做任何 AI 強化。
4. Owner 永遠掌握 AI 學習方向。
5. 網站永遠是正式後台。
