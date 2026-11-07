// Writes the public suffix list that the desktop app uses (from tldts) for BoltworkKit:
//   node apple/tools/dump-psl.mjs > apple/BoltworkKit/Sources/BoltworkKit/Resources/public-suffixes.txt
// One rule per line, labels in normal order; "!" marks exceptions, "*" wildcards.
import * as t from '../../node_modules/tldts/dist/es6/src/data/trie.js';
const offsets = [];
for (let node = 0, offset = 0; node < t.nodeFlags.length; node++) {
  for (let e = t.edgeStart[node]; e < t.edgeStart[node + 1]; e++) { offsets[e] = offset; offset += t.edgeLength[e]; }
}
const out = [];
function walk(node, labels, prefix) {
  if (t.nodeFlags[node] && labels.length) out.push(prefix + [...labels].reverse().join('.'));
  for (let e = t.edgeStart[node]; e < t.edgeStart[node + 1]; e++) {
    walk(t.edgeChild[e], [...labels, t.labelText.slice(offsets[e], offsets[e] + t.edgeLength[e])], prefix);
  }
}
walk(t.rulesRoot, [], '');
walk(t.exceptionsRoot, [], '!');
console.log(`// Public suffix list (publicsuffix.org, MPL 2.0) via tldts ${JSON.parse((await import('node:fs')).readFileSync('node_modules/tldts/package.json', 'utf8')).version}.`);
console.log(out.sort().join('\n'));
