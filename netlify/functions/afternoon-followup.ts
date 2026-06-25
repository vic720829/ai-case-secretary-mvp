import type { Config } from "@netlify/functions";
import { sendAfternoonFollowupReminder } from "../../src/services/workflowReminders";

const handler = async () => {
  const result = await sendAfternoonFollowupReminder();
  console.log("Afternoon LINE follow-up result", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;

export const config: Config = {
  schedule: "0 6 * * *"
};
