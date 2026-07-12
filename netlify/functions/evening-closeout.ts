const handler = async () => {
  const result = {
    ok: true,
    sent: 0,
    failed: 0,
    reason: "Evening closeout reminder is disabled. Morning summary remains active."
  };
  console.log("Evening LINE closeout skipped", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;
