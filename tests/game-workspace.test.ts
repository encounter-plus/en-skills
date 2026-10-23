import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-ignore resource is shipped as JavaScript with the skill
import {initializeWorkspace} from '../skills/game-author/scripts/init-workspace.mjs';

test('game workspaces are independent and reinitialization preserves author decisions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'en-workspace-'));
  try {
    const a=await initializeWorkspace(join(root,'a'),'Игра A');
    const b=await initializeWorkspace(join(root,'b'),'Игра B');
    assert.notEqual(a.project.id,b.project.id);
    const entries=await readdir(a.root);
    assert.ok(!entries.includes('planning'));
    assert.ok(!entries.includes('archive'));
    await writeFile(join(a.root,'decisions.md'),'Согласовано автором');
    await writeFile(join(a.root,'tasks.md'),'T-042: активная задача');
    await mkdir(join(a.root,'planning'));
    await writeFile(join(a.root,'planning','backlog.md'),'T-043: отложено');
    await mkdir(join(a.root,'archive','tasks'),{recursive:true});
    await writeFile(join(a.root,'archive','tasks','2026-10.md'),'T-041: проверено');
    assert.equal((await initializeWorkspace(a.root,'Другое имя')).created,false);
    assert.equal(await readFile(join(a.root,'decisions.md'),'utf8'),'Согласовано автором');
    assert.equal(await readFile(join(a.root,'tasks.md'),'utf8'),'T-042: активная задача');
    assert.equal(await readFile(join(a.root,'planning','backlog.md'),'utf8'),'T-043: отложено');
    assert.equal(await readFile(join(a.root,'archive','tasks','2026-10.md'),'utf8'),'T-041: проверено');
    assert.match(await readFile(join(b.root,'GAME.md'),'utf8'),/Игра B/);
    await writeFile(join(b.root,'.en-agent/project.json'),JSON.stringify({...b.project,templateVersion:99}));
    await assert.rejects(initializeWorkspace(b.root,'B'),/migration/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('initialization refuses populated folders and linked metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'en-workspace-'));
  try {
    await writeFile(join(root,'source.txt'),'keep');
    await assert.rejects(initializeWorkspace(root,'Game'),/empty folder/);
    const other=join(root,'other');await mkdir(other);
    const game=join(root,'game');await mkdir(game);
    await symlink(other,join(game,'.en-agent'),'junction');
    await assert.rejects(initializeWorkspace(game,'Game'),/symbolic link/);
    assert.equal(await readFile(join(root,'source.txt'),'utf8'),'keep');
  } finally {await rm(root,{recursive:true,force:true});}
});
