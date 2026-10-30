// Why a case could not be learned, so the QA page can group those cases and say what to do about each group.
// Claude starts its answer with a tag (prepare.js RULES); cases learned before the tags existed are matched on
// their words instead.
const TAGS = { 'NEEDS DATA': 'data', BLOCKED: 'blocked', DIFFERENT: 'different', UNCLEAR: 'unclear' };
const TAG_PATTERN = /\b(NEEDS DATA|BLOCKED|DIFFERENT|UNCLEAR):\s*/;
const REASONS = ['data', 'blocked', 'different', 'unclear', 'timeout', 'setup', 'other'];

function prepReasonOf(message) {
  const text = String(message || '');
  const tagged = text.match(TAG_PATTERN);
  if (tagged) return TAGS[tagged[1]];
  if (/^Preparing took longer than/.test(text)) return 'timeout';
  if (/^(?:Claude Code (?:is not installed|could not start|stopped with an error)|The QA browser tools|There is no test account|Preparing failed)/.test(text)) return 'setup';
  if (/captcha|turnstile|\botp\b|verification code|email inbox|\bsms\b/i.test(text)) return 'blocked';
  if (/\bno (?:data|records?|propert|listings?|leads?|results?)|has no |have no |there (?:are|is) no |\b0 (?:propert|records?|listings?)|is empty|are empty/i.test(text)) return 'data';
  return 'other';
}

/** The message without Claude's reason tag. */
const withoutTag = (text) => String(text || '').replace(TAG_PATTERN, '');

module.exports = { prepReasonOf, withoutTag, REASONS };
