import type { Config } from "@netlify/functions";
import { sendDailyAdminReminder } from "../../src/services/dailyReminder";

const handler = async () => {
  const result = await sendDailyAdminReminder();
  console.log("Daily LINE reminder result", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;

export const config: Config = {
  schedule: "0 1 * * *"
};
