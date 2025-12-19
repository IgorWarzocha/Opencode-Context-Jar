// OpenCode client compatibility helpers
//
// The OpenCode SDK has had multiple shapes for session endpoints (v1-style
// {path, query, body} vs v2-style flat params). This module provides best-effort
// calls that work in either environment.

export type ModelRef = { providerID: string; modelID: string }

export async function sendIgnoredSessionText(input: {
  client: any
  sessionID: string
  directory?: string
  agent?: string
  model?: ModelRef
  text: string
}): Promise<boolean> {
  // Attempt v1-style SDK first (matches DCP plugin).
  try {
    await input.client.session.prompt({
      path: { id: input.sessionID },
      body: {
        noReply: true,
        agent: input.agent,
        model: input.model,
        parts: [
          {
            type: "text",
            text: input.text,
            ignored: true,
          },
        ],
      },
    })
    return true
  } catch {}

  // Fallback to v2-style flat parameters.
  try {
    await input.client.session.prompt({
      sessionID: input.sessionID,
      directory: input.directory,
      agent: input.agent,
      model: input.model,
      noReply: true,
      parts: [
        {
          type: "text",
          text: input.text,
          ignored: true,
        },
      ],
    })
    return true
  } catch {
    return false
  }
}

export async function getSessionDiff(input: {
  client: any
  sessionID: string
  directory?: string
}): Promise<Array<{ file: string }>> {
  // v1-style
  try {
    const resp = await input.client.session.diff({
      path: { id: input.sessionID },
      query: input.directory ? { directory: input.directory } : undefined,
    })
    if (Array.isArray(resp)) return resp
    if (Array.isArray((resp as any)?.data)) return (resp as any).data
  } catch {}

  // v2-style
  try {
    const resp = await input.client.session.diff({
      sessionID: input.sessionID,
      directory: input.directory,
    })
    if (Array.isArray(resp)) return resp
    if (Array.isArray((resp as any)?.data)) return (resp as any).data
  } catch {}

  return []
}
