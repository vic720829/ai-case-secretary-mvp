const handler = async () => {
  const result = {
    ok: true,
    sent: 0,
    failed: 0,
    reason: "Afternoon follow-up reminder is disabled. Morning summary and customer unanswered checks remain active."
  };
  console.log("Afternoon LINE follow-up skipped", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;
