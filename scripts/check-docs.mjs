import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class DocRules {
  static ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  static DIRS = ['assets', 'docs', 'prototype', 'skills'];
  static SKIP = new Set(['node_modules', '.local', '.venv', '.npm-cache', 'dist', 'work', '__pycache__', 'evidence']);
  static ZH = '.zh-CN.md';
  static LOCAL = new Set(['RENAME-STATUS.md']);
}

class Docs {
  static files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
      if (DocRules.SKIP.has(item.name)) return [];
      const file = path.join(dir, item.name);
      return item.isDirectory() ? Docs.files(file) : item.name.endsWith('.md') ? [file] : [];
    });
  }
  static read(file) { return fs.readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''); }
  static structure(text) {
    const headings = [], blocks = [], tables = [];
    let fence = null;
    let table = null;
    for (const line of text.split(/\r?\n/)) {
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) { fence=marker[1][0]; blocks.push(marker[2].trim()); }
        else if (marker[1][0] === fence) fence=null;
        continue;
      }
      if (!fence) {
        const heading=line.match(/^(#{1,6})\s/);
        if (heading) headings.push(heading[1].length);
        if (/^\|/.test(line)) {
          if (!table) { table=[]; tables.push(table); }
          table.push(line.replace(/`[^`]*`/g,'').split('|').length-2);
        } else table=null;
      }
    }
    return { headings, blocks, tables, closed: fence === null };
  }
  static links(file, text, errors) {
    const links = [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1].replace(/^<|>$/g,''));
    let count=0;
    for (const link of links) {
      if (/^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('#')) continue;
      const target=path.resolve(path.dirname(file),decodeURIComponent(link.split('#')[0]));
      if (!fs.existsSync(target)) errors.push(`${path.relative(DocRules.ROOT,file)}: missing link ${link}`);
      count++;
    }
    return { links, count };
  }
  static run() {
    const roots=fs.readdirSync(DocRules.ROOT).filter(name=>name.endsWith('.md')&&!DocRules.LOCAL.has(name)).map(name=>path.join(DocRules.ROOT,name));
    const files=[...roots,...DocRules.DIRS.flatMap(dir=>Docs.files(path.join(DocRules.ROOT,dir)))];
    const errors=[];
    let count=0,pairs=0;
    for(const file of files) {
      const text=Docs.read(file);
      const zh=file.endsWith(DocRules.ZH);
      const peer=zh?file.slice(0,-DocRules.ZH.length)+'.md':file.slice(0,-3)+DocRules.ZH;
      const links=Docs.links(file,text,errors); count+=links.count;
      if (!fs.existsSync(peer)) {errors.push(`${path.relative(DocRules.ROOT,file)}: missing translation`);continue;}
      if(!links.links.includes(path.basename(peer))) errors.push(`${path.relative(DocRules.ROOT,file)}: missing language-switch link`);
      if(!zh) {
        pairs++;
        const left=Docs.structure(text),right=Docs.structure(Docs.read(peer));
        if(!left.closed||!right.closed) errors.push(`${path.relative(DocRules.ROOT,file)}: unclosed code fence`);
        if(JSON.stringify(left.headings)!==JSON.stringify(right.headings)) errors.push(`${path.relative(DocRules.ROOT,file)}: heading structure differs`);
        if(JSON.stringify(left.blocks)!==JSON.stringify(right.blocks)) errors.push(`${path.relative(DocRules.ROOT,file)}: code-block structure differs`);
        if(JSON.stringify(left.tables)!==JSON.stringify(right.tables)) errors.push(`${path.relative(DocRules.ROOT,file)}: table structure differs`);
      }
    }
    console.log(JSON.stringify({documents:files.length,pairs,localLinks:count,errors},null,2));
    process.exitCode=errors.length?1:0;
  }
}

Docs.run();
