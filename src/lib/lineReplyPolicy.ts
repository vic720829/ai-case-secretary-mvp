type LineReplyPolicyInput = {
  groupType?: string | null;
  allowAssistantReplies?: unknown;
  sourceType?: string | null;
};

export function canLineGroupUseAssistantReplies(input: Pick<LineReplyPolicyInput, "groupType" | "allowAssistantReplies">) {
  return input.groupType === "admin" && input.allowAssistantReplies !== false;
}

export function canReplyInLineChat(input: LineReplyPolicyInput) {
  return canLineGroupUseAssistantReplies(input) && (input.sourceType === "group" || input.sourceType === "room");
}
