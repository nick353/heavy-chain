import { spawn } from 'node:child_process';

const descendantOutputIndex = process.argv.indexOf('--descendant-output');
if (descendantOutputIndex >= 0) {
  const descendantOutput = process.argv[descendantOutputIndex + 1];
  const code = `
    const fs = require('node:fs');
    const path = require('node:path');
    process.on('SIGTERM', () => {});
    setTimeout(() => {
      fs.mkdirSync(path.dirname(process.argv[1]), { recursive: true });
      fs.writeFileSync(process.argv[1], 'descendant-survived');
    }, 3000);
    setInterval(() => {}, 1000);
  `;
  spawn(process.execPath, ['-e', code, descendantOutput], { stdio: 'ignore' });
}

process.on('SIGTERM', () => {
  process.stdout.write(`${JSON.stringify({ type: 'sigterm-ignored', pid: process.pid })}\n`);
  if (process.argv.includes('--leader-exits-on-term')) process.exit(0);
});

process.stdout.write(`${JSON.stringify({ type: 'fixture-ready', pid: process.pid })}\n`);
if (process.argv.includes('--leader-exits-normally-after-ready')) {
  // Give the descendant a scheduling window before the leader exits. The
  // process-group contract is exercised under the full verifier suite, where
  // a 300ms window is not reliable on a busy host.
  setTimeout(() => process.exit(0), 1_000);
}
setInterval(() => undefined, 1_000);
