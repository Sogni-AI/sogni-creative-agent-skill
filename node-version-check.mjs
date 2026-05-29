// Zero-dependency Node.js version guard.
//
// This module is imported FIRST by sogni-agent.mjs (before `sharp` and the
// Sogni SDK). ES modules evaluate their dependencies in source order, so this
// runs — and can exit cleanly — before any modern-syntax/native dependency is
// loaded. That turns "wrong Node version" from a cryptic native/ESM stack
// trace into a one-line, actionable message.
//
// Keep this file import-free and syntactically conservative so it parses and
// runs on old Node versions too.

var MIN_NODE_VERSION = [22, 11, 0];

function isVersionAtLeast(current, required) {
  for (var i = 0; i < required.length; i++) {
    var currentValue = current[i] || 0;
    var requiredValue = required[i] || 0;
    if (currentValue > requiredValue) return true;
    if (currentValue < requiredValue) return false;
  }
  return true;
}

try {
  var raw = (process && process.versions && process.versions.node) || '0';
  var current = String(raw).split('.').map(function (part) { return Number(part); });
  if (!isVersionAtLeast(current, MIN_NODE_VERSION)) {
    var required = MIN_NODE_VERSION.join('.');
    process.stderr.write(
      'Error: Sogni requires Node.js >= ' + required + ' (you have ' + raw + ').\n' +
      'Hint: Upgrade Node — e.g. with nvm (`nvm install ' + MIN_NODE_VERSION[0] + '`), fnm, or volta — then re-run.\n'
    );
    process.exit(1);
  }
} catch (err) {
  // Never let the guard itself crash the CLI; fall through to normal startup.
}
