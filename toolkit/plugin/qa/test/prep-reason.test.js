const test = require('node:test');
const assert = require('node:assert/strict');
const { prepReasonOf, withoutTag } = require('../lib/prep-reason');

test("Claude's reason tag wins, and is removed from the message", () => {
  assert.equal(prepReasonOf('No passing test was saved. Claude said: NEEDS DATA: staging has no properties.'), 'data');
  assert.equal(prepReasonOf('Claude said: BLOCKED: a captcha stops the login.'), 'blocked');
  assert.equal(prepReasonOf('Claude said: DIFFERENT: there is no Export button.'), 'different');
  assert.equal(prepReasonOf('Claude said: UNCLEAR: which page?'), 'unclear');
  assert.equal(withoutTag('Claude said: NEEDS DATA: staging has no properties.'), 'Claude said: staging has no properties.');
});

test('messages without a tag are matched on their words', () => {
  assert.equal(prepReasonOf('Preparing took longer than 6 minutes and was stopped.'), 'timeout');
  assert.equal(prepReasonOf('Claude Code is not installed or not on PATH on this computer.'), 'setup');
  assert.equal(prepReasonOf('There is no test account for Staging. Add one, then run again.'), 'setup');
  assert.equal(prepReasonOf("Claude said: I didn't save a test because a Cloudflare Turnstile check blocks the form."), 'blocked');
  assert.equal(prepReasonOf("Claude said: I didn't save a test. Staging has no properties to edit."), 'data');
  assert.equal(prepReasonOf("Claude said: I checked the listing pages: Dg1 has 0 properties."), 'data');
  assert.equal(prepReasonOf("Claude said: I couldn't make this test pass."), 'other');
  assert.equal(prepReasonOf(''), 'other');
});
