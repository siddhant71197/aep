import type { CadenceState, ChatMessage } from './types';

export const SUGGEST_EVERY_N_USER_TURNS = 3;

/** The current (latest) user message must already be included in `messages`. */
export function computeCadence(messages: Pick<ChatMessage, 'role' | 'suggestions'>[]): CadenceState {
  let userTurn = 0;
  let turnsSinceLastSuggestion = 0;
  for (const m of messages) {
    if (m.role === 'user') {
      userTurn++;
      turnsSinceLastSuggestion++;
    } else if (m.role === 'assistant' && (m.suggestions?.length ?? 0) > 0) {
      turnsSinceLastSuggestion = 0;
    }
  }
  return {
    userTurn,
    turnsSinceLastSuggestion,
    mustSuggest: turnsSinceLastSuggestion >= SUGGEST_EVERY_N_USER_TURNS,
  };
}
