/**
 * VoiceCommandInterpreter — pure domain service.
 * Takes transcription + language + roster and returns structured interpretation.
 * No I/O, no framework imports.
 */
import { VoiceIntentAction, RosterEntry, SupportedLanguageCode } from './voice.types';
import { SupportedLanguageVO } from './value-objects/supported-language.vo';
import { VoiceIntentVO } from './value-objects/voice-intent.vo';
import { getPatternsForLanguage } from './intent-patterns';

// Honorifics to strip before name matching (common in Indian languages)
const HONORIFIC_PATTERNS = [
  /\bji\b/gi,
  /\bजी\b/g,
  /\bsir\b/gi,
  /\bmadam\b/gi,
  /\bma'am\b/gi,
  /\bshree\b/gi,
  /\bshri\b/gi,
  /\bsmt\b\.?/gi,
  /\bdr\b\.?/gi,
];

function stripHonorifics(text: string): string {
  let result = text;
  for (const pattern of HONORIFIC_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance (normalized ratio 0..1, higher = more similar). */
function similarityRatio(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  const lenA = la.length;
  const lenB = lb.length;
  if (lenA === 0 && lenB === 0) return 1;
  if (lenA === 0 || lenB === 0) return 0;

  const dp: number[][] = Array.from({ length: lenA + 1 }, (_, i) =>
    Array.from({ length: lenB + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      if (la[i - 1] === lb[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  const distance = dp[lenA]![lenB]!;
  return 1 - distance / Math.max(lenA, lenB);
}

const FUZZY_THRESHOLD = 0.6;

export interface InterpreterOutput {
  intent: VoiceIntentVO;
  customerId?: bigint;
  candidates?: bigint[];
  matchConfidence: number; // 0-100 match-side confidence
}

export class VoiceCommandInterpreter {
  interpret(
    transcription: string,
    language: SupportedLanguageVO,
    roster: RosterEntry[]
  ): InterpreterOutput {
    const stripped = stripHonorifics(transcription);
    const patterns = getPatternsForLanguage(language.value);

    // 1. Detect action
    if (patterns.markAll.some((re) => re.test(stripped))) {
      return {
        intent: VoiceIntentVO.create({ action: VoiceIntentAction.MARK_ALL }),
        matchConfidence: 95,
      };
    }

    // 2. Extract quantity for ADJUST_QUANTITY
    let quantity: number | undefined;
    const qtyResult = this._tryExtractQuantity(stripped, patterns.adjustQuantity);
    if (qtyResult !== null) {
      quantity = qtyResult;
    }

    // 3. Determine action type
    const isDelivered = patterns.markDelivered.some((re) => re.test(stripped));
    const isLeave = patterns.markLeave.some((re) => re.test(stripped));
    const isAdjust = quantity !== undefined;

    let action = VoiceIntentAction.UNKNOWN;
    if (isAdjust) action = VoiceIntentAction.ADJUST_QUANTITY;
    else if (isDelivered) action = VoiceIntentAction.MARK_DELIVERED;
    else if (isLeave) action = VoiceIntentAction.MARK_LEAVE;

    if (action === VoiceIntentAction.UNKNOWN) {
      return {
        intent: VoiceIntentVO.unknown(),
        matchConfidence: 0,
      };
    }

    if (action === VoiceIntentAction.ADJUST_QUANTITY && quantity !== undefined) {
      // For adjust_quantity without a customer match, return UNKNOWN for non-English (future)
      if (language.value !== SupportedLanguageCode.EN) {
        return { intent: VoiceIntentVO.unknown(), matchConfidence: 0 };
      }
    }

    // 4. Fuzzy-match customer name from roster
    const nameResult = this._matchCustomerName(stripped, roster);

    if (nameResult.type === 'none') {
      // No name found — action needs a customer but none found
      if (action === VoiceIntentAction.MARK_DELIVERED || action === VoiceIntentAction.MARK_LEAVE) {
        return { intent: VoiceIntentVO.unknown(), matchConfidence: 0 };
      }
      // ADJUST_QUANTITY without customer name → unknown for now
      return { intent: VoiceIntentVO.unknown(), matchConfidence: 0 };
    }

    if (nameResult.type === 'ambiguous') {
      return {
        intent: VoiceIntentVO.create({ action, customerName: nameResult.spokenName }),
        candidates: nameResult.candidates,
        matchConfidence: 50,
      };
    }

    // Exact/strong match
    const matchConfidence = nameResult.ratio >= 0.9 ? 95 : 80;
    return {
      intent: VoiceIntentVO.create({
        action,
        customerName: nameResult.matchedName,
        ...(quantity !== undefined ? { quantity } : {}),
      }),
      customerId: nameResult.customerId,
      matchConfidence,
    };
  }

  private _tryExtractQuantity(text: string, patterns: RegExp[]): number | null {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) {
        const numStr = m[1];
        if (numStr) {
          const num = parseFloat(numStr);
          if (!isNaN(num) && num > 0) return num;
        }
      }
    }
    return null;
  }

  private _matchCustomerName(
    text: string,
    roster: RosterEntry[]
  ):
    | { type: 'none' }
    | { type: 'ambiguous'; spokenName: string; candidates: bigint[] }
    | { type: 'match'; customerId: bigint; matchedName: string; ratio: number } {
    if (roster.length === 0) return { type: 'none' };

    // Find all words/ngrams that might be a name (2+ chars, not stopwords)
    const words = text.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length === 0) return { type: 'none' };

    interface Match {
      entry: RosterEntry;
      ratio: number;
      segment: string;
    }
    const matches: Match[] = [];

    for (const entry of roster) {
      if (!entry.name) continue;
      // Try each word and bigram against the roster name
      for (let i = 0; i < words.length; i++) {
        const segments = [words[i]!, words.slice(i, i + 2).join(' ')];
        for (const seg of segments) {
          const ratio = similarityRatio(seg, entry.name);
          if (ratio >= FUZZY_THRESHOLD) {
            const existing = matches.find((m) => m.entry.id === entry.id);
            if (!existing || existing.ratio < ratio) {
              if (!existing) matches.push({ entry, ratio, segment: seg });
              else {
                existing.ratio = ratio;
                existing.segment = seg;
              }
            }
          }
        }
      }
    }

    if (matches.length === 0) return { type: 'none' };

    // Sort by ratio descending
    matches.sort((a, b) => b.ratio - a.ratio);

    const best = matches[0]!;
    const AMBIGUITY_RATIO_DIFF = 0.15;

    // Check for ties / near-ties → ambiguous
    const tied = matches.filter(
      (m) => Math.abs(m.ratio - best.ratio) <= AMBIGUITY_RATIO_DIFF && m.entry.id !== best.entry.id
    );

    if (tied.length > 0) {
      return {
        type: 'ambiguous',
        spokenName: best.segment,
        candidates: [best.entry.id, ...tied.map((t) => t.entry.id)],
      };
    }

    return {
      type: 'match',
      customerId: best.entry.id,
      matchedName: best.entry.name,
      ratio: best.ratio,
    };
  }
}
