import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "rename_current_session",
    label: "Rename current session",
    description: "Set the display name of this Pi session. Use when the user requests a name or a task workflow requires one.",
    parameters: Type.Object({
      name: Type.String({ description: "Session name, such as 🧪 Rex Loop 测试", minLength: 1, maxLength: 120 }),
    }),
    async execute(_id, { name }) {
      const trimmed = name.trim();
      if (!trimmed || /[\r\n\x00-\x1f\x7f]/.test(trimmed)) throw new Error("Name must be a non-empty single line.");
      pi.setSessionName(trimmed);
      return { content: [{ type: "text", text: `Session name set: ${pi.getSessionName()}` }], details: {} };
    },
  });
}
