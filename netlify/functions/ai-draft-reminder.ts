import type { Config } from "@netlify/functions";
import { sendPendingAiDraftReviewReminders } from "../../src/services/aiDraftReminder";

const handler = async () => {
  const result = await sendPendingAiDraftReviewReminders();
  console.log("Pending AI draft reminder result", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;

export const config: Config = {
  schedule: "*/10 * * * *"
};
