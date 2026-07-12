import type { Config } from "@netlify/functions";
import { sendCustomerUnansweredReminders } from "../../src/services/customerUnansweredReminder";

const handler = async () => {
  const result = await sendCustomerUnansweredReminders();
  console.log("Customer unanswered LINE reminder result", result);

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
