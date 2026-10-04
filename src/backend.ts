declare const spindle: any

type Msg = { role: string; content: unknown; name?: string }
type Pending = {
  messages: Msg[]
  connectionId?: string
  characterId?: string
  abort: AbortController
  spare?: Promise<string | null>
}

const TYPES = new Set(['normal', 'regenerate', 'swipe'])
const pending = new Map<string, Pending>()

// Runs last so the spare request sees the exact messages vLLM receives;
// an identical prompt is what lets it reuse the prefix cache.
spindle.registerInterceptor(async (messages: Msg[], ctx: any) => {
  if (TYPES.has(ctx?.generationType) && ctx?.chatId) {
    pending.get(ctx.chatId)?.abort.abort()
    pending.set(ctx.chatId, {
      messages: messages.map(({ role, content, name }) => ({ role, content, ...(name ? { name } : {}) })),
      connectionId: ctx.connectionId,
      abort: new AbortController(),
    })
  }
  return messages
}, 100000)

spindle.on('GENERATION_STARTED', (p: any) => {
  const s = pending.get(p.chatId)
  if (s) s.characterId = p.characterId
})

// The first streamed token means the main prompt has been prefilled and
// cached, so starting the spare now avoids a second full prefill.
spindle.on('STREAM_TOKEN_RECEIVED', (p: any) => {
  const s = pending.get(p.chatId)
  if (!s || s.spare) return
  s.spare = spindle.generate
    .quiet({ messages: s.messages, connection_id: s.connectionId, signal: s.abort.signal })
    .then((r: any) => (r?.content?.trim() ? r.content : null))
    .catch((e: any) => {
      if (e?.name !== 'AbortError') spindle.log.warn(`spare generation failed: ${e?.message ?? e}`)
      return null
    })
})

spindle.on('GENERATION_STOPPED', (p: any) => {
  pending.get(p.chatId)?.abort.abort()
  pending.delete(p.chatId)
})

spindle.on('GENERATION_ENDED', async (p: any) => {
  const s = pending.get(p.chatId)
  if (!s) return
  pending.delete(p.chatId)
  if (p.error || !p.messageId || !s.spare) return s.abort.abort()

  const text = await s.spare
  if (!text) return
  const content = await applyResponseRegex(text, p.chatId, s.characterId)

  const msg = (await spindle.chat.getMessages(p.chatId)).find((m: any) => m.id === p.messageId)
  if (!msg) return
  // Omitting swipe_id keeps the streamed reply as the active swipe.
  await spindle.chat.updateMessage(p.chatId, p.messageId, { swipes: [...msg.swipes, content] })
})

// The host applies response-target regexes only on its own generation path,
// so the spare has to get them here.
async function applyResponseRegex(text: string, chatId: string, characterId?: string) {
  const scripts = await spindle.regex_scripts.getActive({ target: 'response', chatId, characterId })
  for (const s of scripts) {
    if (!s.placement.includes('ai_output')) continue
    // ponytail: plain find/replace only; macro and match-action scripts are skipped, port them if one gets enabled.
    if (s.substitute_macros !== 'none' || s.metadata?.match_actions?.length) {
      spindle.log.warn(`spare swipe skipped regex "${s.name}": macros/actions unsupported`)
      continue
    }
    try {
      text = text.replace(new RegExp(s.find_regex, s.flags), s.replace_string)
      for (const t of s.trim_strings ?? []) text = text.split(t).join('')
    } catch (e: any) {
      spindle.log.warn(`spare swipe regex "${s.name}" failed: ${e?.message ?? e}`)
    }
  }
  return text
}

spindle.log.info('Spare Swipe loaded')
