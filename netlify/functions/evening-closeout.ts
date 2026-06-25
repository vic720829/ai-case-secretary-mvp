import type { Config } from "@netlify/functions";
import { sendEveningCloseoutReminder } from "../../src/services/workflowReminders";

const handler = async () => {
  const result = await sendEveningCloseoutReminder();
  console.log("Evening LINE closeout result", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;

export const config: Config = {
  schedule: "30 10 * * *"
};
