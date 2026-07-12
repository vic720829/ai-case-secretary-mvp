const handler = async () => {
  const result = {
    ok: true,
    sent: 0,
    failed: 0,
    reason: "Pending AI draft reminder is disabled in low-noise LINE mode."
  };
  console.log("Pending AI draft reminder skipped", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default handler;
