/**
 * intent-patterns.ts — per-language regex tables for voice intent matching.
 * Falls back to EN patterns for unimplemented languages.
 * Pure domain, no framework imports.
 */

export interface IntentPatterns {
  markDelivered: RegExp[];
  markLeave: RegExp[];
  markAll: RegExp[];
  adjustQuantity: RegExp[];
}

const EN_PATTERNS: IntentPatterns = {
  markDelivered: [
    /\bdelivered?\b/i,
    /\bgave?\b/i,
    /\bdone\b/i,
    /\bmark(ed)? delivered?\b/i,
    /\bsupply(ied)?\b/i,
  ],
  markLeave: [
    /\bno delivery\b/i,
    /\bleave\b/i,
    /\babsent\b/i,
    /\bskip\b/i,
    /\bnot today\b/i,
    /\bmark(ed)? leave\b/i,
  ],
  markAll: [/\ball delivered?\b/i, /\beveryone delivered?\b/i, /\bmark all\b/i, /\ball done\b/i],
  adjustQuantity: [
    /\b(change|adjust|update|set)\s+(quantity|amount|qty)\b/i,
    /\b(\d+(?:\.\d+)?)\s*(litre|liter|l|ml|kg|g|unit)s?\b/i,
  ],
};

const HI_PATTERNS: IntentPatterns = {
  markDelivered: [
    // "दे दिया" (gave/delivered), "दूध दिया" (gave milk), "पहुंचा दिया"
    /दे\s*दिया/i,
    /दिया/i,
    /पहुंचा/i,
    /deliver\s*कर\s*दिया/i,
    /मिल\s*गया/i,
  ],
  markLeave: [/छुट्टी/i, /नहीं\s*देना/i, /नहीं\s*दिया/i, /leave/i, /absent/i, /बंद/i],
  markAll: [/सबको\s*दे\s*दिया/i, /सभी\s*को/i, /सब\s*deliver/i, /सब\s*हो\s*गया/i, /all\s*deliver/i],
  adjustQuantity: [/(\d+(?:\.\d+)?)\s*(लीटर|लिटर|किलो|ग्राम|kg|g|l|ml)/i, /quantity\s*change/i],
};

const TA_PATTERNS: IntentPatterns = {
  markDelivered: [/கொடுத்தேன்/i, /வழங்கினேன்/i, /delivered/i, /போட்டேன்/i],
  markLeave: [/விடுமுறை/i, /இல்லை/i, /leave/i, /absent/i],
  markAll: [/அனைவருக்கும்/i, /எல்லோருக்கும்/i, /all\s*deliver/i],
  adjustQuantity: [/(\d+(?:\.\d+)?)\s*(லிட்டர்|கிலோ|கி\.கி|ml|l|kg|g)/i],
};

/** Returns the pattern set for a language code, falling back to EN. */
export function getPatternsForLanguage(langCode: string): IntentPatterns {
  const upper = langCode.toUpperCase();
  switch (upper) {
    case 'HI':
      return HI_PATTERNS;
    case 'TA':
      return TA_PATTERNS;
    default:
      return EN_PATTERNS;
  }
}
