import { isMap, isSeq, parseDocument } from 'yaml';
import { isDeepStrictEqual } from 'node:util';
import { Conflict } from './files.mjs';

export class Dsh {
  static id = 'mcp-tether';
  static plugin = '@deepseek-ai/dsh-mcp-client';
  static edit(text, entry, force = false) {
    const doc = parseDocument(text.trim() ? text : '[]\n');
    if (doc.errors.length || !isSeq(doc.contents)) throw new Error('DSH configuration must be a YAML patch list');
    const desired = { id: Dsh.id, name: Dsh.plugin, config: { serverName: 'tether', transport: 'stdio', ...entry } };
    const matches = [];
    const walk = node => {
      if (isSeq(node)) for (const child of node.items) walk(child);
      if (!isMap(node)) return;
      const config = node.get('config');
      if (node.get('id') === Dsh.id || (node.get('name') === Dsh.plugin && isMap(config) && config.get('serverName') === 'tether')) matches.push(node);
      for (const pair of node.items) walk(pair.value);
    };
    walk(doc.contents);
    if (matches.length > 1) throw new Conflict('Multiple DSH Tether entries; resolve duplicates before installing');
    if (matches.length) {
      const node = matches[0];
      const actual = node.toJSON();
      // Retain a user's existing plugin identity when updating its transport.
      desired.id = actual.id || Dsh.id;
      if (isDeepStrictEqual(actual, desired)) return text;
      if (!force) throw new Conflict('Conflicting tether entry');
      for (const pair of [...node.items]) node.delete(pair.key.value);
      for (const [key, value] of Object.entries(desired)) node.set(key, value);
    } else {
      doc.contents.flow = false;
      doc.contents.add(doc.createNode({ insert: [desired] }));
    }
    return String(doc);
  }
}
