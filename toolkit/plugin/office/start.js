#!/usr/bin/env node
// Starts the office if it isn't running and prints its URL. Used by /devcrew:office.
const { ensureServer } = require('./lib/client');
const config = require('./lib/config');

ensureServer({ waitMs: 3000 }).then((running) => {
  if (running) {
    console.log(`devcrew office is running: ${config.officeUrl()}`);
  } else {
    console.log(`devcrew office could not start on port ${config.port()}. Another program may be using it; set DEVCREW_OFFICE_PORT to another port.`);
    process.exitCode = 1;
  }
});
