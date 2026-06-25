import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isDateOverdue, todayInputValue } from "@/lib/date";

export function shouldAnswerLineQuestion(text: string) {
  return /(今天|明天|有哪些|什麼事情|有什麼|風險|款項|發票|做到哪裡|做到哪|忘記)/.test(text);
}

export async function answerQuestionFromFirestore(question: string, projectId = "") {
  const db = getAdminDb();
  const today = todayInputValue();
  const tomorrowDate = new Date(`${today}T00:00:00+08:00`);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = [
    tomorrowDate.getFullYear(),
    String(tomorrowDate.getMonth() + 1).padStart(2, "0"),
    String(tomorrowDate.getDate()).padStart(2, "0")
  ].join("-");

  if (/明天/.test(question)) {
    return summarizeDueItems(db, tomorrow, projectId, "明天");
  }

  if (/今天/.test(question)) {
    return summarizeDueItems(db, today, projectId, "今天");
  }

  if (/款項|收款|請款|尾款|付款/.test(question)) {
    return summarizeAiTasks("payment", projectId, "款項");
  }

  if (/發票|統編|報帳/.test(question)) {
    return summarizeAiTasks("invoice", projectId, "發票");
  }

  if (/風險|忘記/.test(question)) {
    return summarizeRisks(projectId);
  }

  return "我目前可以查今天/明天待辦、風險案件、收款事項與發票事項。";
}

async function summarizeDueItems(db: FirebaseFirestore.Firestore, date: string, projectId: string, label: string) {
  const [taskSnapshot, milestoneSnapshot] = await Promise.all([
    db.collection("tasks").where("dueDate", "==", date).get(),
    db.collection("milestones").where("dueDate", "==", date).get()
  ]);

  const taskLines = taskSnapshot.docs
    .map((doc) => doc.data())
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => task.status !== "done")
    .map((task) => `任務：${task.title}`);
  const milestoneLines = milestoneSnapshot.docs
    .map((doc) => doc.data())
    .filter((milestone) => !projectId || milestone.projectId === projectId)
    .filter((milestone) => !milestone.completed)
    .map((milestone) => `節點：${milestone.title}`);

  const lines = [...taskLines, ...milestoneLines];
  return lines.length ? `${label}待辦：\n${lines.join("\n")}` : `${label}目前沒有到期事項。`;
}

async function summarizeAiTasks(taskType: string, projectId: string, label: string) {
  const db = getAdminDb();
  const snapshot = await db.collection("ai_tasks").where("taskType", "==", taskType).get();
  const lines = snapshot.docs
    .map((doc) => doc.data())
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => task.reviewStatus === "approved")
    .filter((task) => task.status !== "done")
    .map((task) => `${task.title}`);

  return lines.length ? `${label}待處理：\n${lines.join("\n")}` : `目前沒有待處理的${label}事項。`;
}

async function summarizeRisks(projectId: string) {
  const db = getAdminDb();
  const [taskSnapshot, milestoneSnapshot, aiTaskSnapshot] = await Promise.all([
    db.collection("tasks").get(),
    db.collection("milestones").get(),
    db.collection("ai_tasks").get()
  ]);

  const taskLines = taskSnapshot.docs
    .map((doc) => doc.data())
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => task.status !== "done" && (task.riskLevel === "high" || isDateOverdue(task.dueDate)))
    .map((task) => `任務：${task.title}`);
  const milestoneLines = milestoneSnapshot.docs
    .map((doc) => doc.data())
    .filter((milestone) => !projectId || milestone.projectId === projectId)
    .filter((milestone) => !milestone.completed && (milestone.riskLevel === "high" || isDateOverdue(milestone.dueDate)))
    .map((milestone) => `節點：${milestone.title}`);
  const aiTaskLines = aiTaskSnapshot.docs
    .map((doc) => doc.data())
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => task.reviewStatus === "approved")
    .filter((task) => task.status !== "done" && isAiTaskOverdue(task.dueDate))
    .map((task) => `AI任務：${task.title}`);

  const lines = [...taskLines, ...milestoneLines, ...aiTaskLines];
  return lines.length ? `目前風險摘要：\n${lines.join("\n")}` : "目前沒有明顯風險。";
}

function isAiTaskOverdue(value: unknown) {
  if (value instanceof Timestamp) {
    return isDateOverdue(value.toDate().toISOString().slice(0, 10));
  }

  return false;
}
